import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '@/lib/api'

export const useTables = (connId: string) =>
  useQuery({ queryKey: ['tables', connId], queryFn: () => api.listTables(connId), staleTime: 60_000 })

export const useColumns = (connId: string, schema: string, table: string) =>
  useQuery({
    queryKey: ['columns', connId, schema, table],
    queryFn: () => api.listColumns(connId, schema, table),
    staleTime: 60_000,
  })

export const useDatabases = (connId: string) =>
  useQuery({ queryKey: ['databases', connId], queryFn: () => api.listDatabases(connId), staleTime: 5 * 60_000 })

/** One round trip for every column, so the SQL editor can autocomplete table and column names. */
export function useCompletionSchema(connId: string) {
  const q = useQuery({
    queryKey: ['completion-schema', connId],
    queryFn: () => api.allColumns(connId),
    staleTime: 5 * 60_000,
  })
  const tables = useTables(connId)
  const schema = useMemo(() => {
    const out: Record<string, Record<string, string[]>> = {}
    // Tables with no visible columns (or past the 10k cap) still complete by name.
    for (const t of tables.data ?? []) (out[t.schema_name] ??= {})[t.name] ??= []
    for (const t of q.data ?? []) (out[t.schema_name] ??= {})[t.name] = t.columns
    return out
  }, [q.data, tables.data])
  return schema
}
