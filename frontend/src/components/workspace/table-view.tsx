import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Filter, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FilterInput } from '@/components/editor/filter-input'
import type { Sort } from '@/components/grid/data-grid'
import { ErrorBox, ExportMenu, ResultBody } from '@/components/grid/result-pane'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useColumns, useTables } from '@/hooks/use-schema'
import { api } from '@/lib/api'
import type { BrowseFilterCondition, BrowseFilterOperator } from '@/lib/types'
import { apiTableChanges, draftCount, emptyTableDraft, tableDraftKey, useWorkspace } from '@/stores/workspace'
import { StructureView } from './structure-view'
import { ReviewTableChangesDialog } from './review-table-changes-dialog'

const PAGE_SIZES = ['50', '100', '250', '500']
const EMPTY = emptyTableDraft()
type Edit = { row: number; column: number; text: string; isNull: boolean; large: boolean }
type VisualFilter = { id: string; column: string; operator: BrowseFilterOperator; value: string }
const FILTER_OPERATORS: BrowseFilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is_null', 'is_not_null']

export function TableView({ connId, schema, table, readOnly }: { connId: string; schema: string; table: string; readOnly: boolean }) {
  const qc = useQueryClient()
  const key = tableDraftKey(connId, schema, table)
  const draft = useWorkspace((s) => s.tableDrafts[key] ?? EMPTY)
  const setDraft = useWorkspace((s) => s.setTableDraft)
  const clearDraft = useWorkspace((s) => s.clearTableDraft)
  const [view, setView] = useState<'data' | 'structure'>('data')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState('100')
  const [sort, setSort] = useState<Sort | null>(null)
  const [filterDraft, setFilterDraft] = useState('')
  const [filter, setFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'visual' | 'raw'>('visual')
  const [filterCombine, setFilterCombine] = useState<'and' | 'or'>('and')
  const [visualDraft, setVisualDraft] = useState<VisualFilter[]>([])
  const [visualFilters, setVisualFilters] = useState<BrowseFilterCondition[]>([])
  const [edit, setEdit] = useState<Edit | null>(null)
  const [applying, setApplying] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)

  const cols = useColumns(connId, schema, table)
  const tables = useTables(connId)
  const colNames = useMemo(() => cols.data?.map((c) => c.name) ?? [], [cols.data])
  const pkNames = useMemo(() => cols.data?.filter((c) => c.is_primary_key).map((c) => c.name) ?? [], [cols.data])
  const pks = useMemo(() => new Set(pkNames), [pkNames])
  const kind = tables.data?.find((t) => t.schema_name === schema && t.name === table)?.kind
  const editable = !readOnly && (kind === 'table' || kind === 'partitioned_table') && pkNames.length > 0
  const limit = Number(pageSize)
  const offset = page * limit
  const structuredConditions = useMemo(() => visualFilters, [visualFilters])
  const rows = useQuery({
    queryKey: ['rows', connId, schema, table, { page, limit, sort, filter, filterMode, filterCombine, structuredConditions }],
    placeholderData: keepPreviousData,
    queryFn: () => filterMode === 'visual'
      ? api.searchTable(connId, schema, table, { limit, offset, order_by: sort?.column, desc: sort?.desc, combine: filterCombine, conditions: structuredConditions })
      : api.browseTable(connId, schema, table, { limit, offset, orderBy: sort?.column, desc: sort?.desc, filter }),
  })
  const result = rows.data
  const rowPk = (row: unknown[]) => Object.fromEntries(pkNames.map((name) => [name, row[colNames.indexOf(name)]]))
  const rowKey = (row: unknown[]) => JSON.stringify(rowPk(row))
  const inserts = draft.inserts
  const displayedRows = useMemo(() => {
    const added = inserts.map((item) => colNames.map((name) => item.values[name] ?? null))
    const existing = (result?.rows ?? []).map((row) => {
      const changed = draft.updates[JSON.stringify(Object.fromEntries(pkNames.map((name) => [name, row[colNames.indexOf(name)]]))) ]?.values
      return row.map((value, ci) => changed && Object.hasOwn(changed, colNames[ci]) ? changed[colNames[ci]] : value)
    })
    return [...added, ...existing]
  }, [inserts, colNames, result, draft.updates, pkNames])
  const insertCount = inserts.length
  const displayResult = result ? { ...result, rows: displayedRows } : null
  const staged = draftCount(draft)

  const guard = (action: () => void) => {
    if (staged) setPendingAction(() => action)
    else action()
  }
  const applyChanges = async () => {
    if (!staged || applying) return false
    const changes = apiTableChanges(draft)
    setApplying(true)
    try {
      const done = await api.applyTableChanges(connId, schema, table, changes)
      clearDraft(key)
      await qc.invalidateQueries({ queryKey: ['rows', connId, schema, table] })
      toast.success(`Applied ${done.updated + done.inserted + done.deleted} row changes`)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setApplying(false)
    }
  }
  const requestReview = () => { if (staged && !applying) setReviewOpen(true) }
  const original = (index: number) => result?.rows[index - insertCount]
  const startEdit = (index: number, column: number, large = false) => {
    const meta = cols.data?.[column]
    if (!editable || !result || meta?.is_generated || meta?.is_identity || (index >= insertCount && meta?.is_primary_key)) return
    if (index >= insertCount && draft.deletes[rowKey(original(index)!)]) return
    const value = displayedRows[index]?.[column]
    setEdit({ row: index, column, text: value == null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value), isNull: value == null, large })
  }
  const commitEdit = () => {
    if (!edit || !result) return
    const column = colNames[edit.column]
    const type = cols.data?.[edit.column]?.data_type ?? ''
    let value: unknown = edit.isNull ? null : edit.text
    if (!edit.isNull && (/^jsonb?$/.test(type) || type.endsWith('[]'))) {
      try { value = JSON.parse(edit.text) } catch { toast.error('Enter valid JSON for this column'); return }
    }
    if (!edit.isNull && type === 'boolean' && !['true', 'false'].includes(edit.text.toLowerCase())) {
      toast.error('Enter true or false'); return
    }
    const inserted = inserts[edit.row]
    if (inserted) {
      setDraft(key, { ...draft, inserts: inserts.map((item) => item.id === inserted.id ? { ...item, values: { ...item.values, [column]: value } } : item) })
    } else {
      const row = original(edit.row)!
      const id = rowKey(row)
      const values = { ...draft.updates[id]?.values }
      let previous = row[edit.column]
      if (/^jsonb?$/.test(type) && typeof previous === 'string') {
        try { previous = JSON.parse(previous) } catch { /* keep the original text */ }
      }
      if (JSON.stringify(value) === JSON.stringify(previous)) delete values[column]
      else values[column] = value
      const updates = { ...draft.updates }
      if (Object.keys(values).length) updates[id] = { primary_key: rowPk(row), version: result.row_versions[edit.row - insertCount]!, values, original: Object.fromEntries(colNames.map((name, ci) => [name, row[ci]])) }
      else delete updates[id]
      setDraft(key, { ...draft, updates })
    }
    setEdit(null)
  }
  const toggleDelete = (index: number) => {
    if (!editable || !result) return
    const inserted = inserts[index]
    if (inserted) {
      setDraft(key, { ...draft, inserts: inserts.filter((item) => item.id !== inserted.id) })
      return
    }
    const row = original(index)!
    const id = rowKey(row)
    const deletes = { ...draft.deletes }
    const updates = { ...draft.updates }
    if (deletes[id]) delete deletes[id]
    else {
      deletes[id] = { primary_key: rowPk(row), version: result.row_versions[index - insertCount]!, values: {}, original: Object.fromEntries(colNames.map((name, ci) => [name, row[ci]])) }
      delete updates[id]
    }
    setDraft(key, { ...draft, deletes, updates })
  }
  const setNullCell = (index: number, column: number) => {
    if (!editable || !result) return
    const meta = cols.data?.[column]
    if (meta?.is_generated || meta?.is_identity || (index >= insertCount && meta?.is_primary_key)) return
    if (index < insertCount) {
      const item = inserts[index]
      setDraft(key, { ...draft, inserts: inserts.map((entry) => entry.id === item.id ? { ...entry, values: { ...entry.values, [colNames[column]]: null } } : entry) })
      return
    }
    const row = original(index)!
    const id = rowKey(row)
    const name = colNames[column]
    const values = { ...draft.updates[id]?.values }
    if (row[column] == null) delete values[name]
    else values[name] = null
    const updates = { ...draft.updates }
    if (Object.keys(values).length) updates[id] = { primary_key: rowPk(row), version: result.row_versions[index - insertCount]!, values, original: Object.fromEntries(colNames.map((field, ci) => [field, row[ci]])) }
    else delete updates[id]
    const deletes = { ...draft.deletes }
    setDraft(key, { ...draft, updates, deletes })
  }
  const cloneRow = (index: number) => {
    if (!editable || !result) return
    const src = index < insertCount ? inserts[index]?.values : Object.fromEntries(colNames.map((name, ci) => [name, displayedRows[index]?.[ci]]))
    if (!src) return
    const values = Object.fromEntries(cols.data!.filter((column) => !column.is_primary_key && !column.is_generated && !column.is_identity && Object.hasOwn(src, column.name)).map((column) => [column.name, src[column.name]]))
    setDraft(key, { ...draft, inserts: [{ id: crypto.randomUUID(), values }, ...inserts] })
    toast.success('Cloned row staged as a new row')
  }
  const applyVisualFilters = () => {
    const conditions: BrowseFilterCondition[] = []
    for (const f of visualDraft) {
      if (!f.column || (!['is_null', 'is_not_null'].includes(f.operator) && !f.value.trim())) continue
      let value: unknown = f.value
      if (f.operator === 'in') {
        try { const parsed: unknown = JSON.parse(f.value); value = Array.isArray(parsed) ? parsed : f.value.split(',').map((part) => part.trim()) }
        catch { value = f.value.split(',').map((part) => part.trim()) }
        if (!Array.isArray(value) || !value.length) { toast.error('IN filters need at least one value'); return }
      }
      conditions.push({ column: f.column, operator: f.operator, ...(['is_null', 'is_not_null'].includes(f.operator) ? {} : { value }) })
    }
    guard(() => { setPage(0); setVisualFilters(conditions) })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList><TabsTrigger value="data">Data</TabsTrigger><TabsTrigger value="structure">Structure</TabsTrigger></TabsList>
        </Tabs>
        {view === 'data' && <>
          <div className="order-last flex min-w-0 basis-full flex-col gap-1.5 rounded-lg border bg-background p-2 sm:order-none sm:basis-full">
            <div className="flex items-center gap-1.5"><Filter className="size-3.5 shrink-0 text-muted-foreground" />
              <Button variant={filterMode === 'visual' ? 'secondary' : 'ghost'} size="xs" onClick={() => setFilterMode('visual')}>Visual</Button>
              <Button variant={filterMode === 'raw' ? 'secondary' : 'ghost'} size="xs" onClick={() => setFilterMode('raw')}>Raw WHERE</Button>
              {filterMode === 'visual' && <><Select value={filterCombine} onValueChange={(v) => v && setFilterCombine(v as 'and'|'or')}><SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="and">All (AND)</SelectItem><SelectItem value="or">Any (OR)</SelectItem></SelectContent></Select>
              <Button variant="outline" size="xs" onClick={() => setVisualDraft((items) => [...items, { id: crypto.randomUUID(), column: colNames[0] ?? '', operator: 'eq', value: '' }])}>Add filter</Button>
              <Button variant="secondary" size="sm" className="ml-auto h-6" onClick={applyVisualFilters}>Apply filters</Button></>}
            </div>
            {filterMode === 'visual' ? visualDraft.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-1">
              <Select value={item.column} onValueChange={(v) => v && setVisualDraft((items) => items.map((f) => f.id === item.id ? { ...f, column: v } : f))}><SelectTrigger size="sm" className="min-w-24 flex-1"><SelectValue placeholder="Column" /></SelectTrigger><SelectContent>{colNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
              <Select value={item.operator} onValueChange={(v) => v && setVisualDraft((items) => items.map((f) => f.id === item.id ? { ...f, operator: v as BrowseFilterOperator } : f))}><SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{FILTER_OPERATORS.map((op) => <SelectItem key={op} value={op}>{op.replaceAll('_', ' ').toUpperCase()}</SelectItem>)}</SelectContent></Select>
              {!['is_null', 'is_not_null'].includes(item.operator) && <input className="h-8 min-w-20 flex-[2] rounded-md border bg-background px-2 text-xs" placeholder={item.operator === 'in' ? 'values or JSON array' : 'value'} value={item.value} onChange={(e) => setVisualDraft((items) => items.map((f) => f.id === item.id ? { ...f, value: e.target.value } : f))} onKeyDown={(e) => e.key === 'Enter' && applyVisualFilters()} />}
              <Button variant="ghost" size="icon-xs" aria-label="Remove filter" onClick={() => setVisualDraft((items) => items.filter((f) => f.id !== item.id))}><X /></Button>
            </div>) : <div className="flex min-w-0 items-center gap-1.5"><span className="font-mono text-[11px] text-muted-foreground">WHERE</span><FilterInput value={filterDraft} onChange={setFilterDraft} onSubmit={() => guard(() => { setPage(0); setFilter(filterDraft.trim()) })} table={table} columns={colNames} />{(filterDraft || filter) && <Button variant="ghost" size="icon-xs" aria-label="Clear filter" onClick={() => guard(() => { setFilterDraft(''); setFilter(''); setPage(0) })}><X /></Button>}<Button variant="secondary" size="sm" className="mr-0.5 h-6" onClick={() => guard(() => { setPage(0); setFilter(filterDraft.trim()) })}>Apply</Button></div>}
          </div>
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            {editable && <Button variant="outline" size="sm" onClick={() => setDraft(key, { ...draft, inserts: [{ id: crypto.randomUUID(), values: {} }, ...inserts] })}><Plus /> Row</Button>}
            <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => guard(() => { void rows.refetch() })}><RefreshCw className={rows.isFetching ? 'animate-spin' : undefined} /></Button>
            {displayResult && <ExportMenu result={displayResult} name={table} />}
          </div>
        </>}
      </div>
      {view === 'structure' ? <div className="min-h-0 flex-1"><StructureView connId={connId} schema={schema} table={table} /></div> : <>
        {!readOnly && kind && !editable && <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">Editing requires an ordinary or partitioned table with a primary key.</p>}
        {rows.error && <ErrorBox message={rows.error.message} />}
        {displayResult ? <ResultBody
          result={displayResult} rowOffset={offset} sort={sort} primaryKeys={pks}
          onSortChange={(next) => guard(() => { setSort(next); setPage(0) })}
          onEditCell={editable ? (r, c) => startEdit(r, c) : undefined}
          onEditLarge={editable ? (r, c) => startEdit(r, c, true) : undefined}
          onSetNullCell={editable ? setNullCell : undefined}
          onCloneRow={editable ? cloneRow : undefined}
          onToggleDelete={editable ? toggleDelete : undefined}
          isInserted={(r) => r < insertCount}
          isDeleted={(r) => r >= insertCount && !!draft.deletes[rowKey(original(r)!)]}
          isChanged={(r, c) => r < insertCount ? Object.hasOwn(inserts[r].values, colNames[c]) : !!draft.updates[rowKey(original(r)!)]?.values && Object.hasOwn(draft.updates[rowKey(original(r)!)]!.values, colNames[c])}
          editing={edit && !edit.large ? edit : undefined}
          onEditTextChange={(text) => setEdit((current) => current && { ...current, text, isNull: false })}
          onCommitEdit={commitEdit} onCancelEdit={() => setEdit(null)}
        /> : !rows.error && <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
        {staged > 0 && <div className="flex shrink-0 items-center gap-2 border-t bg-amber-500/10 px-3 py-1.5 text-xs">
          <span className="mr-auto">{Object.keys(draft.updates).length} updated · {inserts.length} added · {Object.keys(draft.deletes).length} deleted</span>
          <Button variant="outline" size="sm" onClick={() => clearDraft(key)} disabled={applying}>Reset</Button>
          <Button size="sm" onClick={requestReview} disabled={applying}>Review and Apply</Button>
        </div>}
        <div className="flex h-10 shrink-0 items-center gap-2 border-t px-2 text-xs text-muted-foreground">
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => guard(() => setPage((p) => p - 1))}><ChevronLeft /></Button>
          <span className="min-w-[96px] text-center tabular-nums">{result?.rows.length ? `${offset + 1}–${offset + result.rows.length}` : '0 rows'}</span>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={!result?.truncated} onClick={() => guard(() => setPage((p) => p + 1))}><ChevronRight /></Button>
          {result && <span className="hidden sm:inline">{result.duration_ms} ms</span>}
          <div className="ml-auto flex items-center gap-1.5"><span className="hidden sm:inline">Rows per page</span>
            <Select value={pageSize} onValueChange={(v) => v && guard(() => { setPageSize(v); setPage(0) })}>
              <SelectTrigger size="sm" className="w-[76px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </>}
      <Dialog open={!!edit?.large} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Edit {edit && colNames[edit.column]}</DialogTitle><DialogDescription>Change the value, then review it before applying.</DialogDescription></DialogHeader>
          <Textarea value={edit?.text ?? ''} onChange={(e) => setEdit((current) => current && { ...current, text: e.target.value, isNull: false })} disabled={edit?.isNull} className="min-h-48 font-mono" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit?.isNull ?? false} onChange={(e) => setEdit((current) => current && { ...current, isNull: e.target.checked })} /> Set NULL</label>
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={commitEdit}>Stage change</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent><DialogHeader><DialogTitle>Unsaved table changes</DialogTitle><DialogDescription>Apply changes before continuing, discard them, or keep editing.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => { clearDraft(key); pendingAction?.(); setPendingAction(null) }}>Reset and continue</Button>
            <Button onClick={() => { setPendingAction((action) => action); setReviewOpen(true) }} disabled={applying}>Review and continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewTableChangesDialog open={reviewOpen} onOpenChange={setReviewOpen} schema={schema} table={table} columns={colNames} primaryKeys={pkNames} draft={draft} busy={applying} onConfirm={async () => { if (await applyChanges()) { setReviewOpen(false); if (pendingAction) { pendingAction(); setPendingAction(null) } } }} />
    </div>
  )
}
