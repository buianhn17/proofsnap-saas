import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
// Chỉ dùng trong Codespaces: FE và BE chung 1 origin qua proxy để cookie hoạt động
export default mergeConfig(base, defineConfig({
  server: {
    host: true,
    allowedHosts: ['.app.github.dev'],
    proxy: { '/api': 'http://localhost:3000', '/api-docs': 'http://localhost:3000' },
  },
}))
