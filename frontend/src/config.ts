// Base API & WebSocket URL Configuration
// Always use relative path so browser NEVER contacts VPS or Tunnel directly (avoids i-FILTER detection)
export const API_BASE_URL = '';

export function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
