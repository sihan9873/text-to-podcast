"""隔离临时数据库 + 真实 TCP/Qwen + Mock TTS 验证；不会修改已有服务或数据库。

从仓库根目录：conda run -n podcast-backend python scripts/verify_local_llm.py
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

from verify_backend_flow import BackendClient, run_flow

ROOT = Path(__file__).resolve().parents[1]


def conda_python(environment):
    result = subprocess.run(["conda", "run", "--no-capture-output", "-n", environment,
        "python", "-c", "import sys; print(sys.executable)"], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llm-env", default="podcast-llm", help="LLM 的 Conda 环境")
    parser.add_argument("--tts-env", default="podcast-tts-service", help="Mock TTS 的独立 Conda 环境")
    parser.add_argument("--llm-python", type=Path, help="可选：显式覆盖 LLM Python 路径")
    parser.add_argument("--description", default="写一段双人中文播客，给初学者介绍太阳系，4到6条简短台词，语气轻松。")
    parser.add_argument("--report", type=Path, default=ROOT / "outputs/llm-verification/report.json")
    args = parser.parse_args()
    llm_python = str(args.llm_python.resolve()) if args.llm_python else conda_python(args.llm_env)
    tts_python = conda_python(args.tts_env)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = {"scope": "real TCP + Qwen LLM + backend Worker/SQLite + Mock TTS + MP3 decode", "status": "running"}
    children, logs = [], []
    with tempfile.TemporaryDirectory(prefix="podcast-llm-flow-") as temporary:
        folder = Path(temporary)
        # 保留三个 socket，确保端口彼此不同，然后交给服务启动。
        sockets = [socket.socket() for _ in range(3)]
        try:
            for sock in sockets:
                sock.bind(("127.0.0.1", 0))
            api_port, tts_port, llm_port = [sock.getsockname()[1] for sock in sockets]
        finally:
            for sock in sockets:
                sock.close()
        env = {**os.environ, "DATABASE_URL": f"sqlite:///{folder}/test.sqlite3", "STORAGE_DIR": str(folder / "assets"),
               "LLM_PROVIDER": "local_http", "LOCAL_LLM_BASE_URL": f"http://127.0.0.1:{llm_port}",
               "LOCAL_LLM_MODEL_ID": "Qwen/Qwen2.5-0.5B-Instruct", "LOCAL_LLM_TIMEOUT_SECONDS": "300",
               "LOCAL_LLM_MAX_NEW_TOKENS": "1536", "AUDIO_PROVIDER": "local_http",
               "LOCAL_TTS_BASE_URL": f"http://127.0.0.1:{tts_port}", "LOCAL_TTS_ENGINE_ID": "mock"}
        try:
            subprocess.run([sys.executable, "-m", "app.bootstrap"], cwd=ROOT / "backend", env=env, check=True)
            commands = [
                ("llm", llm_python, ROOT / "llm", ["-m", "uvicorn", "llm_service.app:app", "--host", "127.0.0.1", "--port", str(llm_port)]),
                ("tts", tts_python, ROOT / "tts", ["-m", "uvicorn", "tts_service.app:app", "--host", "127.0.0.1", "--port", str(tts_port)]),
                ("api", sys.executable, ROOT / "backend", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(api_port)]),
                ("worker", sys.executable, ROOT / "backend", ["-m", "app.worker"]),
            ]
            for name, python, cwd, command in commands:
                log = (folder / f"{name}.log").open("w")
                logs.append(log)
                children.append(subprocess.Popen([python, *command], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT))
            client = BackendClient(f"http://127.0.0.1:{api_port}")
            deadline = time.monotonic() + 30
            for port, path in ((api_port, "/api/v1/health/ready"), (tts_port, "/health"), (llm_port, "/v1/models")):
                while True:
                    try:
                        data = BackendClient(f"http://127.0.0.1:{port}").request(path)
                        if port == llm_port:
                            assert data["models"][0]["loaded"] is False
                        break
                    except Exception:
                        if time.monotonic() > deadline or any(child.poll() is not None for child in children):
                            raise RuntimeError("验证服务启动失败")
                        time.sleep(0.1)
            started = time.monotonic()
            audio = run_flow(client, "mock", 300, report, args.description)
            decoded = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
                "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"], input=audio, capture_output=True, check=True, timeout=60).stdout
            assert decoded
            script = client.request(f"/api/v1/scripts/{report['script_id']}")
            with sqlite3.connect(folder / "test.sqlite3") as database:
                snapshot = json.loads(database.execute("SELECT llm_snapshot FROM scripts WHERE id=?", (report["script_id"],)).fetchone()[0])
                metadata = json.loads(database.execute("SELECT metadata_json FROM assets WHERE id=?", (report["audio_result"]["asset_id"],)).fetchone()[0])
            assert snapshot["simulated"] is False and metadata["script_simulated"] is False
            assert metadata["simulated"] is True and metadata["real_speech"] is False
            report.update(status="succeeded", seconds=round(time.monotonic() - started, 3),
                script_title=script["title"], sentence_count=len(script["sentences"]), script_simulated=False,
                audio_metadata=metadata, mp3_bytes=len(audio), decoded_seconds=len(decoded) / 48000)
        except Exception as exc:
            report.update(status="failed", error_type=type(exc).__name__, error=str(exc))
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
            for child in children:
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=10)
            for log in logs:
                log.close()
            if report["status"] == "failed":
                for log in folder.glob("*.log"):
                    (args.report.parent / log.name).write_bytes(log.read_bytes())
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "succeeded":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
