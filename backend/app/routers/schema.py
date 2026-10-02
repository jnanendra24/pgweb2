import asyncpg
from fastapi import APIRouter, Depends

from app.core.auth import usable_connection
from app.db.models import Connection
from app.models.schemas import ColumnInfo, ConstraintInfo, IndexInfo, TableColumns, TableInfo, TableStructure
from app.routers.connections import get_pool_or_http

router = APIRouter(prefix="/api/connections/{conn_id}", tags=["schema"])

_KINDS = {
    "r": "table", "v": "view", "m": "materialized_view", "f": "foreign_table", "p": "partitioned_table",
}

_TABLES_SQL = """
SELECT n.nspname AS schema_name, c.relname AS name, c.relkind::text AS kind,
       CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','v','m','f','p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND NOT c.relispartition
ORDER BY n.nspname, c.relname
"""

_COLUMNS_SQL = """
SELECT a.attname AS name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS "default",
       COALESCE(a.attnum = ANY (i.indkey), false) AS is_primary_key
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary
WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum
"""

_ALL_COLUMNS_SQL = """
SELECT table_schema AS schema_name, table_name AS name,
       array_agg(column_name::text ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'
GROUP BY table_schema, table_name
ORDER BY table_schema, table_name
"""

_INDEXES_SQL = """
SELECT indexname AS name, indexdef AS definition FROM pg_indexes
WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname
"""

# 'n' (NOT NULL) constraints exist as rows from PG 18; the Columns list already shows them.
_CONSTRAINT_TYPES = {"p": "primary_key", "f": "foreign_key", "u": "unique", "c": "check", "x": "exclusion", "t": "trigger"}
_CONSTRAINTS_SQL = """
SELECT conname AS name, contype::text AS type, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass AND contype::text = ANY ($3::text[])
ORDER BY contype, conname
"""

_DATABASES_SQL = """
SELECT datname FROM pg_database
WHERE NOT datistemplate AND datallowconn AND has_database_privilege(datname, 'CONNECT')
ORDER BY datname
"""


@router.get("/databases", response_model=list[str])
async def list_databases(conn: Connection = Depends(usable_connection)):
    pool = await get_pool_or_http(conn.id)
    return [r["datname"] for r in await pool.fetch(_DATABASES_SQL)]


@router.get("/tables", response_model=list[TableInfo])
async def list_tables(conn: Connection = Depends(usable_connection)):
    pool = await get_pool_or_http(conn.id)
    rows = await pool.fetch(_TABLES_SQL)
    return [TableInfo(**{**r, "kind": _KINDS[r["kind"]]}) for r in rows]


@router.get("/tables/{schema_name}/{table}/columns", response_model=list[ColumnInfo])
async def list_columns(schema_name: str, table: str, conn: Connection = Depends(usable_connection)):
    pool = await get_pool_or_http(conn.id)
    rows = await pool.fetch(_COLUMNS_SQL, schema_name, table)
    return [ColumnInfo(**r) for r in rows]


@router.get("/columns", response_model=list[TableColumns])
async def all_columns(conn: Connection = Depends(usable_connection)):
    """One round trip for the whole schema's columns. A dedicated endpoint, so the editor's background
    autocomplete lookups don't show up in the audit log as something the user ran."""
    pool = await get_pool_or_http(conn.id)
    return [TableColumns(**r) for r in await pool.fetch(_ALL_COLUMNS_SQL)]


@router.get("/tables/{schema_name}/{table}/structure", response_model=TableStructure)
async def table_structure(schema_name: str, table: str, conn: Connection = Depends(usable_connection)):
    pool = await get_pool_or_http(conn.id)
    indexes = await pool.fetch(_INDEXES_SQL, schema_name, table)
    try:
        constraints = await pool.fetch(_CONSTRAINTS_SQL, schema_name, table, list(_CONSTRAINT_TYPES))
    except asyncpg.UndefinedTableError:
        constraints = []
    return TableStructure(
        indexes=[IndexInfo(**r) for r in indexes],
        constraints=[ConstraintInfo(**{**r, "type": _CONSTRAINT_TYPES[r["type"]]}) for r in constraints],
    )
