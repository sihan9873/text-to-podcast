import hashlib
from pathlib import Path

from app.core.common import BusinessError, new_token


class LocalStorage:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, object_key):
        result = (self.root / object_key).resolve()
        if not result.is_relative_to(self.root) or result == self.root:
            raise BusinessError("INVALID_ASSET_PATH", "文件路径无效", 404)
        return result

    def save_mp3(self, content):
        if not content or not (content.startswith(b"ID3") or content[:1] == b"\xff"):
            raise BusinessError("INVALID_AUDIO_RESULT", "音频服务未返回有效的MP3数据")
        key = new_token() + ".mp3"
        target = self.path(key)
        temporary = target.with_suffix(".tmp")
        try:
            temporary.write_bytes(content)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return key, len(content), hashlib.sha256(content).hexdigest()

    def readable(self, key):
        target = self.path(key)
        if not target.is_file() or target.stat().st_size == 0:
            raise BusinessError("AUDIO_FILE_MISSING", "音频文件不存在或不可读取", 404)
        return target
