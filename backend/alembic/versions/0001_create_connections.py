"""create connections

Revision ID: 0001
Revises:
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "connections",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer, nullable=False),
        sa.Column("database", sa.String(255), nullable=False),
        sa.Column("user", sa.String(255), nullable=False),
        sa.Column("password_enc", sa.Text, nullable=False),
        sa.Column("ssl_mode", sa.String(16), nullable=False),
        sa.Column("read_only", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("connections")
