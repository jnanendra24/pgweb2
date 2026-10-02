from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.db.models import AuditLog, User
from app.db.session import get_session
from app.models.schemas import AuditRead

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=list[AuditRead])
async def list_audit(
    limit: int = Query(100, ge=1, le=500),
    before_id: int | None = None,
    user_email: str | None = None,
    action: str | None = None,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if before_id:
        q = q.where(AuditLog.id < before_id)
    if user_email:
        q = q.where(AuditLog.user_email == user_email.lower())
    if action:
        q = q.where(AuditLog.action == action)
    return (await db.scalars(q)).all()
