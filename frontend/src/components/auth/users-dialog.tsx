import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import type { Role, User } from '@/lib/types'

function AddUser({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: '', name: '', password: '', role: 'member' as Role })
  const create = useMutation({
    mutationFn: () => api.createUser(f),
    onSuccess: (u) => {
      toast.success(`Created ${u.email}. Share the password with them securely.`)
      onDone()
    },
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Email" type="email" required autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input placeholder="Name (optional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="Temporary password (10+ chars)" type="text" autoComplete="off" required minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Select value={f.role} onValueChange={(v) => v && setF({ ...f, role: v as Role })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">member</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />} Create user
        </Button>
      </div>
    </form>
  )
}

export function UsersDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: User }) {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers, enabled: open })
  const [adding, setAdding] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateUser>[1] }) => api.updateUser(id, patch),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })

  const resetPassword = (u: User) => {
    const pw = window.prompt(`New temporary password for ${u.email} (10+ characters). They will be signed out everywhere.`)
    if (pw) update.mutate({ id: u.id, patch: { password: pw } }, { onSuccess: () => toast.success('Password reset') })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Team members</DialogTitle>
          <DialogDescription>
            Admins manage users and can share connections with the team. Deactivating someone signs them out immediately.
          </DialogDescription>
        </DialogHeader>
        {adding ? (
          <AddUser
            onDone={() => {
              setAdding(false)
              refresh()
            }}
          />
        ) : (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAdding(true)}>
              <UserPlus /> Add user
            </Button>
          </div>
        )}
        <ul className="divide-y rounded-lg border">
          {users.isLoading && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
          {users.data?.map((u) => {
            const self = u.id === me.id
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{u.name || u.email}</span>
                    {self && <Badge variant="outline">you</Badge>}
                    {!u.is_active && <Badge variant="secondary">deactivated</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.name ? `${u.email} · ` : ''}
                    {u.last_login_at ? `last sign-in ${new Date(u.last_login_at).toLocaleString()}` : 'never signed in'}
                  </p>
                </div>
                <Select value={u.role} disabled={self} onValueChange={(v) => v && v !== u.role && update.mutate({ id: u.id, patch: { role: v as Role } })}>
                  <SelectTrigger size="sm" className="w-[100px]" aria-label={`Role for ${u.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">member</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={u.is_active} disabled={self} aria-label={`Active: ${u.email}`} onCheckedChange={(v) => update.mutate({ id: u.id, patch: { is_active: v } })} />
                  Active
                </label>
                <Button variant="ghost" size="icon-sm" aria-label={`Reset password for ${u.email}`} onClick={() => resetPassword(u)}>
                  <KeyRound />
                </Button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
