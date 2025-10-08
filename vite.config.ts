import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      // Anything under /api will be forwarded to your n8n server
      '/api': {
        target: 'http://localhost:5678', // <-- change to your n8n host if different
        changeOrigin: true,
        secure: false, // set true if your n8n endpoint has a valid HTTPS cert
        // /api/webhook/... -> http://localhost:5678/webhook/...
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
