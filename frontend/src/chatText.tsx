// チャット本文の装飾 (@メンション・#チャンネル・:絵文字:・URL・Markdown) と、入力欄の補完
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TOKEN_RE = /(@[^\s@#]+|#[^\s@#]+|:[a-zA-Z0-9_-]{2,32}:|https?:\/\/[^\s<>"]+)/g;
export const SPECIAL_MENTIONS = ['everyone', 'gemini'];

export interface CustomEmojiItem {
  id?: number;
  name: string;
  url: string;
  created_by?: number | null;
}

export const BUILTIN_SHORTCODES: Record<string, string> = {
  check: '✅',
  white_check_mark: '✅',
  x: '❌',
  cross_mark: '❌',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  '-1': '👎',
  heart: '❤️',
  sparkling_heart: '💖',
  broken_heart: '💔',
  joy: '😂',
  rofl: '🤣',
  smile: '😄',
  grin: '😁',
  sweat_smile: '😅',
  laughing: '😆',
  wink: '😉',
  blush: '😊',
  innocent: '😇',
  heart_eyes: '😍',
  kissing_heart: '😘',
  yum: '😋',
  stuck_out_tongue: '😛',
  sunglasses: '😎',
  smirk: '😏',
  unamused: '😒',
  pleading_face: '🥺',
  melting_face: '🫠',
  salute: '🫡',
  face_with_peeking_eye: '🫣',
  face_holding_back_tears: '🥹',
  thinking: '🤔',
  eyes: '👀',
  open_mouth: '😮',
  screaming: '😱',
  sob: '😢',
  cry: '😭',
  pray: '🙏',
  fire: '🔥',
  sparkles: '✨',
  tada: '🎉',
  '100': '💯',
  muscle: '💪',
  clap: '👏',
  wave: '👋',
  ok_hand: '👌',
  point_up: '☝️',
  point_right: '👉',
  point_left: '👈',
  v: '✌️',
  handshake: '🤝',
  skull: '💀',
  skull_and_crossbones: '☠️',
  clown: '🤡',
  ghost: '👻',
  alien: '👽',
  robot: '🤖',
  poop: '💩',
  shit: '💩',
  party: '🥳',
  partying_face: '🥳',
  cool: '😎',
  nerd: '🤓',
  yawning_face: '🥱',
  sleeping: '😴',
  hot_face: '🥵',
  cold_face: '🥶',
  exploding_head: '🤯',
  angry: '😠',
  rage: '😡',
  crown: '👑',
  gem: '💎',
  rocket: '🚀',
  star: '⭐',
  warning: '⚠️',
  zzz: '💤',
  book: '📚',
  pencil: '✏️',
  bulb: '💡',
  bell: '🔔',
  mega: '📣',
  loudspeaker: '📢',
  swimmer: '🏊',
  swim: '🏊',
};

// メッセージ本文が絵文字のみ（1〜5個）で構成されているか判定 (ジャンボ絵文字用)
export function isOnlyEmojis(text: string, customEmojis?: Map<string, string>): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // ショートコード (:melting_face:, :swim: 等) を抽出して一旦除去
  const shortcodes = trimmed.match(/:[a-zA-Z0-9_+-]{1,32}:/g) || [];
  for (const sc of shortcodes) {
    const clean = sc.slice(1, -1).toLowerCase();
    const isKnown = Boolean(BUILTIN_SHORTCODES[clean] || clean === 'swim' || customEmojis?.has(clean));
    if (!isKnown) return false;
  }
  const withoutShortcodes = trimmed.replace(/:[a-zA-Z0-9_+-]{1,32}:/g, '').trim();
  if (!withoutShortcodes) {
    return shortcodes.length >= 1 && shortcodes.length <= 5;
  }
  const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\uFE0F|\u200D|\s)+$/u;
  if (!emojiRegex.test(withoutShortcodes)) return false;
  const PictographicRe = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu;
  const unicodeMatches = withoutShortcodes.match(PictographicRe) || [];
  const totalCount = shortcodes.length + unicodeMatches.length;
  return totalCount >= 1 && totalCount <= 5;
}

