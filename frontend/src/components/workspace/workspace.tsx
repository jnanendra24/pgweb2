import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Command, Database, FileCode2, Menu, Users } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { UserMenu } from '@/components/auth/user-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cacheConnection } from '@/hooks/use-connections'
import { useDatabases } from '@/hooks/use-schema'
import { useIsMobile } from '@/hooks/use-media-query'
import { api } from '@/lib/api'
import type { ConnectionRead, User } from '@/lib/types'
import { useActive } from '@/stores/connections'
import { useConnWorkspace, useWorkspace } from '@/stores/workspace'
import { CommandPalette } from './command-palette'
import { Explorer } from './explorer'
import { TabsBar } from './tabs-bar'

// CodeMirror and the SQL formatter are heavy; load them when the first tab opens.
const QueryTab = lazy(() => import('./query-tab').then((m) => ({ default: m.QueryTab })))
const TableView = lazy(() => import('./table-view').then((m) => ({ default: m.TableView })))

function EmptyState({ connId }: { connId: string }) {
  const openQuery = useWorkspace((s) => s.openQuery)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <Database className="size-9" />
      <div>
        <p className="font-medium text-foreground">Pick a table to browse</p>
        <p className="text-sm">…or start with a SQL query.</p>
      </div>
      <Button variant="outline" onClick={() => openQuery(connId)}>
        <FileCode2 /> New query
      </Button>
      <p className="hidden text-xs sm:block">
        Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd> to jump anywhere
      </p>
    </div>
  )
}

export function Workspace({ conn, me }: { conn: ConnectionRead; me: User }) {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const setActive = useActive((s) => s.setActive)
  const { tabs, activeId } = useConnWorkspace(conn.id)
  const databases = useDatabases(conn.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const switchDb = useMutation({
    mutationFn: (db: string) => api.switchDatabase(conn.id, db),
    onSuccess: (c) => {
      cacheConnection(qc, c)
      setActive(c.id)
      toast.success(`Switched to ${c.database}`)
    },
    onError: (e) => toast.error(e.message),
  })

  const openTx = tabs.some((t) => t.kind === 'query' && t.txId)
  const leave = () => {
    if (openTx && !window.confirm('You have an open transaction. It stays open on the server (and auto-rolls back when idle) if you leave. Leave anyway?')) return
    setActive(null)
  }

  // A reload keeps the transaction alive on the server, but make it hard to do by accident.
  useEffect(() => {
    if (!openTx) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [openTx])

  const active = tabs.find((t) => t.id === activeId)

  const main = (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <TabsBar connId={conn.id} />
      <div className="min-h-0 flex-1">
        {/* Keyed by tab so each tab keeps its own page / sort / results while open. */}
        <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground">Loading…</div>}>
        {active?.kind === 'table' ? (
          <TableView key={active.id} connId={conn.id} schema={active.schema} table={active.table} />
        ) : active?.kind === 'query' ? (
          <QueryTab key={active.id} connId={conn.id} tab={active} readOnly={conn.read_only} />
        ) : (
          <EmptyState connId={conn.id} />
        )}
        </Suspense>
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        {isMobile && (
          <Button variant="ghost" size="icon" aria-label="Open explorer" onClick={() => setMenuOpen(true)}>
            <Menu />
          </Button>
        )}
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground max-sm:hidden">
          <Database className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium">{conn.name}</span>
          <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:block">
            {conn.user}@{conn.host}:{conn.port}
          </span>
        </div>
        {conn.read_only ? (
          <Badge variant="secondary" className="hidden sm:inline-flex">Read-only</Badge>
        ) : (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">R/W</Badge>
        )}
        {conn.shared && (
          <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
            <Users className="size-3" /> Team
          </Badge>
        )}

        <Select value={conn.database} onValueChange={(v) => v && v !== conn.database && switchDb.mutate(v)} disabled={switchDb.isPending}>
          <SelectTrigger size="sm" className="ml-1 max-w-[150px] min-w-[96px] sm:max-w-[220px]" aria-label="Database">
            <Database className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(databases.data ?? [conn.database]).map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="outline" size="sm" className="hidden w-48 justify-start text-muted-foreground md:inline-flex" onClick={() => setPaletteOpen(true)}>
            <Command /> Search…
            <kbd className="ml-auto font-mono text-[10px]">⌘K</kbd>
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
            <Command />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Switch connection" title="Switch connection" onClick={leave}>
            <ArrowLeftRight />
          </Button>
          <ThemeToggle />
          <UserMenu me={me} />
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {isMobile ? (
          <>
            {main}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetContent side="left" className="w-[85vw] max-w-sm gap-0 p-0" showCloseButton={false}>
                <SheetTitle className="sr-only">Explorer</SheetTitle>
                <Explorer connId={conn.id} onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="22%" minSize="14%" maxSize="40%">
              <Explorer connId={conn.id} />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="78%" minSize="40%">
              {main}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <CommandPalette connId={conn.id} open={paletteOpen} onOpenChange={setPaletteOpen} onDisconnect={leave} />
    </div>
  )
}
