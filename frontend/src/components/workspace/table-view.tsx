import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Filter, Loader2, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FilterInput } from '@/components/editor/filter-input'
import type { Sort } from '@/components/grid/data-grid'
import { ErrorBox, ExportMenu, ResultBody } from '@/components/grid/result-pane'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useColumns } from '@/hooks/use-schema'
import { api } from '@/lib/api'
import { qualified, quoteIdent } from '@/lib/sql'
import { StructureView } from './structure-view'

const PAGE_SIZES = ['50', '100', '250', '500']

export function TableView({ connId, schema, table }: { connId: string; schema: string; table: string }) {
  const [view, setView] = useState<'data' | 'structure'>('data')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState('100')
  const [sort, setSort] = useState<Sort | null>(null)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')

  const cols = useColumns(connId, schema, table)
  const colNames = useMemo(() => cols.data?.map((c) => c.name) ?? [], [cols.data])
  const pks = useMemo(() => new Set(cols.data?.filter((c) => c.is_primary_key).map((c) => c.name)), [cols.data])

  const limit = Number(pageSize)
  const offset = page * limit
  const rows = useQuery({
    queryKey: ['rows', connId, schema, table, { page, limit, sort, filter }],
    placeholderData: keepPreviousData,
    queryFn: () => {
      if (!filter) return api.browseTable(connId, schema, table, { limit, offset, orderBy: sort?.column, desc: sort?.desc })
      // The browse endpoint has no filter parameter, so filtered views go through the query endpoint.
      let sql = `SELECT * FROM ${qualified(schema, table)} WHERE (${filter})`
      if (sort) sql += ` ORDER BY ${quoteIdent(sort.column)} ${sort.desc ? 'DESC' : 'ASC'}`
      return api.runQuery(connId, `${sql} OFFSET ${offset}`, limit)
    },
  })

  const apply = () => {
    setPage(0)
    setFilter(draft.trim())
  }
  const result = rows.data

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="structure">Structure</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === 'data' && (
          <>
            <div className="order-last flex min-w-0 basis-full items-center gap-1.5 rounded-lg border bg-background pl-2.5 sm:order-none sm:basis-0 sm:flex-1">
              <Filter className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[11px] text-muted-foreground">WHERE</span>
              <FilterInput value={draft} onChange={setDraft} onSubmit={apply} table={table} columns={colNames} />
              {(draft || filter) && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear filter"
                  onClick={() => {
                    setDraft('')
                    setFilter('')
                    setPage(0)
                  }}
                >
                  <X />
                </Button>
              )}
              <Button variant="secondary" size="sm" className="mr-0.5 h-6" onClick={apply}>
                Apply
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-1 sm:ml-0">
              <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => rows.refetch()}>
                <RefreshCw className={rows.isFetching ? 'animate-spin' : undefined} />
              </Button>
              {result && <ExportMenu result={result} name={table} />}
            </div>
          </>
        )}
      </div>

      {view === 'structure' ? (
        <div className="min-h-0 flex-1">
          <StructureView connId={connId} schema={schema} table={table} />
        </div>
      ) : (
        <>
          {rows.error && <ErrorBox message={rows.error.message} />}
          {result ? (
            <ResultBody
              result={result}
              rowOffset={offset}
              sort={sort}
              onSortChange={(s) => {
                setSort(s)
                setPage(0)
              }}
              primaryKeys={pks}
            />
          ) : (
            !rows.error && (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )
          )}

          <div className="flex h-10 shrink-0 items-center gap-2 border-t px-2 text-xs text-muted-foreground">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-[96px] text-center tabular-nums">
              {result?.rows.length ? `${offset + 1}–${offset + result.rows.length}` : '0 rows'}
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={!result?.truncated} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight />
            </Button>
            {result && <span className="hidden sm:inline">{result.duration_ms} ms</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="hidden sm:inline">Rows per page</span>
              <Select
                value={pageSize}
                onValueChange={(v) => {
                  if (!v) return
                  setPageSize(v)
                  setPage(0)
                }}
              >
                <SelectTrigger size="sm" className="w-[76px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
