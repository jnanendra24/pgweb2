export const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`
export const qualified = (schema: string, table: string) => `${quoteIdent(schema)}.${quoteIdent(table)}`

/** Parse postgres://user:pass@host:port/db?sslmode=require into form fields. Returns null if it isn't a URL. */
export function parseConnectionUrl(input: string) {
  try {
    const u = new URL(input.trim())
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null
    const ssl = u.searchParams.get('sslmode')
    return {
      host: decodeURIComponent(u.hostname),
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      ssl_mode: (['disable', 'prefer', 'require', 'verify-ca', 'verify-full'] as const).find((m) => m === ssl),
    }
  } catch {
    return null
  }
}

export const formatCount = (n: number | null | undefined) =>
  n == null ? '' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export function toCsv(columns: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
