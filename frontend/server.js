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
  logLevel: 'debug',
});
app.use(apiProxy);

// 2. Uploads Reverse Proxy (Preserve /uploads prefix)
const uploadsProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  secure: true,
  pathFilter: '/uploads/**',
  logLevel: 'warn',
});
app.use(uploadsProxy);

// 3. WebSocket Reverse Proxy (/ws)
const wsProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  ws: true,
  secure: true,
  pathFilter: '/ws',
  logLevel: 'warn',
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
