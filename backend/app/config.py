from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _cors_origins() -> list[str]:
    value = os.getenv(
        "TEXTCAST_CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    )
    return [origin.strip() for origin in value.split(",") if origin.strip()]


@dataclass(slots=True)
class Settings:
    database_path: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "TEXTCAST_DATABASE_PATH",
                str(BACKEND_DIR / "data" / "textcast.db"),
            )
        )
    )
    session_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("TEXTCAST_SESSION_TTL_SECONDS", "28800"))
    )
    session_cookie_name: str = "textcast_session"
    secure_cookies: bool = field(
        default_factory=lambda: _env_bool("TEXTCAST_SECURE_COOKIES", False)
    )
    cors_origins: list[str] = field(default_factory=_cors_origins)
    bootstrap_admin_username: str | None = field(
        default_factory=lambda: os.getenv("TEXTCAST_BOOTSTRAP_ADMIN_USERNAME")
    )
    bootstrap_admin_password: str | None = field(
        default_factory=lambda: os.getenv("TEXTCAST_BOOTSTRAP_ADMIN_PASSWORD")
    )
    bootstrap_admin_display_name: str = field(
        default_factory=lambda: os.getenv(
            "TEXTCAST_BOOTSTRAP_ADMIN_DISPLAY_NAME", "系统管理员"
        )
    )
