"""Ordered, transactional migrations for business tables."""
import sqlite3
from .database import iso

MIGRATIONS = [(1, """
CREATE TABLE projects (
 project_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
 source_text TEXT NOT NULL CHECK(length(trim(source_text)) > 0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','script_generating','script_review','script_ready','audio_generating','audio_review','audio_ready','exporting','completed','failed')),
 script_version INTEGER NOT NULL DEFAULT 0 CHECK(script_version >= 0),
 config_version INTEGER NOT NULL DEFAULT 0 CHECK(config_version >= 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_owner_created ON projects(user_id, created_at DESC, project_id);
""")]

def migrate(connection: sqlite3.Connection) -> None:
    connection.execute('BEGIN IMMEDIATE')
    connection.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    applied = {row[0] for row in connection.execute('SELECT version FROM schema_migrations')}
    for version, sql in MIGRATIONS:
        if version in applied:
            continue
        for statement in sql.split(';'):
            if statement.strip():
                connection.execute(statement)
        connection.execute('INSERT INTO schema_migrations VALUES (?, ?)', (version, iso()))
