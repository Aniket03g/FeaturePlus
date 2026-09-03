import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The app is served from /app both in development and once embedded in the Go
// binary, so asset URLs resolve the same either way.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Built straight into the backend, where go:embed picks it up.
    outDir: '../backend/web/dist',
    emptyOutDir: true,
    // Source maps are omitted because dist/ is committed for go:embed; a
    // 700 kB map per build would dominate the diff.
    sourcemap: false,
  },
  server: {
    port: 5173,
    // In development Vite serves the app and forwards API calls to the Go
    // server, so the session cookie stays same-origin and simply works.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
})
