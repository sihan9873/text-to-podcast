from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets


PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}$")
PBKDF2_ITERATIONS = 600_000


class CredentialValidationError(ValueError):
    """Raised when a username or password does not meet the public contract."""


def validate_username(username: str) -> str:
    normalized = username.strip().lower()
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise CredentialValidationError(
            "用户名须为 3 至 32 位，只能包含字母、数字、点、短横线和下划线"
        )
    return normalized


def validate_password(password: str) -> None:
    if len(password) < PASSWORD_MIN_LENGTH or len(password) > PASSWORD_MAX_LENGTH:
        raise CredentialValidationError(
            f"密码长度须为 {PASSWORD_MIN_LENGTH} 至 {PASSWORD_MAX_LENGTH} 个字符"
        )
    if password.isspace():
        raise CredentialValidationError("密码不能全部为空白字符")


def hash_password(password: str) -> str:
    validate_password(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "$".join(
        [
            "pbkdf2_sha256",
            str(PBKDF2_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iteration_text)
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(actual, expected)


def create_session_token() -> tuple[str, str]:
    raw_token = secrets.token_urlsafe(32)
    return raw_token, hash_session_token(raw_token)


def hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
