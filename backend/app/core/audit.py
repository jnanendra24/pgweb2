from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import client_ip
from app.db.models import AuditLog, Connection, User

_MAX_DETAIL = 20_000


async def record(
    db: AsyncSession,
    action: str,
    *,
    user: User | None = None,
    email: str | None = None,
    conn: Connection | None = None,
    detail: str | None = None,
    rows: int | None = None,
    ms: float | None = None,
    error: str | None = None,
    request: Request | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            user_email=user.email if user else email,
            action=action,
            connection_id=conn.id if conn else None,
            connection_name=conn.name if conn else None,
            detail=detail[:_MAX_DETAIL] if detail else None,
            row_count=rows,
            duration_ms=ms,
            error=error[:2000] if error else None,
            ip=client_ip(request) if request else None,
        )
    )
    await db.commit()


async def prune(db: AsyncSession, retention_days: int) -> None:
    if retention_days > 0:
        await db.execute(delete(AuditLog).where(AuditLog.created_at < datetime.now(UTC) - timedelta(days=retention_days)))
        await db.commit()
