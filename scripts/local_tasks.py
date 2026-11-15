"""Local acceptance tasks. No shell evaluation; all data lives in a fresh run folder."""
from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.request import ProxyHandler, HTTPCookieProcessor, Request, build_opener
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "generation-backend/data/local-console"
MODES = ("mock", "http-mock", "customvoice", "clone")
OPTION_KEYS = {"PODCAST_LLM_MODEL_PATH", "PODCAST_CUSTOMVOICE_MODEL_PATH", "PODCAST_BASE_MODEL_PATH",
               "PODCAST_BACKEND_PYTHON", "PODCAST_GENERATION_BACKEND_PYTHON", "PODCAST_LLM_PYTHON",
               "PODCAST_TTS_PYTHON", "PODCAST_TTS_REAL_PYTHON", "LLM_DEVICE", "TTS_QWEN_DEVICE",
               "PODCAST_NODE_BINARY", "PODCAST_PNPM_BINARY"}


def options():
    path = DATA / "settings.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def tool_env():
    settings = options()
    folders = [str(Path(settings[k]).parent) for k in ("PODCAST_NODE_BINARY", "PODCAST_PNPM_BINARY") if settings.get(k)]
    return {**os.environ, "PATH": os.pathsep.join([*folders, os.environ.get("PATH", "")])}


def python_for(module):
    key = "PODCAST_" + module.upper().replace("-", "_") + "_PYTHON"
    override = options().get(key) or os.environ.get(key)
    if override:
        return override
    for folder in (ROOT / module / ".venv",):
        path = folder / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if path.is_file():
            return str(path)
    # Reuse existing independent model environments without modifying them.
    name = {"backend": "podcast-backend", "generation-backend": "podcast-backend",
            "llm": "podcast-llm", "tts": "podcast-tts-service", "tts-real": "podcast-tts"}[module]
    conda = Path(os.environ.get("CONDA_EXE", shutil.which("conda") or sys.executable)).resolve().parent.parent
    path = conda / "envs" / name / ("python.exe" if os.name == "nt" else "bin/python")
    return str(path) if path.is_file() else sys.executable


def pnpm():
    path = options().get("PODCAST_PNPM_BINARY") or shutil.which("pnpm", path=tool_env()["PATH"])
    if not path:
        raise RuntimeError("找不到 pnpm；请先安装 Node.js ≥22.12 和 pnpm 11，并加入 PATH")
    # Avoid cmd.exe shell command construction on Windows.
    if os.name == "nt" and path.endswith(".cmd"):
        cli = Path(path).parent / "node_modules/pnpm/bin/pnpm.cjs"
        if cli.is_file():
            return [shutil.which("node", path=tool_env()["PATH"]) or "node", str(cli)]
        raise RuntimeError("未找到 pnpm.cjs，请检查 pnpm 安装")
    return [path]


