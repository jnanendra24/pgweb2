import json
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
from app.models.schemas import (
    BrowseSearch,
    QueryColumn,
    QueryRequest,
    QueryResult,
    TableChanges,
    TableChangesResult,
    TableRowsResult,
)
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


async def _table_metadata(conn: asyncpg.Connection, schema_name: str, table: str):
    relation = await conn.fetchrow(
        """SELECT c.oid, c.relkind::text AS kind FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2""", schema_name, table,
    )
    if relation is None:
        raise HTTPException(404, "Table not found")
    columns = await conn.fetch(
        """SELECT a.attname AS name, a.attgenerated <> '' AS generated,
                  a.attidentity <> '' AS identity, COALESCE(a.attnum = ANY(i.indkey), false) AS primary_key
           FROM pg_attribute a
           LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary
           WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
           ORDER BY a.attnum""", relation["oid"],
    )
    return relation["kind"], columns


def _record_value(relation: str, parameter: int, name: str) -> str:
    return f'(jsonb_populate_record(NULL::{relation}, ${parameter}::jsonb)).{_quote(name)}'


def _validate_values(values: dict, allowed: set[str], label: str) -> None:
    unknown = set(values) - allowed
    if unknown:
        raise HTTPException(400, f"{label}: unknown or non-editable column: {', '.join(sorted(unknown))}")


async def _apply_changes(conn: asyncpg.Connection, schema_name: str, table: str, body: TableChanges) -> TableChangesResult:
    kind, columns = await _table_metadata(conn, schema_name, table)
    if kind not in ("r", "p"):
        raise HTTPException(400, "Only ordinary and partitioned tables can be edited")
    pk = [c["name"] for c in columns if c["primary_key"]]
    if not pk:
        raise HTTPException(400, "A primary key is required to edit table data")
    editable = {c["name"] for c in columns if not c["primary_key"] and not c["generated"] and not c["identity"]}
    insertable = {c["name"] for c in columns if not c["generated"] and not c["identity"]}
    relation = f"{_quote(schema_name)}.{_quote(table)}"
    seen: set[str] = set()
    for change in [*body.updates, *body.deletes]:
        if set(change.primary_key) != set(pk) or any(v is None for v in change.primary_key.values()):
            raise HTTPException(400, "Each existing row needs its complete primary key")
        key = json.dumps(change.primary_key, sort_keys=True, default=str)
        if key in seen:
            raise HTTPException(400, "A row appears more than once in the batch")
        seen.add(key)
        if not change.version.isdigit():
            raise HTTPException(400, "Invalid row version")
    for change in body.updates:
        _validate_values(change.values, editable, "Update")
        if not change.values:
            raise HTTPException(400, "An update needs at least one changed column")
    for change in body.deletes:
        if change.values:
            raise HTTPException(400, "A delete cannot include column changes")
    for row in body.inserts:
        _validate_values(row.values, insertable, "Insert")

    def where(pk_param: int, version_param: int) -> str:
        return ' AND '.join(
            f'{_quote(name)} IS NOT DISTINCT FROM {_record_value(relation, pk_param, name)}' for name in pk
        ) + f' AND xmin::text = ${version_param}'
    for change in body.deletes:
        result = await conn.fetch(
            f'DELETE FROM {relation} WHERE {where(1, 2)} RETURNING 1',
            json.dumps(change.primary_key), change.version,
        )
        if len(result) != 1:
            raise HTTPException(409, "A row changed or disappeared. Refresh the table before applying changes.")
    for change in body.updates:
        if not change.values:
            continue
        assignments = ', '.join(
            f'{_quote(name)} = {_record_value(relation, 1, name)}' for name in change.values
        )
        result = await conn.fetch(
            f'UPDATE {relation} SET {assignments} WHERE {where(2, 3)} RETURNING 1',
            json.dumps(change.values), json.dumps(change.primary_key), change.version,
        )
        if len(result) != 1:
            raise HTTPException(409, "A row changed or disappeared. Refresh the table before applying changes.")
    for row in body.inserts:
        if row.values:
            names = list(row.values)
            fields = ', '.join(_quote(name) for name in names)
            values = ', '.join(_record_value(relation, 1, name) for name in names)
            await conn.execute(f'INSERT INTO {relation} ({fields}) VALUES ({values})', json.dumps(row.values))
        else:
            await conn.execute(f'INSERT INTO {relation} DEFAULT VALUES')
    return TableChangesResult(updated=len(body.updates), inserted=len(body.inserts), deleted=len(body.deletes))


