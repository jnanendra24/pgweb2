import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API sets a SameSite=strict refresh cookie, so in dev we proxy /api to keep everything same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8000' },
  },
})
