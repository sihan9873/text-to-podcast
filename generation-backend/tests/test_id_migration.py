"""Upgrade an actual UUID database, including snapshots, jobs and assets."""
from copy import deepcopy
import hashlib
import json
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import MetaData, inspect, select

from app.bootstrap import initialize
from app.core.common import utcnow
from app.core.config import ROOT, Settings
from app.db.database import Database
from app.db.models import AudioVersion, Project, Script, Task
from app.integrations.mock import MockAudioGenerator, MockScriptGenerator
from app.main import create_app
from app.worker import Worker


def legacy_database(settings):
    db = Database(settings.database_url)
    cfg = Config(str(ROOT / 'alembic.ini'))
    with db.engine.connect() as connection:
        cfg.attributes['connection'] = connection
        command.upgrade(cfg, '6cd3f46a61e0')
    metadata = MetaData()
    metadata.reflect(db.engine)
    ids = {'users': '00000000-0000-4000-8000-000000000001',
           'llm_models': '00000000-0000-4000-8000-000000000002',
           'role_profiles': '00000000-0000-4000-8000-000000000003'}

    with db.engine.begin() as connection:
        def add(table, label=None, **values):
            key = label or table
            old_id = ids.setdefault(key, str(uuid4()))
            connection.execute(metadata.tables[table].insert().values(
                id=old_id, created_at=utcnow(), updated_at=utcnow(), **values))
            return old_id

        user = add('users', username='development_user', status='active')
        model = add('llm_models', name='mock', provider_code='mock', model_code='mock-script-v1',
                    params={'simulated': True}, enabled=True)
        profile = add('role_profiles', user_id=user, name='host', description='host',
                      voice_config={'voice_id': 'test-tone'}, status='enabled')
        project = add('projects', user_id=user, title='保留旧项目', source_text='原文不能被改写',
                      source_type='text', source_hash='source-hash', source_submitted_at=utcnow(), llm_model_id=model)
        role_snapshot = {'profile_id': profile, 'role_key': 'host', 'name': 'host',
                         'description': 'host', 'voice_config': {'voice_id': 'test-tone'}}
        script_input = {'source_text': '原文不能被改写', 'source_hash': 'source-hash', 'simulated': True,
                        'model': {'model_id': model}, 'roles': [role_snapshot], 'prompt': 'prompt'}
        script = add('scripts', project_id=project, version=1, edit_revision=1, title='旧脚本', summary='summary',
                     status='confirmed', llm_snapshot=script_input, confirmed_at=utcnow(), confirmed_by=user,
                     confirmed_revision=1)
        role = add('script_roles', script_id=script, **role_snapshot)
        sentence = add('script_sentences', script_id=script, role_id=role, sequence=1,
                       text='这是一条旧台词。', speed=1.0, extra_params={})
        settings.storage_dir.mkdir(parents=True)
        audio_bytes = (ROOT / 'fixtures/test_audio.mp3').read_bytes()
        (settings.storage_dir / 'legacy.mp3').write_bytes(audio_bytes)
        asset = add('assets', user_id=user, object_key='legacy.mp3', kind='full_audio', size_bytes=len(audio_bytes),
                    duration_ms=3048, sha256=hashlib.sha256(audio_bytes).hexdigest(),
                    metadata_json={'simulated': True}, status='ready')
        snapshot = {'script_id': script, 'project_id': project, 'version': 1, 'edit_revision': 1,
                    'confirmed_by': user, 'roles': [{'role_id': role, **role_snapshot}],
                    'sentences': [{'sentence_id': sentence, 'role_id': role, 'sequence': 1, 'text': '这是一条旧台词。'}]}
        audio = add('audio_versions', project_id=project, script_id=script, version=1, script_edit_revision=1,
                    script_snapshot=snapshot, config_snapshot={'roles': snapshot['roles']}, status='ready',
                    selection_revision=1, current_asset_id=asset)
        common = {'user_id': user, 'project_id': project, 'stage': 'completed', 'status': 'succeeded',
                  'progress': 100, 'total_sentences': 1, 'completed_sentences': 1,
                  'failed_sentences': 0, 'request_hash': 'old-hash', 'finished_at': utcnow()}
        add('tasks', 'script_task', **common, task_type='script', script_id=script, input_snapshot=script_input,
            idempotency_key='legacy-script', result_json={'script_id': script, 'version': 1})
        audio_input = {'source_text': '原文不能被改写', 'source_hash': 'source-hash', 'simulated': True, 'script': snapshot}
        add('tasks', 'audio_task', **common, task_type='audio', audio_action='full', script_id=script,
            audio_version_id=audio, input_snapshot=audio_input, idempotency_key='legacy-audio', result_asset_id=asset,
            result_json={'asset_id': asset, 'audio_version_id': audio,
                         'play_url': f'/api/v1/audio-assets/{asset}/play',
                         'download_url': f'/api/v1/audio-assets/{asset}/download'})
        queued = dict(common, status='queued', stage='queued', progress=0, completed_sentences=0, finished_at=None)
        active = add('tasks', 'queued_task', **queued, task_type='script', input_snapshot=deepcopy(script_input),
                     idempotency_key='legacy-queued')
        connection.execute(metadata.tables['projects'].update().where(metadata.tables['projects'].c.id == project)
                           .values(current_script_id=script, confirmed_script_id=script, active_task_id=active))
    db.engine.dispose()
    return ids


