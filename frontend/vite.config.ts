import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/auth': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
      '/api/admin': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
      '/api/v1': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
        rewrite: path => path.replace(/^\/api/, '/api/v1'),
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src"
    }
  }
})
