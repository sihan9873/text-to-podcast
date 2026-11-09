from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_url: str = f"sqlite:///{(ROOT / 'data' / 'backend.sqlite3').as_posix()}"
    storage_dir: Path = ROOT / "data" / "assets"
    development_user_id: int = 1
    poll_seconds: float = 0.5
    lease_seconds: int = 60
    max_pending_tasks: int = 100
    cors_origin: str = "http://localhost:5173"

    @classmethod
    def from_env(cls):
        load_dotenv(ROOT / ".env", override=False)
        return cls(
            database_url=os.getenv("DATABASE_URL", cls.database_url),
            storage_dir=Path(os.getenv("STORAGE_DIR", str(cls.storage_dir))).resolve(),
            development_user_id=int(os.getenv("DEVELOPMENT_USER_ID", str(cls.development_user_id))),
            poll_seconds=float(os.getenv("WORKER_POLL_SECONDS", "0.5")),
            lease_seconds=int(os.getenv("WORKER_LEASE_SECONDS", "60")),
            max_pending_tasks=int(os.getenv("MAX_PENDING_TASKS", "100")),
            cors_origin=os.getenv("CORS_ORIGIN", "http://localhost:5173"),
        )

    def __post_init__(self):
        if self.development_user_id < 1:
            raise ValueError("DEVELOPMENT_USER_ID 必须为正整数")
        if self.poll_seconds <= 0 or self.lease_seconds < 5 or self.max_pending_tasks < 1:
            raise ValueError("轮询间隔必须为正，租约至少5秒，队列容量至少1")
