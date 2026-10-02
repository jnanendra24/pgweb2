import { FileCode2, Plus, Table2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Tab } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { useConnWorkspace, useWorkspace } from '@/stores/workspace'

export function TabsBar({ connId }: { connId: string }) {
  const { tabs, activeId } = useConnWorkspace(connId)
  const { setActive, closeTab, openQuery } = useWorkspace()
  const activeRef = useRef<HTMLDivElement>(null)

  const close = async (t: Tab) => {
    if (t.kind === 'query' && t.txId) {
      if (!window.confirm('This tab has an open transaction. Close it and roll the transaction back?')) return
      await api.rollback(t.txId).catch(() => undefined) // already gone is fine
      toast('Transaction rolled back')
    }
    closeTab(connId, t.id)
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <div className="flex shrink-0 items-stretch border-b bg-muted/30">
      <div role="tablist" className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => {
          const active = t.id === activeId
          const Icon = t.kind === 'table' ? Table2 : FileCode2
          const label = t.kind === 'table' ? t.table : t.title
          return (
            <div
              key={t.id}
              ref={active ? activeRef : undefined}
              onAuxClick={(e) => e.button === 1 && close(t)}
              className={cn(
                'group relative flex h-10 shrink-0 items-center border-r text-sm',
                active ? 'bg-background font-medium' : 'text-muted-foreground hover:bg-accent/40',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
              <button
                role="tab"
                aria-selected={active}
                onClick={() => setActive(connId, t.id)}
                className="flex h-full max-w-[200px] items-center gap-1.5 pr-1 pl-3"
                title={t.kind === 'table' ? `${t.schema}.${t.table}` : t.title}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
              <button
                aria-label={`Close ${label}`}
                onClick={() => close(t)}
                className="mr-1.5 grid size-6 place-items-center rounded hover:bg-muted"
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>
      <Button variant="ghost" size="icon" className="m-1 shrink-0" aria-label="New query tab" onClick={() => openQuery(connId)}>
        <Plus />
      </Button>
    </div>
  )
}
