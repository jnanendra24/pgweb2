import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/lib/theme'

interface Props {
  value: string
  onChange: (v: string) => void
  /** Called with the selected text, or the whole buffer when nothing is selected. */
  onRun: (sql: string) => void
  /** schema -> table -> columns */
  schema: Record<string, Record<string, string[]>>
  className?: string
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--muted-foreground)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)' },
  '.cm-tooltip': { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--popover)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
})

export function SqlEditor({ value, onChange, onRun, schema, className }: Props) {
  const { resolvedTheme } = useTheme()
  const runRef = useRef(onRun)
  useEffect(() => {
    runRef.current = onRun
  })

  const extensions = useMemo(() => {
    // lang-sql nests dotted keys: "public.users" completes as users once `public.` is typed.
    const flat: Record<string, string[]> = {}
    for (const [s, tables] of Object.entries(schema)) for (const [t, cols] of Object.entries(tables)) flat[`${s}.${t}`] = cols
    return [
      sql({ dialect: PostgreSQL, schema: flat, defaultSchema: 'public', upperCaseKeywords: true }),
      theme,
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: (view) => {
              const sel = view.state.selection.main
              runRef.current(sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to))
              return true
            },
          },
        ]),
      ),
    ]
  }, [schema])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      height="100%"
      className={className}
      placeholder="SELECT * FROM …   (⌘/Ctrl + Enter to run)"
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: true, autocompletion: true }}
    />
  )
}
