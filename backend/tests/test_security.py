from __future__ import annotations

import pytest

from app.security import (
    CredentialValidationError,
    hash_password,
    validate_password,
    validate_username,
    verify_password,
)


def test_password_hash_is_salted_and_verifiable() -> None:
    first = hash_password("StrongPass123!")
    second = hash_password("StrongPass123!")

    assert first != second
    assert "StrongPass123!" not in first
    assert verify_password("StrongPass123!", first)
    assert not verify_password("wrong-password", first)


def test_username_normalization_and_validation() -> None:
    assert validate_username(" Alice-01 ") == "alice-01"
    with pytest.raises(CredentialValidationError):
        validate_username("中文用户名")


def test_password_length_validation() -> None:
    with pytest.raises(CredentialValidationError):
        validate_password("short")
