"""Start with `python scripts/local_console.py`; visit http://localhost:8765.

Standard-library supervisor, intentionally separate from production APIs.
"""
from __future__ import annotations

import argparse
import atexit
import json
import mimetypes
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from urllib.request import ProxyHandler, build_opener

from local_tasks import DATA, MODES, OPTION_KEYS, ROOT, options, pnpm, prepare, python_for, tool_env, tts_environment, tts_python
from hardware import collect_hardware

TASKS = {
    "install-tts-fast": "安装独立 TTS 加速环境（联网）",
    "download-customvoice-1.7b": "下载 Qwen TTS 1.7B（联网）",
    "preflight": "环境检查", "install": "安装缺失的独立开发环境（联网）",
    "health": "服务健康检查", "flow": "短文 HTTP 闭环", "long-flow": "长文 HTTP 闭环",
    "test-frontend": "前端完整检查", "test-backend": "账号测试",
    "test-generation-backend": "生成服务测试", "test-llm": "LLM 无模型测试", "test-tts": "TTS 无模型测试",
    "llm-demo": "LLM 单独生成测试", "tts-demo": "TTS 双声音试听",
    "verify-real-script": "真实 LLM 脚本闭环（不生成音频）",
    "download-llm": "下载 Qwen 0.5B（联网）", "download-llm-4b": "下载 Qwen 4B（联网）", "download-customvoice": "下载 CustomVoice 模型（联网）", "download-base": "下载 Base 模型（联网）",
}


def service_definitions(mode):
    definitions = [
        ("account", "backend", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]),
        ("generation", "generation-backend", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"]),
        ("worker-script", "generation-backend", ["-m", "app.worker", "--queue", "script"]),
        ("worker-audio", "generation-backend", ["-m", "app.worker", "--queue", "audio"]),
    ]
    if mode != "mock":
        definitions.append(("tts", "tts", ["-m", "uvicorn", "tts_service.configured:configured_app", "--factory", "--host", "127.0.0.1", "--port", "8002"]))
    if mode in MODES[2:]:
        definitions.append(("llm", "llm", ["-m", "uvicorn", "llm_service.app:app", "--host", "127.0.0.1", "--port", "8003"]))
    return definitions


