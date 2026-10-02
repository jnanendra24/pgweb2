import { FileCode2, LogOut, Moon, Table2 } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useEffect } from 'react'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { useTables } from '@/hooks/use-schema'
import { useWorkspace } from '@/stores/workspace'

interface Props {
  connId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onDisconnect: () => void
}

export function CommandPalette({ connId, open, onOpenChange, onDisconnect }: Props) {
  const { data: tables } = useTables(connId)
  const { openTable, openQuery } = useWorkspace()
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a table or run an action">
      <Command>
      <CommandInput placeholder="Jump to table or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(() => openQuery(connId))}>
            <FileCode2 /> New query
          </CommandItem>
          <CommandItem onSelect={run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}>
            <Moon /> Toggle theme
          </CommandItem>
          <CommandItem onSelect={run(onDisconnect)}>
            <LogOut /> Switch connection
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Tables">
          {tables?.map((t) => (
            <CommandItem key={`${t.schema_name}.${t.name}`} value={`${t.schema_name}.${t.name}`} onSelect={run(() => openTable(connId, t.schema_name, t.name))}>
              <Table2 />
              <span className="truncate">{t.name}</span>
              <CommandShortcut>{t.schema_name}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
