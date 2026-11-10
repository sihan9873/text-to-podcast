"""Linux/WSL 本地服务管理：Conda 运行 API、Worker、Qwen LLM 和配置指定的 TTS。"""
import argparse
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import sys
from threading import Event
import time
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "outputs/local-services"
STATE = RUNTIME / "processes.json"
UNIT = "text-to-podcast-local.service"


def python_for(environment):
    conda = os.environ.get("CONDA_EXE") or shutil.which("conda")
    if not conda:
        raise RuntimeError("找不到 Conda，请使用 conda run 执行本工具")
    result = subprocess.run([conda, "run", "--no-capture-output", "-n", environment,
        "python", "-c", "import sys; print(sys.executable)"], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1].split()
        return None if fields[0] == "Z" else fields[19]
    except (OSError, IndexError):
        return None


def alive(process):
    return process.get("identity") is not None and identity(process["pid"]) == process["identity"]


def read_state():
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def stop(state):
    # 只停止本工具记录且启动时间仍匹配的进程，避免 PID 复用误杀。
    for process in state.values():
        if alive(process):
            os.kill(process["pid"], signal.SIGTERM)
    deadline = time.monotonic() + 10
    while any(alive(p) for p in state.values()) and time.monotonic() < deadline:
        time.sleep(0.1)
    for process in state.values():
        if alive(process):
            os.kill(process["pid"], signal.SIGKILL)


def start():
    state = read_state()
    if any(alive(p) for p in state.values()):
        raise RuntimeError("已有本工具启动的服务，请先 status 或 stop")
    for port in (8000, 8001, 8002):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
    backend = python_for("podcast-backend")
    llm = python_for("podcast-llm")
    # 由后端自己的配置加载器读取 .env，不输出数据库连接串等敏感配置。
    config_code = "from app.core.config import Settings; import json; s=Settings.from_env(); print(json.dumps([s.llm_provider,s.llm_base_url,s.audio_provider,s.tts_base_url,s.tts_engine_id]))"
    config = json.loads(subprocess.run([backend, "-c", config_code], cwd=ROOT / "backend",
        check=True, capture_output=True, text=True).stdout)
    if config[:4] != ["local_http", "http://127.0.0.1:8002", "local_http", "http://127.0.0.1:8001"] or config[4] not in ("mock", "qwen3-customvoice"):
        raise RuntimeError("统一启动要求本地8002的 Qwen LLM，以及本地8001的 mock 或 qwen3-customvoice TTS")
    engine_id = config[4]
    tts = python_for("podcast-tts" if engine_id == "qwen3-customvoice" else "podcast-tts-service")
    tts_env = dict(os.environ)
    tts_app = "tts_service.app:app"
    if engine_id == "qwen3-customvoice":
        # 模型部署配置属于 TTS；由已有后端 dotenv 解析，不给轻量 TTS 新增依赖。
        config_code = "from dotenv import dotenv_values; import os,json,sys; v=dotenv_values(sys.argv[1]); print(json.dumps({k:os.environ.get(k,v[k]) for k in v if k.startswith('TTS_QWEN_') and v[k] is not None}))"
        tts_env.update(json.loads(subprocess.run([backend, "-c", config_code, str(ROOT / "tts/.env")], check=True,
            capture_output=True, text=True).stdout))
        tts_env["TTS_ENABLE_QWEN"] = "1"
        tts_app = "tts_service.configured:configured_app"
        preflight = subprocess.run([tts, "-c", "import json; from dataclasses import asdict; from tts_service.qwen import Qwen3Engine,QwenConfig; print(json.dumps(asdict(Qwen3Engine(QwenConfig.from_env()).info())))"],
            cwd=ROOT / "tts", env=tts_env, check=True, capture_output=True, text=True)
        info = json.loads(preflight.stdout)
        if not info["installed"]:
            raise RuntimeError("Qwen TTS 资源检查失败：" + str(info["availability_reason"]) + "；请检查 tts/.env 的 TTS_QWEN_MODEL_PATH")
    subprocess.run([backend, "-m", "app.bootstrap"], cwd=ROOT / "backend", check=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    commands = {
        "llm": (llm, "llm", ["-m", "uvicorn", "llm_service.app:app", "--host", "127.0.0.1", "--port", "8002", "--workers", "1"]),
        "tts": (tts, "tts", ["-m", "uvicorn", tts_app, *(["--factory"] if engine_id == "qwen3-customvoice" else []), "--host", "127.0.0.1", "--port", "8001", "--workers", "1"]),
        "api": (backend, "backend", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]),
        "worker": (backend, "backend", ["-m", "app.worker"]),
    }
    state = {}
    try:
        for name, (python, cwd, args) in commands.items():
            with (RUNTIME / f"{name}.log").open("a") as log:
                process = subprocess.Popen([python, *args], cwd=ROOT / cwd,
                    env={**(tts_env if name == "tts" else os.environ), "PYTHONUNBUFFERED": "1"}, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            state[name] = {"pid": process.pid, "identity": identity(process.pid), "log": str(RUNTIME / f"{name}.log")}
        temporary = STATE.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2) + "\n")
        temporary.replace(STATE)
        opener = build_opener(ProxyHandler({}))
        deadline = time.monotonic() + 30
        for url in ("http://127.0.0.1:8000/api/v1/health/ready", "http://127.0.0.1:8001/health", "http://127.0.0.1:8002/v1/models"):
            while True:
                try:
                    with opener.open(url, timeout=2) as reply:
                        if reply.status == 200:
                            break
                except OSError:
                    pass
                if time.monotonic() >= deadline or not all(alive(p) for p in state.values()):
                    raise RuntimeError(f"服务启动失败，请检查 {RUNTIME} 中的日志")
                time.sleep(0.2)
    except BaseException:
        stop(state)
        raise
    print(json.dumps({"status": "started", "api": "http://127.0.0.1:8000/docs",
        "llm": "http://127.0.0.1:8002/docs", "tts_engine_id": engine_id, "processes": state}, indent=2))
    return state


