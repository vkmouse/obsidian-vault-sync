import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), cloudflare()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 11000,
    // Docker volume 需要 polling 才能穩定偵測到檔案變更
    watch: {
      usePolling: true,
    },
    // 讓 host 瀏覽器可以連上 HMR
    hmr: {
      host: 'localhost',
      port: 11000,
      clientPort: 11000,
    },
  },
})
