import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'asdfbase - Collaboration Workspace',
        short_name: 'asdfbase',
        description: '学校生活・共同作業のためのサイバーダーク・ワークスペース',
        theme_color: '#090A0C',
        background_color: '#090A0C',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        // API はキャッシュしない (古いメモ等が表示されるのを防ぐ)
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://api-asdf.rds9.net',
        changeOrigin: true,
        secure: true,
      },
      '/ws': {
        target: 'wss://api-asdf.rds9.net',
        changeOrigin: true,
        ws: true,
        secure: true,
      },
    },
  },
})
