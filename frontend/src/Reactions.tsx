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
  userIds,
  nameOf,
  count,
  mine,
  customEmojis,
  onToggle,
  onResolveUnknown,
}: {
  emoji: string;
  userIds: number[];
  nameOf: (userId: number) => string | undefined;
  count: number;
  mine: boolean;
  customEmojis?: Map<string, string>;
  onToggle: () => void;
  onResolveUnknown?: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [peek, setPeek] = useState(false);
  const timer = useRef<any>(null);
  const longPressed = useRef(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  const items = userIds.map(id => ({
    id,
    name: nameOf(id),
    isDiscord: id < 0,
  }));
  const names = items.map(it => it.name).filter((n): n is string => Boolean(n));
  const unknown = count - names.length;

  useEffect(() => {
    if (unknown > 0 && onResolveUnknown) {
      onResolveUnknown();
    }
  }, [unknown, onResolveUnknown]);

  // 長押しで開いた一覧は、どこかを触ると閉じる
  useEffect(() => {
    if (!peek && !showModal) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setPeek(false);
        setShowModal(false);
      }
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
    };
  }, [peek, showModal]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span ref={rootRef} className="relative group/rx inline-block">
      <button
        type="button"
        aria-label={`${emoji} ${count}件`}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onToggle();
        }}
        onContextMenu={e => {
          e.preventDefault();
          if (unknown > 0 && onResolveUnknown) onResolveUnknown();
          setShowModal(true);
        }}
        onTouchStart={() => {
          longPressed.current = false;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            longPressed.current = true;
            if (unknown > 0 && onResolveUnknown) onResolveUnknown();
            setShowModal(true);
            navigator.vibrate?.(10);
          }, LONG_PRESS_MS);
        }}
        onTouchEnd={() => clearTimeout(timer.current)}
        onTouchMove={() => clearTimeout(timer.current)}
        className={`text-xs px-2 py-0.5 rounded-lg border flex items-center gap-1 select-none transition active:scale-95 ${
          mine
            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold'
            : 'bg-[#14161C] border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
        }`}
      >
        {renderReactionEmoji(emoji, customEmojis, 'w-4 h-4')}
        <span className="tabular-nums font-mono text-[11px]">{count}</span>
      </button>

      {/* ホバーまたは長押し/クリック時のポップアップ */}
      {(showModal || peek) && (
        <div
          role="dialog"
          className="absolute bottom-full left-0 mb-1.5 z-40 w-max min-w-[13rem] max-w-[19rem] max-h-52 overflow-y-auto p-2.5 rounded-xl bg-[#16181D] border border-stone-700 shadow-2xl text-xs text-stone-200 anim-pop space-y-1.5"
        >
          <div className="flex items-center justify-between pb-1 border-b border-stone-800 text-[11px] font-bold text-stone-400">
            <span className="flex items-center gap-1.5">
              {renderReactionEmoji(emoji, customEmojis, 'w-4 h-4')}
              <span>リアクション ({count}人)</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                setPeek(false);
              }}
              className="text-stone-500 hover:text-white px-1"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 py-0.5 px-1 rounded hover:bg-stone-800/50">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${it.isDiscord ? 'bg-[#5865F2]' : 'bg-amber-400'}`} />
                  <span className="truncate text-stone-200 font-medium">
                    {it.name || (it.isDiscord ? `Discord メンバー (#${Math.abs(it.id) % 10000})` : `メンバー (#${it.id})`)}
                  </span>
                </div>
                {it.isDiscord && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-[#5865F2]/20 text-indigo-300 border border-[#5865F2]/30 shrink-0">
                    Discord
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 通常ホバーの簡易ツールチップ (モーダルが開いていない時のみ) */}
      {!showModal && !peek && (
        <span
          role="tooltip"
          className="hidden group-hover/rx:block absolute bottom-full left-0 mb-1.5 z-30 w-max max-w-[18rem] px-2.5 py-1.5 rounded-lg bg-[#16181D] border border-stone-700 shadow-xl text-[11px] text-stone-200 leading-relaxed pointer-events-none anim-fade"
        >
          <span className="mr-1 align-middle">{renderReactionEmoji(emoji, customEmojis, 'w-3.5 h-3.5')}</span>
          <b className="text-white">
            {names.length > 0
              ? names.slice(0, 6).join('、') + (names.length > 6 || unknown > 0 ? ` ほか${Math.max(0, names.length - 6) + unknown}人` : '')
              : `${count}人`}
          </b>
          <span className="text-stone-400 text-[10px] ml-1">(右クリックで一覧)</span>
        </span>
      )}
    </span>
  );
}

export function ReactionBar({
  reactions,
  meId,
  nameOf,
  customEmojis,
  onToggle,
  onResolveUnknown,
}: {
  reactions: Record<string, number[]>;
  meId?: number;
  nameOf: (userId: number) => string | undefined;
  customEmojis?: Map<string, string>;
  onToggle: (emoji: string) => void;
  onResolveUnknown?: () => void;
}) {
  const entries = Object.entries(reactions).filter(([, ids]) => ids.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      {entries.map(([emoji, userIds]) => (
        <ReactionChip
          key={emoji}
          emoji={emoji}
          userIds={userIds.map(Number)}
          nameOf={nameOf}
          count={userIds.length}
          mine={meId !== undefined && userIds.includes(meId)}
          customEmojis={customEmojis}
          onToggle={() => onToggle(emoji)}
          onResolveUnknown={onResolveUnknown}
        />
      ))}
    </div>
  );
}