def test_upgrade_preserves_relations_snapshots_idempotency_and_download(tmp_path):
    settings = Settings(database_url=f'sqlite:///{(tmp_path / "legacy.sqlite3").as_posix()}',
                        storage_dir=tmp_path / 'assets')
    old = legacy_database(settings)
    initialize(settings)
    backups = list((tmp_path / 'backups').glob('*.sqlite3'))
    assert len(backups) == 1
    mapping = json.loads(backups[0].with_suffix('.mapping.json').read_text(encoding='utf-8'))
    assert mapping['projects'][old['projects']] == 1
    initialize(settings)  # Upgrading twice must not reset sequences or duplicate seeds.
    assert len(list((tmp_path / 'backups').glob('*.sqlite3'))) == 1
    app = create_app(settings)
    db = app.state.database
    with TestClient(app) as client:
        project = client.get('/api/v1/projects/1').json()['data']
        assert project['source_text'] == '原文不能被改写'
        assert project['confirmed_script']['script_id'] == 1
        with db.sessions() as session:
            audio = session.get(AudioVersion, 1)
            assert audio.script_snapshot['sentences'][0]['sentence_id'] == 1
            assert audio.config_snapshot['roles'][0]['profile_id'] == 1
            assert session.get(Script, 1).confirmed_project_key == 1
            assert session.get(Task, 3).input_snapshot['model']['model_id'] == 1
        replay = client.post('/api/v1/projects/1/script/generate', headers={'Idempotency-Key': 'legacy-script'},
                             json={'roles': [{'profile_id': 1, 'role_key': 'host'}]})
        assert replay.status_code == 200 and replay.json()['data']['task_id'] == 1
        replay = client.post('/api/v1/projects/1/audio/generate', headers={'Idempotency-Key': 'legacy-audio'},
                             json={'script_id': 1, 'expected_script_version': 1, 'expected_edit_revision': 1})
        assert replay.status_code == 200 and replay.json()['data']['task_id'] == 2
        result = client.get('/api/v1/tasks/2').json()['data']['result']
        assert result['asset_id'] == 1
        assert result['download_url'] == '/api/v1/audio-assets/1/download'
        assert client.get(result['download_url']).content == (ROOT / 'fixtures/test_audio.mp3').read_bytes()
        worker = Worker(db, settings, MockScriptGenerator(0), MockAudioGenerator(0))
        assert worker.run_once()
        assert client.get('/api/v1/tasks/3').json()['data']['status'] == 'succeeded'
        assert client.get('/api/v1/projects/1').json()['data']['current_script']['script_id'] == 2
        assert client.post('/api/v1/projects', json={'title': '新项目'}).json()['data']['project_id'] == 2


def test_sqlite_migration_failure_rolls_back_schema_and_data(tmp_path, monkeypatch):
    settings = Settings(database_url=f'sqlite:///{(tmp_path / "rollback.sqlite3").as_posix()}',
                        storage_dir=tmp_path / 'assets')
    legacy_database(settings)
    from alembic.operations import Operations
    original = Operations.create_table

    def broken(self, name, *args, **kwargs):
        if name == 'script_sentences':
            raise RuntimeError('injected migration failure')
        return original(self, name, *args, **kwargs)

    monkeypatch.setattr(Operations, 'create_table', broken)
    with pytest.raises(RuntimeError, match='injected migration failure'):
        initialize(settings)
    db = Database(settings.database_url)
    with db.engine.connect() as connection:
        assert connection.exec_driver_sql('SELECT version_num FROM alembic_version').scalar() == '6cd3f46a61e0'
        assert connection.exec_driver_sql('SELECT count(*) FROM tasks').scalar() == 3
        assert connection.exec_driver_sql('SELECT id FROM users').scalar() == '00000000-0000-4000-8000-000000000001'
        assert connection.exec_driver_sql('PRAGMA foreign_keys').scalar() == 1
        assert connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall() == []
    db.engine.dispose()
