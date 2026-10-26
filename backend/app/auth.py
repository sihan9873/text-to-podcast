from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from .config import Settings
from .database import Database
from .dependencies import get_current_user, get_database, get_settings
from .errors import ApiError
from .schemas import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    MeResponse,
    UpdateMyProfileRequest,
)
from .security import (
    CredentialValidationError,
    create_session_token,
    hash_session_token,
    validate_password,
    validate_username,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["authentication"])


def _set_session_cookie(
    response: Response, settings: Settings, raw_token: str
) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/api",
    )


@router.post("/login", response_model=LoginResponse)
def login(
    body: LoginRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> dict[str, object]:
    try:
        username = validate_username(body.username)
    except CredentialValidationError:
        raise ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误") from None

    record = database.get_user_record_by_username(username)
    if record is None or not verify_password(body.password, record["password_hash"]):
        raise ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误")
    if record["status"] != "active":
        raise ApiError(403, "ACCOUNT_DISABLED", "账户已被禁用，请联系管理员")

    raw_token, token_hash = create_session_token()
    expires_at = database.create_session(
        token_hash, record["id"], settings.session_ttl_seconds
    )
    _set_session_cookie(response, settings, raw_token)
    user = database.get_user(record["id"])
    return {"user": user, "expiresAt": expires_at}


@router.get("/me", response_model=MeResponse)
def me(user: dict[str, object] = Depends(get_current_user)) -> dict[str, object]:
    return {"user": user}


@router.patch("/me", response_model=MeResponse)
def update_me(
    body: UpdateMyProfileRequest,
    user: dict[str, object] = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> dict[str, object]:
    display_name = body.displayName.strip()
    if not display_name:
        raise ApiError(400, "DISPLAY_NAME_REQUIRED", "显示名称不能为空")
    updated = database.update_display_name(str(user["id"]), display_name)
    return {"user": updated}


@router.post("/change-password", response_model=LoginResponse)
def change_password(
    body: ChangePasswordRequest,
    response: Response,
    user: dict[str, object] = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> dict[str, object]:
    record = database.get_user_record_by_username(str(user["username"]))
    if record is None or not verify_password(
        body.currentPassword, record["password_hash"]
    ):
        raise ApiError(400, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
    try:
        validate_password(body.newPassword)
    except CredentialValidationError as exc:
        raise ApiError(400, "PASSWORD_INVALID", str(exc)) from exc
    if verify_password(body.newPassword, record["password_hash"]):
        raise ApiError(400, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同")

    database.change_password(str(user["id"]), body.newPassword)
    raw_token, token_hash = create_session_token()
    expires_at = database.create_session(
        token_hash, str(user["id"]), settings.session_ttl_seconds
    )
    _set_session_cookie(response, settings, raw_token)
    updated_user = database.get_user(str(user["id"]))
    return {"user": updated_user, "expiresAt": expires_at}


@router.post(
    "/logout", status_code=204, response_class=Response, response_model=None
)
def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    database: Database = Depends(get_database),
) -> None:
    raw_token = request.cookies.get(settings.session_cookie_name)
    if raw_token:
        database.delete_session(hash_session_token(raw_token))
    response.delete_cookie(settings.session_cookie_name, path="/api")
