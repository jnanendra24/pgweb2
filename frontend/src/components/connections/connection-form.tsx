import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cacheConnection } from '@/hooks/use-connections'
import { api } from '@/lib/api'
import { parseConnectionUrl } from '@/lib/sql'
import type { ConnectionInput, ConnectionRead, SslMode } from '@/lib/types'

const SSL_MODES: SslMode[] = ['require', 'verify-full', 'verify-ca', 'prefer', 'disable']
const EMPTY: ConnectionInput = { name: '', host: '', port: 5432, database: '', user: '', password: '', ssl_mode: 'require', read_only: true, shared: false }

function Field({ label, children, className }: { label: string; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId()
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  )
}

export function ConnectionDialog({
  open,
  onOpenChange,
  onCreated,
  isAdmin,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (c: ConnectionRead) => void
  isAdmin: boolean
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<ConnectionInput>(EMPTY)
  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const create = useMutation({
    mutationFn: () => api.createConnection({ ...form, name: form.name.trim() || `${form.user}@${form.host}/${form.database}` }),
    onSuccess: (c) => {
      cacheConnection(qc, c)
      setForm(EMPTY)
      onOpenChange(false)
      onCreated(c)
    },
  })

  const onUrl = (v: string) => {
    const p = parseConnectionUrl(v)
    if (p) setForm((f) => ({ ...f, ...p, ssl_mode: p.ssl_mode ?? f.ssl_mode, name: f.name || `${p.host}/${p.database}` }))
  }

  const valid = form.host && form.database && form.user && form.password

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>New connection</DialogTitle>
            <DialogDescription>Credentials are verified, then stored encrypted on the server. They are never sent back to the browser.</DialogDescription>
          </DialogHeader>

          <Field label="Connection URL (optional)">
            {(id) => <Input id={id} placeholder="postgres://user:password@host:5432/dbname?sslmode=require" onChange={(e) => onUrl(e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>

          <div className="grid grid-cols-4 gap-3">
            <Field label="Name" className="col-span-4">
              {(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Production (read-only)" />}
            </Field>
            <Field label="Host" className="col-span-3">
              {(id) => <Input id={id} value={form.host} onChange={(e) => set('host', e.target.value)} autoCapitalize="none" spellCheck={false} />}
            </Field>
            <Field label="Port">
              {(id) => <Input id={id} type="number" inputMode="numeric" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />}
            </Field>
            <Field label="Database" className="col-span-4 sm:col-span-2">
              {(id) => <Input id={id} value={form.database} onChange={(e) => set('database', e.target.value)} autoCapitalize="none" spellCheck={false} />}
            </Field>
            <Field label="User" className="col-span-4 sm:col-span-2">
              {(id) => <Input id={id} value={form.user} onChange={(e) => set('user', e.target.value)} autoCapitalize="none" autoComplete="username" spellCheck={false} />}
            </Field>
            <Field label="Password" className="col-span-4 sm:col-span-2">
              {(id) => <Input id={id} type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="current-password" />}
            </Field>
            <Field label="SSL mode" className="col-span-4 sm:col-span-2">
              {(id) => (
                <Select value={form.ssl_mode} onValueChange={(v) => v && set('ssl_mode', v as SslMode)}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SSL_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="ro">Read-only</Label>
              <p className="text-xs text-muted-foreground">Every session runs with default_transaction_read_only. Recommended for production data.</p>
            </div>
            <Switch id="ro" checked={form.read_only} onCheckedChange={(v) => set('read_only', v)} />
          </div>

          {isAdmin && (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="shared">Share with team</Label>
                <p className="text-xs text-muted-foreground">Everyone can use this connection; only admins can change it. They never see the password.</p>
              </div>
              <Switch id="shared" checked={!!form.shared} onCheckedChange={(v) => set('shared', v)} />
            </div>
          )}

          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