def terminate(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait(timeout=5)


class Console:
    def __init__(self):
        self.lock = threading.RLock()
        self.services = {}
        self.jobs = {}
        self.folder = None
        self.config = None
        self.closing = False
        self.hardware_report = None
        self.hardware_error = None
        self.hardware_detecting = False
        self.hardware_started = 0.0

    def spawn(self, command, cwd, env, log):
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("ab") as output:
            return subprocess.Popen(command, cwd=cwd, env={**env, "PYTHONUNBUFFERED": "1"}, stdout=output, stderr=subprocess.STDOUT,
                                    start_new_session=os.name != "nt")

    def busy(self):
        return any(item["process"].poll() is None for item in self.jobs.values())

    def start(self, mode, resume=None):
        with self.lock:
            if self.closing:
                raise ValueError("控制台正在关闭")
            if mode not in MODES:
                raise ValueError("未知模式")
            if self.busy() or any(j.get("starting") for j in self.jobs.values()) or any(p["process"].poll() is None for p in self.services.values()):
                raise ValueError("请等待任务结束并停止当前服务后再启动新一轮")
            for port in (8000, 8001, 5173, *((8002,) if mode != "mock" else ()), *((8003,) if mode in MODES[2:] else ())):
                with socket.socket() as sock:
                    if os.name != "nt":
                        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    try:
                        sock.bind(("127.0.0.1", port))
                    except OSError as exc:
                        raise ValueError(f"端口 {port} 被占用；请停止原服务，控制台不会结束非本控制台启动的进程") from exc
            if resume is None:
                folder, config = prepare(mode)
            else:
                folder = Path(resume).resolve()
                if not folder.is_relative_to(DATA.resolve()) or folder.parent != DATA.resolve():
                    raise ValueError("只能恢复控制台已有的隔离测试目录")
                config = json.loads((folder / "config.json").read_text(encoding="utf-8"))
                if config["mode"] != mode:
                    raise ValueError("恢复模式与保存配置不一致")
            # Resume keeps projects and assets while applying explicit TTS preferences.
            if resume is not None and any(k in options() for k in ("TTS_MODEL_SIZE", "TTS_QWEN_BACKEND")):
                config["env"].update(tts_environment({**os.environ, **options()}))
                (folder / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
            self.folder, self.config = folder, config
            if mode in MODES[2:]:
                for key in ("LLM_MODEL_PATH", "TTS_QWEN_MODEL_PATH" if mode == "customvoice" else "TTS_QWEN_BASE_MODEL_PATH"):
                    if not Path(config["env"][key]).is_dir():
                        raise ValueError(f"模型目录不存在：{key}={config['env'][key]}；请按文档配置本地模型路径")
            env = {**tool_env(), **config["env"]}
            # Sanitize frontend URL overrides so traffic always goes through Vite's cookie proxy.
            for key in tuple(env):
                if key.startswith("VITE_") and key not in config["env"]:
                    del env[key]
            self.services = {}
            # Bootstrap and service startup run in a job subprocess; HTTP server stays responsive.
            job = self.job("bootstrap", [python_for("generation-backend"), "-m", "app.bootstrap"], ROOT / "generation-backend", env)
            threading.Thread(target=self.finish_start, args=(job, folder, config, env), daemon=True).start()
            return job["id"]

    def finish_start(self, job, folder, config, env):
        try:
            code = job["process"].wait(timeout=180)
            with self.lock:
                if self.closing or job.get("cancelled"):
                    return
                if code:
                    raise RuntimeError("数据库初始化失败，请查看启动日志")
                mode = config["mode"]
                for name, module, args in service_definitions(mode):
                    executable = tts_python(config["env"]) if name == "tts" and mode == "customvoice" else python_for("tts-real" if name == "tts" and mode in MODES[2:] else module)
                    self.service(name, [executable, *args], ROOT / module, env, folder)
                self.service("frontend", [*pnpm(), "dev", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], ROOT / "frontend", env, folder)
            opener = build_opener(ProxyHandler({}))
            endpoints = ["http://127.0.0.1:8000/api/health", "http://127.0.0.1:8001/api/v1/health/ready", "http://127.0.0.1:5173"]
            if mode != "mock":
                endpoints.append("http://127.0.0.1:8002/health")
            if mode in MODES[2:]:
                endpoints.append("http://127.0.0.1:8003/health")
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                with self.lock:
                    if job.get("cancelled") or self.closing:
                        return
                    if any(p["process"].poll() is not None for p in self.services.values()):
                        raise RuntimeError("有服务提前退出，请查看对应日志")
                pending = []
                for url in endpoints:
                    try:
                        with opener.open(url, timeout=1):
                            pass
                    except OSError:
                        pending.append(url)
                if not pending:
                    break
                endpoints = pending
                time.sleep(0.2)
            else:
                raise TimeoutError("服务未在60秒内就绪：" + ", ".join(endpoints))
            with self.lock:
                if not job.get("cancelled"):
                    job["stage"] = "ready"
                    self.append(job, "全部服务就绪。打开 http://localhost:5173，管理员：admin / TextCast123!。模型仍需推理验收。")
        except Exception as exc:
            with self.lock:
                job["error"] = str(exc)
                self.append(job, str(exc))
                terminate(job["process"])
                for item in self.services.values():
                    terminate(item["process"])
        finally:
            with self.lock:
                job["starting"] = False

    def append(self, job, message):
        with job["log"].open("a", encoding="utf-8") as stream:
            stream.write("\n" + message + "\n")

    def service(self, name, command, cwd, env, folder):
        log = folder / "logs" / (name + ".log")
        self.services[name] = {"process": self.spawn(command, cwd, env, log), "log": log}

    def job(self, action, command, cwd, env):
        identity = uuid()
        log = DATA / "jobs" / (identity + ".log")
        item = {"id": identity, "action": action, "log": log, "starting": action == "bootstrap"}
        item["process"] = self.spawn(command, cwd, env, log)
        self.jobs[identity] = item
        return item

    def task(self, action):
        with self.lock:
            if self.closing or action not in TASKS:
                raise ValueError("未知操作或控制台正在关闭")
            if self.busy() or any(j.get("starting") for j in self.jobs.values()):
                raise ValueError("已有任务运行中，请等待或取消")
            if action in ("flow", "long-flow", "health", "llm-demo", "tts-demo", "verify-real-script") and (not self.config or not self.services or any(p["process"].poll() is not None for p in self.services.values())):
                raise ValueError("请先启动本轮服务并等待就绪")
            if action in ("llm-demo", "verify-real-script") and self.config["mode"] not in MODES[2:]:
                raise ValueError("LLM 单测需要启动真实模型模式")
            if action == "tts-demo" and self.config["mode"] == "mock":
                raise ValueError("TTS 试听需要 HTTP Mock 或真实模型模式")
            if (action in ("install", "install-tts-fast") or action.startswith("download-")) and any(p["process"].poll() is None for p in self.services.values()):
                raise ValueError("安装依赖或下载模型前请停止服务")
            command = [sys.executable, str(ROOT / "scripts/local_tasks.py"), action]
            if self.folder:
                command.append(str(self.folder))
            return self.job(action, command, ROOT, {**tool_env(), "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1"})["id"]

    def stop(self):
        with self.lock:
            for item in self.jobs.values():
                if item["process"].poll() is None or item.get("starting"):
                    item["cancelled"] = True
                    terminate(item["process"])
                    item["starting"] = False
            for item in reversed(list(self.services.values())):
                terminate(item["process"])

    def restart(self):
        with self.lock:
            if self.folder is None or self.config is None:
                raise ValueError("请先启动一轮测试服务")
            folder, mode = self.folder, self.config["mode"]
            self.stop()
            return self.start(mode, resume=folder)

    def settings(self, values):
        with self.lock:
            if self.busy() or any(j.get("starting") for j in self.jobs.values()) or any(p["process"].poll() is None for p in self.services.values()):
                raise ValueError("请停止服务和任务后再保存设置")
            if not isinstance(values, dict) or values.keys() - OPTION_KEYS:
                raise ValueError("未知设置字段")
            for key, allowed in (("TTS_MODEL_SIZE", ("0.6b", "1.7b", "")), ("TTS_QWEN_BACKEND", ("standard", "faster", ""))):
                if key in values and values[key] not in allowed:
                    raise ValueError("TTS 模型规格或后端无效")
            values = dict(values)
            for key, default in (("TTS_MODEL_SIZE", "0.6b"), ("TTS_QWEN_BACKEND", "standard")):
                if key in values and values[key] == "":
                    values[key] = default
            for key, value in values.items():
                if not isinstance(value, str) or len(value) > 1024 or any(c in value for c in "\r\n\x00"):
                    raise ValueError("设置值无效")
                if value and (key.endswith("_PYTHON") or key.endswith("_PATH") or key.endswith("_BINARY")) and not Path(value).is_absolute():
                    raise ValueError("模型和解释器路径必须是绝对路径")
                if value and key.endswith("DEVICE") and value != "cpu" and not (value.startswith("cuda:") and value[5:].isdigit()):
                    raise ValueError("设备仅支持 cpu 或 cuda:N")
            DATA.mkdir(parents=True, exist_ok=True)
            path = DATA / "settings.json"
            path.write_text(json.dumps({k: v for k, v in values.items() if v}, ensure_ascii=False, indent=2), encoding="utf-8")
            path.chmod(0o600)

    def hardware(self, refresh=False):
        with self.lock:
            if not self.hardware_detecting and (self.hardware_started == 0 or
                    (refresh and time.monotonic() - self.hardware_started >= 30)):
                self.hardware_detecting = True
                self.hardware_started = time.monotonic()
                threading.Thread(target=self.detect_hardware, daemon=True).start()
            return {"status": "detecting" if self.hardware_detecting else "error" if self.hardware_error else "ready",
                    "report": self.hardware_report, "error": self.hardware_error}

    def detect_hardware(self):
        try:
            settings = options()
            report = collect_hardware(ROOT, tts_python(settings), settings.get("TTS_QWEN_BACKEND", "standard"))
            with self.lock:
                self.hardware_report, self.hardware_error = report, None
        except Exception as exc:
            with self.lock:
                self.hardware_error = type(exc).__name__
        finally:
            with self.lock:
                self.hardware_detecting = False

    def snapshot(self):
        with self.lock:
            def entry(item):
                process = item["process"]
                code = process.poll()
                return {"pid": process.pid, "exit_code": code,
                        "status": "cancelled" if item.get("cancelled") else "failed" if item.get("error") else "running" if code is None or item.get("starting") else "passed" if code == 0 else "failed"}
            return {"settings": options(), "mode": self.config["mode"] if self.config else None,
                    "folder": str(self.folder) if self.folder else None, "tasks": TASKS,
                    "services": {k: {**entry(v), "status": "running" if v["process"].poll() is None else "stopped" if v["process"].returncode in (0, -15) else "failed"} for k, v in self.services.items()},
                    "jobs": [{"id": k, "action": v["action"], **entry(v)} for k, v in reversed(list(self.jobs.items()))]}

    def log(self, name):
        with self.lock:
            item = self.jobs.get(name) or self.services.get(name)
            if not item:
                raise ValueError("找不到日志")
            with item["log"].open("rb") as stream:
                stream.seek(max(0, item["log"].stat().st_size - 65536))
                return stream.read().decode("utf-8", errors="replace")


def uuid():
    return secrets.token_hex(12)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, code, data, kind="application/json; charset=utf-8"):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(raw)

    def trusted(self):
        host = self.headers.get("Host", "")
        allowed = {f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}"}
        return host in allowed

    def do_GET(self):
        if not self.trusted():
            return self.send(403, {"error": "只允许本机访问"})
        path = urlsplit(self.path).path
        try:
            if path == "/":
                page = (ROOT / "scripts/console/index.html").read_text(encoding="utf-8").replace("__TOKEN__", self.server.token)
                return self.send(200, page.encode(), "text/html; charset=utf-8")
            if path == "/api/hardware":
                return self.send(200, self.server.console.hardware(refresh="refresh=1" in urlsplit(self.path).query))
            if path == "/api/state":
                return self.send(200, self.server.console.snapshot())
            if path.startswith("/api/log/"):
                return self.send(200, {"log": self.server.console.log(path.removeprefix("/api/log/"))})
            if path == "/api/artifacts":
                files = sorted(DATA.glob("*/results/**/*"))
                return self.send(200, [str(p.relative_to(DATA)) for p in files if p.is_file() and p.suffix in (".json", ".mp3", ".wav")])
            if path.startswith("/artifacts/"):
                file = (DATA / unquote(path.removeprefix("/artifacts/"))).resolve()
                if not file.is_relative_to(DATA.resolve()) or "results" not in file.relative_to(DATA.resolve()).parts or file.suffix not in (".json", ".mp3", ".wav"):
                    return self.send(403, {"error": "不可访问该文件"})
                return self.send(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            return self.send(404, {"error": "找不到资源"})
        except (ValueError, OSError) as exc:
            return self.send(400, {"error": str(exc)})

    def do_POST(self):
        origin = self.headers.get("Origin")
        if not self.trusted() or origin != "http://" + self.headers.get("Host", "") or self.headers.get("X-Console-Token") != self.server.token:
            return self.send(403, {"error": "本地请求来源校验失败"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("请求体大小无效")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("请求体必须是对象")
            path = urlsplit(self.path).path
            if path == "/api/start":
                mode = body.get("mode", "mock")
                if not isinstance(mode, str):
                    raise ValueError("模式必须为字符串")
                identity = self.server.console.start(mode)
            elif path == "/api/task":
                action = body.get("action")
                if not isinstance(action, str):
                    raise ValueError("操作必须为字符串")
                identity = self.server.console.task(action)
            elif path == "/api/stop":
                self.server.console.stop()
                identity = None
            elif path == "/api/restart":
                identity = self.server.console.restart()
            elif path == "/api/settings":
                self.server.console.settings(body)
                identity = None
            else:
                return self.send(404, {"error": "未知接口"})
            return self.send(202, {"id": identity})
        except (ValueError, OSError) as exc:
            return self.send(400, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--resume", type=Path, help="恢复本控制台已有的一轮数据及配置")
    args = parser.parse_args()
    console = Console()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.console, server.token = console, secrets.token_urlsafe(32)
    atexit.register(console.stop)

    def shutdown(*_):
        console.closing = True
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    print(f"本地测试控制台：http://localhost:{server.server_port}（Ctrl+C 关闭并停止子进程）", flush=True)
    try:
        if args.resume:
            config = json.loads((args.resume / "config.json").read_text(encoding="utf-8"))
            console.start(config["mode"], resume=args.resume)
        server.serve_forever(poll_interval=0.2)
    finally:
        console.closing = True
        console.stop()
        server.server_close()


if __name__ == "__main__":
    main()
