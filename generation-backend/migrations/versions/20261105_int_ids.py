"""Replace UUID business keys with per-table auto-increment integers.

Data and snapshot references are remapped together. SQLite runs this rebuild
in a single explicit transaction with foreign keys checked before commit.
"""
import hashlib
import json
import re

from alembic import context, op
import sqlalchemy as sa

revision = '20261105_int_ids'
down_revision = '6cd3f46a61e0'
branch_labels = None
depends_on = None

TABLES = ('llm_models', 'users', 'assets', 'projects', 'role_profiles',
          'scripts', 'audio_versions', 'script_roles', 'tasks', 'script_sentences')
REFERENCES = {
    'user_id': 'users', 'confirmed_by': 'users',
    'project_id': 'projects', 'confirmed_project_key': 'projects',
    'model_id': 'llm_models', 'llm_model_id': 'llm_models',
    'profile_id': 'role_profiles', 'role_id': 'script_roles',
    'sentence_id': 'script_sentences',
    'script_id': 'scripts', 'current_script_id': 'scripts', 'confirmed_script_id': 'scripts',
    'task_id': 'tasks', 'active_task_id': 'tasks', 'retry_of_task_id': 'tasks',
    'audio_version_id': 'audio_versions',
    'asset_id': 'assets', 'result_asset_id': 'assets', 'current_asset_id': 'assets',
}
URL_TABLES = {'tasks': 'tasks', 'scripts': 'scripts', 'projects': 'projects', 'audio-assets': 'assets'}


