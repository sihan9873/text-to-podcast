"""python -m app.bootstrap：迁移数据库并初始化固定测试身份、模型及角色。"""
from alembic import command
from alembic.config import Config
from datetime import datetime
import json
from pathlib import Path
import sqlite3
from sqlalchemy.engine import make_url

from app.core.config import ROOT, Settings
from app.db.database import Database
from app.db.seed import seed


def backup_uuid_database(settings):
    """SQLite online backup captures WAL contents as well as the main file."""
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None
    path = Path(url.database).resolve()
    if not path.is_file():
        return None
    with sqlite3.connect(path) as source:
        columns = source.execute("PRAGMA table_info(projects)").fetchall()
        if not any(col[1] == 'id' and col[2].upper().startswith(('VARCHAR', 'TEXT')) for col in columns):
            return None
        folder = path.parent / "backups"
        folder.mkdir(parents=True, exist_ok=True)
        backup = folder / (path.stem + "-before-int-ids-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".sqlite3")
        with sqlite3.connect(backup) as target:
            source.backup(target)
    return backup


def initialize(settings=None):
    settings = settings or Settings.from_env()
    backup = backup_uuid_database(settings)
    database = Database(settings.database_url)
    try:
        cfg = Config(str(ROOT / "alembic.ini"))
        with database.engine.connect() as connection:
            cfg.attributes["connection"] = connection
            command.upgrade(cfg, "head")
        if backup and cfg.attributes.get("id_mapping") is not None:
            backup.with_suffix(".mapping.json").write_text(
                json.dumps(cfg.attributes["id_mapping"], ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"旧数据库备份及ID映射已保存：{backup}")
        seed(database, settings)
    finally:
        database.engine.dispose()


if __name__ == "__main__":
    initialize()
    print("数据库迁移和测试数据初始化完成。分别启动 API 与 Worker。")