def run(command, cwd=ROOT, env=None):
    print("执行：", subprocess.list2cmdline(list(map(str, command))), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def prepare(mode):
    if mode not in MODES:
        raise ValueError("未知模式")
    settings = {**os.environ, **options()}
    folder = DATA / (time.strftime("%Y%m%d-%H%M%S-") + uuid4().hex[:8])
    folder.mkdir(parents=True, mode=0o700)
    for name in ("assets", "references", "results", "logs"):
        (folder / name).mkdir(mode=0o700)
    engine = {"mock": "mock", "http-mock": "mock", "customvoice": "qwen3-customvoice", "clone": "qwen3-base"}[mode]
    env = {
        "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1",
        "TEXTCAST_DATABASE_PATH": str(folder / "accounts.sqlite3"),
        "TEXTCAST_BOOTSTRAP_ADMIN_USERNAME": "admin", "TEXTCAST_BOOTSTRAP_ADMIN_PASSWORD": "TextCast123!",
        "TEXTCAST_BOOTSTRAP_ADMIN_DISPLAY_NAME": "本地测试管理员",
        "TEXTCAST_ALLOW_REGISTRATION": "true", "TEXTCAST_SECURE_COOKIES": "false",
        "TEXTCAST_CORS_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
        "DATABASE_URL": "sqlite:///" + (folder / "generation.sqlite3").as_posix(),
        "STORAGE_DIR": str(folder / "assets"), "VOICE_REFERENCE_DIR": str(folder / "references"),
        "TEXTCAST_AUTH_URL": "http://127.0.0.1:8000", "DEVELOPMENT_USER_ID": "1",
        "WORKER_POLL_SECONDS": "0.5", "WORKER_LEASE_SECONDS": "60", "MAX_PENDING_TASKS": "100",
        "CORS_ORIGIN": "http://localhost:5173", "LLM_PROVIDER": "local_http" if mode in MODES[2:] else "mock",
        "AUDIO_PROVIDER": "mock" if mode == "mock" else "local_http",
        "LOCAL_LLM_BASE_URL": "http://127.0.0.1:8003", "LOCAL_LLM_MODEL_ID": "Qwen/Qwen2.5-0.5B-Instruct",
        "LOCAL_LLM_TIMEOUT_SECONDS": "300", "LOCAL_LLM_MAX_NEW_TOKENS": "2048",
        "LOCAL_TTS_BASE_URL": "http://127.0.0.1:8002", "LOCAL_TTS_ENGINE_ID": engine,
        "LOCAL_TTS_TIMEOUT_SECONDS": "300", "LOCAL_TTS_CHUNK_CHARS": "120",
        "LOCAL_TTS_SAMPLE_RATE": "24000", "LOCAL_TTS_TURN_SILENCE_MS": "250",
        "FFMPEG_BINARY": "ffmpeg", "AUDIO_ENCODE_TIMEOUT_SECONDS": "60",
        "TTS_INTERNAL_TOKEN": uuid4().hex + uuid4().hex,
        "TTS_ENABLE_QWEN": str(int(mode == "customvoice")), "TTS_ENABLE_QWEN_BASE": str(int(mode == "clone")),
        "LLM_MODEL_PATH": settings.get("PODCAST_LLM_MODEL_PATH", str(ROOT / "llm/models/Qwen2.5-0.5B-Instruct")),
        "TTS_QWEN_MODEL_PATH": settings.get("PODCAST_CUSTOMVOICE_MODEL_PATH", str(ROOT / "tts/models/Qwen3-TTS-12Hz-0.6B-CustomVoice")),
        "TTS_QWEN_BASE_MODEL_PATH": settings.get("PODCAST_BASE_MODEL_PATH", str(ROOT / "tts/models/Qwen3-TTS-12Hz-0.6B-Base")),
        "LLM_DEVICE": settings.get("LLM_DEVICE", "cuda:0"),
        "TTS_QWEN_DEVICE": settings.get("TTS_QWEN_DEVICE", "cuda:0"),
        "TTS_QWEN_DTYPE": "float32" if settings.get("TTS_QWEN_DEVICE") == "cpu" else "bfloat16",
        "VITE_ENABLE_MOCK": "false", "VITE_API_BASE_URL": "/api", "VITE_GENERATION_API_BASE_URL": "/api/v1",
    }
    config = {"mode": mode, "env": env}
    path = folder / "config.json"
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    path.chmod(0o600)
    return folder, config


def health(mode):
    urls = {"账号": "http://127.0.0.1:8000/api/health", "生成 API": "http://127.0.0.1:8001/api/v1/health/ready"}
    if mode != "mock":
        urls["TTS"] = "http://127.0.0.1:8002/v1/engines"
    if mode in MODES[2:]:
        urls["LLM"] = "http://127.0.0.1:8003/v1/models"
    opener = build_opener(ProxyHandler({}))
    failed = []
    for label, url in urls.items():
        try:
            with opener.open(url, timeout=3) as response:
                print(label, response.status, response.read(8192).decode(), flush=True)
        except Exception as exc:
            failed.append(label)
            print(label, "不可用：", exc, flush=True)
    if failed:
        raise RuntimeError("服务检查失败：" + "、".join(failed))
    print("健康接口不代表模型已加载或 Worker 正常；请继续执行闭环验证。", flush=True)


def flow(folder, config, long=False):
    """Exercise real account cookies, API, worker, confirmation, MP3 and Range."""
    if config["mode"] == "clone":
        raise RuntimeError("克隆模式请在业务页面上传真实录音并绑定角色后生成；不能用合成测试录音验收声音克隆")
    opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(method, path, body=None, key=None, account=False, extra=None):
        headers = {"Content-Type": "application/json", **(extra or {})}
        if key:
            headers["Idempotency-Key"] = key
        req = Request("http://127.0.0.1:" + ("8000" if account else "8001") + path,
                      data=None if body is None else json.dumps(body, ensure_ascii=False).encode(), headers=headers, method=method)
        with opener.open(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if response.headers.get_content_type() == "application/json" else raw

    def wait(tid):
        deadline = time.monotonic() + 1800
        previous = None
        while time.monotonic() < deadline:
            _, result = call("GET", f"/api/v1/tasks/{tid}")
            task = result["data"]
            if task["status"] != previous:
                print("任务", tid, task["status"], flush=True)
                previous = task["status"]
            if task["status"] == "failed":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            if task["status"] == "succeeded":
                return task["result"]
            time.sleep(0.5)
        raise TimeoutError("任务超时，请查看 Worker 日志")

    call("POST", "/api/auth/login", {"username": "admin", "password": "TextCast123!"}, account=True)
    _, response = call("POST", "/api/v1/projects", {"title": "控制台长文验收" if long else "控制台闭环验收"})
    pid = response["data"]["project_id"]
    source = "海岚图书馆夜读试点为期六周，每周三20点至22点开放，每场24个名额。负责人林青，预算3600元，不收报名费。"
    if long:
        source = "\n\n".join(f"第{i}段。{source}" * 5 for i in range(1, 25))
    call("PUT", f"/api/v1/projects/{pid}/source", {"text": source})
    _, roles = call("GET", "/api/v1/roles")
    profile = roles["data"]["items"][0]["profile_id"]
    body = {"roles": [{"profile_id": profile, "role_key": "host"}]}
    _, response = call("POST", f"/api/v1/projects/{pid}/script/generate", body, uuid4().hex)
    result = wait(response["data"]["task_id"])
    _, response = call("GET", f'/api/v1/scripts/{result["script_id"]}')
    script = response["data"]
    print(json.dumps(script, ensure_ascii=False, indent=2), flush=True)
    confirmation = {"expected_script_version": script["version"], "expected_edit_revision": script["edit_revision"]}
    call("POST", f'/api/v1/scripts/{script["script_id"]}/confirm', confirmation)
    _, response = call("POST", f"/api/v1/projects/{pid}/audio/generate", {"script_id": script["script_id"], **confirmation}, uuid4().hex)
    audio = wait(response["data"]["task_id"])
    _, data = call("GET", audio["download_url"])
    assert len(data) > 100, "音频为空"
    status, fragment = call("GET", f'/api/v1/audio-assets/{audio["asset_id"]}/play', extra={"Range": "bytes=0-99"})
    assert status == 206 and fragment == data[:100], "Range 播放校验失败"
    if config["mode"] == "mock":
        assert data == (ROOT / "generation-backend/fixtures/test_audio.mp3").read_bytes()
    out = folder / "results" / uuid4().hex[:8]
    out.mkdir()
    (out / "audio.mp3").write_bytes(data)
    (out / "script.json").write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"mode": config["mode"], "project_id": pid, "source_chars": len(source), "audio_bytes": len(data),
              "real_models": config["mode"] == "customvoice", "range": "passed", "output": str(out)}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def main():
    os.environ.update(tool_env())
    action = sys.argv[1]
    folder = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
    config = json.loads((folder / "config.json").read_text()) if folder else None
    if action == "preflight":
        failed = []
        for executable, args in (("node", ["--version"]), ("pnpm", ["--version"]), ("ffmpeg", ["-version"]), ("ffprobe", ["-version"])):
            path = shutil.which(executable)
            print(executable, path or "缺失", flush=True)
            if path:
                result = subprocess.run([path, *args], cwd=ROOT / "frontend", capture_output=True, text=True)
                print((result.stdout or result.stderr).splitlines()[0], flush=True)
                if result.returncode:
                    failed.append(executable)
                if executable in ("node", "pnpm") and result.returncode == 0:
                    version = tuple(map(int, re.findall(r"\d+", result.stdout.strip())[:3]))
                    minimum = (22, 12, 0) if executable == "node" else (11, 0, 0)
                    if version < minimum:
                        failed.append(f"{executable} 版本过低")
            else:
                failed.append(executable)
        for module in ("backend", "generation-backend", "llm", "tts", "tts-real"):
            print(module, "解释器：", python_for(module), flush=True)
        for module in ("backend", "generation-backend", "llm", "tts"):
            imports = "fastapi,httpx,uvicorn" + (",pytest" if module in ("backend", "generation-backend") else "") + (",sqlalchemy,alembic,dotenv" if module == "generation-backend" else "")
            result = subprocess.run([python_for(module), "-c", "import " + imports], capture_output=True, text=True)
            print(module, "依赖正常" if result.returncode == 0 else result.stderr, flush=True)
            if result.returncode:
                failed.append(module)
        if failed:
            raise RuntimeError("预检存在缺项：" + ", ".join(failed))
        for key, default in (("PODCAST_LLM_MODEL_PATH", ROOT / "llm/models/Qwen2.5-0.5B-Instruct"),
                             ("PODCAST_CUSTOMVOICE_MODEL_PATH", ROOT / "tts/models/Qwen3-TTS-12Hz-0.6B-CustomVoice"),
                             ("PODCAST_BASE_MODEL_PATH", ROOT / "tts/models/Qwen3-TTS-12Hz-0.6B-Base")):
            path = Path(options().get(key) or os.environ.get(key) or default)
            print(key, path, "目录存在（需推理验收）" if path.is_dir() else "权重未准备，阻塞真实模型模式；Mock 可运行", flush=True)
    elif action == "health":
        health(config["mode"])
    elif action in ("flow", "long-flow"):
        flow(folder, config, action == "long-flow")
    elif action == "llm-demo":
        run([python_for("llm"), str(ROOT / "llm/scripts/demo_llm_service.py"), "--api-url", "http://127.0.0.1:8003"])
    elif action == "verify-real-script":
        run([sys.executable, str(ROOT / "scripts/verify_real_script.py"), str(folder)])
    elif action == "tts-demo":
        if config["mode"] == "clone":
            raise RuntimeError("Base 模式请在声音库选择已上传的私有声音试听")
        run([python_for("tts"), str(ROOT / "tts/scripts/demo_tts_service.py"), "--api-url", "http://127.0.0.1:8002",
             "--engine-id", config["env"]["LOCAL_TTS_ENGINE_ID"], "--output-dir", str(folder / "results/tts-demo")])
    elif action == "download-llm":
        run([python_for("llm"), str(ROOT / "llm/scripts/download_model.py")])
    elif action in ("download-customvoice", "download-base"):
        run([python_for("tts-real"), str(ROOT / "scripts/download_tts_model.py"), action.removeprefix("download-")])
    elif action.startswith("test-"):
        module = action[5:]
        if module == "frontend":
            run([*pnpm(), "check"], ROOT / module)
        elif module in ("backend", "generation-backend", "tts", "llm"):
            args = ["-m", "pytest", "-q"] if module in ("backend", "generation-backend") else ["-m", "unittest", "discover", "-s", "tests", "-v"]
            run([python_for(module), *args], ROOT / module)
        else:
            raise ValueError("未知测试模块")
    elif action == "install":
        # Fresh per-module venvs only. Never pip install into existing Conda/model environments.
        for module, requirement in (("backend", "requirements-dev.txt"), ("generation-backend", "requirements.lock"),
                                    ("llm", "requirements.txt"), ("tts", "requirements/tts-service-test.txt")):
            target = ROOT / module / ".venv"
            marker = target / ".console-installing"
            if target.exists() and not marker.exists():
                print("保留已有环境：", target, flush=True)
                continue
            if not target.exists():
                run([sys.executable, "-m", "venv", str(target)])
            marker.touch()
            executable = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            run([str(executable), "-m", "pip", "install", "-r", requirement], ROOT / module)
            marker.unlink()
        run([*pnpm(), "install", "--frozen-lockfile"], ROOT / "frontend")
    else:
        raise ValueError("未知任务")


if __name__ == "__main__":
    main()