def remap_json(value, mappings):
    if isinstance(value, list):
        return [remap_json(item, mappings) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in REFERENCES and isinstance(item, str) and item in mappings[REFERENCES[key]]:
            result[key] = mappings[REFERENCES[key]][item]
        elif key in ('status_url', 'play_url', 'download_url') and isinstance(item, str):
            def replace(match):
                group, old = match.groups()
                return '/api/v1/' + group + '/' + str(mappings[URL_TABLES[group]].get(old, old))
            result[key] = re.sub(r'/api/v1/(tasks|scripts|projects|audio-assets)/([^/?#]+)', replace, item)
        else:
            result[key] = remap_json(item, mappings)
    return result


def upgrade():
    if context.is_offline_mode():
        raise RuntimeError('ID 数据迁移需要在线连接数据库；不能仅生成 SQL 后离线执行。')
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite' and bind.exec_driver_sql('PRAGMA foreign_keys').scalar():
        raise RuntimeError('请通过 python -m app.bootstrap 执行，迁移前需在事务外关闭 SQLite 外键检查。')
    old = sa.MetaData()
    old.reflect(bind, only=TABLES)
    rows = {name: [dict(row) for row in bind.execute(sa.select(old.tables[name])
            .order_by(old.tables[name].c.created_at, old.tables[name].c.id)).mappings()] for name in TABLES}
    mappings = {name: {row['id']: i for i, row in enumerate(values, 1)} for name, values in rows.items()}
    # Keep fixed development records at 1, even if another record was imported earlier.
    preferred = {'users': '00000000-0000-4000-8000-000000000001',
                 'llm_models': '00000000-0000-4000-8000-000000000002',
                 'role_profiles': '00000000-0000-4000-8000-000000000003'}
    for name, first in preferred.items():
        if first in mappings[name]:
            ordered = [first] + [row['id'] for row in rows[name] if row['id'] != first]
            mappings[name] = {old_id: i for i, old_id in enumerate(ordered, 1)}
    converted = {}
    for name, values in rows.items():
        converted[name] = []
        for row in values:
            target = {}
            for key, value in row.items():
                if key == 'confirmed_project_key':
                    continue  # Generated column is recalculated by the database.
                if key == 'id':
                    target[key] = mappings[name][value]
                elif key in REFERENCES and value is not None:
                    target[key] = mappings[REFERENCES[key]][value]
                elif isinstance(old.tables[name].c[key].type, sa.JSON):
                    target[key] = remap_json(value, mappings)
                else:
                    target[key] = value
            if name == 'tasks':
                snapshot = target['input_snapshot']
                if target['task_type'] == 'script':
                    body = {'roles': [{'profile_id': r['profile_id'], 'role_key': r['role_key']}
                                      for r in snapshot['roles']]}
                else:
                    script = snapshot['script']
                    body = {'script_id': script['script_id'], 'expected_script_version': script['version'],
                            'expected_edit_revision': script['edit_revision']}
                signature = json.dumps({'project_id': target['project_id'], 'type': target['task_type'],
                                        'body': body}, sort_keys=True)
                target['request_hash'] = hashlib.sha256(signature.encode()).hexdigest()
            converted[name].append(target)
    mysql = bind.dialect.name == 'mysql'
    if mysql:
        bind.exec_driver_sql('SET FOREIGN_KEY_CHECKS=0')
    try:
        for name in reversed(TABLES):
            op.drop_table(name)
        _create_integer_tables()
        new = sa.MetaData()
        new.reflect(bind, only=TABLES)
        for name in TABLES:
            if converted[name]:
                bind.execute(new.tables[name].insert(), converted[name])
        # Validate every reference, including on MySQL where reenabling checks
        # does not retrospectively check the imported rows.
        for table in new.tables.values():
            for fk in table.foreign_keys:
                missing = bind.scalar(sa.select(sa.func.count()).select_from(table.outerjoin(
                    fk.column.table, fk.parent == fk.column)).where(
                        fk.parent.is_not(None), fk.column.is_(None)))
                if missing:
                    raise RuntimeError(f'迁移外键校验失败：{table.name}.{fk.parent.name}')
        if bind.dialect.name == 'sqlite' and bind.exec_driver_sql('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('迁移 SQLite 外键校验失败')
        context.config.attributes['id_mapping'] = mappings
    finally:
        if mysql:
            bind.exec_driver_sql('SET FOREIGN_KEY_CHECKS=1')


def downgrade():
    raise RuntimeError('ID 转换不支持自动降级；请使用升级前数据库备份和对应旧代码恢复。')


def _create_integer_tables():
    """Frozen target schema; independent of future ORM model changes."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('llm_models',
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('provider_code', sa.String(length=64), nullable=False),
    sa.Column('model_code', sa.String(length=128), nullable=False),
    sa.Column('params', sa.JSON(), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sqlite_autoincrement=True)
    op.create_table('users',
    sa.Column('username', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username'),
    sqlite_autoincrement=True)
    op.create_table('assets',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('object_key', sa.String(length=255), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('metadata_json', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('object_key'),
    sqlite_autoincrement=True)
    op.create_table('projects',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('source_text', sa.Text(), nullable=True),
    sa.Column('source_type', sa.String(length=16), nullable=True),
    sa.Column('source_hash', sa.String(length=64), nullable=True),
    sa.Column('source_submitted_at', sa.DateTime(), nullable=True),
    sa.Column('llm_model_id', sa.Integer(), nullable=False),
    sa.Column('current_script_id', sa.Integer(), nullable=True),
    sa.Column('confirmed_script_id', sa.Integer(), nullable=True),
    sa.Column('active_task_id', sa.Integer(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['active_task_id'], ['tasks.id'], name='fk_project_active_task', use_alter=True),
    sa.ForeignKeyConstraint(['confirmed_script_id'], ['scripts.id'], name='fk_project_confirmed_script', use_alter=True),
    sa.ForeignKeyConstraint(['current_script_id'], ['scripts.id'], name='fk_project_current_script', use_alter=True),
    sa.ForeignKeyConstraint(['llm_model_id'], ['llm_models.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sqlite_autoincrement=True)
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_user_id'), ['user_id'], unique=False)

    op.create_table('role_profiles',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('voice_config', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sqlite_autoincrement=True)
    with op.batch_alter_table('role_profiles', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_role_profiles_user_id'), ['user_id'], unique=False)

    op.create_table('scripts',
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('edit_revision', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('llm_snapshot', sa.JSON(), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.Column('confirmed_by', sa.Integer(), nullable=True),
    sa.Column('confirmed_revision', sa.Integer(), nullable=True),
    sa.Column('confirmed_project_key', sa.Integer(), sa.Computed("CASE WHEN status = 'confirmed' THEN project_id ELSE NULL END", persisted=True), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("status IN ('draft','confirmed')"),
    sa.ForeignKeyConstraint(['confirmed_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('confirmed_project_key'),
    sa.UniqueConstraint('project_id', 'version'),
    sqlite_autoincrement=True)
    with op.batch_alter_table('scripts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_scripts_project_id'), ['project_id'], unique=False)

    op.create_table('audio_versions',
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('script_id', sa.Integer(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('script_edit_revision', sa.Integer(), nullable=False),
    sa.Column('script_snapshot', sa.JSON(), nullable=False),
    sa.Column('config_snapshot', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('selection_revision', sa.Integer(), nullable=False),
    sa.Column('current_asset_id', sa.Integer(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['current_asset_id'], ['assets.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['script_id'], ['scripts.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'version'),
    sqlite_autoincrement=True)
    op.create_table('script_roles',
    sa.Column('script_id', sa.Integer(), nullable=False),
    sa.Column('profile_id', sa.Integer(), nullable=False),
    sa.Column('role_key', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('voice_config', sa.JSON(), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['profile_id'], ['role_profiles.id'], ),
    sa.ForeignKeyConstraint(['script_id'], ['scripts.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('script_id', 'id'),
    sa.UniqueConstraint('script_id', 'role_key'),
    sqlite_autoincrement=True)
    op.create_table('tasks',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('task_type', sa.String(length=16), nullable=False),
    sa.Column('audio_action', sa.String(length=16), nullable=True),
    sa.Column('script_id', sa.Integer(), nullable=True),
    sa.Column('audio_version_id', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('stage', sa.String(length=32), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=True),
    sa.Column('total_sentences', sa.Integer(), nullable=False),
    sa.Column('completed_sentences', sa.Integer(), nullable=False),
    sa.Column('failed_sentences', sa.Integer(), nullable=False),
    sa.Column('input_snapshot', sa.JSON(), nullable=False),
    sa.Column('result_json', sa.JSON(), nullable=True),
    sa.Column('result_asset_id', sa.Integer(), nullable=True),
    sa.Column('error_code', sa.String(length=64), nullable=True),
    sa.Column('error_message', sa.String(length=1000), nullable=True),
    sa.Column('idempotency_key', sa.String(length=128), nullable=False),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('heartbeat_at', sa.DateTime(), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(), nullable=True),
    sa.Column('lease_token', sa.String(length=36), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("status IN ('queued','running','succeeded','failed')"),
    sa.ForeignKeyConstraint(['audio_version_id'], ['audio_versions.id'], name='fk_task_audio_version', use_alter=True),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['result_asset_id'], ['assets.id'], ),
    sa.ForeignKeyConstraint(['script_id'], ['scripts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'idempotency_key'),
    sqlite_autoincrement=True)
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.create_index('ix_tasks_queue', ['status', 'created_at', 'id'], unique=False)

    op.create_table('script_sentences',
    sa.Column('script_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('sequence', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('speed', sa.Float(), nullable=True),
    sa.Column('extra_params', sa.JSON(), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('sequence > 0'),
    sa.ForeignKeyConstraint(['role_id'], ['script_roles.id'], ),
    sa.ForeignKeyConstraint(['script_id'], ['scripts.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('script_id', 'sequence'),
    sqlite_autoincrement=True)
    # ### end Alembic commands ###


    # MySQL 延迟建立循环外键；SQLite 已在 CREATE TABLE 中内联建立。
    if op.get_bind().dialect.name == 'mysql':
        op.create_foreign_key('fk_project_current_script', 'projects', 'scripts', ['current_script_id'], ['id'])
        op.create_foreign_key('fk_project_confirmed_script', 'projects', 'scripts', ['confirmed_script_id'], ['id'])
        op.create_foreign_key('fk_project_active_task', 'projects', 'tasks', ['active_task_id'], ['id'])
        op.create_foreign_key('fk_task_audio_version', 'tasks', 'audio_versions', ['audio_version_id'], ['id'])
