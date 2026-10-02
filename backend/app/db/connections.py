"""Lazily-created asyncpg pool per saved connection, cached for reuse."""

import asyncio
from typing import Protocol

import asyncpg

from app.core.config import get_settings
from app.core.security import decrypt
from app.db.models import Connection
from app.db.session import sessionmaker
from app.db.transactions import txs


class _Target(Protocol):
    host: str
    port: int
    database: str
    user: str
    ssl_mode: str


def _target_kwargs(cfg: _Target, password: str) -> dict:
    return {
        "host": cfg.host,
        "port": cfg.port,
        "database": cfg.database,
        "user": cfg.user,
        "password": password,
        "ssl": cfg.ssl_mode,
    }


async def verify(cfg: _Target, password: str) -> None:
    """Open and close one connection; raises on any connect/auth failure."""
    conn = await asyncpg.connect(**_target_kwargs(cfg, password), timeout=10)
    await conn.close()


class PoolManager:
    def __init__(self) -> None:
        self._pools: dict[str, asyncpg.Pool] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def get(self, conn_id: str) -> asyncpg.Pool:
        if (pool := self._pools.get(conn_id)) is not None:
            return pool
        lock = self._locks.setdefault(conn_id, asyncio.Lock())
        async with lock:
            if (pool := self._pools.get(conn_id)) is not None:
                return pool
            pool = await self._create(conn_id)
            self._pools[conn_id] = pool
            return pool

    async def _create(self, conn_id: str) -> asyncpg.Pool:
        async with sessionmaker()() as session:
            cfg = await session.get(Connection, conn_id)
        if cfg is None:
            raise KeyError(conn_id)
        s = get_settings()
        settings = {
            "application_name": "pgweb2",
            "statement_timeout": str(s.statement_timeout_ms),
        }
        if cfg.read_only:
            settings["default_transaction_read_only"] = "on"
        # Backstop for abandoned manual transactions if this process dies before it can roll them back.
        settings["idle_in_transaction_session_timeout"] = str((s.tx_max_age_seconds + 120) * 1000)
        return await asyncpg.create_pool(
            **_target_kwargs(cfg, decrypt(cfg.password_enc)),
            min_size=s.pool_min_size,
            max_size=s.pool_max_size,
            server_settings=settings,
            timeout=10,
        )

    async def evict(self, conn_id: str) -> None:
        """Drop a pool (after delete / password change) so the next request rebuilds it."""
        # pool.close() waits for every connection to come back, so open transactions must end first.
        await txs.rollback_where(lambda t: t.conn_id == conn_id)
        pool = self._pools.pop(conn_id, None)
        if pool is not None:
            await pool.close()

    async def close_all(self) -> None:
        await txs.close_all()
        for conn_id in list(self._pools):
            await self.evict(conn_id)


pools = PoolManager()
