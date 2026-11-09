import sqlite3
from pathlib import Path

import pytest
from fastapi import Response

from app.auth import register
from app.config import Settings
from app.database import Database
from app.errors import ApiError
from app.schemas import RegisterRequest


def test_register_creates_normal_user_and_cookie(tmp_path: Path) -> None:
    database = Database(tmp_path / "register.db")
    database.initialize()
    settings = Settings(database_path=database.path, allow_registration=True)
    response = Response()

    result = register(
        RegisterRequest(
            username="new-user",
            displayName="新用户",
            password="NewUserPass123!",
        ),
        response,
        settings,
        database,
    )

    assert result["user"]["role"] == "user"
    assert result["user"]["status"] == "active"
    assert "textcast_session=" in response.headers["set-cookie"]
    assert "HttpOnly" in response.headers["set-cookie"]

    with pytest.raises(ApiError) as duplicate:
        register(
            RegisterRequest(
                username="new-user",
                displayName="重复用户",
                password="AnotherPass123!",
            ),
            Response(),
            settings,
            database,
        )
    assert duplicate.value.code == "USERNAME_EXISTS"


def test_registration_can_be_disabled(tmp_path: Path) -> None:
    database = Database(tmp_path / "disabled-register.db")
    database.initialize()
    settings = Settings(database_path=database.path, allow_registration=False)

    with pytest.raises(ApiError) as disabled:
        register(
            RegisterRequest(
                username="new-user",
                displayName="新用户",
                password="NewUserPass123!",
            ),
            Response(),
            settings,
            database,
        )
    assert disabled.value.code == "REGISTRATION_DISABLED"


def test_database_still_enforces_unique_username(tmp_path: Path) -> None:
    database = Database(tmp_path / "unique-user.db")
    database.initialize()
    database.create_user(
        username="alice",
        display_name="Alice",
        password="UserPass123!",
    )
    with pytest.raises(sqlite3.IntegrityError):
        database.create_user(
            username="alice",
            display_name="Another Alice",
            password="AnotherPass123!",
        )
