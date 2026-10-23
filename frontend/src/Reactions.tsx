// メッセージのリアクション: クリックで付け外し、ホバー (PC) / 長押し (スマホ) で誰が押したかを表示
import { useEffect, useRef, useState } from 'react';
import { renderEmojiToken } from './chatText';

const LONG_PRESS_MS = 450;

export const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅', '❌', ':swim:'];

export function renderReactionEmoji(emoji: string, customEmojis?: Map<string, string>, sizeClass = 'w-4 h-4') {
  if (emoji.startsWith(':') && emoji.endsWith(':')) {
    const node = renderEmojiToken(emoji, customEmojis, undefined, sizeClass);
    if (node) return node;
  }
  return <span>{emoji}</span>;
}

function ReactionChip({
  emoji,
  names,
  count,
  mine,
  customEmojis,
  onToggle,
}: {
  emoji: string;
  names: string[];
  count: number;
  mine: boolean;
  customEmojis?: Map<string, string>;
  onToggle: () => void;
}) {
  const [peek, setPeek] = useState(false);
  const timer = useRef<any>(null);
  const longPressed = useRef(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 長押しで開いた一覧は、どこかを触ると閉じる
  useEffect(() => {
    if (!peek) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPeek(false);
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
    };
  }, [peek]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const unknown = count - names.length;
  const label = names.length > 0
    ? `${names.join('、')}${unknown > 0 ? ` ほか${unknown}人` : ''}`
    : `退会したユーザー${count > 1 ? ` ${count}人` : ''}`;

  return (
    <span ref={rootRef} className="relative group/rx">
      <button
        type="button"
        aria-label={`${emoji} ${count}件: ${label}`}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          setPeek(false);
          onToggle();
        }}
        onTouchStart={() => {
          longPressed.current = false;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            longPressed.current = true;
            setPeek(true);
            navigator.vibrate?.(10);
          }, LONG_PRESS_MS);
        }}
        onTouchEnd={() => clearTimeout(timer.current)}
        onTouchMove={() => clearTimeout(timer.current)}
        onContextMenu={e => e.preventDefault()}
        className={`text-xs px-2 py-0.5 rounded-md border flex items-center gap-1 select-none ${
          mine ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-[#14161C] border-stone-800 text-stone-400 hover:border-stone-600'
        }`}
      >
        {renderReactionEmoji(emoji, customEmojis, 'w-4 h-4')}
        <span>{count}</span>
      </button>
      <span
        role="tooltip"
        className={`${peek ? 'block' : 'hidden'} group-hover/rx:block absolute bottom-full left-0 mb-1.5 z-30 w-max max-w-[16rem] px-2.5 py-1.5 rounded-lg bg-[#16181D] border border-stone-700 shadow-xl text-[11px] text-stone-200 leading-relaxed pointer-events-none anim-pop`}
      >
        <span className="text-base mr-1 align-middle">{renderReactionEmoji(emoji, customEmojis, 'w-4 h-4')}</span>
        <b className="text-white">{label}</b>
        <span className="text-stone-500"> がリアクション ({emoji === ':swim:' ? 'SWIMしよ' : emoji})</span>
      </span>
    </span>
  );
}

export function ReactionBar({
  reactions,
  meId,
  nameOf,
  customEmojis,
  onToggle,
}: {
  reactions: Record<string, number[]>;
  meId?: number;
  nameOf: (userId: number) => string | undefined;
  customEmojis?: Map<string, string>;
  onToggle: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions).filter(([, ids]) => ids.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      {entries.map(([emoji, userIds]) => (
        <ReactionChip
          key={emoji}
          emoji={emoji}
          names={userIds.map(id => nameOf(id)).filter((n): n is string => Boolean(n))}
          count={userIds.length}
          mine={meId !== undefined && userIds.includes(meId)}
          customEmojis={customEmojis}
          onToggle={() => onToggle(emoji)}
        />
      ))}
    </div>
  );
}
