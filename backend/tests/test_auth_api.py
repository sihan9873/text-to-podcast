from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app


ADMIN_PASSWORD = "AdminPass123!"


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture()
async def client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    settings = Settings(
        database_path=tmp_path / "test.db",
        session_ttl_seconds=3600,
        cors_origins=["http://localhost:5173"],
        bootstrap_admin_username="admin",
        bootstrap_admin_password=ADMIN_PASSWORD,
        bootstrap_admin_display_name="测试管理员",
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as test_client:
            yield test_client


async def login(client: AsyncClient, username: str, password: str) -> None:
    response = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text


async def create_normal_user(
    client: AsyncClient, username: str = "alice"
) -> dict:
    response = await client.post(
        "/api/admin/users",
        json={
            "username": username,
            "displayName": "Alice",
            "password": "UserPass123!",
            "role": "user",
            "status": "active",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["user"]


@pytest.mark.anyio
async def test_login_session_and_logout(client: AsyncClient) -> None:
    bad = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "wrong"}
    )
    assert bad.status_code == 401
    assert bad.json()["code"] == "INVALID_CREDENTIALS"

    await login(client, "admin", ADMIN_PASSWORD)
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "admin"
    assert "textcast_session" in client.cookies

    assert (await client.post("/api/auth/logout")).status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.anyio
async def test_admin_can_create_update_disable_and_reset_user(
    client: AsyncClient,
) -> None:
    await login(client, "admin", ADMIN_PASSWORD)
    user = await create_normal_user(client)

    listed = await client.get("/api/admin/users")
    assert listed.status_code == 200
    assert listed.json()["total"] == 2

    updated = await client.patch(
        f"/api/admin/users/{user['id']}",
        json={"displayName": "爱丽丝", "status": "disabled"},
    )
    assert updated.status_code == 200
    assert updated.json()["user"]["displayName"] == "爱丽丝"
    assert updated.json()["user"]["status"] == "disabled"

    await client.post("/api/auth/logout")
    disabled_login = await client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "UserPass123!"},
    )
    assert disabled_login.status_code == 403
    assert disabled_login.json()["code"] == "ACCOUNT_DISABLED"


@pytest.mark.anyio
async def test_normal_user_cannot_access_admin_api(client: AsyncClient) -> None:
    await login(client, "admin", ADMIN_PASSWORD)
    await create_normal_user(client)
    await client.post("/api/auth/logout")
    await login(client, "alice", "UserPass123!")

    response = await client.get("/api/admin/users")
    assert response.status_code == 403
    assert response.json()["code"] == "ADMIN_REQUIRED"


@pytest.mark.anyio
async def test_password_reset_revokes_existing_sessions(
    client: AsyncClient,
) -> None:
    await login(client, "admin", ADMIN_PASSWORD)
    user = await create_normal_user(client)

    transport = client._transport
    async with AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as user_client:
        await login(user_client, "alice", "UserPass123!")

        response = await client.post(
            f"/api/admin/users/{user['id']}/reset-password",
            json={"newPassword": "NewUserPass456!"},
        )
        assert response.status_code == 204
        assert (await user_client.get("/api/auth/me")).status_code == 401
        assert (
            await user_client.post(
                "/api/auth/login",
                json={"username": "alice", "password": "UserPass123!"},
            )
        ).status_code == 401
        await login(user_client, "alice", "NewUserPass456!")


@pytest.mark.anyio
async def test_last_active_admin_cannot_change_own_access(
    client: AsyncClient,
) -> None:
    await login(client, "admin", ADMIN_PASSWORD)
    admin_id = (await client.get("/api/auth/me")).json()["user"]["id"]

    self_change = await client.patch(
        f"/api/admin/users/{admin_id}", json={"status": "disabled"}
    )
    assert self_change.status_code == 409
    assert self_change.json()["code"] == "SELF_ACCESS_CHANGE_FORBIDDEN"


@pytest.mark.anyio
async def test_change_password_reissues_current_session(
    client: AsyncClient,
) -> None:
    await login(client, "admin", ADMIN_PASSWORD)
    response = await client.post(
        "/api/auth/change-password",
        json={
            "currentPassword": ADMIN_PASSWORD,
            "newPassword": "ChangedAdmin456!",
        },
    )
    assert response.status_code == 200
    assert (await client.get("/api/auth/me")).status_code == 200
    await client.post("/api/auth/logout")
    assert (
        await client.post(
            "/api/auth/login",
            json={"username": "admin", "password": ADMIN_PASSWORD},
        )
    ).status_code == 401
    await login(client, "admin", "ChangedAdmin456!")
