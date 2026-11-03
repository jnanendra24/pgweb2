import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { TableDraft } from '@/stores/workspace'
import { draftCount } from '@/stores/workspace'

const show = (value: unknown) => value == null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const keyLabel = (primaryKey: Record<string, unknown>) =>
  Object.entries(primaryKey).map(([name, value]) => `${name} = ${show(value)}`).join(', ')

export function ReviewTableChangesDialog({ open, onOpenChange, schema, table, columns, primaryKeys = [], draft, busy, canConfirm = true, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  schema: string
  table: string
  columns: string[]
  primaryKeys?: string[]
  draft: TableDraft
  busy: boolean
  canConfirm?: boolean
  onConfirm: () => void
}) {
  const count = draftCount(draft)
  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Review and apply changes</DialogTitle>
        <DialogDescription>
          {schema}.{table} · {Object.keys(draft.updates).length} updated · {draft.inserts.length} added · {Object.keys(draft.deletes).length} deleted.
          Once applied, these changes cannot be undone here.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[55dvh] space-y-3 overflow-auto pr-1">
        {Object.values(draft.updates).map((change, index) => (
          <section key={`update-${index}`} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <h3 className="mb-2 text-xs font-semibold">Update row · {keyLabel(change.primary_key)}</h3>
            <dl className="space-y-1 font-mono text-xs">
              {Object.entries(change.values).map(([name, value]) => (
                <div key={name} className="grid grid-cols-[minmax(90px,0.5fr)_1fr_auto_1fr] gap-2">
                  <dt className="truncate font-sans font-medium">{name}</dt><dd className="truncate text-muted-foreground">{show(change.original[name])}</dd>
                  <span aria-hidden="true">→</span><dd className="truncate">{show(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {draft.inserts.map((insert, index) => (
          <section key={insert.id} className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <h3 className="mb-2 text-xs font-semibold">Add row {index + 1} · {keyLabel(Object.fromEntries(primaryKeys.map((name) => [name, Object.hasOwn(insert.values, name) ? insert.values[name] : 'DEFAULT'])))}</h3>
            <dl className="grid grid-cols-1 gap-1 font-mono text-xs sm:grid-cols-2">
              {columns.map((name) => <div key={name} className="flex min-w-0 gap-2"><dt className="truncate font-sans font-medium">{name}</dt><dd className="truncate text-muted-foreground">{Object.hasOwn(insert.values, name) ? show(insert.values[name]) : 'DEFAULT'}</dd></div>)}
            </dl>
          </section>
        ))}
        {Object.values(draft.deletes).map((change, index) => (
          <section key={`delete-${index}`} className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <h3 className="mb-2 text-xs font-semibold text-destructive">Delete row · {keyLabel(change.primary_key)}</h3>
            <dl className="grid grid-cols-1 gap-1 font-mono text-xs sm:grid-cols-2">
              {columns.map((name) => <div key={name} className="flex min-w-0 gap-2"><dt className="truncate font-sans font-medium">{name}</dt><dd className="truncate">{show(change.original[name])}</dd></div>)}
            </dl>
          </section>
        ))}
        {!count && <p className="text-sm text-muted-foreground">There are no staged changes.</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="destructive" disabled={busy || !canConfirm || !count} onClick={onConfirm}>{busy ? 'Applying…' : 'Confirm and apply'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
