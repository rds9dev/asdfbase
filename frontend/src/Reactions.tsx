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
  const [showModal, setShowModal] = useState(false);
  const [peek, setPeek] = useState(false);
  const timer = useRef<any>(null);
  const longPressed = useRef(false);
  const rootRef = useRef<HTMLSpanElement>(null);

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

  const unknown = count - names.length;

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
          setShowModal(true);
        }}
        onTouchStart={() => {
          longPressed.current = false;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            longPressed.current = true;
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
          className="absolute bottom-full left-0 mb-1.5 z-40 w-max min-w-[12rem] max-w-[18rem] max-h-48 overflow-y-auto p-2.5 rounded-xl bg-[#16181D] border border-stone-700 shadow-2xl text-xs text-stone-200 anim-pop space-y-1.5"
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
            {names.map((name, idx) => (
              <div key={idx} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-stone-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="truncate text-stone-200 font-medium">{name}</span>
              </div>
            ))}
            {unknown > 0 && (
              <div className="text-[10px] text-stone-500 px-1 italic">
                ほか {unknown} 人 (Discord / 過去のメンバー)
              </div>
            )}
          </div>
        </div>
      )}

      {/* 通常ホバーの簡易ツールチップ (モーダルが開いていない時のみ) */}
      {!showModal && !peek && (
        <span
          role="tooltip"
          className="hidden group-hover/rx:block absolute bottom-full left-0 mb-1.5 z-30 w-max max-w-[16rem] px-2.5 py-1 rounded-lg bg-[#16181D] border border-stone-700 shadow-xl text-[11px] text-stone-200 leading-relaxed pointer-events-none anim-fade"
        >
          <span className="mr-1 align-middle">{renderReactionEmoji(emoji, customEmojis, 'w-3.5 h-3.5')}</span>
          <b className="text-white">
            {names.length > 0 ? names.slice(0, 3).join('、') + (names.length > 3 || unknown > 0 ? ` ほか${names.length - 3 + unknown}人` : '') : `${count}人`}
          </b>
          <span className="text-stone-400 text-[10px] ml-1">(右クリックで全員表示)</span>
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
