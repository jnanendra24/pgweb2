"""Login sessions (opaque cookie -> server-side row) and the dependencies that enforce them."""

from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_token, new_session_token
from app.db.models import Connection, User, UserSession
from app.db.session import get_session

COOKIE_NAME = "pgweb_session"
_TOUCH_EVERY = timedelta(seconds=60)  # don't write on every request


def utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite drops tzinfo


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def start_session(db: AsyncSession, response: Response, request: Request, user: User) -> None:
    s = get_settings()
    now = datetime.now(UTC)
    await db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at < now))
    raw = new_session_token()
    db.add(
        UserSession(
            token_hash=hash_token(raw),
            user_id=user.id,
            last_seen_at=now,
            expires_at=now + timedelta(days=s.session_ttl_days),
            ip=client_ip(request),
            user_agent=(request.headers.get("user-agent") or "")[:255] or None,
        )
    )
    await db.commit()
    response.set_cookie(
        COOKIE_NAME, raw, max_age=s.session_ttl_days * 86400, path="/",
        httponly=True, secure=s.cookie_secure, samesite="strict",
    )


async def end_session(db: AsyncSession, response: Response, raw: str | None) -> None:
    if raw:
        await db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(raw)))
        await db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


async def revoke_user_sessions(db: AsyncSession, user_id: str, keep_raw: str | None = None) -> None:
    q = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_raw:
        q = q.where(UserSession.token_hash != hash_token(keep_raw))
    await db.execute(q)
    await db.commit()


async def current_user(request: Request, db: AsyncSession = Depends(get_session)) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        raise unauthorized
    row = (
        await db.execute(
            select(UserSession, User).join(User, User.id == UserSession.user_id).where(UserSession.token_hash == hash_token(raw))
        )
    ).one_or_none()
    if row is None:
        raise unauthorized
    sess, user = row
    now = datetime.now(UTC)
    idle = timedelta(minutes=get_settings().session_idle_minutes)
    if not user.is_active or utc(sess.expires_at) <= now or utc(sess.last_seen_at) + idle <= now:
        await db.delete(sess)
        await db.commit()
        raise unauthorized
    if now - utc(sess.last_seen_at) > _TOUCH_EVERY:
        sess.last_seen_at = now
        await db.commit()
    return user


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


def can_use(conn: Connection, user: User) -> bool:
    return conn.owner_id == user.id or conn.shared


def can_manage(conn: Connection, user: User) -> bool:
    """Owners manage their own connections; admins also manage the team's shared ones."""
    return conn.owner_id == user.id or (conn.shared and user.role == "admin")


async def usable_connection(
    conn_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_session)
) -> Connection:
    """404 (not 403) for connections the caller may not use, so ids can't be probed."""
    row = await db.get(Connection, conn_id)
    if row is None or not can_use(row, user):
        raise HTTPException(404, "Connection not found")
    return row