@router.post("/query", response_model=QueryResult)
async def run_query(
    body: QueryRequest,
    request: Request,
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    return await audited(db, request, user, cfg, "query", body.sql, lambda: execute(cfg, body.sql, body.limit))


@router.get("/tables/{schema_name}/{table}/rows", response_model=TableRowsResult)
async def browse_table(
    schema_name: str,
    table: str,
    request: Request,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    order_by: str | None = None,
    desc: bool = False,
    filter: str = "",
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    """Paginated table view. Always read-only, even on writable connections."""
    pool = await get_pool_or_http(cfg.id)
    kind = await pool.fetchval(
        """SELECT c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2""", schema_name, table,
    )
    version_expr = "xmin::text" if kind in ("r", "p") else "NULL::text"
    sql = f"SELECT *, {version_expr} AS __pgweb_row_version FROM {_quote(schema_name)}.{_quote(table)}"
    if filter.strip():
        sql += f" WHERE ({filter})"
    if order_by:
        sql += f" ORDER BY {_quote(order_by)} {'DESC' if desc else 'ASC'}"
    sql += f" OFFSET {offset}"
    result = await audited(db, request, user, cfg, "browse", f"{sql} LIMIT {limit}", lambda: execute(cfg, sql, limit, force_read_only=True))
    versions = [row.pop() for row in result.rows]
    result.columns.pop()
    return TableRowsResult(**result.model_dump(), row_versions=versions)


@router.post("/tables/{schema_name}/{table}/rows/search", response_model=TableRowsResult)
async def search_table_rows(
    schema_name: str,
    table: str,
    body: BrowseSearch,
    request: Request,
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    pool = await get_pool_or_http(cfg.id)
    relation_info = await pool.fetchrow(
        """SELECT c.oid, c.relkind::text AS kind FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2""",
        schema_name, table,
    )
    if relation_info is None:
        raise HTTPException(404, "Table not found")
    columns = await pool.fetch(
        "SELECT attname AS name FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped",
        relation_info["oid"],
    )
    names = {column["name"] for column in columns}
    relation = f"{_quote(schema_name)}.{_quote(table)}"
    predicates: list[str] = []
    args: list[object] = []
    operators = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    for condition in body.conditions:
        if condition.column not in names:
            raise HTTPException(400, f"Unknown filter column: {condition.column}")
        column = _quote(condition.column)
        if condition.operator == "is_null":
            predicates.append(f"{column} IS NULL")
        elif condition.operator == "is_not_null":
            predicates.append(f"{column} IS NOT NULL")
        elif condition.operator == "in":
            if not isinstance(condition.value, list) or not condition.value:
                raise HTTPException(400, "IN filters need at least one value")
            params = []
            for value in condition.value:
                args.append(json.dumps({condition.column: value}))
                params.append(_record_value(relation, len(args), condition.column))
            predicates.append(f"{column} IN ({', '.join(params)})")
        elif condition.operator in ("like", "ilike"):
            if not isinstance(condition.value, str):
                raise HTTPException(400, "LIKE filters need a text value")
            args.append(condition.value)
            predicates.append(f"{column}::text {'ILIKE' if condition.operator == 'ilike' else 'LIKE'} ${len(args)}::text")
        else:
            args.append(json.dumps({condition.column: condition.value}))
            predicates.append(f"{column} {operators[condition.operator]} {_record_value(relation, len(args), condition.column)}")
    where = f" WHERE ({f' {body.combine.upper()} '.join(predicates)})" if predicates else ""
    order = f" ORDER BY {_quote(body.order_by)} {'DESC' if body.desc else 'ASC'}" if body.order_by else ""
    version = "xmin::text" if relation_info["kind"] in ("r", "p") else "NULL::text"
    sql = f"SELECT *, {version} AS __pgweb_row_version FROM {relation}{where}{order} OFFSET {body.offset}"

    async def run():
        async with pool.acquire() as conn:
            async with conn.transaction(readonly=True):
                start = time.perf_counter()
                try:
                    stmt = await conn.prepare(sql)
                    records = await (await stmt.cursor(*args)).fetch(body.limit + 1)
                except asyncpg.PostgresError as e:
                    raise HTTPException(400, str(e))
                attrs = stmt.get_attributes()
                return QueryResult(
                    columns=[QueryColumn(name=a.name, type=a.type.name) for a in attrs],
                    rows=[[_json(v) for v in record.values()] for record in records[:body.limit]],
                    truncated=len(records) > body.limit,
                    status=None,
                    duration_ms=round((time.perf_counter() - start) * 1000, 1),
                )

    result = await audited(db, request, user, cfg, "browse", f"{sql} LIMIT {body.limit}", run)
    versions = [row.pop() for row in result.rows]
    result.columns.pop()
    return TableRowsResult(**result.model_dump(), row_versions=versions)


@router.post("/tables/{schema_name}/{table}/changes", response_model=TableChangesResult)
async def apply_table_changes(
    schema_name: str,
    table: str,
    body: TableChanges,
    request: Request,
    cfg: Connection = Depends(usable_connection),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
):
    if cfg.read_only:
        raise HTTPException(403, "This connection is read-only")
    if not (body.updates or body.inserts or body.deletes):
        raise HTTPException(400, "No changes to apply")
    detail = f"{schema_name}.{table}: {len(body.updates)} updates, {len(body.inserts)} inserts, {len(body.deletes)} deletes"
    pool = await get_pool_or_http(cfg.id)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                result = await _apply_changes(conn, schema_name, table, body)
    except (asyncpg.PostgresError, HTTPException) as e:
        error = str(e.detail) if isinstance(e, HTTPException) else str(e)
        await audit.record(db, "table_changes", user=user, conn=cfg, detail=detail, error=error, request=request)
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(400, error) from e
    await audit.record(db, "table_changes", user=user, conn=cfg, detail=detail,
                       rows=result.updated + result.inserted + result.deleted, request=request)
    return result
