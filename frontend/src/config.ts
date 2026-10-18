// Base API & WebSocket URL Configuration
// Chromebook & School i-FILTER Protection Architecture:
// 既定(プロキシモード)ではブラウザからは外部FQDN（api-asdf.rds9.netやVPS IP）への直接リクエストを行わず、
// 常に同一オリジン（相対パス ''）のプロキシ経由で通信します。
// これにより、i-FILTERやネットワーク監視に裏のドメイン・IPが露出するのを防ぎます。
// 直結モードは設定画面から明示的に切り替えた場合のみ有効になります（プロキシが遅い/落ちている時用）。

export const REMOTE_API_BASE = 'https://api-asdf.rds9.net';
export const API_BASE_URL = '';

export type ConnectionRoute = 'proxy' | 'direct';
// auto: WS → SSE → ロングポーリング → ポーリング の順に自動フォールバック
export type RealtimeTransport = 'auto' | 'ws' | 'sse' | 'longpoll' | 'poll';

const ROUTE_KEY = 'asdf_conn_route';
const TRANSPORT_KEY = 'asdf_rt_transport';
const POLL_INTERVAL_KEY = 'asdf_rt_poll_interval';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode etc.)
  }
}

export function getConnectionRoute(): ConnectionRoute {
  return readStorage(ROUTE_KEY) === 'direct' ? 'direct' : 'proxy';
}

export function setConnectionRoute(route: ConnectionRoute) {
  writeStorage(ROUTE_KEY, route);
}

export function getRealtimeTransport(): RealtimeTransport {
  const v = readStorage(TRANSPORT_KEY);
  return v === 'ws' || v === 'sse' || v === 'longpoll' || v === 'poll' ? v : 'auto';
}

export function setRealtimeTransport(t: RealtimeTransport) {
  writeStorage(TRANSPORT_KEY, t);
}

export function getPollInterval(): number {
  const v = parseInt(readStorage(POLL_INTERVAL_KEY) || '', 10);
  return [500, 1000, 2000, 3000, 5000].includes(v) ? v : 1000;
}

export function setPollInterval(ms: number) {
  writeStorage(POLL_INTERVAL_KEY, String(ms));
}

export async function detectApiBase(): Promise<string> {
  return getApiBaseUrl();
}

export function getApiBaseUrl(): string {
  return getConnectionRoute() === 'direct' ? REMOTE_API_BASE : '';
}

export function setApiBaseUrl(_url: string) {
  // No-op: 接続先は setConnectionRoute で切り替える
}

export function getWsUrl(): string {
  if (getConnectionRoute() === 'direct') {
    return REMOTE_API_BASE.replace(/^http/, 'ws') + '/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function getWsFallbackUrl(): string {
  return getWsUrl();
}
