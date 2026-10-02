"""refresh tokens

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("connection_id", sa.String(32), sa.ForeignKey("connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_refresh_tokens_connection_id", "refresh_tokens", ["connection_id"])


def downgrade() -> None:
    op.drop_table("refresh_tokens")
