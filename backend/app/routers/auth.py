from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.auth import COOKIE_NAME, current_user, end_session, revoke_user_sessions, start_session, utc
from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.models import User
from app.db.session import get_session
from app.models.schemas import LoginRequest, PasswordChange, UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])

_BAD = "Invalid email or password"


@router.post("/login", response_model=UserRead)
async def login(body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_session)):
    s = get_settings()
    now = datetime.now(UTC)
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()

    if user and user.locked_until and utc(user.locked_until) > now:
        await audit.record(db, "login_blocked", user=user, request=request)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed attempts. Try again in a few minutes.")

    # Always run the hash check, even for unknown emails, to keep timing uniform.
    ok = verify_password(user.password_hash if user else None, body.password)
    if not (ok and user and user.is_active):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= s.max_failed_logins:
                user.locked_until = now + timedelta(minutes=s.lockout_minutes)
                user.failed_logins = 0
            await db.commit()
        await audit.record(db, "login_failed", user=user, email=body.email, request=request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _BAD)

    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    await db.commit()
    await start_session(db, response, request, user)
    await audit.record(db, "login", user=user, request=request)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_session)):
    raw = request.cookies.get(COOKIE_NAME)
    await end_session(db, response, raw)


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(current_user)):
    return user


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChange, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_session)
):
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    # Sign out every other device; keep this one.
    await revoke_user_sessions(db, user.id, keep_raw=request.cookies.get(COOKIE_NAME))
    await audit.record(db, "password_change", user=user, request=request)
