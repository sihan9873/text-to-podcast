from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


UserRole = Literal["admin", "user"]
UserStatus = Literal["active", "disabled"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserOut(StrictModel):
    id: str
    username: str
    displayName: str
    role: UserRole
    status: UserStatus
    createdAt: str
    updatedAt: str
    lastLoginAt: str | None


class LoginRequest(StrictModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(StrictModel):
    username: str = Field(min_length=3, max_length=32)
    displayName: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)


class LoginResponse(StrictModel):
    user: UserOut
    expiresAt: str


class MeResponse(StrictModel):
    user: UserOut


class UpdateMyProfileRequest(StrictModel):
    displayName: str = Field(min_length=1, max_length=80)


class ChangePasswordRequest(StrictModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class CreateUserRequest(StrictModel):
    username: str = Field(min_length=3, max_length=32)
    displayName: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = "user"
    status: UserStatus = "active"


class UpdateUserRequest(StrictModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    role: UserRole | None = None
    status: UserStatus | None = None

    @model_validator(mode="after")
    def require_change(self) -> "UpdateUserRequest":
        if self.displayName is None and self.role is None and self.status is None:
            raise ValueError("至少需要提供一个待更新字段")
        return self


class ResetPasswordRequest(StrictModel):
    newPassword: str = Field(min_length=8, max_length=128)


class UserResponse(StrictModel):
    user: UserOut


class UserListResponse(StrictModel):
    users: list[UserOut]
    total: int
