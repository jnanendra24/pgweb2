import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useTheme } from '@/lib/theme'
import { useEffect, useMemo, useRef } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  table: string
  columns: string[]
}

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'hidden' },
  '.cm-content': { padding: '6px 0' },
  '.cm-tooltip': { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--popover)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
})

/** One-line WHERE clause editor that completes this table's column names and SQL keywords. */
export function FilterInput({ value, onChange, onSubmit, table, columns }: Props) {
  const { resolvedTheme } = useTheme()
  const submitRef = useRef(onSubmit)
  useEffect(() => {
    submitRef.current = onSubmit
  })

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: { [table]: columns }, defaultTable: table, upperCaseKeywords: true }),
      theme,
      Prec.highest(keymap.of([{ key: 'Enter', run: () => (submitRef.current(), true) }])),
    ],
    [table, columns],
  )

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      placeholder="status = 'active' AND id > 100"
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, autocompletion: true }}
      className="min-w-0 flex-1 text-[13px]"
    />
  )
}
