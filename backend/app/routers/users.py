from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.auth import require_admin, revoke_user_sessions
from app.core.security import hash_password
from app.db.models import User
from app.db.session import get_session
from app.db.transactions import txs
from app.models.schemas import UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserRead])
async def list_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_session)):
    return (await db.scalars(select(User).order_by(User.email))).all()


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate, request: Request, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_session)
):
    user = User(email=body.email, name=body.name.strip(), role=body.role, password_hash=hash_password(body.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")
    await audit.record(db, "user_create", user=admin, detail=f"{user.email} ({user.role})", request=request)
    return user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    body: UserUpdate,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    changes = body.model_dump(exclude_unset=True)

    if user.id == admin.id and (changes.get("role", "admin") != "admin" or changes.get("is_active", True) is False):
        raise HTTPException(400, "You can't demote or deactivate your own account. Ask another admin.")
    losing_admin = user.role == "admin" and (changes.get("role", "admin") != "admin" or changes.get("is_active", True) is False)
    if losing_admin:
        admins = await db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.is_active))
        if admins <= 1:
            raise HTTPException(400, "There must be at least one active admin")

    if "name" in changes and changes["name"] is not None:
        user.name = changes["name"].strip()
    if changes.get("role"):
        user.role = changes["role"]
    if "is_active" in changes and changes["is_active"] is not None:
        user.is_active = changes["is_active"]
    if changes.get("password"):
        user.password_hash = hash_password(changes["password"])
        user.failed_logins, user.locked_until = 0, None
    await db.commit()

    # A deactivation or password reset must take effect now, not when the sessions expire.
    if changes.get("password") or changes.get("is_active") is False:
        await revoke_user_sessions(db, user.id)
        await txs.rollback_where(lambda t: t.user_id == user.id)
    detail = ", ".join(k if k != "password" else "password reset" for k in changes)
    await audit.record(db, "user_update", user=admin, detail=f"{user.email}: {detail}", request=request)
    return user
