import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudflare Tunnel URL or VPS API Target
const BACKEND_TARGET = process.env.BACKEND_TARGET || process.env.BACKEND_INTERNAL_URL || 'https://api-asdf.rds9.net';

console.log(`[Render Proxy Server] Proxy target: ${BACKEND_TARGET}`);

// 1. API Reverse Proxy (Preserve /api prefix)
const apiProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  secure: true,
  pathFilter: '/api/**',
  proxyTimeout: 30000,
  timeout: 30000,
  headers: {
    'Connection': 'keep-alive',
  },
  // http-proxy-middleware v3+ uses `on: { error }` (legacy `onError` is ignored)
  on: {
    error: (err, req, res) => {
      console.error('[API Proxy Error]', err.message);
      if (res && typeof res.status === 'function' && !res.headersSent) {
        res.status(502).json({ error: 'バックエンドAPIプロキシ通信エラー (502 Bad Gateway)' });
      }
    },
  },
});
app.use(apiProxy);

// 2. Uploads Reverse Proxy (Preserve /uploads prefix)
const uploadsProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  secure: true,
  pathFilter: '/uploads/**',
  proxyTimeout: 60000,
  timeout: 60000,
  headers: {
    'Connection': 'keep-alive',
  },
  on: {
    error: (err, req, res) => {
      console.error('[Uploads Proxy Error]', err.message);
      if (res && typeof res.status === 'function' && !res.headersSent) {
        res.status(502).json({ error: '画像プロキシ通信エラー' });
      }
    },
  },
});
app.use(uploadsProxy);

// 3. WebSocket Reverse Proxy (/ws)
const wsProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  ws: true,
  secure: true,
  pathFilter: '/ws',
  proxyTimeout: 3600000,
  timeout: 3600000,
  on: {
    error: (err, req, socket) => {
      console.error('[WS Proxy Error]', err.message);
      // Destroy the client socket so the browser gets onclose immediately and reconnects
      if (socket && typeof socket.destroy === 'function') socket.destroy();
    },
  },
});
app.use(wsProxy);

// 4. Static Files (Vite Production Build)
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// 5. SPA Fallback (compatible with Express 5)
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Render Proxy Server] Serving frontend & proxy on port ${PORT}`);
});

server.on('upgrade', wsProxy.upgrade);

// Keep long-lived sockets (WebSocket) from being cut by Node's default timeouts
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0;
