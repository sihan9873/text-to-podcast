from pathlib import Path

from app.database import Database
from app.security import verify_password


def initialized_database(tmp_path: Path) -> Database:
    database = Database(tmp_path / "textcast-test.db")
    database.initialize()
    return database


def test_user_lifecycle_and_filters(tmp_path: Path) -> None:
    database = initialized_database(tmp_path)
    admin = database.create_user(
        username="admin",
        display_name="系统管理员",
        password="AdminPass123!",
        role="admin",
    )
    user = database.create_user(
        username="alice",
        display_name="Alice",
        password="UserPass123!",
        actor_user_id=admin["id"],
    )

    assert database.count_users() == 2
    assert database.active_admin_count() == 1
    assert [item["username"] for item in database.list_users(role="user")] == [
        "alice"
    ]
    assert database.list_users(search="Ali")[0]["id"] == user["id"]

    updated = database.update_user(
        user["id"],
        {"displayName": "爱丽丝", "status": "disabled"},
        actor_user_id=admin["id"],
    )
    assert updated is not None
    assert updated["displayName"] == "爱丽丝"
    assert updated["status"] == "disabled"


def test_disabling_or_resetting_password_revokes_sessions(tmp_path: Path) -> None:
    database = initialized_database(tmp_path)
    admin = database.create_user(
        username="admin",
        display_name="系统管理员",
        password="AdminPass123!",
        role="admin",
    )
    user = database.create_user(
        username="alice",
        display_name="Alice",
        password="UserPass123!",
        actor_user_id=admin["id"],
    )

    database.create_session("first-session", user["id"], 3600)
    assert database.get_user_by_session("first-session") is not None
    assert database.reset_password(
        user["id"], "NewUserPass456!", actor_user_id=admin["id"]
    )
    assert database.get_user_by_session("first-session") is None
    record = database.get_user_record_by_username("alice")
    assert record is not None
    assert verify_password("NewUserPass456!", record["password_hash"])

    database.create_session("second-session", user["id"], 3600)
    database.update_user(
        user["id"], {"status": "disabled"}, actor_user_id=admin["id"]
    )
    assert database.get_user_by_session("second-session") is None
