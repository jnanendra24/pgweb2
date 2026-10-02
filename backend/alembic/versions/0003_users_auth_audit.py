"""users, sessions, audit log; connections gain an owner

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-02

Existing connections keep owner_id NULL (invisible to everyone) until the first admin is created,
which adopts them.
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(100), nullable=False, server_default=""),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("failed_logins", sa.Integer, nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "user_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip", sa.String(45)),
        sa.Column("user_agent", sa.String(255)),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", sa.String(32)),
        sa.Column("user_email", sa.String(255)),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("connection_id", sa.String(32)),
        sa.Column("connection_name", sa.String(100)),
        sa.Column("detail", sa.Text),
        sa.Column("row_count", sa.Integer),
        sa.Column("duration_ms", sa.Float),
        sa.Column("error", sa.Text),
        sa.Column("ip", sa.String(45)),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])
    op.create_index("ix_audit_log_user_id", "audit_log", ["user_id"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])

    with op.batch_alter_table("connections") as batch:
        batch.add_column(sa.Column("owner_id", sa.String(32), nullable=True))
        batch.add_column(sa.Column("shared", sa.Boolean, nullable=False, server_default=sa.false()))
        batch.create_foreign_key("fk_connections_owner_id", "users", ["owner_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_connections_owner_id", ["owner_id"])

    # Per-connection refresh cookies are replaced by user sessions.
    op.drop_table("refresh_tokens")


def downgrade() -> None:
    raise NotImplementedError("Downgrading would discard users and the audit log; restore from backup instead.")