export interface RenderOptions {
  usernames: Set<string>;
  discordUsernames?: Set<string>;
  channels: Map<string, number>;
  customEmojis?: Map<string, string>;
  me?: string;
  onChannelClick: (id: number) => void;
  // このサイトのメッセージリンク (…/#msg-123) はタブを開かずにその場でジャンプ
  onMessageLink?: (id: number) => void;
  // メモリンク (…/#memo-3) ジャンプ
  onMemoLink?: (slot: number) => void;
  token?: string;
}

export function resolveEmojiUrl(name: string, customEmojis?: Map<string, string>, token = ''): string | null {
  const clean = name.replace(/^:+|:+$/g, '').toLowerCase();
  if (customEmojis?.has(clean)) {
    const raw = customEmojis.get(clean)!;
    return toProxiedMediaUrl(raw, token);
  }
  if (clean === 'swim') return '/uploads/emoji-swim.svg';
  return null;
}

export function getTwemojiUrl(unicode: string): string {
  const codePoints: string[] = [];
  for (let i = 0; i < unicode.length; i++) {
    const cp = unicode.codePointAt(i);
    if (cp && cp !== 0xfe0f) {
      codePoints.push(cp.toString(16));
      if (cp > 0xffff) i++;
    }
  }
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join('-')}.svg`;
}

export function renderEmojiToken(
  token: string,
  customEmojis?: Map<string, string>,
  key?: React.Key,
  sizeClass = 'w-5 h-5',
  authToken = ''
): React.ReactNode | null {
  const clean = token.replace(/^:+|:+$/g, '').toLowerCase();
  const customUrl = resolveEmojiUrl(clean, customEmojis, authToken);
  if (customUrl) {
    return (
      <img
        key={key}
        src={customUrl}
        alt={`:${clean}:`}
        title={clean === 'swim' ? 'SWIMしよ (:swim:)' : `:${clean}:`}
        className={`${sizeClass} inline-block object-contain align-middle mx-0.5 select-none`}
      />
    );
  }
  const unicode = BUILTIN_SHORTCODES[clean];
  if (unicode) {
    const twemojiUrl = getTwemojiUrl(unicode);
    return (
      <img
        key={key}
        src={twemojiUrl}
        alt={unicode}
        title={`:${clean}:`}
        className={`${sizeClass} inline-block object-contain align-middle mx-0.5 select-none`}
        onError={(e) => {
          const target = e.currentTarget;
          const span = document.createElement('span');
          span.textContent = unicode;
          span.className = 'inline-block align-middle';
          target.replaceWith(span);
        }}
      />
    );
  }
  return null;
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

// Discord アイコン (公式ロゴ SVG)
export function DiscordIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// Discord から来たメッセージの名前の後ろに付けるバッジ
export function DiscordBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Discord から送信"
      className={`inline-flex items-center gap-0.5 px-1 py-px rounded bg-[#5865F2] text-white text-[9px] font-bold leading-none align-middle select-none ${className}`}
    >
      <DiscordIcon className="w-2.5 h-2.5" />
      Discord
    </span>
  );
}

// "[Discord] 名前" → { name, fromDiscord }
export function splitSenderName(raw: string): { name: string; fromDiscord: boolean } {
  return raw.startsWith('[Discord] ') ? { name: raw.slice(10), fromDiscord: true } : { name: raw, fromDiscord: raw === '[Discord]' };
}

