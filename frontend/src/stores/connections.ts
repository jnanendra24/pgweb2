import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Connections now live on the server (per user). The browser only remembers which one was open.
interface ActiveState {
  activeId: string | null
  setActive: (id: string | null) => void
}

export const useActive = create<ActiveState>()(
  persist((set) => ({ activeId: null, setActive: (activeId) => set({ activeId }) }), { name: 'pgweb2.active' }),
)
