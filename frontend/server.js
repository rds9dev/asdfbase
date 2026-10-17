import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudflare Tunnel URL or VPS API Target
// (e.g. https://api-asdf.rds9.net)
const BACKEND_TARGET = process.env.BACKEND_TARGET || process.env.BACKEND_INTERNAL_URL || 'https://api-asdf.rds9.net';

console.log(`[Render Proxy Server] Proxy target: ${BACKEND_TARGET}`);

// 1. API Reverse Proxy
app.use(
  '/api',
  createProxyMiddleware({
    target: BACKEND_TARGET,
    changeOrigin: true,
    secure: true,
    ws: false,
    logLevel: 'warn',
    onProxyReq: (proxyReq) => {
      // Clean headers if necessary
      proxyReq.setHeader('x-forwarded-host', new URL(BACKEND_TARGET).host);
    },
  })
);

// 2. Uploads Reverse Proxy
app.use(
  '/uploads',
  createProxyMiddleware({
    target: BACKEND_TARGET,
    changeOrigin: true,
    secure: true,
  })
);

// 3. WebSocket Reverse Proxy (/ws)
const wsProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  ws: true,
  secure: true,
  logLevel: 'warn',
});
app.use('/ws', wsProxy);

// 4. Static Files (Vite Production Build)
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// 5. SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Render Proxy Server] Serving frontend & proxy on port ${PORT}`);
});

server.on('upgrade', wsProxy.upgrade);