export function renderMessageText(content: string, opts: RenderOptions, emojiSizeClass = 'w-6 h-6'): React.ReactNode[] {
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
      const isDiscordUser = Boolean(opts.discordUsernames?.has(name));
      const known = opts.usernames.has(name) || isDiscordUser || SPECIAL_MENTIONS.includes(name.toLowerCase());
      if (known) {
        const isMe = name === opts.me || name.toLowerCase() === 'everyone';
        out.push(
          <span key={i++} className={`mention-pill ${isMe ? 'mention-me' : isDiscordUser ? 'mention-discord' : ''}`}>
            {token}
            {isDiscordUser && <span className="ml-0.5 text-[8px] font-mono px-0.5 rounded bg-indigo-500/30 text-indigo-200">DC</span>}
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
    } else if (token.startsWith(':') && token.endsWith(':')) {
      const rendered = renderEmojiToken(token, opts.customEmojis, i++, emojiSizeClass, opts.token);
      if (rendered) {
        out.push(rendered);
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

// 見出しテキストから目次アンカー用のスラッグを生成
export function slugifyHeading(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('');
  if (React.isValidElement(children)) {
    return extractTextFromChildren((children.props as any)?.children);
  }
  return '';
}

function decorateInlineChildren(children: React.ReactNode, opts: RenderOptions): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return <>{renderMessageText(child, opts)}</>;
    }
    return child;
  });
}

