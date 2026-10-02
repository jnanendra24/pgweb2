export type Kind = 'null' | 'number' | 'boolean' | 'json' | 'text'

const NUMERIC = /^(int|float|numeric|decimal|money|oid|serial)/

export function describe(v: unknown, type: string): { text: string; kind: Kind } {
  if (v === null || v === undefined) return { text: 'NULL', kind: 'null' }
  if (typeof v === 'boolean') return { text: String(v), kind: 'boolean' }
  if (typeof v === 'number') return { text: String(v), kind: 'number' }
  if (typeof v === 'object') return { text: JSON.stringify(v), kind: 'json' }
  // Decimals arrive as strings to keep precision; still right-align them.
  if (NUMERIC.test(type) && typeof v === 'string') return { text: v, kind: 'number' }
  return { text: String(v), kind: 'text' }
}

/** Full value for the inspector / clipboard: pretty-printed JSON when possible. */
export function fullText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  if (typeof v === 'string' && /^\s*[{[]/.test(v)) {
    try {
      return JSON.stringify(JSON.parse(v), null, 2)
    } catch {
      /* not JSON */
    }
  }
  return String(v)
}

export function compare(a: unknown, b: unknown): number {
  if (a == null) return b == null ? 0 : 1 // NULLs last, like Postgres ASC
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = Number(a)
  const nb = Number(b)
  if (typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

export function initialWidth(name: string, type: string, rows: unknown[][], i: number): number {
  let chars = Math.max(name.length + 3, type.length)
  for (const r of rows.slice(0, 50)) chars = Math.max(chars, describe(r[i], type).text.length)
  return Math.min(Math.max(chars * 7.5 + 28, 90), 360)
}
