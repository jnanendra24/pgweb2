import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ConnectionRead } from '@/lib/types'

export const useConnectionList = (enabled = true) =>
  useQuery({ queryKey: ['connections'], queryFn: api.listConnections, staleTime: 15_000, enabled })

/** Put a just-created connection in the cache right away, so the UI can open it before the refetch lands. */
export function cacheConnection(qc: QueryClient, c: ConnectionRead) {
  qc.setQueryData<ConnectionRead[]>(['connections'], (old = []) => (old.some((x) => x.id === c.id) ? old : [...old, c]))
  qc.invalidateQueries({ queryKey: ['connections'] })
}
