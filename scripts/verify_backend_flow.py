"""验证已启动的业务 API + Worker + TTS；会创建独立联调项目，不删除旧数据。"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
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


def wait_task(client, task_id, timeout, progress=None):
    started = time.monotonic()
    deadline = started + timeout
    last_status, last_report = None, started
    while True:
        task = client.request(f"/api/v1/tasks/{task_id}")
        if progress is not None:
            now = time.monotonic()
            if task["status"] != last_status or now - last_report >= 30:
                progress(f"任务 {task_id}: {task['status']}，已等待 {round(now - started)} 秒")
                last_status, last_report = task["status"], now
        if task["status"] == "succeeded":
            return task
        if task["status"] == "failed":
            raise RuntimeError(f"任务 {task_id} 失败：{task.get('error_code')} {task.get('error_message')}")
        if task["status"] not in ("queued", "running"):
            raise RuntimeError(f"未知任务状态：{task['status']}")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"等待任务 {task_id} 超时；服务端任务未被取消，请查询后再决定是否重提")
        time.sleep(min(1, max(0, deadline - time.monotonic())))


def export_script(script, folder):
    """保存合成输入；已有导出文件保留，不覆盖用户可能编辑的内容。"""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    roles = {role["role_id"]: role for role in script.get("roles", [])}
    lines = [script.get("title") or "播客脚本", script.get("summary") or "", ""]
    for sentence in sorted(script.get("sentences", []), key=lambda item: item["sequence"]):
        role = roles.get(sentence.get("role_id"), {})
        name = role.get("name") or role.get("role_key") or str(sentence.get("role_id", "主持人"))
        lines.extend([f"{sentence['sequence']}. {name}", sentence["text"], ""])
    for name, content in (("script.json", json.dumps(script, ensure_ascii=False, indent=2) + "\n"),
                          ("script.txt", "\n".join(lines))):
        try:
            with (folder / name).open("x", encoding="utf-8") as output:
                output.write(content)
        except FileExistsError:
            pass
    return {"script_file": "script.json", "script_text_file": "script.txt"}


def export_from_report(client, report_path):
    report_path = Path(report_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    script_id = report.get("script_id")
    if type(script_id) is not int or script_id < 1:
        raise ValueError("报告中没有有效 script_id，请先检查原脚本任务状态")
    script = client.request(f"/api/v1/scripts/{script_id}")
    report.update(export_script(script, report_path.parent))
    report["script_url"] = f"/api/v1/scripts/{script_id}"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"output_dir": str(report_path.parent), "script_id": script_id,
            "script_file": report["script_file"], "script_text_file": report["script_text_file"]}


def run_flow(client, engine_id, task_timeout, context, source_text=None, require_real=False, progress=None, output_dir=None):
    report_progress = progress if progress is not None else lambda _message: None
    report_progress(f"检查业务配置；TTS 引擎：{engine_id}")
    client.request("/api/v1/health/live")
    ready = client.request("/api/v1/health/ready")
    if ready.get("provider") != "local_http":
        raise RuntimeError("业务 API 未启用 AUDIO_PROVIDER=local_http，请修改配置并重启")
    if ready.get("tts_engine_id") is not None and ready["tts_engine_id"] != engine_id:
        raise RuntimeError(f"请求的 TTS 引擎是 {engine_id}，后端当前配置为 {ready['tts_engine_id']}；请更新 .env 并重启服务")
    if require_real and ready.get("llm_provider") != "local_http":
        raise RuntimeError("真实 Qwen 验证要求 LLM_PROVIDER=local_http，请配置并重启 API/Worker")
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
    report_progress(f"已创建联调项目 {project_id}，提交自然语言描述和脚本任务")
    client.request(f"/api/v1/projects/{project_id}/source", {"text": source_text or "本项目用于验证双主持人语音生成、任务轮询和完整音频下载。"}, "PUT")
    task = client.request(f"/api/v1/projects/{project_id}/script/generate", {"roles": selected}, "POST", "verify-script-" + uuid4().hex)
    context["script_task_id"] = task["task_id"]
    completed = wait_task(client, task["task_id"], task_timeout, progress)
    context["script_generation"] = completed["result"].get("generation", {})
    if require_real and (context["script_generation"].get("simulated") is not False
            or context["script_generation"].get("provider") != "local_http"
            or context["script_generation"].get("model_id") != "Qwen/Qwen2.5-0.5B-Instruct"):
        raise RuntimeError("脚本任务未提供真实 Qwen 生成信息，请检查模型配置并重启 API/Worker")
    script = client.request(f"/api/v1/scripts/{completed['result']['script_id']}")
    context["script_id"] = script["script_id"]
    context["script_title"] = script.get("title")
    context["sentence_count"] = len(script.get("sentences", []))
    context["script_url"] = f"/api/v1/scripts/{script['script_id']}"
    if output_dir is not None:
        context.update(export_script(script, output_dir))
        report_progress(f"脚本已保存到 {output_dir}/script.json 和 script.txt")
    report_progress(f"脚本已生成：{context['script_title']}，{context['sentence_count']} 条台词；自动确认本次联调脚本")
    version = {"expected_script_version": script["version"], "expected_edit_revision": script["edit_revision"]}
    client.request(f"/api/v1/scripts/{script['script_id']}/confirm", version, "POST")
    task = client.request(f"/api/v1/projects/{project_id}/audio/generate", {"script_id": script["script_id"], **version}, "POST", "verify-audio-" + uuid4().hex)
    context["audio_task_id"] = task["task_id"]
    report_progress("已提交语音任务；首次合成包含模型冷启动，请等待，勿重复提交")
    completed = wait_task(client, task["task_id"], task_timeout, progress)
    context["audio_result"] = completed["result"]
    metadata = completed["result"].get("metadata", {})
    if require_real and (metadata.get("engine_id") != engine_id or metadata.get("simulated") is not False
            or metadata.get("real_speech") is not True or metadata.get("script_simulated") is not False):
        raise RuntimeError("音频任务未提供真实 Qwen LLM/TTS 执行信息，不能按真实合成验收")
    report_progress("音频任务成功，正在下载完整 MP3")
    return client.request(completed["result"]["download_url"], binary=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", default="http://127.0.0.1:8000")
    parser.add_argument("--engine-id", choices=["mock", "qwen3-customvoice"], default="qwen3-customvoice",
                        help="语音模型；默认真实 Qwen TTS，mock 仅用于测试音调")
    parser.add_argument("--task-timeout", type=float, default=1800)
    parser.add_argument("--description", help="传给脚本模型的自然语言创作要求；省略则使用联调素材")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/backend-verification"))
    parser.add_argument("--export-script-from-report", type=Path,
                        help="为已有 report.json 补导出脚本；不创建任务、不重新调用模型")
    args = parser.parse_args()
    if args.export_script_from_report is not None:
        result = export_from_report(BackendClient(args.backend_url), args.export_script_from_report)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    if not math.isfinite(args.task_timeout) or args.task_timeout <= 0:
        parser.error("task-timeout 必须为有限正数")
    if not shutil.which(args.ffmpeg):
        parser.error("缺少 FFmpeg，请先准备后再验证")
    folder = args.output_dir / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
    folder.mkdir(parents=True, exist_ok=False)
    report = {"engine_id_requested": args.engine_id, "status": "running",
              "scope": "业务HTTP任务闭环、生成元数据及MP3解码；发音、文本完整性和事实内容仍需人工审核",
              "requires_real_qwen": args.engine_id == "qwen3-customvoice"}
    try:
        content = run_flow(BackendClient(args.backend_url), args.engine_id, args.task_timeout, report, args.description,
                           require_real=report["requires_real_qwen"],
                           progress=lambda message: print(message, file=sys.stderr, flush=True), output_dir=folder)
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
