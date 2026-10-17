// Base API & WebSocket URL Configuration
// Chromebook & School i-FILTER Protection Architecture:
// ブラウザからは外部FQDN（api-asdf.rds9.netやVPS IP）への直接リクエストを一切行わず、
// 常に同一オリジン（相対パス ''）のプロキシ経由で通信します。
// これにより、i-FILTERやネットワーク監視に裏のドメイン・IPが露出するのを完全に防ぎます。

export const REMOTE_API_BASE = '';
export const API_BASE_URL = '';

export async function detectApiBase(): Promise<string> {
  return '';
}

export function getApiBaseUrl(): string {
  return '';
}

export function setApiBaseUrl(_url: string) {
  // No-op to prevent leaking external API base
}

export function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function getWsFallbackUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
