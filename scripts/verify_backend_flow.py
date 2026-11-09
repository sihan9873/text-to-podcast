"""验证已启动的业务 API + Worker + TTS；会创建独立联调项目，不删除旧数据。"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import subprocess
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4


class BackendClient:
    def __init__(self, url, timeout=30):
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("backend-url 必须为不含凭据/查询参数的 HTTP(S) 地址")
        self.url, self.timeout = url.rstrip("/"), timeout
        self.opener = build_opener(ProxyHandler({}))

    def request(self, path, body=None, method="GET", key=None, binary=False):
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("后端返回了无效的相对路径")
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if key:
            headers["Idempotency-Key"] = key
        request = Request(self.url + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                          headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                content = response.read()
                if binary:
                    if response.headers.get_content_type() != "audio/mpeg":
                        raise ValueError("音频下载未返回 audio/mpeg")
                    return content
                payload = json.loads(content)
                if "code" in payload:
                    if payload["code"] != "OK":
                        raise RuntimeError(f"业务失败：{payload['code']} {payload.get('message', '')}")
                    return payload["data"]
                return payload
        except HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code}: {exc.read(4096).decode(errors='replace')}") from exc


def wait_task(client, task_id, timeout):
    deadline = time.monotonic() + timeout
    while True:
        task = client.request(f"/api/v1/tasks/{task_id}")
        if task["status"] == "succeeded":
            return task
        if task["status"] == "failed":
            raise RuntimeError(f"任务 {task_id} 失败：{task.get('error_code')} {task.get('error_message')}")
        if task["status"] not in ("queued", "running"):
            raise RuntimeError(f"未知任务状态：{task['status']}")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"等待任务 {task_id} 超时；服务端任务未被取消，请查询后再决定是否重提")
        time.sleep(min(1, max(0, deadline - time.monotonic())))


def run_flow(client, engine_id, task_timeout, context):
    client.request("/api/v1/health/live")
    ready = client.request("/api/v1/health/ready")
    if ready.get("provider") != "local_http":
        raise RuntimeError("业务 API 未启用 AUDIO_PROVIDER=local_http，请修改配置并重启")
    roles = []
    page = 1
    while True:
        result = client.request(f"/api/v1/roles?page={page}&page_size=100")
        roles.extend(result["items"])
        if page * 100 >= result["total"]:
            break
        page += 1
    selected = []
    for alias in ("host_a", "host_b"):
        role = next((r for r in roles if r.get("tts_provider") == "local_http" and r.get("tts_model") == engine_id
                     and r.get("voice_id") == alias), None)
        if role is None:
            raise RuntimeError(f"缺少 {engine_id}/{alias} 角色；使用相同配置运行后端 bootstrap")
        selected.append({"profile_id": role["profile_id"], "role_key": alias})
    project = client.request("/api/v1/projects", {"title": "TTS完整联调 " + datetime.now().strftime("%m%d %H:%M:%S")}, "POST")
    project_id = context["project_id"] = project["project_id"]
    client.request(f"/api/v1/projects/{project_id}/source", {"text": "本项目用于验证双主持人语音生成、任务轮询和完整音频下载。"}, "PUT")
    task = client.request(f"/api/v1/projects/{project_id}/script/generate", {"roles": selected}, "POST", "verify-script-" + uuid4().hex)
    context["script_task_id"] = task["task_id"]
    completed = wait_task(client, task["task_id"], task_timeout)
    script = client.request(f"/api/v1/scripts/{completed['result']['script_id']}")
    context["script_id"] = script["script_id"]
    version = {"expected_script_version": script["version"], "expected_edit_revision": script["edit_revision"]}
    client.request(f"/api/v1/scripts/{script['script_id']}/confirm", version, "POST")
    task = client.request(f"/api/v1/projects/{project_id}/audio/generate", {"script_id": script["script_id"], **version}, "POST", "verify-audio-" + uuid4().hex)
    context["audio_task_id"] = task["task_id"]
    completed = wait_task(client, task["task_id"], task_timeout)
    context["audio_result"] = completed["result"]
    return client.request(completed["result"]["download_url"], binary=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", default="http://127.0.0.1:8000")
    parser.add_argument("--engine-id", choices=["mock", "qwen3-customvoice"], default="mock")
    parser.add_argument("--task-timeout", type=float, default=900)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/backend-verification"))
    args = parser.parse_args()
    if not math.isfinite(args.task_timeout) or args.task_timeout <= 0:
        parser.error("task-timeout 必须为有限正数")
    if not shutil.which(args.ffmpeg):
        parser.error("缺少 FFmpeg，请先准备后再验证")
    folder = args.output_dir / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
    folder.mkdir(parents=True, exist_ok=False)
    report = {"engine_id_requested": args.engine_id, "status": "running",
              "scope": "业务HTTP任务闭环及MP3解码；模型真实性/文本完整性需结合部署状态、资产metadata和听音确认"}
    try:
        content = run_flow(BackendClient(args.backend_url), args.engine_id, args.task_timeout, report)
        decoded = subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", "pipe:0",
                                  "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"],
                                 input=content, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=60).stdout
        if not decoded or len(decoded) % 2:
            raise ValueError("MP3 解码为空或帧不完整")
        with (folder / "full.mp3").open("xb") as output:
            output.write(content)
        report.update(status="succeeded", decoded_duration_seconds=len(decoded) / 48000,
                      audio_bytes=len(content), file="full.mp3")
    except Exception as exc:
        report.update(status="failed", error_type=type(exc).__name__, error=str(exc))
    (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output_dir": str(folder), **report}, ensure_ascii=False, indent=2))
    if report["status"] != "succeeded":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
