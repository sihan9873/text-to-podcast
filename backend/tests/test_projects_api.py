from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient
from app.config import Settings
from app.database import Database
from app.main import create_app

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_project_persistence_isolation_and_errors(tmp_path: Path):
    path = tmp_path / 'projects.db'
    app = create_app(Settings(database_path=path))
    async with app.router.lifespan_context(app):
        db = Database(path)
        for name in ('alice', 'bob'):
            db.create_user(username=name, display_name=name, password='UserPass123!')
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/projects', json={'title':'test', 'input_type':'text', 'raw_text':'text'})
            assert response.status_code == 401
            assert response.json()['data'] is None
            await client.post('/api/auth/login', json={'username':'alice','password':'UserPass123!'})
            response = await client.post('/api/v1/projects', json={'title':' test ', 'input_type':'text', 'raw_text':' first\r\nsecond '})
            assert response.status_code == 201, response.text
            body = response.json()
            assert body['request_id'] == response.headers['X-Request-ID']
            assert body['timestamp'].endswith('Z')
            project = body['data']
            assert project['source_text'] == 'first\nsecond'
            assert project['script_version'] == 0
            project_id = project['project_id']
            db.initialize()  # repeated migration preserves business data
            own = await client.get('/api/v1/projects/' + project_id)
            assert own.json()['data'] == project
            empty = await client.post('/api/v1/projects', json={'title':'test','input_type':'text', 'raw_text':'  '})
            assert empty.status_code == 400
            assert empty.json()['code'] == 'TEXT_EMPTY'
            controls = await client.post('/api/v1/projects', json={'title':'test','input_type':'text','raw_text':'\x00 \x01'})
            assert controls.status_code == 400
            invalid = await client.post('/api/v1/projects', json={'title':'test','input_type':'text', 'raw_text':'text','user_id':'bob'})
            assert invalid.status_code == 422
            assert invalid.json()['code'] == 'INVALID_INPUT'
            too_long = await client.post('/api/v1/projects', json={'title':'test','input_type':'text','raw_text':'x' * 20001})
            assert too_long.status_code == 413
            assert too_long.json()['code'] == 'TEXT_TOO_LONG'
            malformed = await client.get('/api/v1/projects/not-a-uuid')
            assert malformed.status_code == 422
            missing = await client.get('/api/v1/missing')
            assert missing.status_code == 404
            assert missing.json()['data'] is None
            await client.post('/api/auth/login', json={'username':'bob','password':'UserPass123!'})
            denied = await client.get('/api/v1/projects/' + project_id)
            assert denied.status_code == 404
            assert denied.json()['code'] == 'PROJECT_NOT_FOUND'
            await client.post('/api/auth/login', json={'username':'alice','password':'UserPass123!'})
            assert (await client.get('/api/v1/projects/' + project_id)).status_code == 200
    restarted = create_app(Settings(database_path=path))
    async with restarted.router.lifespan_context(restarted):
        async with AsyncClient(transport=ASGITransport(app=restarted), base_url='http://test') as client:
            await client.post('/api/auth/login', json={'username':'alice','password':'UserPass123!'})
            assert (await client.get('/api/v1/projects/' + project_id)).json()['data'] == project


def test_migration_failure_rolls_back(tmp_path: Path, monkeypatch):
    from app import migrations
    db = Database(tmp_path / 'rollback.db')
    db.initialize()
    monkeypatch.setattr(migrations, 'MIGRATIONS', [(2, 'CREATE TABLE temporary_change (id INTEGER); INVALID SQL;')])
    with pytest.raises(Exception):
        db.initialize()
    with db.connect() as connection:
        assert connection.execute("SELECT name FROM sqlite_master WHERE name='temporary_change'").fetchone() is None
        assert connection.execute('SELECT version FROM schema_migrations').fetchall()[0][0] == 1
