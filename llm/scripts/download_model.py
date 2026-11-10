"""显式下载固定版本；不在服务启动/health 中调用。"""
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
    folder = ROOT / "models" / "Qwen2.5-0.5B-Instruct"
    snapshot_download(MODEL_ID, revision=REVISION, local_dir=folder, allow_patterns=FILES,
                      cache_dir=ROOT / ".cache" / "huggingface", max_workers=2)
    records = {}
    for name in FILES:
        path = folder / name
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        records[name] = {"size_bytes": path.stat().st_size, "sha256": digest.hexdigest()}
    manifest = {"model_id": MODEL_ID, "revision": REVISION, "license": "Apache-2.0", "files": records}
    (folder / "download-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"path": str(folder), "revision": REVISION, "bytes": sum(r["size_bytes"] for r in records.values())}))


if __name__ == "__main__":
    main()
