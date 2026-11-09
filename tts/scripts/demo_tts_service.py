"""标准库 HTTP 客户端：生成 host_a/host_b 两份中文 WAV 与可核对的 RTF 记录。

此脚本会触发所选引擎真实推理；仅在明确授权后使用 Qwen 模式。
"""

import argparse
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--engine-id", choices=["mock", "qwen3-customvoice"], default="mock")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/tts-demo"))
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    if not 0 < args.timeout < float("inf"):
        parser.error("timeout 必须为有限正数")
    endpoint = urlsplit(args.api_url)
    if endpoint.scheme not in ("http", "https") or not endpoint.hostname:
        parser.error("api-url 必须是 HTTP(S) 地址")
    opener = build_opener(ProxyHandler({})) if endpoint.hostname in ("127.0.0.1", "localhost", "::1") else build_opener()
    folder = args.output_dir / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
    folder.mkdir(parents=True, exist_ok=False)
    results = []
    try:
        with opener.open(args.api_url.rstrip("/") + "/v1/engines", timeout=args.timeout) as response:
            before = json.load(response)
        for index, (voice, text) in enumerate([
            ("host_a", "欢迎收听今天的科技播客。"),
            ("host_b", "今天我们聊聊人工智能如何帮助学习。"),
        ]):
            payload = {"engine_id": args.engine_id, "voice_id": voice, "text": text, "speed": 1.0}
            request = Request(args.api_url.rstrip("/") + "/v1/synthesize", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            start = time.perf_counter()
            with opener.open(request, timeout=args.timeout) as response:
                if response.headers.get_content_type() != "audio/wav":
                    raise ValueError("服务未返回 audio/wav")
                data = response.read()
            elapsed = time.perf_counter() - start
            with wave.open(io.BytesIO(data), "rb") as wav:
                frames, rate = wav.getnframes(), wav.getframerate()
                if frames <= 0 or len(wav.readframes(frames)) != frames * wav.getnchannels() * wav.getsampwidth():
                    raise ValueError("WAV 为空或不完整")
            path = folder / f"{index:03d}_{voice}.wav"
            path.write_bytes(data)
            results.append({"voice_id": voice, "file": path.name, "sample_rate": rate,
                            "duration_seconds": frames / rate, "elapsed_seconds": elapsed,
                            "rtf": elapsed / (frames / rate)})
    except HTTPError as exc:
        raise SystemExit(f"HTTP {exc.code}: {exc.read(4096).decode(errors='replace')}") from exc
    report = {"engine_id": args.engine_id, "engines_before": before, "results": results,
              "timing_scope": "HTTP端到端；首句若模型未加载包含冷启动，第二句为已加载单次测量，非稳态基准"}
    (folder / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"output_dir": str(folder), **report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
