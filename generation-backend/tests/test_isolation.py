from fastapi.testclient import TestClient

from test_framework import env  # noqa: F401  (pytest fixture)

from app.bootstrap import initialize
from app.core.common import BusinessError
from app.core.config import Settings
from app.db.models import User
from app.main import create_app
from app.services.projects import create_project
from app.services.views import owned_project


def test_project_is_only_visible_to_its_owner(env):
    with env.db.sessions() as session:
        other = User(username="auth:isolation-owner")
        session.add(other)
        session.commit()

        project = create_project(session, other.id, "B 的项目")
        project_id = project["project_id"]

        assert owned_project(session, project_id, other.id).id == project_id
        try:
            owned_project(session, project_id, env.settings.development_user_id)
        except BusinessError as exc:
            assert exc.code == "RESOURCE_NOT_FOUND"
            assert exc.status == 404
        else:
            raise AssertionError("another user must not read this project")


def test_missing_auth_configuration_fails_closed(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'no-auth.sqlite3').as_posix()}",
        storage_dir=tmp_path / "assets",
        allow_development_user=False,
    )
    initialize(settings)
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/api/v1/projects")
    assert response.status_code == 503
    assert response.json()["code"] == "AUTH_NOT_CONFIGURED"
