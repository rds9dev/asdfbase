// チャット本文の装飾 (@メンション・#チャンネル・URL) と、入力欄の補完
import React from 'react';

const TOKEN_RE = /(@[^\s@#]+|#[^\s@#]+|https?:\/\/[^\s<>"]+)/g;
export const SPECIAL_MENTIONS = ['everyone', 'gemini'];

interface RenderOptions {
  usernames: Set<string>;
  channels: Map<string, number>;
  me?: string;
  onChannelClick: (id: number) => void;
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