def run_supervisor():
    stopped = Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    state = start()
    try:
        while not stopped.wait(1):
            if not all(alive(p) for p in state.values()):
                raise RuntimeError("服务进程退出，请检查日志；托管器将停止其余进程")
    finally:
        stop(state)


def start_systemd():
    if subprocess.run(["systemctl", "--user", "is-active", "--quiet", UNIT]).returncode == 0:
        print("服务已由 systemd 托管，无需重复启动")
        return
    conda = os.environ.get("CONDA_EXE") or shutil.which("conda")
    if not conda:
        raise RuntimeError("找不到 Conda")
    subprocess.run(["systemd-run", "--user", "--unit=" + UNIT, "--collect",
        "--property=Type=exec", "--property=Restart=on-failure", "--property=RestartSec=5",
        "--working-directory=" + str(ROOT), "--setenv=CONDA_EXE=" + conda,
        "--setenv=PYTHONUNBUFFERED=1", sys.executable, str(Path(__file__).resolve()), "run"], check=True)
    deadline = time.monotonic() + 45
    opener = build_opener(ProxyHandler({}))
    while time.monotonic() < deadline:
        state = read_state()
        if len(state) == 4 and all(alive(p) for p in state.values()):
            try:
                for port, path in ((8000, "/api/v1/health/ready"), (8001, "/health"), (8002, "/v1/models")):
                    with opener.open(f"http://127.0.0.1:{port}{path}", timeout=2):
                        pass
                print("服务已就绪，由用户级 systemd 托管；API http://127.0.0.1:8000/docs")
                return
            except OSError:
                pass
        time.sleep(0.2)
    subprocess.run(["systemctl", "--user", "stop", UNIT], check=False)
    raise RuntimeError("服务未在45秒内就绪，请查看 journalctl --user -u " + UNIT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "status", "stop", "run"])
    args = parser.parse_args()
    if args.action == "start":
        start_systemd()
    elif args.action == "run":
        run_supervisor()
    elif args.action == "stop":
        loaded = subprocess.run(["systemctl", "--user", "show", UNIT, "--property=LoadState", "--value"],
            capture_output=True, text=True)
        if loaded.stdout.strip() not in ("", "not-found"):
            subprocess.run(["systemctl", "--user", "stop", UNIT], check=True)
        stop(read_state())
        print("本工具管理的服务已停止")
    else:
        print(json.dumps({name: {**p, "running": alive(p)} for name, p in read_state().items()}, indent=2))


if __name__ == "__main__":
    main()
