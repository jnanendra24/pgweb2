import { AlertTriangle, CheckCircle2, Download, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { download, toCsv } from '@/lib/sql'
import type { QueryResult } from '@/lib/types'
import { DataGrid, type Sort } from './data-grid'

export function ExportMenu({ result, name }: { result: QueryResult; name: string }) {
  const names = result.columns.map((c) => c.name)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!result.rows.length} />}>
        <Download /> <span className="hidden sm:inline">Export</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => download(`${name}.csv`, toCsv(names, result.rows), 'text/csv')}>CSV</DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            download(
              `${name}.json`,
              JSON.stringify(result.rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]]))), null, 2),
              'application/json',
            )
          }
        >
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="m-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <pre className="min-w-0 flex-1 font-mono text-xs break-words whitespace-pre-wrap">{message}</pre>
    </div>
  )
}

interface Props {
  result: QueryResult
  rowOffset?: number
  sort?: Sort | null
  onSortChange?: (s: Sort | null) => void
  primaryKeys?: ReadonlySet<string>
  /** Warn when the row limit cut the result short (query tabs; paginated tables just have a next page). */
  warnTruncated?: boolean
}

/** Grid for result sets; command-tag message for statements that return no rows. */
export function ResultBody({ result, warnTruncated, ...grid }: Props) {
  if (!result.columns.length) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm">
        <CheckCircle2 className="size-4 text-emerald-500" />
        <span className="font-mono">{result.status ?? 'OK'}</span>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {warnTruncated && result.truncated && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" /> Result truncated — more rows exist than the limit allows.
        </div>
      )}
      <DataGrid columns={result.columns} rows={result.rows} className="flex-1" {...grid} />
    </div>
  )
}
