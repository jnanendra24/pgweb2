import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { TxInfo } from '@/lib/types'

export interface TxState {
  info: TxInfo
  /** When `info` was received, so the countdown can run locally between server updates. */
  at: number
}

export function useSecondsLeft(tx: TxState | null) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!tx) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [tx])
  return tx ? Math.max(0, tx.info.expires_in - Math.floor((now - tx.at) / 1000)) : 0
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

interface Props {
  tx: TxState
  secondsLeft: number
  busy: boolean
  onCommit: () => void
  onRollback: () => void
}

export function TxBar({ tx, secondsLeft, busy, onCommit, onRollback }: Props) {
  const n = tx.info.statements
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <span className="size-2 animate-pulse rounded-full bg-amber-500" /> Transaction open
      </span>
      <span>
        {n} statement{n === 1 ? '' : 's'}
      </span>
      <span className={secondsLeft <= 60 ? 'font-medium text-destructive' : undefined}>auto-rollback in {fmt(secondsLeft)}</span>
      <span className="ml-auto flex gap-1.5">
        <Button variant="outline" size="xs" onClick={onRollback} disabled={busy}>
          Rollback
        </Button>
        <Button size="xs" onClick={onCommit} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Commit
        </Button>
      </span>
    </div>
  )
}
