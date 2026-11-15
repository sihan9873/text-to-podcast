"""Private immutable voice versions and project-independent preview jobs."""
from alembic import op
import sqlalchemy as sa

revision = "20261114_voice_cloning"
down_revision = "20261114_long_document_input"
branch_labels = None
depends_on = None


def record_columns():
    return [sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False)]


def upgrade():
    op.create_table("voice_profiles", *record_columns(),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("status", sa.String(16), nullable=False), sqlite_autoincrement=True)
    op.create_index("ix_voice_profiles_user_id", "voice_profiles", ["user_id"])
    op.create_table("voice_versions", *record_columns(),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("voice_profiles.id"), nullable=False, unique=True),
        sa.Column("reference_asset_id", sa.Integer(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("reference_text", sa.Text(), nullable=False),
        sa.Column("language", sa.String(32), nullable=False),
        sa.Column("engine_id", sa.String(100), nullable=False),
        sa.Column("authorized_at", sa.DateTime(), nullable=False), sqlite_autoincrement=True)
    with op.batch_alter_table("tasks", table_args=(sa.CheckConstraint("status IN ('queued','running','succeeded','failed')", name="ck_task_status"),)) as batch:
        batch.alter_column("project_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("voice_version_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_task_voice_version", "voice_versions", ["voice_version_id"], ["id"])
        batch.create_check_constraint("ck_task_subject", "(task_type = 'voice_preview' AND project_id IS NULL AND voice_version_id IS NOT NULL) OR (task_type IN ('script','audio') AND project_id IS NOT NULL AND voice_version_id IS NULL)")


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT COUNT(*) FROM voice_profiles")).scalar() or connection.execute(sa.text("SELECT COUNT(*) FROM tasks WHERE task_type='voice_preview'")).scalar():
        raise RuntimeError("存在声音数据或试听任务，拒绝有损降级")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint("ck_task_subject", type_="check")
        batch.drop_constraint("fk_task_voice_version", type_="foreignkey")
        batch.drop_column("voice_version_id")
        batch.alter_column("project_id", existing_type=sa.Integer(), nullable=False)
    op.drop_table("voice_versions")
    op.drop_index("ix_voice_profiles_user_id", table_name="voice_profiles")
    op.drop_table("voice_profiles")
