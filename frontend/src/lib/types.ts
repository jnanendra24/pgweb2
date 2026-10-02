// Mirrors backend/app/models/schemas.py

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

export type Role = 'admin' | 'member'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  is_active: boolean
  last_login_at: string | null
  created_at: string | null
}

export interface ConnectionInput {
  name: string
  host: string
  port: number
  database: string
  user: string
  ssl_mode: SslMode
  read_only: boolean
  password: string
  shared?: boolean
}

export interface ConnectionRead extends Omit<ConnectionInput, 'password'> {
  id: string
  shared: boolean
  /** Created by the signed-in user. */
  owned: boolean
  can_manage: boolean
}

export interface ConnectionUpdate {
  name?: string
  shared?: boolean
  read_only?: boolean
  password?: string
}

export type TableKind = 'table' | 'view' | 'materialized_view' | 'foreign_table' | 'partitioned_table'

export interface TableInfo {
  schema_name: string
  name: string
  kind: TableKind
  estimated_rows: number | null
}

export interface ColumnInfo {
  name: string
  data_type: string
  nullable: boolean
  default: string | null
  is_primary_key: boolean
}

export interface TableColumns {
  schema_name: string
  name: string
  columns: string[]
}

export interface TableStructure {
  indexes: { name: string; definition: string }[]
  constraints: { name: string; type: 'primary_key' | 'foreign_key' | 'unique' | 'check' | 'exclusion' | 'trigger'; definition: string }[]
}

export interface QueryColumn {
  name: string
  type: string
}

export interface QueryResult {
  columns: QueryColumn[]
  rows: unknown[][]
  truncated: boolean
  status: string | null
  duration_ms: number
}

export interface TxInfo {
  id: string
  connection_id: string
  started_at: string
  last_used_at: string
  statements: number
  /** Seconds until the server rolls the transaction back if it stays idle. */
  expires_in: number
}

export interface TxQueryResult extends QueryResult {
  tx: TxInfo
}

export interface AuditEntry {
  id: number
  created_at: string
  user_email: string | null
  action: string
  connection_name: string | null
  detail: string | null
  row_count: number | null
  duration_ms: number | null
  error: string | null
  ip: string | null
}
