import math
import time
from datetime import date, datetime, timedelta
from datetime import time as dt_time
from decimal import Decimal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.auth import current_user, usable_connection
from app.db.models import Connection, User
from app.db.session import get_session
from app.models.schemas import QueryColumn, QueryRequest, QueryResult
from app.routers.connections import get_pool_or_http

router = APIRouter(prefix="/api/connections/{conn_id}", tags=["query"])


def _json(v):
    """Make asyncpg values JSON-safe; anything exotic falls back to its text form."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, (datetime, date, dt_time)):
        return v.isoformat()
    if isinstance(v, (Decimal, timedelta)):  # Decimal as text keeps full precision
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "\\x" + bytes(v).hex()
    if isinstance(v, (list, tuple)):
        return [_json(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _json(x) for k, x in v.items()}
    return str(v)


def _quote(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


async def run_on(conn: asyncpg.Connection, sql: str, limit: int) -> QueryResult:
    """Run one statement on a connection that is already inside a transaction, fetching at most limit+1 rows.

    The extended protocol only accepts a single statement per request. Postgres errors become HTTP 400;
    a dead connection (asyncpg.InterfaceError) is left for the caller to interpret.
    """
    start = time.perf_counter()
    try:
        stmt = await conn.prepare(sql)
        attrs = stmt.get_attributes()
        if attrs:
            records = await (await stmt.cursor()).fetch(limit + 1)
            status = None
        else:
            await stmt.fetch()
            records, status = [], stmt.get_statusmsg()
    except asyncpg.PostgresError as e:
        raise HTTPException(400, str(e))
    return QueryResult(
        columns=[QueryColumn(name=a.name, type=a.type.name) for a in attrs],
        rows=[[_json(v) for v in r.values()] for r in records[:limit]],
        truncated=len(records) > limit,
        status=status,
        duration_ms=round((time.perf_counter() - start) * 1000, 1),
    )


async def execute(cfg: Connection, sql: str, limit: int, force_read_only: bool = False) -> QueryResult:
    """Autocommit mode: one statement in its own transaction. Read-only connections run READ ONLY."""
    pool = await get_pool_or_http(cfg.id)
    async with pool.acquire() as conn:
        async with conn.transaction(readonly=cfg.read_only or force_read_only):
            return await run_on(conn, sql, limit)


async def audited(db, request, user, cfg, action, sql, call) -> QueryResult:
    try:
        result = await call()
    except HTTPException as e:
        await audit.record(db, action, user=user, conn=cfg, detail=sql, error=str(e.detail), request=request)
        raise
    await audit.record(
        db, action, user=user, conn=cfg, detail=sql, rows=len(result.rows), ms=result.duration_ms, request=request
    )
    return result


@router.post("/query", response_model=QueryResult)
async def run_query(
    body: QueryRequest,
    request: Request,
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    return await audited(db, request, user, cfg, "query", body.sql, lambda: execute(cfg, body.sql, body.limit))


@router.get("/tables/{schema_name}/{table}/rows", response_model=QueryResult)
async def browse_table(
    schema_name: str,
    table: str,
    request: Request,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    order_by: str | None = None,
    desc: bool = False,
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    """Paginated table view. Always read-only, even on writable connections."""
    sql = f"SELECT * FROM {_quote(schema_name)}.{_quote(table)}"
    if order_by:
        sql += f" ORDER BY {_quote(order_by)} {'DESC' if desc else 'ASC'}"
    sql += f" OFFSET {offset}"
    return await audited(db, request, user, cfg, "browse", f"{sql} LIMIT {limit}", lambda: execute(cfg, sql, limit, force_read_only=True))
