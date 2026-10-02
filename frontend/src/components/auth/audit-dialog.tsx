import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'

const ACTIONS = ['all', 'login', 'login_failed', 'query', 'browse', 'tx_begin', 'tx_query', 'tx_commit', 'tx_rollback', 'connection_create', 'connection_update', 'connection_delete', 'user_create', 'user_update']

export function AuditDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState('')
  const [action, setAction] = useState('all')
  const q = useInfiniteQuery({
    queryKey: ['audit', email.trim().toLowerCase(), action],
    enabled: open,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.listAudit({ before_id: pageParam, user_email: email.trim().toLowerCase(), action: action === 'all' ? undefined : action }),
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id : undefined),
  })
  const rows = q.data?.pages.flat() ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Audit log</DialogTitle>
          <DialogDescription>Who ran what, newest first. SQL text is recorded as typed and may contain sensitive values.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Filter by user email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select value={action} onValueChange={(v) => v && setAction(v)}>
            <SelectTrigger className="w-[190px]" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Connection</th>
                <th className="px-3 py-2 font-medium">Detail</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{r.user_email ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.error ? 'destructive' : 'secondary'}>{r.action}</Badge>
                  </td>
                  <td className="px-3 py-2">{r.connection_name ?? '—'}</td>
                  <td className="max-w-[360px] px-3 py-2 font-mono break-words whitespace-pre-wrap">
                    {r.detail?.slice(0, 400)}
                    {r.error && <span className="mt-1 block text-destructive">{r.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.row_count ?? ''}</td>
                </tr>
              ))}
              {!q.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nothing matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {q.hasNextPage && (
          <Button variant="outline" size="sm" className="self-center" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Load older
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
