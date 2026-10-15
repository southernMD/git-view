import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { gitServicePlugin } from './server/vitePluginGit.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), gitServicePlugin()],
  server: {
    port: 5173,
    host: true
  }
})

