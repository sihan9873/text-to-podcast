from alembic import context

from app.core.config import Settings
from app.db.database import Database
from app.db.models import Base

config = context.config
target_metadata = Base.metadata


def migrate(connection):
    sqlite = connection.dialect.name == "sqlite"
    if sqlite:
        # Rebuilding tables with circular foreign keys requires checks disabled
        # outside the transaction. Explicit BEGIN makes SQLite DDL rollbackable.
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
    try:
        with connection.begin():
            if sqlite:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
            context.configure(connection=connection, target_metadata=target_metadata,
                              compare_type=True, render_as_batch=sqlite)
            with context.begin_transaction():
                context.run_migrations()
            if sqlite and connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("数据库迁移后的外键检查失败，已回滚")
    finally:
        if sqlite:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()


if context.is_offline_mode():
    context.configure(url=Settings.from_env().database_url, target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()
elif config.attributes.get("connection") is not None:
    migrate(config.attributes["connection"])
else:
    database = Database(Settings.from_env().database_url)
    try:
        with database.engine.connect() as connection:
            migrate(connection)
    finally:
        database.engine.dispose()
