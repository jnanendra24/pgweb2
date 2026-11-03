import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Copy, Expand, KeyRound, Pencil, Trash2, Undo2 } from 'lucide-react'
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
  onEditCell?: (row: number, column: number) => void
  onToggleDelete?: (row: number) => void
  isDeleted?: (row: number) => boolean
  isInserted?: (row: number) => boolean
  isChanged?: (row: number, column: number) => boolean
  editing?: { row: number; column: number; text: string }
  onEditTextChange?: (text: string) => void
  onCommitEdit?: () => void
  onCancelEdit?: () => void
  onEditLarge?: (row: number, column: number) => void
  onSetNullCell?: (row: number, column: number) => void
  onCloneRow?: (row: number) => void
  className?: string
}

const ROW_H = 34
const HEAD_H = 44
const GUTTER_W = 52

export function DataGrid({ columns, rows, rowOffset = 0, sort, onSortChange, primaryKeys, onEditCell, onToggleDelete, isDeleted, isInserted, isChanged, editing, onEditTextChange, onCommitEdit, onCancelEdit, onEditLarge, onSetNullCell, onCloneRow, className }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [localSort, setLocalSort] = useState<Sort | null>(null)
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null)
  const [selectedRange, setSelectedRange] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null)
  const [selectedRows, setSelectedRows] = useState<number[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; column: number; header?: boolean } | null>(null)
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
    setSelected(null); setSelectedRange(null); setSelectedRows([])
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

  const cellText = (v: unknown) => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  const copySelection = useCallback(async (format: 'tsv' | 'csv' | 'json' | 'markdown', mode: 'cell' | 'cells' | 'rows', target?: { row: number; column: number }) => {
    let data: unknown[][]
    let names: string[]
    if (mode === 'cell' && target) { data = [[sorted[target.row]?.[target.column]]]; names = [columns[target.column]?.name ?? 'value'] }
    else if (mode === 'rows') { const indices = selectedRows.length ? selectedRows : target ? [target.row] : []; data = indices.map((i) => sorted[i] ?? []); names = columns.map((c) => c.name) }
    else if (mode === 'cells' && selectedRange) {
      const r0 = Math.min(selectedRange.r0, selectedRange.r1), r1 = Math.max(selectedRange.r0, selectedRange.r1)
      const c0 = Math.min(selectedRange.c0, selectedRange.c1), c1 = Math.max(selectedRange.c0, selectedRange.c1)
      names = columns.slice(c0, c1 + 1).map((c) => c.name)
      data = Array.from({ length: r1 - r0 + 1 }, (_, r) => sorted[r0 + r]?.slice(c0, c1 + 1) ?? [])
    }
    else if (selected) { data = [[sorted[selected.r]?.[selected.c]]]; names = [columns[selected.c]?.name ?? 'value'] }
    else { data = []; names = columns.map((c) => c.name) }
    const quote = (v: unknown, sep: string) => { const s = cellText(v); return s.includes(sep) || /[\r\n"]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s }
    let output = ''
    if (format === 'json') output = JSON.stringify(data.map((row) => Object.fromEntries(names.map((name, i) => [name, row[i] ?? null]))), null, 2)
    else if (format === 'markdown') output = [names, names.map(() => '---'), ...data.map((row) => names.map((_, i) => cellText(row[i]).replaceAll('|', '\\|').replaceAll('\n', '<br>')))].map((row) => `| ${row.join(' | ')} |`).join('\n')
    else if (format === 'tsv') output = data.map((row) => row.map((value) => quote(value, '\t')).join('\t')).join('\n')
    else output = [names.map((n) => quote(n, ',')).join(','), ...data.map((row) => names.map((_, i) => quote(row[i], ',')).join(','))].join('\n')
    try { await navigator.clipboard.writeText(output); toast.success('Copied selection') } catch { toast.error('Clipboard unavailable') }
  }, [sorted, columns, selectedRows, selected, selectedRange])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && (selectedRows.length || selected)) {
      e.preventDefault()
      void copySelection('tsv', selectedRows.length ? 'rows' : selectedRange && (selectedRange.r0 !== selectedRange.r1 || selectedRange.c0 !== selectedRange.c1) ? 'cells' : 'cell')
      return
    }
    if (!selected) return
    const { r, c } = selected
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const nr = Math.max(0, Math.min(sorted.length - 1, r + dr))
      const nc = Math.max(0, Math.min(columns.length - 1, c + dc))
      setSelectedRange(e.shiftKey ? { r0: selectedRange?.r0 ?? r, c0: selectedRange?.c0 ?? c, r1: nr, c1: nc } : { r0: nr, c0: nc, r1: nr, c1: nc })
      setSelected({ r: nr, c: nc })
      virt.scrollToIndex(nr)
    }
    if (e.key === 'ArrowDown') move(1, 0)
    else if (e.key === 'ArrowUp') move(-1, 0)
    else if (e.key === 'ArrowRight') move(0, 1)
    else if (e.key === 'ArrowLeft') move(0, -1)
    else if (e.key === 'Enter') {
      if (onEditCell) onEditCell(r, c)
      else setExpanded(true)
    }
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
                <div key={i} style={{ width: widths[i] }} className="relative shrink-0 border-r last:border-r-0" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, row: 0, column: i, header: true }) }}>
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
                    onContextMenu={(e) => { if (e.defaultPrevented) return; e.preventDefault(); if (!selectedRows.includes(vi.index)) setSelectedRows([vi.index]); const column = selected?.c ?? 0; setSelected({ r: vi.index, c: column }); setSelectedRange({ r0: vi.index, c0: column, r1: vi.index, c1: column }); setMenu({ x: e.clientX, y: e.clientY, row: vi.index, column }) }}
                    className={cn('absolute left-0 flex w-full border-b', vi.index % 2 ? 'bg-muted/25' : 'bg-background', isDeleted?.(vi.index) && 'opacity-50', isInserted?.(vi.index) && 'bg-emerald-500/10', selectedRows.includes(vi.index) && 'bg-primary/10')}
                  style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}
                >
                  <div
                    className={cn(
                      'sticky left-0 z-10 shrink-0 border-r px-2 text-right font-mono text-[11px] leading-[34px] text-muted-foreground',
                      isSelRow ? 'bg-accent' : 'bg-muted',
                    )}
                    style={{ width: GUTTER_W }}
                    onClick={(e) => { if (e.shiftKey && selectedRows.length) { const anchor = selectedRows[0]; setSelectedRows(Array.from({ length: Math.abs(vi.index - anchor) + 1 }, (_, n) => Math.min(anchor, vi.index) + n)) } else if (e.metaKey || e.ctrlKey) setSelectedRows((prev) => prev.includes(vi.index) ? prev.filter((n) => n !== vi.index) : [...prev, vi.index].sort((a,b) => a-b)); else setSelectedRows([vi.index]); setSelected({ r: vi.index, c: selected?.c ?? 0 }) }}
                  >
                    {onToggleDelete ? (
                      <button type="button" className="group flex h-full w-full items-center justify-end gap-1" title={isDeleted?.(vi.index) ? 'Undo delete' : 'Delete row'} onClick={() => onToggleDelete(vi.index)}>
                        <span className="group-hover:hidden">{isInserted?.(vi.index) ? '+' : rowOffset + vi.index + 1}</span>
                        {isDeleted?.(vi.index) ? <Undo2 className="size-3.5" /> : <Trash2 className="hidden size-3.5 group-hover:block" />}
                      </button>
                    ) : rowOffset + vi.index + 1}
                  </div>
                  {columns.map((col, ci) => {
                    const { text, kind } = describe(row[ci], col.type)
                    const isRange = !!selectedRange && vi.index >= Math.min(selectedRange.r0, selectedRange.r1) && vi.index <= Math.max(selectedRange.r0, selectedRange.r1) && ci >= Math.min(selectedRange.c0, selectedRange.c1) && ci <= Math.max(selectedRange.c0, selectedRange.c1)
                    const isSel = isRange || (isSelRow && selected?.c === ci)
                    return (
                      <div
                        key={ci}
                        style={{ width: widths[ci] }}
                        onClick={(e) => {
                          setSelectedRange(e.shiftKey && selectedRange ? { ...selectedRange, r1: vi.index, c1: ci } : { r0: vi.index, c0: ci, r1: vi.index, c1: ci })
                          setSelected({ r: vi.index, c: ci })
                          if (!e.shiftKey) setSelectedRows([])
                          scrollRef.current?.focus({ preventScroll: true })
                        }}
                        onContextMenu={(e) => { e.preventDefault(); setSelected({ r: vi.index, c: ci }); const inside = !!selectedRange && vi.index >= Math.min(selectedRange.r0, selectedRange.r1) && vi.index <= Math.max(selectedRange.r0, selectedRange.r1) && ci >= Math.min(selectedRange.c0, selectedRange.c1) && ci <= Math.max(selectedRange.c0, selectedRange.c1); if (!inside) setSelectedRange({ r0: vi.index, c0: ci, r1: vi.index, c1: ci }); if (!selectedRows.includes(vi.index)) setSelectedRows([]); setMenu({ x: e.clientX, y: e.clientY, row: vi.index, column: ci }) }}
                        onDoubleClick={() => onEditCell ? onEditCell(vi.index, ci) : setExpanded(true)}
                        className={cn(
                          'shrink-0 truncate border-r px-3 leading-[34px] last:border-r-0',
                          kind === 'number' && 'text-right font-mono tabular-nums',
                          kind === 'json' && 'font-mono text-[12px] text-sky-600 dark:text-sky-400',
                          kind === 'boolean' && 'font-mono text-violet-600 dark:text-violet-400',
                          kind === 'null' && 'text-[12px] text-muted-foreground/60 italic',
                          isSel && 'bg-primary/15 outline outline-2 -outline-offset-2 outline-primary',
                          isChanged?.(vi.index, ci) && 'bg-amber-500/20',
                          isDeleted?.(vi.index) && 'line-through',
                        )}
                      >
                        {editing?.row === vi.index && editing.column === ci ? (
                          <input
                            autoFocus
                            aria-label={`Edit ${col.name}`}
                            className="h-[30px] w-full rounded border border-primary bg-background px-1 font-mono text-xs text-foreground outline-none"
                            value={editing.text}
                            onChange={(e) => onEditTextChange?.(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onBlur={onCommitEdit}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') { e.preventDefault(); onCommitEdit?.() }
                              if (e.key === 'Escape') { e.preventDefault(); onCancelEdit?.() }
                            }}
                          />
                        ) : text}
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

      {menu && <>
        <button type="button" aria-label="Close context menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
        <div role="menu" className="fixed z-50 max-h-[80dvh] min-w-48 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md" style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 320) }}>
          {menu.header ? <>
            <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { copy(columns[menu.column]?.name); setMenu(null) }}>Copy column name</button>
            <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { toggleSort(columns[menu.column].name); setMenu(null) }}>Sort ascending / cycle</button>
          </> : <>
          <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Copy clicked cell</div>
          {(['tsv', 'csv', 'json', 'markdown'] as const).map((format) => <button key={`cell-${format}`} role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { void copySelection(format, 'cell', { row: menu.row, column: menu.column }); setMenu(null) }}>{format.toUpperCase()}</button>)}
          {selectedRange && (selectedRange.r0 !== selectedRange.r1 || selectedRange.c0 !== selectedRange.c1) && <>
            <div className="my-1 border-t" /><div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Copy selected cells</div>
            {(['tsv', 'csv', 'json', 'markdown'] as const).map((format) => <button key={`cells-${format}`} role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { void copySelection(format, 'cells', { row: menu.row, column: menu.column }); setMenu(null) }}>{format.toUpperCase()}</button>)}
          </>}
          <div className="my-1 border-t" /><div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">{selectedRows.length ? 'Copy selected rows' : 'Copy clicked row'}</div>
          {(['tsv', 'csv', 'json', 'markdown'] as const).map((format) => <button key={`rows-${format}`} role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { void copySelection(format, 'rows', { row: menu.row, column: menu.column }); setMenu(null) }}>{format.toUpperCase()}</button>)}
          {onEditCell && !menu.header && !isDeleted?.(menu.row) && <>
            <div className="my-1 border-t" />
            <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { (onEditLarge ?? onEditCell)(menu.row, menu.column); setMenu(null) }}>Edit in modal</button>
            <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { onSetNullCell?.(menu.row, menu.column); setMenu(null) }}>Set NULL</button>
            <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { onCloneRow?.(menu.row); setMenu(null) }}>Clone this row</button>
            <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent" onClick={() => { onToggleDelete?.(menu.row); setMenu(null) }}>Delete this row</button>
          </>}
          </>}
        </div>
      </>}

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
            {onEditCell && !isDeleted?.(selected.r) && (
              <Button variant="ghost" size="icon-xs" aria-label="Edit value" onClick={() => onEditCell(selected.r, selected.c)}><Pencil /></Button>
            )}
            {onEditLarge && !isDeleted?.(selected.r) && (
              <Button variant="ghost" size="icon-xs" aria-label="Edit in larger editor" onClick={() => onEditLarge(selected.r, selected.c)}><Expand /></Button>
            )}
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
