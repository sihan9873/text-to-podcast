"""导出供审阅/上传的源码 ZIP 和 SHA256 清单，不依赖当前目录的 Git 元数据。"""

import argparse
from datetime import datetime, timezone
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = ("backend", "tts", "llm", "tests", "scripts", "docs")
SOURCE_FILES = ("README.md", "AGENTS.md", ".gitignore", ".gitattributes", "pytest.ini",
                "tts/data/texts/example.txt", "tts/outputs/.gitkeep", "tts/third_party/.gitkeep",
                "tts/models/MeloTTS/.gitkeep", "tts/data/references/.gitkeep", "tts/data/datasets/.gitkeep")
EXCLUDED_DIRS = {".git", ".agents", ".codex", ".aws", "__pycache__", ".pytest_cache",
                 "data", "outputs", "output", "models", "third_party", "venv", ".cache", "node_modules"}
EXCLUDED_FILES = ("*.pyc", "*.pyo", "*.log", "*.sqlite*", "*.db", "*.db-*", "*.wav", "*.mp3",
                  "*.flac", "*.m4a", "*.ogg", "*.aac", "*.safetensors", "*.pth", "*.pt", "*.ckpt",
                  "*.onnx", "*.pem", "*.key", "*.p12", "*.pfx", "*:Zone.Identifier", ".DS_Store", "Thumbs.db")


def source_paths(root):
    candidates = [root / name for name in SOURCE_FILES]
    for directory in SOURCE_DIRS:
        base = root / directory
        if base.is_symlink():
            continue
        for parent, dirs, files in os.walk(base, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not d.startswith(".venv")
                             and not (Path(parent) / d).is_symlink())
            candidates.extend(Path(parent) / name for name in files)
    for path in sorted(set(candidates)):
        relative = path.relative_to(root)
        if (not path.is_file() or any(root.joinpath(*relative.parts[:i]).is_symlink()
                                     for i in range(1, len(relative.parts) + 1))):
            continue
        name = path.name
        if name == ".env" or name.startswith(".env.") and name != ".env.example":
            continue
        if (any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDED_FILES)
                and relative.as_posix() != "backend/fixtures/test_audio.mp3"):
            continue
        # 源码/文档中的异常大文件应先人工审阅，不静默混入源码包。
        if path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError(f"文件超过 2 MiB，需先检查：{path.relative_to(root)}")
        yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "outputs/github-upload")
    args = parser.parse_args()
    folder = args.output_dir / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
    folder.mkdir(parents=True, exist_ok=False)
    records = []
    with zipfile.ZipFile(folder / "podcast-source.zip", "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in source_paths(ROOT):
            relative = path.relative_to(ROOT).as_posix()
            content = path.read_bytes()
            archive.writestr(relative, content)
            records.append({"path": relative, "size_bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "files": records,
                "note": "Source-only review archive; not a secret scanner. No model weights, user audio, databases, environments or Git history."}
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"directory": str(folder), "file_count": len(records),
                      "archive_bytes": (folder / "podcast-source.zip").stat().st_size}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
