import { ChevronRight, Eye, KeyRound, Layers, Link2, Loader2, Plus, RefreshCw, Search, Table2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useColumns, useTables } from '@/hooks/use-schema'
import { formatCount } from '@/lib/sql'
import type { TableInfo, TableKind } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useConnWorkspace, useWorkspace } from '@/stores/workspace'
import { useQueryClient } from '@tanstack/react-query'

const KIND_ICON: Record<TableKind, typeof Table2> = {
  table: Table2,
  partitioned_table: Table2,
  view: Eye,
  materialized_view: Layers,
  foreign_table: Link2,
}

function ColumnList({ connId, schema, table }: { connId: string; schema: string; table: string }) {
  const { data, isLoading, error } = useColumns(connId, schema, table)
  if (isLoading) return <Loader2 className="ml-9 my-1.5 size-3.5 animate-spin text-muted-foreground" />
  if (error) return <p className="ml-9 py-1 text-xs text-destructive">{error.message}</p>
  return (
    <ul className="mb-1 ml-[22px] border-l pl-2">
      {data?.map((c) => (
        <li key={c.name} className="flex items-center gap-1.5 rounded px-1.5 py-[3px] text-xs">
          {c.is_primary_key ? <KeyRound className="size-3 shrink-0 text-amber-500" /> : <span className="size-3 shrink-0" />}
          <span className="truncate">{c.name}</span>
          <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] text-muted-foreground">{c.data_type}</span>
        </li>
      ))}
    </ul>
  )
}

function TableRow({ connId, t, active, onOpen }: { connId: string; t: TableInfo; active: boolean; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[t.kind]
  return (
    <li>
      <div className={cn('group flex items-center rounded-md', active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
        <button
          type="button"
          aria-label={open ? 'Hide columns' : 'Show columns'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="grid size-8 shrink-0 place-items-center text-muted-foreground md:size-7"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm md:py-1">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{t.name}</span>
          {t.estimated_rows != null && t.estimated_rows > 0 && (
            <span className="ml-auto shrink-0 pl-2 text-[10px] text-muted-foreground tabular-nums">{formatCount(t.estimated_rows)}</span>
          )}
        </button>
      </div>
      {open && <ColumnList connId={connId} schema={t.schema_name} table={t.name} />}
    </li>
  )
}

export function Explorer({ connId, onNavigate }: { connId: string; onNavigate?: () => void }) {
  const { data, isLoading, error, isFetching } = useTables(connId)
  const qc = useQueryClient()
  const ws = useConnWorkspace(connId)
  const { openTable, openQuery } = useWorkspace()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = new Map<string, TableInfo[]>()
    for (const t of data ?? []) {
      if (q && !`${t.schema_name}.${t.name}`.toLowerCase().includes(q)) continue
      out.set(t.schema_name, [...(out.get(t.schema_name) ?? []), t])
    }
    return [...out]
  }, [data, search])

  const activeTab = ws.tabs.find((t) => t.id === ws.activeId)

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="space-y-2 p-2">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => (openQuery(connId), onNavigate?.())}>
          <Plus /> New query
        </Button>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter tables…" className="h-8 pr-8 pl-8" />
          {search && (
            <button type="button" aria-label="Clear" onClick={() => setSearch('')} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" aria-label="Tables">
        {isLoading && (
          <div className="space-y-1.5 p-1">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}
        {error && <p className="p-2 text-sm text-destructive">{error.message}</p>}
        {!isLoading && !error && groups.length === 0 && <p className="p-3 text-center text-sm text-muted-foreground">{search ? 'No matching tables' : 'No tables found'}</p>}
        {groups.map(([schema, tables]) => {
          const isCollapsed = collapsed.has(schema) && !search
          return (
            <section key={schema} className="mb-1">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((c) => {
                    const n = new Set(c)
                    if (!n.delete(schema)) n.add(schema)
                    return n
                  })
                }
                className="flex w-full items-center gap-1 px-1.5 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
              >
                <ChevronRight className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')} />
                {schema}
                <span className="font-normal">{tables.length}</span>
              </button>
              {!isCollapsed && (
                <ul>
                  {tables.map((t) => (
                    <TableRow
                      key={`${t.schema_name}.${t.name}`}
                      connId={connId}
                      t={t}
                      active={activeTab?.kind === 'table' && activeTab.schema === t.schema_name && activeTab.table === t.name}
                      onOpen={() => (openTable(connId, t.schema_name, t.name), onNavigate?.())}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </nav>

      <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span>{data?.length ?? 0} relations</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh schema"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['tables', connId] })
            qc.invalidateQueries({ queryKey: ['columns', connId] })
            qc.invalidateQueries({ queryKey: ['completion-schema', connId] })
          }}
        >
          <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
        </Button>
      </div>
    </div>
  )
}
