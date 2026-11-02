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
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^\/uploads\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'uploads-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.discordapp\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'discord-cdn-cache',
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 3 * 24 * 60 * 60, // 3 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
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
