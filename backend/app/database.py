from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from .security import hash_password


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT,
    password_changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL
);
"""


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat().replace("+00:00", "Z")


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "role": row["role"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastLoginAt": row["last_login_at"],
    }


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA)
            from .migrations import migrate

            migrate(connection)

    def count_users(self) -> int:
        with self.connect() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()
            return int(row["count"])

    def create_user(
        self,
        *,
        username: str,
        display_name: str,
        password: str,
        role: str = "user",
        status: str = "active",
        actor_user_id: str | None = None,
    ) -> dict[str, Any]:
        now = iso()
        user_id = str(uuid.uuid4())
        password_digest = hash_password(password)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO users (
                    id, username, display_name, role, status, password_hash,
                    created_at, updated_at, password_changed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    username,
                    display_name,
                    role,
                    status,
                    password_digest,
                    now,
                    now,
                    now,
                ),
            )
            self._audit(
                connection,
                actor_user_id,
                user_id,
                "user.created",
                {"username": username, "role": role, "status": status},
            )
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return public_user(row)

    def get_user_record_by_username(self, username: str) -> sqlite3.Row | None:
        with self.connect() as connection:
            return connection.execute(
                "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
            ).fetchone()

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return public_user(row) if row else None

    def list_users(
        self,
        *,
        search: str | None = None,
        role: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if search:
            clauses.append("(username LIKE ? OR display_name LIKE ?)")
            pattern = f"%{search}%"
            params.extend([pattern, pattern])
        if role:
            clauses.append("role = ?")
            params.append(role)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM users{where} ORDER BY created_at DESC", params
            ).fetchall()
            return [public_user(row) for row in rows]

    def update_user(
        self,
        user_id: str,
        changes: dict[str, Any],
        *,
        actor_user_id: str,
    ) -> dict[str, Any] | None:
        columns = {
            "displayName": "display_name",
            "role": "role",
            "status": "status",
        }
        assignments: list[str] = []
        values: list[Any] = []
        for api_name, column in columns.items():
            if api_name in changes:
                assignments.append(f"{column} = ?")
                values.append(changes[api_name])
        if not assignments:
            return self.get_user(user_id)
        assignments.append("updated_at = ?")
        values.extend([iso(), user_id])
        with self.connect() as connection:
            cursor = connection.execute(
                f"UPDATE users SET {', '.join(assignments)} WHERE id = ?", values
            )
            if cursor.rowcount == 0:
                return None
            if changes.get("status") == "disabled":
                connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._audit(
                connection,
                actor_user_id,
                user_id,
                "user.updated",
                changes,
            )
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return public_user(row)

    def update_display_name(self, user_id: str, display_name: str) -> dict[str, Any]:
        now = iso()
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
                (display_name, now, user_id),
            )
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return public_user(row)

    def reset_password(
        self,
        user_id: str,
        password: str,
        *,
        actor_user_id: str,
    ) -> bool:
        now = iso()
        password_digest = hash_password(password)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE users
                SET password_hash = ?, password_changed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (password_digest, now, now, user_id),
            )
            if cursor.rowcount == 0:
                return False
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._audit(
                connection,
                actor_user_id,
                user_id,
                "user.password_reset",
                None,
            )
            return True

    def change_password(self, user_id: str, password: str) -> None:
        now = iso()
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET password_hash = ?, password_changed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (hash_password(password), now, now, user_id),
            )
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._audit(connection, user_id, user_id, "user.password_changed", None)

    def active_admin_count(self) -> int:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'"
            ).fetchone()
            return int(row["count"])

    def create_session(
        self, token_hash: str, user_id: str, ttl_seconds: int
    ) -> str:
        now = utc_now()
        expires_at = now + timedelta(seconds=ttl_seconds)
        with self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (iso(now),))
            connection.execute(
                """
                INSERT INTO sessions (
                    token_hash, user_id, created_at, expires_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (token_hash, user_id, iso(now), iso(expires_at), iso(now)),
            )
            connection.execute(
                "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
                (iso(now), iso(now), user_id),
            )
            self._audit(connection, user_id, user_id, "auth.login", None)
        return iso(expires_at)

    def get_user_by_session(self, token_hash: str) -> dict[str, Any] | None:
        now = iso()
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT users.*
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ?
                  AND sessions.expires_at > ?
                  AND users.status = 'active'
                """,
                (token_hash, now),
            ).fetchone()
            if not row:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", (token_hash,)
                )
                return None
            connection.execute(
                "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
                (now, token_hash),
            )
            return public_user(row)

    def delete_session(self, token_hash: str) -> None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT user_id FROM sessions WHERE token_hash = ?", (token_hash,)
            ).fetchone()
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            if row:
                self._audit(connection, row["user_id"], row["user_id"], "auth.logout", None)

    @staticmethod
    def _audit(
        connection: sqlite3.Connection,
        actor_user_id: str | None,
        target_user_id: str | None,
        action: str,
        details: object | None,
    ) -> None:
        connection.execute(
            """
            INSERT INTO audit_logs (
                actor_user_id, target_user_id, action, details_json, created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                actor_user_id,
                target_user_id,
                action,
                json.dumps(details, ensure_ascii=False) if details is not None else None,
                iso(),
            ),
        )