// チャットやメモで使える拡張Markdown (メンション・チャンネル・絵文字・目次アンカージャンプ対応)
export const SmartMarkdown = React.memo(function SmartMarkdown({
  content,
  opts,
  className = '',
  containerRef,
}: {
  content: string;
  opts: RenderOptions;
  className?: string;
  containerRef?: React.RefObject<HTMLElement | null>;
}) {
  const scrollToHeadingElement = (targetEl: Element) => {
    const scrollContainer = containerRef?.current;
    if (scrollContainer) {
      scrollContainer.dataset.anchorJumping = '1';
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const nextTop = scrollContainer.scrollTop + (targetRect.top - containerRect.top) - 24;
      scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
      window.setTimeout(() => {
        if (scrollContainer.dataset) delete scrollContainer.dataset.anchorJumping;
      }, 1200);
    } else {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const msgId = opts.onMessageLink ? messageLinkId(href) : null;
    if (msgId !== null) {
      e.preventDefault();
      opts.onMessageLink!(msgId);
      return;
    }
    const memoId = opts.onMemoLink ? memoSlotId(href) : null;
    if (memoId !== null) {
      e.preventDefault();
      opts.onMemoLink!(memoId);
      return;
    }
    if (href.startsWith('#')) {
      e.preventDefault();
      let rawTarget = href.slice(1);
      try {
        rawTarget = decodeURIComponent(rawTarget);
      } catch (_) {}
      const slug = slugifyHeading(rawTarget);
      const root: ParentNode = containerRef?.current || document;
      const byId =
        (root instanceof Document ? root.getElementById(rawTarget) : root.querySelector(`[id="${CSS.escape(rawTarget)}"]`)) ||
        (root instanceof Document ? root.getElementById(slug) : root.querySelector(`[id="${CSS.escape(slug)}"]`));
      if (byId) {
        scrollToHeadingElement(byId);
        return;
      }
      // 見出しテキスト一致でもフォールバック検索
      const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const h of Array.from(headings)) {
        const text = (h.textContent || '').trim();
        if (text === rawTarget || slugifyHeading(text) === slug) {
          scrollToHeadingElement(h);
          return;
        }
      }
    }
  };

  if (isOnlyEmojis(content, opts.customEmojis)) {
    return (
      <div className={`${className} py-1 text-5xl sm:text-6xl leading-tight flex flex-wrap items-center gap-1.5 select-none`}>
        {renderMessageText(content.trim(), opts, 'w-14 h-14 sm:w-16 sm:h-16')}
      </div>
    );
  }

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{decorateInlineChildren(children, opts)}</p>,
          li: ({ children }) => <li className="leading-relaxed">{decorateInlineChildren(children, opts)}</li>,
          td: ({ children }) => <td className="border border-stone-700 px-2.5 py-1">{decorateInlineChildren(children, opts)}</td>,
          th: ({ children }) => <th className="border border-stone-700 px-2.5 py-1 bg-stone-800/70">{decorateInlineChildren(children, opts)}</th>,
          h1: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return <h1 id={id} className="scroll-mt-16 font-bold text-lg text-white mt-2 mb-1">{decorateInlineChildren(children, opts)}</h1>;
          },
          h2: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return <h2 id={id} className="scroll-mt-16 font-bold text-base text-white mt-2 mb-1">{decorateInlineChildren(children, opts)}</h2>;
          },
          h3: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return <h3 id={id} className="scroll-mt-16 font-semibold text-sm text-stone-100 mt-1.5 mb-0.5">{decorateInlineChildren(children, opts)}</h3>;
          },
          h4: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return <h4 id={id} className="scroll-mt-16 font-semibold text-sm text-stone-200 mt-1 mb-0.5">{decorateInlineChildren(children, opts)}</h4>;
          },
          a: ({ href, children }) => {
            const linkHref = href || '';
            const isInternal =
              linkHref.startsWith('#') ||
              (opts.onMessageLink && messageLinkId(linkHref) !== null) ||
              (opts.onMemoLink && memoSlotId(linkHref) !== null);
            return (
              <a
                href={linkHref}
                onClick={(e) => handleAnchorClick(e, linkHref)}
                target={isInternal ? undefined : '_blank'}
                rel={isInternal ? undefined : 'noreferrer noopener'}
                className="text-sky-400 hover:underline break-all cursor-pointer"
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <div className="my-1.5 pl-3 pr-2.5 py-1.5 border-l-4 border-indigo-500/80 bg-[#16181F]/90 rounded-r-lg text-stone-200 text-xs sm:text-[13px] leading-relaxed shadow-sm">
              {children}
            </div>
          ),
          img: ({ src, alt }) => {
            const proxied = toProxiedMediaUrl(src || '', opts.token || '');
            return (
              <span className="relative my-1 inline-block max-w-full align-middle">
                <img
                  src={proxied}
                  alt={alt || ''}
                  loading="lazy"
                  className="max-h-72 w-auto rounded-lg object-contain border border-stone-800 bg-stone-900/60 transition-opacity duration-200"
                  style={{ minHeight: '48px', minWidth: '48px' }}
                />
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, (prev, next) => (
  prev.content === next.content &&
  prev.className === next.className &&
  prev.containerRef === next.containerRef &&
  prev.opts.me === next.opts.me &&
  prev.opts.token === next.opts.token &&
  prev.opts.usernames.size === next.opts.usernames.size &&
  prev.opts.channels.size === next.opts.channels.size &&
  (prev.opts.customEmojis?.size ?? 0) === (next.opts.customEmojis?.size ?? 0)
));

// 入力欄の下に敷く「ハイライトだけの影」。文字は透明で、メンション部分にだけ色を付ける
export function renderComposerHighlight(
  text: string,
  usernames: Set<string>,
  channels: Map<string, number>,
  customEmojis?: Map<string, string>
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[0];
    const idx = m.index ?? 0;
    const body = token.slice(1);
    const valid = token.startsWith('@')
      ? usernames.has(body) || SPECIAL_MENTIONS.includes(body.toLowerCase())
      : token.startsWith('#')
      ? channels.has(body)
      : token.startsWith(':') && token.endsWith(':')
      ? Boolean(resolveEmojiUrl(token, customEmojis) || BUILTIN_SHORTCODES[token.slice(1, -1).toLowerCase()])
      : false;
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

// キャレット位置にある @… / #… / :… を探す
export function findCompletionToken(value: string, caret: number): { kind: '@' | '#' | ':'; query: string; start: number } | null {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  const token = value.slice(start, caret);
  if (token.length === 0) return null;
  const kind = token[0];
  if (kind !== '@' && kind !== '#' && kind !== ':') return null;
  const query = token.slice(1);
  if (kind === ':' && query.length === 0) return null;
  if (/[@#:]/.test(query)) return null;
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
