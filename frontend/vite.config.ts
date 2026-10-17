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
        runtimeCaching: [
          {
            urlPattern: /\/api\/notes/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'notes-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 24 * 60 * 60
              }
            }
          },
          {
            urlPattern: /\/api\/assignments/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'assignments-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 24 * 60 * 60
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8091',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8091',
        ws: true,
      },
    },
  },
})
