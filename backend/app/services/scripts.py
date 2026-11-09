from sqlalchemy import select

from app.core.common import BusinessError, iso, utcnow
from app.db.database import transaction
from app.db.models import Script, ScriptSentence
from app.services.views import owned_project


def confirm_script(session, user_id, script_id, body):
    with transaction(session):
        script = session.get(Script, script_id)
        if script is None:
            raise BusinessError("RESOURCE_NOT_FOUND", "脚本不存在", 404)
        project = owned_project(session, script.project_id, user_id, lock=True)
        script = session.scalar(select(Script).where(Script.id == script_id).with_for_update().execution_options(populate_existing=True))
        if script.version != body.expected_script_version or script.edit_revision != body.expected_edit_revision:
            raise BusinessError("REVISION_CONFLICT", "脚本版本或内部修订已变化，请刷新后重新审核")
        if project.confirmed_script_id and project.confirmed_script_id != script.id:
            raise BusinessError("ANOTHER_SCRIPT_CONFIRMED", "已有其他版本确认，请先取消确认")
        if session.scalar(select(ScriptSentence.id).where(ScriptSentence.script_id == script.id).limit(1)) is None:
            raise BusinessError("SCRIPT_EMPTY", "脚本没有可确认的台词")
        if script.status != "confirmed":
            script.status = "confirmed"
            script.confirmed_by = user_id
            script.confirmed_at = utcnow()
            script.confirmed_revision = script.edit_revision
            project.confirmed_script_id = script.id
        session.flush()
        return {"script_id": script.id, "version": script.version, "edit_revision": script.edit_revision,
            "status": script.status, "confirmed_revision": script.confirmed_revision,
            "confirmed_by": script.confirmed_by, "confirmed_at": iso(script.confirmed_at)}
