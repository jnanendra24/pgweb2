import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { LoginScreen } from '@/components/auth/login-screen'
import { ConnectionsScreen } from '@/components/connections/connections-screen'
import { Workspace } from '@/components/workspace/workspace'
import { useConnectionList } from '@/hooks/use-connections'
import { api, ApiError, onUnauthenticated } from '@/lib/api'
import { useActive } from '@/stores/connections'

const Splash = () => (
  <div className="grid h-dvh place-items-center text-muted-foreground">
    <Loader2 className="size-6 animate-spin" />
  </div>
)

export default function App() {
  const qc = useQueryClient()
  const { activeId, setActive } = useActive()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me().catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    staleTime: Infinity,
    retry: false,
  })

  // The session can end while the app is open (idle timeout, deactivated, signed out elsewhere).
  useEffect(
    () =>
      onUnauthenticated(() => {
        qc.clear()
        qc.setQueryData(['me'], null)
      }),
    [qc],
  )

  const signedIn = !!me.data
  const connections = useConnectionList(signedIn)
  const active = connections.data?.find((c) => c.id === activeId)

  // A remembered connection that's gone (deleted, unshared) shouldn't strand the user on a splash screen.
  useEffect(() => {
    if (signedIn && activeId && connections.data && !connections.isFetching && !active) setActive(null)
  }, [signedIn, activeId, connections.data, connections.isFetching, active, setActive])

  if (me.isLoading) return <Splash />
  if (me.error) return <div className="grid h-dvh place-items-center p-6 text-center text-sm text-destructive">Can't reach the server: {me.error.message}</div>
  if (!me.data) return <LoginScreen />
  if (activeId && connections.isLoading) return <Splash />
  if (!active) return <ConnectionsScreen me={me.data} />
  return <Workspace key={active.id} conn={active} me={me.data} />
}
