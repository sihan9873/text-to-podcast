"""显式下载固定版本；不在服务启动/health 中调用。"""
import argparse
import hashlib
import json
from pathlib import Path

from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
FILES = ["config.json", "generation_config.json", "model.safetensors", "tokenizer.json",
         "tokenizer_config.json", "vocab.json", "merges.txt", "LICENSE", "README.md"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=("0.5b", "4b"), default="0.5b")
    args = parser.parse_args()
    model_id = MODEL_ID if args.model == "0.5b" else "Qwen/Qwen3-4B-Instruct-2507"
    revision = REVISION if args.model == "0.5b" else "cdbee75f17c01a7cc42f958dc650907174af0554"
    folder = ROOT / "models" / model_id.split("/")[-1]
    patterns = FILES if args.model == "0.5b" else ["*.json", "*.safetensors", "*.txt", "*.jinja", "LICENSE", "README.md"]
    snapshot_download(model_id, revision=revision, local_dir=folder, allow_patterns=patterns,
                      cache_dir=ROOT / ".cache" / "huggingface", max_workers=2)
    records = {}
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.name == "download-manifest.json":
            continue
        name = path.name
        path = folder / name
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        records[name] = {"size_bytes": path.stat().st_size, "sha256": digest.hexdigest()}
    manifest = {"model_id": model_id, "revision": revision, "license": "Apache-2.0", "files": records}
    (folder / "download-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"path": str(folder), "revision": revision, "bytes": sum(r["size_bytes"] for r in records.values())}))


if __name__ == "__main__":
    main()
