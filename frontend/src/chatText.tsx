// チャット本文の装飾 (@メンション・#チャンネル・URL) と、入力欄の補完
import React from 'react';

const TOKEN_RE = /(@[^\s@#]+|#[^\s@#]+|https?:\/\/[^\s<>"]+)/g;
export const SPECIAL_MENTIONS = ['everyone', 'gemini'];

interface RenderOptions {
  usernames: Set<string>;
  channels: Map<string, number>;
  me?: string;
  onChannelClick: (id: number) => void;
  // このサイトのメッセージリンク (…/#msg-123) はタブを開かずにその場でジャンプ
  onMessageLink?: (id: number) => void;
  // メモリンク (…/#memo-3) ジャンプ
  onMemoLink?: (slot: number) => void;
  token?: string;
}

// URL がメッセージリンクならメッセージ ID を返す
export function messageLinkId(url: string): number | null {
  try {
    const u = new URL(url, window.location.origin);
    const m = u.hash.match(/^#msg-(\d+)$/);
    return m ? Number(m[1]) : null;
  } catch {
    const m = String(url).match(/#msg-(\d+)/);
    return m ? Number(m[1]) : null;
  }
}

// URL がメモリンクならメモのスロット番号を返す
export function memoSlotId(url: string): number | null {
  try {
    const u = new URL(url, window.location.origin);
    const m = u.hash.match(/^#memo-(\d+)$/);
    return m ? Number(m[1]) : null;
  } catch {
    const m = String(url).match(/#memo-(\d+)/);
    return m ? Number(m[1]) : null;
  }
}

// Discord CDN や GIF の URL をプロキシ経由に変換 (i-FILTER 対策)
export function toProxiedMediaUrl(url: string, token = ''): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (
      host.includes('discordapp.com') ||
      host.includes('discordapp.net') ||
      host.includes('tenor.com') ||
      host.includes('giphy.com')
    ) {
      return `/api/proxy/media?url=${encodeURIComponent(url)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    }
  } catch (_) {}
  return url;
}

// Discord から来たメッセージの名前の後ろに付けるバッジ
export function DiscordBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Discord から送信"
      className={`inline-flex items-center gap-0.5 px-1 py-px rounded bg-[#5865F2] text-white text-[9px] font-bold leading-none align-middle select-none ${className}`}
    >
      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="currentColor" aria-hidden="true">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
      Discord
    </span>
  );
}

// "[Discord] 名前" → { name, fromDiscord }
export function splitSenderName(raw: string): { name: string; fromDiscord: boolean } {
  return raw.startsWith('[Discord] ') ? { name: raw.slice(10), fromDiscord: true } : { name: raw, fromDiscord: raw === '[Discord]' };
}

export function renderMessageText(content: string, opts: RenderOptions): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of content.matchAll(TOKEN_RE)) {
    const token = m[0];
    const idx = m.index ?? 0;
    if (idx > last) out.push(content.slice(last, idx));
    last = idx + token.length;
    if (token.startsWith('@')) {
      const name = token.slice(1);
      const known = opts.usernames.has(name) || SPECIAL_MENTIONS.includes(name.toLowerCase());
      if (known) {
        const isMe = name === opts.me || name.toLowerCase() === 'everyone';
        out.push(
          <span key={i++} className={`mention-pill ${isMe ? 'mention-me' : ''}`}>
            {token}
          </span>
        );
        continue;
      }
    } else if (token.startsWith('#')) {
      const chId = opts.channels.get(token.slice(1));
      if (chId !== undefined) {
        out.push(
          <button key={i++} type="button" onClick={() => opts.onChannelClick(chId)} className="mention-pill channel-pill">
            {token}
          </button>
        );
        continue;
      }
    } else {
      const linkedId = opts.onMessageLink ? messageLinkId(token) : null;
      if (linkedId !== null) {
        out.push(
          <button key={i++} type="button" onClick={() => opts.onMessageLink!(linkedId)} className="mention-pill channel-pill" title="このメッセージへ移動">
            ↪ メッセージへ移動
          </button>
        );
        continue;
      }
      const linkedMemoSlot = opts.onMemoLink ? memoSlotId(token) : null;
      if (linkedMemoSlot !== null) {
        out.push(
          <button key={i++} type="button" onClick={() => opts.onMemoLink!(linkedMemoSlot)} className="mention-pill channel-pill" title={`メモ #${linkedMemoSlot} を開く`}>
            📝 メモ #{linkedMemoSlot}
          </button>
        );
        continue;
      }
      out.push(
        <a key={i++} href={token} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline break-all">
          {token}
        </a>
      );
      continue;
    }
    out.push(token);
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

// 入力欄の下に敷く「ハイライトだけの影」。文字は透明で、メンション部分にだけ色を付ける
export function renderComposerHighlight(text: string, usernames: Set<string>, channels: Map<string, number>): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[0];
    const idx = m.index ?? 0;
    const body = token.slice(1);
    const valid = token.startsWith('@')
      ? usernames.has(body) || SPECIAL_MENTIONS.includes(body.toLowerCase())
      : token.startsWith('#') && channels.has(body);
    if (!valid) continue;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(
      <mark key={i++} className={token.startsWith('@') ? 'composer-mention' : 'composer-channel'}>
        {token}
      </mark>
    );
    last = idx + token.length;
  }
  out.push(text.slice(last));
  // 末尾の改行でも高さが揃うように
  out.push('​');
  return out;
}

// キャレット位置にある @… / #… を探す
export function findCompletionToken(value: string, caret: number): { kind: '@' | '#'; query: string; start: number } | null {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  const token = value.slice(start, caret);
  if (token.length === 0) return null;
  const kind = token[0];
  if (kind !== '@' && kind !== '#') return null;
  const query = token.slice(1);
  if (/[@#]/.test(query)) return null;
  return { kind, query, start };
}

// 前方一致を優先して並べる
export function rankCandidates<T>(items: T[], query: string, key: (t: T) => string): T[] {
  const q = query.toLowerCase();
  return items
    .map(it => ({ it, name: key(it).toLowerCase() }))
    .filter(x => x.name.includes(q))
    .sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)) || a.name.localeCompare(b.name))
    .map(x => x.it);
}
