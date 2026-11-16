"""Explicit model download task, launched only from the download button."""
import argparse
import os
from pathlib import Path

from local_tasks import ROOT, options


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("customvoice", "base"))
    parser.add_argument("--size", choices=("0.6b", "1.7b"), default="0.6b")
    args = parser.parse_args()
    model = "Qwen3-TTS-12Hz-" + args.size.upper() + "-" + ("Base" if args.kind == "base" else "CustomVoice")
    key = "PODCAST_BASE_MODEL_PATH" if args.kind == "base" else "PODCAST_CUSTOMVOICE_MODEL_PATH"
    target = Path(options().get(key if args.size == "0.6b" else "PODCAST_CUSTOMVOICE_LARGE_MODEL_PATH" if args.kind == "customvoice" else "PODCAST_BASE_MODEL_PATH") or ROOT / "tts/models" / model)
    # Ordinary HTTP supports resume reliably behind the local proxy.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from huggingface_hub import snapshot_download, HfApi
    import json
    revision = HfApi().model_info("Qwen/" + model).sha
    print(f"下载 Qwen/{model} 到 {target}；需要网络和足够磁盘空间。", flush=True)
    result = snapshot_download(repo_id="Qwen/" + model, revision=revision, local_dir=target, max_workers=2)
    (target / "download-manifest.json").write_text(json.dumps({"model_id": "Qwen/" + model, "revision": revision}, indent=2) + "\n")
    print("模型下载完成：", result, "revision=" + revision, flush=True)


if __name__ == "__main__":
    main()
