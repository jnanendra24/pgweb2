import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Database, Loader2, Lock, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { UserMenu } from '@/components/auth/user-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useConnectionList } from '@/hooks/use-connections'
import { api } from '@/lib/api'
import type { ConnectionRead, User } from '@/lib/types'
import { useActive } from '@/stores/connections'
import { useWorkspace } from '@/stores/workspace'
import { ConnectionDialog } from './connection-form'
import { EditConnectionDialog } from './edit-connection-dialog'

export function ConnectionsScreen({ me }: { me: User }) {
  const qc = useQueryClient()
  const setActive = useActive((s) => s.setActive)
  const dropWorkspace = useWorkspace((s) => s.dropConnection)
  const { data: connections, isLoading, error } = useConnectionList()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ConnectionRead | null>(null)
  const isAdmin = me.role === 'admin'

  const remove = useMutation({
    mutationFn: (c: ConnectionRead) => api.deleteConnection(c.id),
    onSuccess: (_, c) => {
      dropWorkspace(c.id)
      qc.invalidateQueries({ queryKey: ['connections'] })
      toast(`Deleted "${c.name}"`)
    },
    onError: (e) => toast.error(e.message),
  })

  const confirmDelete = (c: ConnectionRead) => {
    const who = c.shared ? ' for the whole team' : ''
    if (window.confirm(`Delete "${c.name}"${who}? Its stored credentials are removed from the server.`)) remove.mutate(c)
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-8 sm:py-14">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Database className="size-5" />
          </div>
          <div>
            <h1 className="text-lg leading-tight font-semibold">pgweb2</h1>
            <p className="text-sm text-muted-foreground">PostgreSQL in your browser</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu me={me} />
        </div>
      </header>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Connections</h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus /> New connection
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[62px] w-full rounded-xl" />
          <Skeleton className="h-[62px] w-full rounded-xl" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : connections?.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <Database className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No connections yet</p>
            <p className="text-sm text-muted-foreground">Add a PostgreSQL server, or ask an admin to share one with the team.</p>
          </div>
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add connection
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {connections?.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40">
              <button type="button" onClick={() => setActive(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                  <Database className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.read_only ? (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="size-3" /> Read-only
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Read / write</Badge>
                    )}
                    {c.shared && (
                      <Badge variant="outline" className="gap-1">
                        <Users className="size-3" /> Team
                      </Badge>
                    )}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {c.user}@{c.host}:{c.port}/{c.database}
                  </p>
                </div>
              </button>
              {c.can_manage && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${c.name}`} disabled={remove.isPending} />}>
                    {remove.isPending && remove.variables?.id === c.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(c)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => confirmDelete(c)}>
                      <Trash2 /> Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConnectionDialog open={adding} onOpenChange={setAdding} onCreated={(c) => setActive(c.id)} isAdmin={isAdmin} />
      {editing && <EditConnectionDialog key={editing.id} conn={editing} isAdmin={isAdmin} onClose={() => setEditing(null)} />}
    </div>
  )
}
