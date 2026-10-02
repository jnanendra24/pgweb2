import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import MIN_PASSWORD_LENGTH

SslMode = Literal["disable", "prefer", "require", "verify-ca", "verify-full"]
Role = Literal["admin", "member"]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL.match(v) or len(v) > 255:
        raise ValueError("Enter a valid email address")
    return v


Password = Field(min_length=MIN_PASSWORD_LENGTH, max_length=200, description="At least 10 characters")


# --- auth & users ---
class LoginRequest(BaseModel):
    email: str
    password: str = Field(max_length=200)

    _norm = field_validator("email")(lambda v: v.strip().lower())


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str
    role: Role
    is_active: bool
    last_login_at: datetime | None = None
    created_at: datetime | None = None


class UserCreate(BaseModel):
    email: str
    name: str = Field("", max_length=100)
    password: str = Password
    role: Role = "member"

    _norm = field_validator("email")(_email)


class UserUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Password


# --- connections ---
class ConnectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    host: str
    port: int = Field(5432, ge=1, le=65535)
    database: str
    user: str
    ssl_mode: SslMode = "require"
    # Sets default_transaction_read_only on every session. Defaults on: safe for prod/PHI data.
    read_only: bool = True


class ConnectionCreate(ConnectionBase):
    password: str
    shared: bool = False  # admins only


class ConnectionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    shared: bool | None = None
    read_only: bool | None = None
    password: str | None = None


class ConnectionRead(ConnectionBase):
    """Never includes the password."""

    id: str
    shared: bool
    owned: bool  # created by the caller
    can_manage: bool


class DatabaseSwitch(BaseModel):
    database: str = Field(min_length=1, max_length=255)
    name: str | None = Field(None, min_length=1, max_length=100)  # label for a newly created connection


# --- schema & queries ---
class TableInfo(BaseModel):
    schema_name: str
    name: str
    kind: Literal["table", "view", "materialized_view", "foreign_table", "partitioned_table"]
    estimated_rows: int | None = None


class ColumnInfo(BaseModel):
    name: str
    data_type: str
    nullable: bool
    default: str | None = None
    is_primary_key: bool = False


class TableColumns(BaseModel):
    """Every column name of a table, for editor autocompletion."""

    schema_name: str
    name: str
    columns: list[str]


class IndexInfo(BaseModel):
    name: str
    definition: str


class ConstraintInfo(BaseModel):
    name: str
    type: Literal["primary_key", "foreign_key", "unique", "check", "exclusion", "trigger"]
    definition: str


class TableStructure(BaseModel):
    indexes: list[IndexInfo]
    constraints: list[ConstraintInfo]


class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    limit: int = Field(1000, ge=1, le=10_000)


class QueryColumn(BaseModel):
    name: str
    type: str


class QueryResult(BaseModel):
    columns: list[QueryColumn]
    rows: list[list]
    truncated: bool  # more rows existed beyond `limit`
    status: str | None = None  # command tag for statements that return no rows, e.g. "INSERT 0 1"
    duration_ms: float


# --- transactions ---
class TxInfo(BaseModel):
    id: str
    connection_id: str
    started_at: datetime
    last_used_at: datetime
    statements: int
    expires_in: int  # seconds until auto-rollback if left idle


class TxQueryResult(QueryResult):
    tx: TxInfo


class AuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    user_email: str | None
    action: str
    connection_name: str | None
    detail: str | None
    row_count: int | None
    duration_ms: float | None
    error: str | None
    ip: str | None
