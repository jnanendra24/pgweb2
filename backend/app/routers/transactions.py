import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.auth import can_use, current_user, usable_connection
from app.db.models import Connection, User
from app.db.session import get_session
from app.db.transactions import TxError, TxSession, reject_control_statement, txs
from app.models.schemas import QueryRequest, TxInfo, TxQueryResult
from app.routers.connections import get_pool_or_http
from app.routers.query import run_on

router = APIRouter(prefix="/api", tags=["transactions"])


def _http(e: TxError) -> HTTPException:
    return HTTPException(e.status, e.message)


async def _owned(tx_id: str, user: User, db: AsyncSession) -> tuple[TxSession, Connection]:
    try:
        ts = txs.get(tx_id, user.id)
    except TxError as e:
        raise _http(e)
    cfg = await db.get(Connection, ts.conn_id)
    if cfg is None or not can_use(cfg, user):  # connection deleted or unshared mid-transaction
        await txs.finish(ts, commit=False)
        raise HTTPException(404, "Transaction not found")
    return ts, cfg


@router.get("/transactions", response_model=list[TxInfo])
async def list_transactions(user: User = Depends(current_user)):
    """Lets the UI re-attach to transactions that survived a page reload."""
    return [TxInfo(**t.info()) for t in txs.list_for(user.id)]


@router.post("/connections/{conn_id}/transactions", response_model=TxInfo, status_code=status.HTTP_201_CREATED)
async def begin_transaction(
    request: Request,
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    if cfg.read_only:
        raise HTTPException(400, "This connection is read-only, so there is nothing to commit. Use a read/write connection.")
    pool = await get_pool_or_http(cfg.id)
    try:
        ts = await txs.begin(user.id, cfg.id, pool)
    except TxError as e:
        raise _http(e)
    await audit.record(db, "tx_begin", user=user, conn=cfg, request=request)
    return TxInfo(**ts.info())


@router.post("/transactions/{tx_id}/query", response_model=TxQueryResult)
async def tx_query(
    tx_id: str,
    body: QueryRequest,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    ts, cfg = await _owned(tx_id, user, db)
    try:
        reject_control_statement(body.sql)
    except TxError as e:
        raise _http(e)

    error: str | None = None
    result = None
    try:
        async with ts.lock:
            # Each statement gets a savepoint, so a typo rolls back that statement only rather than
            # poisoning the whole transaction ("current transaction is aborted").
            await ts.conn.execute("SAVEPOINT pgweb_stmt")
            try:
                result = await run_on(ts.conn, body.sql, body.limit)
            except HTTPException as e:
                error = str(e.detail)
                await ts.conn.execute("ROLLBACK TO SAVEPOINT pgweb_stmt")
                await ts.conn.execute("RELEASE SAVEPOINT pgweb_stmt")
                raise
            await ts.conn.execute("RELEASE SAVEPOINT pgweb_stmt")
            ts.statements += 1
    except HTTPException:
        ts.touch()
        await audit.record(db, "tx_query", user=user, conn=cfg, detail=body.sql, error=error, request=request)
        raise
    except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError) as e:
        # The server ended the transaction under us (idle timeout, restart, failover).
        await txs.drop_dead(ts)
        await audit.record(db, "tx_lost", user=user, conn=cfg, error=str(e), request=request)
        raise HTTPException(409, f"The transaction was ended by the database and has been rolled back: {e}")

    ts.touch()
    await audit.record(
        db, "tx_query", user=user, conn=cfg, detail=body.sql, rows=len(result.rows), ms=result.duration_ms, request=request
    )
    return TxQueryResult(**result.model_dump(), tx=TxInfo(**ts.info()))


async def _finish(tx_id: str, commit: bool, request: Request, user: User, db: AsyncSession) -> Response:
    ts, cfg = await _owned(tx_id, user, db)
    statements = ts.statements
    try:
        await txs.finish(ts, commit=commit)
    except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError) as e:
        # e.g. a deferred constraint failed at COMMIT: Postgres rolled everything back.
        await audit.record(db, "tx_commit", user=user, conn=cfg, error=str(e), request=request)
        raise HTTPException(400, f"Commit failed and the transaction was rolled back: {e}")
    await audit.record(
        db, "tx_commit" if commit else "tx_rollback", user=user, conn=cfg, detail=f"{statements} statement(s)", request=request
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/transactions/{tx_id}/commit", status_code=status.HTTP_204_NO_CONTENT)
async def commit(tx_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_session)):
    return await _finish(tx_id, True, request, user, db)


@router.post("/transactions/{tx_id}/rollback", status_code=status.HTTP_204_NO_CONTENT)
async def rollback(tx_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_session)):
    return await _finish(tx_id, False, request, user, db)
