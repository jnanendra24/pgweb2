import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tab =
  | { id: string; kind: 'table'; schema: string; table: string }
  // txId: a manual transaction this tab holds open on the server (re-attached after a reload)
  | { id: string; kind: 'query'; title: string; sql: string; txId?: string }

interface ConnWorkspace {
  tabs: Tab[]
  activeId: string | null
}

interface WorkspaceState {
  byConn: Record<string, ConnWorkspace>
  openTable: (connId: string, schema: string, table: string) => void
  openQuery: (connId: string, sql?: string) => void
  closeTab: (connId: string, tabId: string) => void
  closeOthers: (connId: string, tabId: string) => void
  setActive: (connId: string, tabId: string) => void
  setSql: (connId: string, tabId: string, sql: string) => void
  setTx: (connId: string, tabId: string, txId: string | null) => void
  dropConnection: (connId: string) => void
}

const EMPTY: ConnWorkspace = { tabs: [], activeId: null }
let seq = 0
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => {
      const patch = (connId: string, fn: (w: ConnWorkspace) => ConnWorkspace) =>
        set((s) => ({ byConn: { ...s.byConn, [connId]: fn(s.byConn[connId] ?? EMPTY) } }))

      return {
        byConn: {},
        openTable: (connId, schema, table) =>
          patch(connId, (w) => {
            const id = `t:${schema}.${table}`
            return w.tabs.some((t) => t.id === id)
              ? { ...w, activeId: id }
              : { tabs: [...w.tabs, { id, kind: 'table', schema, table }], activeId: id }
          }),
        openQuery: (connId, sql = '') =>
          patch(connId, (w) => {
            const n = w.tabs.filter((t) => t.kind === 'query').length + 1
            const id = `q:${newId()}`
            return { tabs: [...w.tabs, { id, kind: 'query', title: `Query ${n}`, sql }], activeId: id }
          }),
        closeTab: (connId, tabId) =>
          patch(connId, (w) => {
            const i = w.tabs.findIndex((t) => t.id === tabId)
            const tabs = w.tabs.filter((t) => t.id !== tabId)
            const activeId = w.activeId === tabId ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : w.activeId
            return { tabs, activeId }
          }),
        closeOthers: (connId, tabId) =>
          patch(connId, (w) => ({ tabs: w.tabs.filter((t) => t.id === tabId), activeId: tabId })),
        setActive: (connId, tabId) => patch(connId, (w) => ({ ...w, activeId: tabId })),
        setSql: (connId, tabId, sql) =>
          patch(connId, (w) => ({
            ...w,
            tabs: w.tabs.map((t) => (t.id === tabId && t.kind === 'query' ? { ...t, sql } : t)),
          })),
        setTx: (connId, tabId, txId) =>
          patch(connId, (w) => ({
            ...w,
            tabs: w.tabs.map((t) => (t.id === tabId && t.kind === 'query' ? { ...t, txId: txId ?? undefined } : t)),
          })),
        dropConnection: (connId) =>
          set((s) => {
            const { [connId]: _, ...rest } = s.byConn
            return { byConn: rest }
          }),
      }
    },
    { name: 'pgweb2.workspace' },
  ),
)

export const useConnWorkspace = (connId: string) => useWorkspace((s) => s.byConn[connId] ?? EMPTY)
