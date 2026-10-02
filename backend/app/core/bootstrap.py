import logging

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import MIN_PASSWORD_LENGTH, hash_password
from app.db.models import Connection, User

log = logging.getLogger("pgweb2")


async def create_user(db: AsyncSession, email: str, password: str, *, role: str = "member", name: str = "") -> User:
    """Create a user. The very first user also adopts connections saved before accounts existed."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    first = (await db.scalar(select(func.count()).select_from(User))) == 0
    user = User(email=email.strip().lower(), name=name, role="admin" if first else role, password_hash=hash_password(password))
    db.add(user)
    await db.flush()
    if first:
        adopted = await db.execute(update(Connection).where(Connection.owner_id.is_(None)).values(owner_id=user.id))
        if adopted.rowcount:
            log.warning("Adopted %d pre-existing connection(s) for %s", adopted.rowcount, user.email)
    await db.commit()
    return user


async def ensure_bootstrap_admin(db: AsyncSession, email: str, password: str) -> None:
    if not email or not password:
        return
    if await db.scalar(select(func.count()).select_from(User)):
        return
    await create_user(db, email, password, role="admin", name="Admin")
    log.warning("Created bootstrap admin %s. Remove PGWEB_BOOTSTRAP_ADMIN_PASSWORD from the environment.", email)
