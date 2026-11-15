"""Explicit model download task, launched only from the download button."""
import argparse
from pathlib import Path

from local_tasks import ROOT, options


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("customvoice", "base"))
    args = parser.parse_args()
    model = "Qwen3-TTS-12Hz-0.6B-" + ("Base" if args.kind == "base" else "CustomVoice")
    key = "PODCAST_BASE_MODEL_PATH" if args.kind == "base" else "PODCAST_CUSTOMVOICE_MODEL_PATH"
    target = Path(options().get(key) or ROOT / "tts/models" / model)
    from huggingface_hub import snapshot_download
    print(f"下载 Qwen/{model} 到 {target}；需要网络和足够磁盘空间。", flush=True)
    result = snapshot_download(repo_id="Qwen/" + model, local_dir=target, max_workers=2)
    print("模型下载完成：", result, flush=True)


if __name__ == "__main__":
    main()
