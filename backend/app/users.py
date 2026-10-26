from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response

from .database import Database
from .dependencies import get_database, require_admin
from .errors import ApiError
from .schemas import (
    CreateUserRequest,
    ResetPasswordRequest,
    UpdateUserRequest,
    UserListResponse,
    UserResponse,
)
from .security import (
    CredentialValidationError,
    validate_password,
    validate_username,
)


router = APIRouter(prefix="/admin/users", tags=["user-management"])


@router.get("", response_model=UserListResponse)
def list_users(
    search: str | None = Query(default=None, max_length=80),
    role: Literal["admin", "user"] | None = None,
    status: Literal["active", "disabled"] | None = None,
    _: dict[str, object] = Depends(require_admin),
    database: Database = Depends(get_database),
) -> dict[str, object]:
    users = database.list_users(search=search, role=role, status=status)
    return {"users": users, "total": len(users)}


@router.post("", response_model=UserResponse, status_code=201)
def create_user(
    body: CreateUserRequest,
    admin: dict[str, object] = Depends(require_admin),
    database: Database = Depends(get_database),
) -> dict[str, object]:
    try:
        username = validate_username(body.username)
        validate_password(body.password)
    except CredentialValidationError as exc:
        raise ApiError(400, "CREDENTIAL_INVALID", str(exc)) from exc
    display_name = body.displayName.strip()
    if not display_name:
        raise ApiError(400, "DISPLAY_NAME_REQUIRED", "显示名称不能为空")
    try:
        user = database.create_user(
            username=username,
            display_name=display_name,
            password=body.password,
            role=body.role,
            status=body.status,
            actor_user_id=str(admin["id"]),
        )
    except sqlite3.IntegrityError as exc:
        raise ApiError(409, "USERNAME_EXISTS", "用户名已经存在") from exc
    return {"user": user}


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    admin: dict[str, object] = Depends(require_admin),
    database: Database = Depends(get_database),
) -> dict[str, object]:
    target = database.get_user(user_id)
    if target is None:
        raise ApiError(404, "USER_NOT_FOUND", "用户不存在")

    changes = body.model_dump(exclude_none=True)
    if "displayName" in changes:
        changes["displayName"] = changes["displayName"].strip()
        if not changes["displayName"]:
            raise ApiError(400, "DISPLAY_NAME_REQUIRED", "显示名称不能为空")

    changing_own_access = user_id == admin["id"] and (
        ("role" in changes and changes["role"] != admin["role"])
        or ("status" in changes and changes["status"] != admin["status"])
    )
    if changing_own_access:
        raise ApiError(409, "SELF_ACCESS_CHANGE_FORBIDDEN", "不能修改自己的角色或状态")

    removes_active_admin = (
        target["role"] == "admin"
        and target["status"] == "active"
        and (
            changes.get("role", target["role"]) != "admin"
            or changes.get("status", target["status"]) != "active"
        )
    )
    if removes_active_admin and database.active_admin_count() <= 1:
        raise ApiError(409, "LAST_ADMIN_REQUIRED", "系统必须保留至少一个启用的管理员")

    updated = database.update_user(user_id, changes, actor_user_id=str(admin["id"]))
    return {"user": updated}


@router.post(
    "/{user_id}/reset-password",
    status_code=204,
    response_class=Response,
    response_model=None,
)
def reset_password(
    user_id: str,
    body: ResetPasswordRequest,
    admin: dict[str, object] = Depends(require_admin),
    database: Database = Depends(get_database),
) -> None:
    if user_id == admin["id"]:
        raise ApiError(409, "USE_CHANGE_PASSWORD", "请通过个人资料页面修改自己的密码")
    try:
        validate_password(body.newPassword)
    except CredentialValidationError as exc:
        raise ApiError(400, "PASSWORD_INVALID", str(exc)) from exc
    if not database.reset_password(
        user_id, body.newPassword, actor_user_id=str(admin["id"])
    ):
        raise ApiError(404, "USER_NOT_FOUND", "用户不存在")
