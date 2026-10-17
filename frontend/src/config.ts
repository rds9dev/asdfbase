// Base API & WebSocket URL Configuration
// Smart Fallback Architecture:
// 1. Checks if same-origin reverse proxy (/api/health) is active (Render Web Service).
//    If active, uses relative path '' so browser NEVER sends traffic to external domains (bypasses i-FILTER).
// 2. If same-origin proxy is unavailable (e.g. static hosting on home PC, serve -s dist),
//    automatically falls back to VPS Cloudflare Tunnel (https://api-asdf.rds9.net).

export const REMOTE_API_BASE = 'https://api-asdf.rds9.net';
export let API_BASE_URL = '';

let activeApiBase = '';
let isResolved = false;

export async function detectApiBase(): Promise<string> {
  if (isResolved) return activeApiBase;

  // If already hosted directly on the API domain
  if (window.location.hostname === 'api-asdf.rds9.net') {
    activeApiBase = '';
    isResolved = true;
    return activeApiBase;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      if (data && data.status === 'ok') {
        activeApiBase = ''; // Same-origin proxy is active
        API_BASE_URL = '';
        isResolved = true;
        return activeApiBase;
      }
    }
  } catch {
    // Same-origin proxy not reachable
  }

  // Fallback to direct VPS tunnel for home PC or static hosting
  activeApiBase = REMOTE_API_BASE;
  API_BASE_URL = REMOTE_API_BASE;
  isResolved = true;
  return activeApiBase;
}

// Initial detection
detectApiBase();

export function getApiBaseUrl(): string {
  return activeApiBase;
}

export function setApiBaseUrl(url: string) {
  activeApiBase = url;
  API_BASE_URL = url;
}

export function getWsUrl(): string {
  if (activeApiBase === REMOTE_API_BASE) {
    return 'wss://api-asdf.rds9.net/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function getWsFallbackUrl(): string {
  return 'wss://api-asdf.rds9.net/ws';
}
