import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { apiTableChanges, draftCount, tableDraftKey, useWorkspace } from '@/stores/workspace'
import { ReviewTableChangesDialog } from './review-table-changes-dialog'

export interface DirtyTable { connId: string; schema: string; table: string }

export function PendingChangesDialog({ tables, onContinue, onCancel }: {
  tables: DirtyTable[]
  onContinue: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const drafts = useWorkspace((s) => s.tableDrafts)
  const clear = useWorkspace((s) => s.clearTableDraft)
  const [queue, setQueue] = useState<DirtyTable[]>([])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const dirty = tables.filter((t) => draftCount(drafts[tableDraftKey(t.connId, t.schema, t.table)]) > 0)
  const current = queue[index]
  const currentKey = current && tableDraftKey(current.connId, current.schema, current.table)
  const currentDraft = currentKey ? drafts[currentKey] : undefined
  const columnsQuery = useQuery({
    queryKey: ['columns', current?.connId, current?.schema, current?.table],
    queryFn: () => api.listColumns(current!.connId, current!.schema, current!.table),
    enabled: !!current,
  })

  const startReview = () => { setQueue(dirty); setIndex(0) }
  const confirm = async () => {
    if (!current || !currentDraft || !currentKey || busy) return
    setBusy(true)
    try {
      await api.applyTableChanges(current.connId, current.schema, current.table, apiTableChanges(currentDraft))
      clear(currentKey)
      await qc.invalidateQueries({ queryKey: ['rows', current.connId, current.schema, current.table] })
      toast.success(`Applied changes to ${current.schema}.${current.table}`)
      if (index + 1 >= queue.length) { setQueue([]); onContinue() }
      else setIndex((i) => i + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  return <>
    <Dialog open={tables.length > 0 && !current} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent><DialogHeader><DialogTitle>Unsaved table changes</DialogTitle>
        <DialogDescription>{dirty.length} table{dirty.length === 1 ? '' : 's'} has staged changes. Review and confirm each table separately, reset them, or keep editing. Applied tables cannot be undone here.</DialogDescription>
      </DialogHeader><DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant="outline" onClick={() => { dirty.forEach((t) => clear(tableDraftKey(t.connId, t.schema, t.table))); onContinue() }}>Reset and continue</Button>
        <Button onClick={startReview} disabled={!dirty.length}>Review changes</Button>
      </DialogFooter></DialogContent>
    </Dialog>
    {current && currentDraft && <ReviewTableChangesDialog
      open={!!current} onOpenChange={(open) => { if (!open && !busy) { setQueue([]); onCancel() } }}
      schema={current.schema} table={current.table} columns={columnsQuery.data?.map((column) => column.name) ?? []} primaryKeys={columnsQuery.data?.filter((column) => column.is_primary_key).map((column) => column.name) ?? []}
      draft={currentDraft} busy={busy} canConfirm={!columnsQuery.isLoading && !columnsQuery.isError} onConfirm={() => void confirm()}
    />}
  </>
}
