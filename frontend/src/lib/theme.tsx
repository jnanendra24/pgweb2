import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'
const KEY = 'pgweb2.theme'

const read = (): Theme => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

interface Ctx {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (t: Theme) => void
}
const ThemeContext = createContext<Ctx>({ theme: 'system', resolvedTheme: 'light', setTheme: () => {} })

// next-themes injects an inline <script>, which React 19 warns about; index.html carries the no-flash script instead.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read)
  const [sysDark, setSysDark] = useState(systemDark)
  const resolvedTheme = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSysDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* private mode: theme just won't persist */
    }
  }, [])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
