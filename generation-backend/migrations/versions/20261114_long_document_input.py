"""Add long-document metadata and deterministic source chunks."""

from alembic import op
import sqlalchemy as sa


revision = "20261114_long_document_input"
down_revision = "20261105_int_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("source_name", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("source_character_count", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_estimated_seconds", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_chunk_count", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("segmentation_mode", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("target_minutes", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("chars_per_minute", sa.Integer(), nullable=True))

    op.create_table(
        "source_chunks",
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("character_count", sa.Integer(), nullable=False),
        sa.Column("estimated_seconds", sa.Integer(), nullable=False),
        sa.Column("boundary_type", sa.String(length=16), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("character_count > 0"),
        sa.CheckConstraint("estimated_seconds > 0"),
        sa.CheckConstraint("sequence > 0"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "sequence"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_source_chunks_project_id", "source_chunks", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_source_chunks_project_id", table_name="source_chunks")
    op.drop_table("source_chunks")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("chars_per_minute")
        batch.drop_column("target_minutes")
        batch.drop_column("segmentation_mode")
        batch.drop_column("source_chunk_count")
        batch.drop_column("source_estimated_seconds")
        batch.drop_column("source_character_count")
        batch.drop_column("source_name")
