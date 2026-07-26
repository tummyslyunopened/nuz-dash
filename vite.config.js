import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4517',
      '/uploads': 'http://localhost:4517',
      '/emulatorjs': 'http://localhost:4517'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})
