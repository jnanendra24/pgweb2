import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import type { ConnectionRead, ConnectionUpdate } from '@/lib/types'

export function EditConnectionDialog({ conn, isAdmin, onClose }: { conn: ConnectionRead | null; isAdmin: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(conn?.name ?? '')
  const [password, setPassword] = useState('')
  const [shared, setShared] = useState(conn?.shared ?? false)
  const [readOnly, setReadOnly] = useState(conn?.read_only ?? true)

  const save = useMutation({
    mutationFn: () => {
      const patch: ConnectionUpdate = {}
      if (name.trim() && name.trim() !== conn!.name) patch.name = name.trim()
      if (shared !== conn!.shared) patch.shared = shared
      if (readOnly !== conn!.read_only) patch.read_only = readOnly
      if (password) patch.password = password
      return api.updateConnection(conn!.id, patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      onClose()
    },
  })

  return (
    <Dialog open={!!conn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {conn && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Edit connection</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {conn.user}@{conn.host}:{conn.port}/{conn.database}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ename">Name</Label>
              <Input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="epw">New database password</Label>
              <Input id="epw" type="password" autoComplete="new-password" placeholder="Leave blank to keep the current one" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="ero">Read-only</Label>
                <p className="text-xs text-muted-foreground">Turn off to allow writes and transactions.</p>
              </div>
              <Switch id="ero" checked={readOnly} onCheckedChange={setReadOnly} />
            </div>
            {(isAdmin || conn.shared) && (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="eshared">Share with team</Label>
                  <p className="text-xs text-muted-foreground">{isAdmin ? 'Everyone can use it; only admins can change it.' : 'Only admins can share a connection.'}</p>
                </div>
                <Switch id="eshared" checked={shared} disabled={!isAdmin && !conn.shared} onCheckedChange={setShared} />
              </div>
            )}
            {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />} Save
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
