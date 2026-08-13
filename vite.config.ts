import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind loopback only; the dev server proxies /local-api to Express, which
    // signs requests with user-supplied AKSK — exposing this to the LAN would
    // turn any nearby device into a free signer/SSRF probe.
    host: '127.0.0.1',
    proxy: {
      '/local-api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/exports':   { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/api':       { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
