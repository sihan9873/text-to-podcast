"""Verify real HTTP LLM through an isolated generation API and Worker, without TTS."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4

from local_console import terminate
from local_tasks import ROOT, python_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="控制台当前一轮目录")
    parser.add_argument("--source-file", type=Path)
    args = parser.parse_args()
    config = json.loads((args.run / "config.json").read_text(encoding="utf-8"))
    if config["mode"] not in ("customvoice", "clone"):
        raise RuntimeError("需要先启动真实 LLM 模式")
    source = args.source_file.read_text(encoding="utf-8") if args.source_file else "Transformer 使用多头注意力处理序列，可以并行训练，在自然语言处理和计算机视觉领域都有应用。请据此介绍其基本原理。"
    output = args.run / "results" / ("real-script-" + uuid4().hex[:8])
    output.mkdir(parents=True)
    env = {**os.environ, **config["env"], "TEXTCAST_AUTH_URL": "", "LLM_PROVIDER": "local_http",
           "AUDIO_PROVIDER": "mock", "DATABASE_URL": "sqlite:///" + (output / "isolated.sqlite3").resolve().as_posix(),
           "STORAGE_DIR": str(output / "assets"), "PYTHONUNBUFFERED": "1"}
    executable = python_for("generation-backend")
    subprocess.run([executable, "-m", "app.bootstrap"], cwd=ROOT / "generation-backend", env=env, check=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    opener = build_opener(ProxyHandler({}))

    def call(method, path, body=None, key=None):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Idempotency-Key"] = key
        request = Request(base + path, method=method, headers=headers,
                          data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
        with opener.open(request, timeout=15) as response:
            return json.load(response)["data"]

    children = []
    try:
        for name, command in (
            ("api", [executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)]),
            ("worker", [executable, "-m", "app.worker"]),
        ):
            with (output / (name + ".log")).open("w", encoding="utf-8") as log:
                children.append(subprocess.Popen(command, cwd=ROOT / "generation-backend", env=env,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=os.name != "nt"))
        for _ in range(100):
            try:
                with opener.open(base + "/api/v1/health/ready", timeout=1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise TimeoutError("隔离生成 API 未启动")
        project = call("POST", "/api/v1/projects", {"title": "真实 LLM 修复验证"})
        pid = project["project_id"]
        call("PUT", f"/api/v1/projects/{pid}/source", {"text": source})
        accepted = call("POST", f"/api/v1/projects/{pid}/script/generate", {
            "roles": [{"profile_id": 1, "role_key": "role_1"}], "target_minutes": 10, "style": "自然、清晰、连贯",
        }, uuid4().hex)
        previous = None
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            task = call("GET", f'/api/v1/tasks/{accepted["task_id"]}')
            if task["status"] != previous:
                print("真实 LLM 脚本任务：", task["status"], flush=True)
                previous = task["status"]
            if task["status"] == "failed":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            if task["status"] == "succeeded":
                break
            time.sleep(0.5)
        else:
            raise TimeoutError("真实 LLM 脚本任务超时")
        script = call("GET", f'/api/v1/scripts/{task["result"]["script_id"]}')
        assert script["sentences"] and script["title"] not in ("简短标题", "根据素材填写标题")
        latest = call("GET", f"/api/v1/projects/{pid}/tasks?page=1&page_size=1&task_type=script")["items"][0]
        assert latest["task_id"] == task["task_id"] and latest["status"] == "succeeded"
        assert not call("GET", f"/api/v1/projects/{pid}")["active_tasks"]
        (output / "script.json").write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
        report = {"status": "passed", "real_models": True, "scope": "real LLM script only; no TTS or audio tested",
                  "title": script["title"], "sentences": len(script["sentences"]), "source_chars": len(source),
                  "task_status": latest["status"], "output": str(output)}
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    finally:
        for child in children:
            terminate(child)


if __name__ == "__main__":
    main()
