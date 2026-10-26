from __future__ import annotations

from typing import Any

from fastapi import Depends, Request

from .config import Settings
from .database import Database
from .errors import ApiError
from .security import hash_session_token


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_database(settings: Settings = Depends(get_settings)) -> Database:
    return Database(settings.database_path)


def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> dict[str, Any]:
    raw_token = request.cookies.get(settings.session_cookie_name)
    if not raw_token:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    user = database.get_user_by_session(hash_session_token(raw_token))
    if not user:
        raise ApiError(401, "SESSION_INVALID", "登录状态已失效，请重新登录")
    return user


def require_admin(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if user["role"] != "admin":
        raise ApiError(403, "ADMIN_REQUIRED", "仅系统管理员可以执行此操作")
    return user
