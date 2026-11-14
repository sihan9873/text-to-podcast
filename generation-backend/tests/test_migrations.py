from io import StringIO

from alembic import command
from alembic.config import Config

from app.core.config import ROOT


def test_mysql_migration_builds_deferred_foreign_keys(monkeypatch):
    """离线校验循环外键在相关表均创建后建立，不需要 MySQL 服务。"""
    monkeypatch.setenv('DATABASE_URL', 'mysql+pymysql://user:password@localhost/textcast')
    output = StringIO()
    config = Config(str(ROOT / 'alembic.ini'), output_buffer=output)
    command.upgrade(config, '6cd3f46a61e0', sql=True)
    sql = output.getvalue()
    assert sql.count('CREATE TABLE ') == 11  # 10 张业务表，加 alembic_version
    for name in ['fk_project_current_script', 'fk_project_confirmed_script',
                 'fk_project_active_task', 'fk_task_audio_version']:
        assert sql.count('ADD CONSTRAINT ' + name) == 1
        assert sql.index('ADD CONSTRAINT ' + name) > sql.index('CREATE TABLE script_sentences')
