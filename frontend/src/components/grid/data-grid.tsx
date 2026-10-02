import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Copy, Expand, KeyRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { QueryColumn } from '@/lib/types'
import { compare, describe, fullText, initialWidth } from './format'

export interface Sort {
  column: string
  desc: boolean
}

interface Props {
  columns: QueryColumn[]
  rows: unknown[][]
  /** Number shown on the first row's gutter (for paginated views). */
  rowOffset?: number
  sort?: Sort | null
  /** When provided, sorting is delegated to the caller (server-side). Otherwise rows sort in the browser. */
  onSortChange?: (s: Sort | null) => void
  primaryKeys?: ReadonlySet<string>
  className?: string
}

const ROW_H = 34
const HEAD_H = 44
const GUTTER_W = 52

export function DataGrid({ columns, rows, rowOffset = 0, sort, onSortChange, primaryKeys, className }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [localSort, setLocalSort] = useState<Sort | null>(null)
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const activeSort = onSortChange ? (sort ?? null) : localSort

  const sorted = useMemo(() => {
    if (onSortChange || !localSort) return rows
    const i = columns.findIndex((c) => c.name === localSort.column)
    if (i < 0) return rows
    const dir = localSort.desc ? -1 : 1
    return [...rows].sort((a, b) => dir * compare(a[i], b[i]))
  }, [rows, columns, localSort, onSortChange])

  const colKey = columns.map((c) => `${c.name}:${c.type}`).join('|')
  // Default widths come from the first page; the user's drags override them until the column set changes.
  const defaults = useMemo(
    () => columns.map((c, i) => initialWidth(c.name, c.type, rows, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colKey],
  )
  const [overrides, setOverrides] = useState<Record<number, number>>({})
  const widths = columns.map((_, i) => overrides[i] ?? defaults[i])
  const totalWidth = GUTTER_W + widths.reduce((a, b) => a + b, 0)

  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widths[i]
    const move = (ev: PointerEvent) => setOverrides((o) => ({ ...o, [i]: Math.min(900, Math.max(60, startW + ev.clientX - startX)) }))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resetWidth = (i: number) =>
    setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([k]) => Number(k) !== i)))

  const virt = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  useEffect(() => {
    setSelected(null)
    setOverrides({})
  }, [colKey])
  useEffect(() => {
    setSelected(null)
  }, [rows])

  const toggleSort = (name: string) => {
    const next: Sort | null =
      activeSort?.column !== name ? { column: name, desc: false } : !activeSort.desc ? { column: name, desc: true } : null
    if (onSortChange) onSortChange(next)
    else setLocalSort(next)
  }

  const value = selected ? sorted[selected.r]?.[selected.c] : undefined
  const copy = useCallback((v: unknown) => {
    navigator.clipboard.writeText(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).then(
      () => toast.success('Copied'),
      () => toast.error('Clipboard unavailable'),
    )
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return
    const { r, c } = selected
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const nr = Math.max(0, Math.min(sorted.length - 1, r + dr))
      const nc = Math.max(0, Math.min(columns.length - 1, c + dc))
      setSelected({ r: nr, c: nc })
      virt.scrollToIndex(nr)
    }
    if (e.key === 'ArrowDown') move(1, 0)
    else if (e.key === 'ArrowUp') move(-1, 0)
    else if (e.key === 'ArrowRight') move(0, 1)
    else if (e.key === 'ArrowLeft') move(0, -1)
    else if (e.key === 'Enter') setExpanded(true)
    else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault()
      copy(value)
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain text-[13px] outline-none"
      >
        <div style={{ width: totalWidth }} className="min-w-full">
          <div className="sticky top-0 z-20 flex border-b bg-muted/95 backdrop-blur" style={{ height: HEAD_H }}>
            <div className="sticky left-0 z-10 shrink-0 border-r bg-muted" style={{ width: GUTTER_W }} />
            {columns.map((col, i) => {
              const isSorted = activeSort?.column === col.name
              return (
                <div key={i} style={{ width: widths[i] }} className="relative shrink-0 border-r last:border-r-0">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.name)}
                    className="flex h-full w-full flex-col justify-center px-3 text-left hover:bg-accent/60"
                  >
                    <span className="flex items-center gap-1 font-medium">
                      {primaryKeys?.has(col.name) && <KeyRound className="size-3 shrink-0 text-amber-500" />}
                      <span className="truncate">{col.name}</span>
                      {isSorted && (activeSort.desc ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUp className="size-3 shrink-0" />)}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{col.type}</span>
                  </button>
                  <div
                    onPointerDown={startResize(i)}
                    onDoubleClick={() => resetWidth(i)}
                    className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/40"
                  />
                </div>
              )
            })}
          </div>

          <div style={{ height: virt.getTotalSize() }} className="relative">
            {virt.getVirtualItems().map((vi) => {
              const row = sorted[vi.index]
              const isSelRow = selected?.r === vi.index
              return (
                <div
                  key={vi.key}
                  className={cn('absolute left-0 flex w-full border-b', vi.index % 2 ? 'bg-muted/25' : 'bg-background')}
                  style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}
                >
                  <div
                    className={cn(
                      'sticky left-0 z-10 shrink-0 border-r px-2 text-right font-mono text-[11px] leading-[34px] text-muted-foreground',
                      isSelRow ? 'bg-accent' : 'bg-muted',
                    )}
                    style={{ width: GUTTER_W }}
                  >
                    {rowOffset + vi.index + 1}
                  </div>
                  {columns.map((col, ci) => {
                    const { text, kind } = describe(row[ci], col.type)
                    const isSel = isSelRow && selected?.c === ci
                    return (
                      <div
                        key={ci}
                        style={{ width: widths[ci] }}
                        onClick={() => {
                          setSelected({ r: vi.index, c: ci })
                          scrollRef.current?.focus({ preventScroll: true })
                        }}
                        onDoubleClick={() => setExpanded(true)}
                        className={cn(
                          'shrink-0 truncate border-r px-3 leading-[34px] last:border-r-0',
                          kind === 'number' && 'text-right font-mono tabular-nums',
                          kind === 'json' && 'font-mono text-[12px] text-sky-600 dark:text-sky-400',
                          kind === 'boolean' && 'font-mono text-violet-600 dark:text-violet-400',
                          kind === 'null' && 'text-[12px] text-muted-foreground/60 italic',
                          isSel && 'bg-primary/15 outline outline-2 -outline-offset-2 outline-primary',
                        )}
                      >
                        {text}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {sorted.length === 0 && (
            <div className="sticky left-0 flex h-32 w-full items-center justify-center text-sm text-muted-foreground" style={{ maxWidth: '100vw' }}>
              No rows
            </div>
          )}
        </div>
      </div>

      {/* Inspector: works on touch where there is no hover or double-click. */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-t bg-muted/40 px-3 text-xs">
        {selected ? (
          <>
            <span className="shrink-0 font-medium">{columns[selected.c].name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{describe(value, columns[selected.c].type).text}</span>
            <Button variant="ghost" size="icon-xs" aria-label="Copy value" onClick={() => copy(value)}>
              <Copy />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Expand value" onClick={() => setExpanded(true)}>
              <Expand />
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Select a cell to inspect it</span>
        )}
      </div>

      <Dialog open={expanded && !!selected} onOpenChange={setExpanded}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2">
              {selected && columns[selected.c].name}
              <span className="font-mono text-xs font-normal text-muted-foreground">{selected && columns[selected.c].type}</span>
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60dvh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap">{fullText(value)}</pre>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => copy(typeof value === 'object' ? fullText(value) : value)}>
              <Copy /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
