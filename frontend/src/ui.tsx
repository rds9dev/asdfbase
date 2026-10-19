// サイト共通の UI 部品: 確認ダイアログ / トースト / ホバーカード / モーダル
// ブラウザ標準の alert / confirm は使わず、すべてここを通す
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogEntry extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

type ToastKind = 'info' | 'success' | 'error';
interface ToastEntry {
  id: number;
  message: React.ReactNode;
  kind: ToastKind;
  action?: { label: string; onClick: () => void };
  leaving?: boolean;
}

let nextId = 1;
let dialogs: DialogEntry[] = [];
let toasts: ToastEntry[] = [];
const listeners = new Set<() => void>();
let snapshot = { dialogs, toasts };
const emit = () => {
  snapshot = { dialogs, toasts };
  listeners.forEach(l => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    dialogs = [...dialogs, { ...opts, id: nextId++, resolve }];
    emit();
  });
}

function closeDialog(id: number, ok: boolean) {
  const d = dialogs.find(x => x.id === id);
  dialogs = dialogs.filter(x => x.id !== id);
  emit();
  d?.resolve(ok);
}

export function toast(
  message: React.ReactNode,
  opts: { kind?: ToastKind; action?: { label: string; onClick: () => void }; duration?: number } = {}
) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message, kind: opts.kind || 'info', action: opts.action }];
  emit();
  setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 8000 : 3200));
  return id;
}

export function dismissToast(id: number) {
  if (!toasts.some(t => t.id === id && !t.leaving)) return;
  toasts = toasts.map(t => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
    emit();
  }, 200);
}

function ConfirmBox({ d }: { d: DialogEntry }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeDialog(d.id, false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeDialog(d.id, true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [d.id]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm anim-fade" onClick={() => closeDialog(d.id, false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl p-5 space-y-4 anim-pop"
      >
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${d.danger ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
            {d.danger ? <AlertTriangle className="w-5 h-5" /> : <Info className="w-5 h-5" />}
          </div>
          <div className="min-w-0 pt-1">
            <div className="text-white font-bold text-sm">{d.title}</div>
            {d.message && <div className="text-stone-400 text-xs mt-1.5 leading-relaxed whitespace-pre-wrap">{d.message}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 text-xs">
          <button onClick={() => closeDialog(d.id, false)} className="btn-ghost px-4 py-2 rounded-xl">
            {d.cancelLabel || 'キャンセル'}
          </button>
          <button
            ref={okRef}
            onClick={() => closeDialog(d.id, true)}
            className={`px-4 py-2 rounded-xl font-bold ${d.danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {d.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

const TOAST_ICON = { info: Info, success: CheckCircle2, error: XCircle };
const TOAST_COLOR = { info: 'text-amber-400', success: 'text-emerald-400', error: 'text-red-400' };

export function UiHost() {
  const s = useSyncExternalStore(subscribe, () => snapshot);
  return (
    <>
      {s.dialogs.slice(0, 1).map(d => <ConfirmBox key={d.id} d={d} />)}
      <div className="fixed z-[110] bottom-20 md:bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-2rem)] max-w-md">
        {s.toasts.map(t => {
          const Icon = TOAST_ICON[t.kind];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#16181D]/95 backdrop-blur border border-stone-700/80 shadow-2xl text-xs text-stone-200 ${t.leaving ? 'anim-toast-out' : 'anim-toast-in'}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${TOAST_COLOR[t.kind]}`} />
              <span className="flex-1 min-w-0 break-words">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick();
                    dismissToast(t.id);
                  }}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 font-bold hover:bg-amber-500/25"
                >
                  {t.action.label}
                </button>
              )}
              <button onClick={() => dismissToast(t.id)} className="shrink-0 p-0.5 text-stone-500 hover:text-white" aria-label="閉じる">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

// ホバーで概要を出し、クリックで詳細を開くボタン (ヘッダーの時間割・天気・時計)
export function HoverCard({
  trigger,
  children,
  onClick,
  className = '',
  panelClassName = 'w-80',
  title,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  panelClassName?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<any>(null);
  const show = () => {
    if (!canHover()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-label={title}
        onClick={() => {
          clearTimeout(timer.current);
          setOpen(false);
          onClick();
        }}
        className={className}
      >
        {trigger}
      </button>
      {open && (
        <div className={`absolute right-0 top-full pt-2 z-[70] ${panelClassName}`}>
          <div className="bg-[#111214]/98 backdrop-blur-md border border-stone-700/80 rounded-2xl shadow-2xl p-3 text-xs anim-pop-down">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

// 画面中央のモーダル (スマホでは全画面)
export function Modal({
  onClose,
  children,
  className = 'max-w-2xl',
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-stretch sm:items-center justify-center sm:p-4 anim-fade" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className={`w-full ${className} bg-[#111214] sm:border border-stone-800 sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[90dvh] anim-pop`}
      >
        {children}
      </div>
    </div>
  );
}
