import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, GitCommitHorizontal, Loader2, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { format } from 'sql-formatter'
import { SqlEditor } from '@/components/editor/sql-editor'
import { ErrorBox, ExportMenu, ResultBody } from '@/components/grid/result-pane'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCompletionSchema } from '@/hooks/use-schema'
import { useIsMobile } from '@/hooks/use-media-query'
import { api, ApiError } from '@/lib/api'
import type { QueryResult, TxQueryResult } from '@/lib/types'
import { useWorkspace, type Tab } from '@/stores/workspace'
import { TxBar, useSecondsLeft, type TxState } from './tx-bar'

const LIMITS = ['100', '500', '1000', '5000', '10000']

interface Props {
  connId: string
  tab: Extract<Tab, { kind: 'query' }>
  readOnly: boolean
}

export function QueryTab({ connId, tab, readOnly }: Props) {
  const qc = useQueryClient()
  const setSql = useWorkspace((s) => s.setSql)
  const setTxId = useWorkspace((s) => s.setTx)
  const schema = useCompletionSchema(connId)
  const isMobile = useIsMobile()
  const [limit, setLimit] = useState('1000')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tx, setTx] = useState<TxState | null>(null)
  const secondsLeft = useSecondsLeft(tx)

  const txEnded = (message: string) => {
    setTx(null)
    setTxId(connId, tab.id, null)
    toast.warning(message)
  }

  // Re-attach to a transaction this tab opened before a reload or tab switch (it lives on the server).
  useEffect(() => {
    if (!tab.txId) return
    let alive = true
    api
      .listTransactions()
      .then((list) => {
        if (!alive) return
        const info = list.find((t) => t.id === tab.txId)
        if (info) setTx({ info, at: Date.now() })
        else txEnded('Your transaction ended and was rolled back (it sat idle for too long).')
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The server rolls back idle transactions; notice when that happens instead of failing on the next Run.
  useEffect(() => {
    if (!tx || secondsLeft > 0) return
    api.listTransactions().then((list) => {
      const info = list.find((t) => t.id === tx.info.id)
      if (info) setTx({ info, at: Date.now() })
      else txEnded('Your transaction was rolled back because it sat idle for too long.')
    }, () => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft === 0 && !!tx])

  const begin = useMutation({
    mutationFn: () => api.beginTransaction(connId),
    onSuccess: (info) => {
      setTx({ info, at: Date.now() })
      setTxId(connId, tab.id, info.id)
    },
    onError: (e) => toast.error(e.message),
  })

  const finish = useMutation({
    mutationFn: (commit: boolean) => (commit ? api.commit(tx!.info.id) : api.rollback(tx!.info.id)).then(() => commit),
    onSuccess: (committed) => {
      setTx(null)
      setTxId(connId, tab.id, null)
      toast.success(committed ? 'Transaction committed' : 'Transaction rolled back')
      // Browsed tables are on other connections, so they only change once the commit lands.
      qc.invalidateQueries({ queryKey: ['rows', connId] })
      qc.invalidateQueries({ queryKey: ['tables', connId] })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 404) txEnded('That transaction had already ended.')
      else {
        // A failed COMMIT rolls everything back server-side.
        setTx(null)
        setTxId(connId, tab.id, null)
        toast.error(e.message)
      }
    },
  })

  const run = useMutation({
    mutationFn: (sql: string): Promise<QueryResult | TxQueryResult> => (tx ? api.txQuery(tx.info.id, sql, Number(limit)) : api.runQuery(connId, sql, Number(limit))),
    onSuccess: (r) => {
      setResult(r)
      setError(null)
      if ('tx' in r) setTx({ info: r.tx, at: Date.now() })
    },
    onError: (e) => {
      setResult(null)
      if (tx && e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        txEnded(e.status === 409 ? e.message : 'Your transaction ended and was rolled back.')
        setError(null)
      } else {
        setError(e instanceof ApiError ? e.message : String(e))
        // Statement errors don't end a transaction, but the server's idea of the count is stale until the next success.
      }
    },
  })

  const exec = (sql: string) => sql.trim() && !run.isPending && run.mutate(sql)

  const prettify = () => {
    try {
      setSql(connId, tab.id, format(tab.sql, { language: 'postgresql', keywordCase: 'upper' }))
    } catch (e) {
      setError(`Could not format: ${e instanceof Error ? e.message : e}`)
    }
  }

  const editor = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Button size="sm" onClick={() => exec(tab.sql)} disabled={run.isPending || !tab.sql.trim()}>
          {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run
        </Button>
        <Button variant="ghost" size="sm" onClick={prettify} disabled={!tab.sql.trim()} aria-label="Format SQL">
          <AlignLeft /> <span className="hidden sm:inline">Format</span>
        </Button>
        {!tx && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => begin.mutate()}
            disabled={readOnly || begin.isPending}
            aria-label="Begin transaction"
            title={readOnly ? 'This connection is read-only. Edit it to allow writes and transactions.' : 'Run statements in a transaction you commit or roll back yourself'}
          >
            {begin.isPending ? <Loader2 className="animate-spin" /> : <GitCommitHorizontal />}
            <span className="hidden sm:inline">Begin transaction</span>
            <span className="sm:hidden">Tx</span>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Limit</span>
          <Select value={limit} onValueChange={(v) => v && setLimit(v)}>
            <SelectTrigger size="sm" className="w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMITS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {tx && <TxBar tx={tx} secondsLeft={secondsLeft} busy={finish.isPending || run.isPending} onCommit={() => finish.mutate(true)} onRollback={() => finish.mutate(false)} />}
      <SqlEditor
        value={tab.sql}
        onChange={(v) => setSql(connId, tab.id, v)}
        onRun={exec}
        schema={schema}
        className="min-h-0 flex-1 overflow-hidden"
      />
    </div>
  )

  const results = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs text-muted-foreground">
        {run.isPending ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" /> Running…
          </span>
        ) : result ? (
          <>
            {result.columns.length > 0 && (
              <span>
                <b className="text-foreground">{result.rows.length.toLocaleString()}</b> rows
              </span>
            )}
            <span>{result.duration_ms} ms</span>
            {result.status && <span className="font-mono">{result.status}</span>}
            <span className="ml-auto">
              <ExportMenu result={result} name={tab.title.toLowerCase().replace(/\s+/g, '-')} />
            </span>
          </>
        ) : (
          <span>Results appear here</span>
        )}
      </div>
      {error && (
        <>
          <ErrorBox message={error} />
          {tx && <p className="-mt-1 px-4 pb-2 text-xs text-muted-foreground">That statement was rolled back. The transaction is still open.</p>}
        </>
      )}
      {result && <ResultBody result={result} warnTruncated />}
    </div>
  )

  return isMobile ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="h-[40%] min-h-[200px] border-b">{editor}</div>
      <div className="min-h-0 flex-1">{results}</div>
    </div>
  ) : (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize="40%" minSize="15%">
        {editor}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="60%" minSize="15%">
        {results}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
