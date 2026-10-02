import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { ErrorBox } from '@/components/grid/result-pane'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useColumns } from '@/hooks/use-schema'
import { api } from '@/lib/api'

const CONSTRAINT_LABEL = { primary_key: 'PRIMARY KEY', foreign_key: 'FOREIGN KEY', unique: 'UNIQUE', check: 'CHECK', exclusion: 'EXCLUDE', trigger: 'TRIGGER' } as const

function useStructure(connId: string, schema: string, table: string) {
  return useQuery({
    queryKey: ['structure', connId, schema, table],
    queryFn: () => api.tableStructure(connId, schema, table),
    staleTime: 60_000,
  })
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {title}
        {count !== undefined && <span className="text-xs font-normal text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

export function StructureView({ connId, schema, table }: { connId: string; schema: string; table: string }) {
  const cols = useColumns(connId, schema, table)
  const structure = useStructure(connId, schema, table)
  const indexes = structure.data?.indexes
  const constraints = structure.data?.constraints

  return (
    <div className="h-full space-y-6 overflow-auto p-3 sm:p-4">
      <Section title="Columns" count={cols.data?.length}>
        {cols.error && <ErrorBox message={cols.error.message} />}
        {cols.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Nullable</th>
                  <th className="px-3 py-2 font-medium">Default</th>
                </tr>
              </thead>
              <tbody>
                {cols.data?.map((c, i) => (
                  <tr key={c.name} className="border-t">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-1.5">
                        {c.is_primary_key && <KeyRound className="size-3.5 text-amber-500" />}
                        {c.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{c.data_type}</td>
                    <td className="px-3 py-2">{c.nullable ? <span className="text-muted-foreground">yes</span> : <Badge variant="secondary">NOT NULL</Badge>}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 font-mono text-xs text-muted-foreground">{c.default ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Constraints" count={constraints?.length}>
        {structure.error ? (
          <p className="text-xs text-muted-foreground">Not available for this relation.</p>
        ) : (
          <ul className="space-y-1.5">
            {constraints?.map((c) => (
              <li key={c.name} className="rounded-lg border p-2.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {c.name} <Badge variant="outline">{CONSTRAINT_LABEL[c.type]}</Badge>
                </div>
                <code className="mt-1 block font-mono text-xs break-words text-muted-foreground">{c.definition}</code>
              </li>
            ))}
            {constraints?.length === 0 && <li className="text-xs text-muted-foreground">None</li>}
          </ul>
        )}
      </Section>

      <Section title="Indexes" count={indexes?.length}>
        {structure.error ? (
          <p className="text-xs text-muted-foreground">Not available for this relation.</p>
        ) : (
          <ul className="space-y-1.5">
            {indexes?.map((i) => (
              <li key={i.name} className="rounded-lg border p-2.5">
                <div className="text-sm font-medium">{i.name}</div>
                <code className="mt-1 block font-mono text-xs break-words text-muted-foreground">{i.definition}</code>
              </li>
            ))}
            {indexes?.length === 0 && <li className="text-xs text-muted-foreground">None</li>}
          </ul>
        )}
      </Section>
    </div>
  )
}
