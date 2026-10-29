// カレンダー: 月表示 + 日ごとの予定。予定は各自が書き込み、全員で見られる
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { confirmDialog, toast } from './ui';
import { getJapaneseHoliday } from './schedule';

export interface CalendarEvent {
  id: number;
  user_id: number;
  username: string;
  event_date: string;
  event_time: string;
  title: string;
  note: string;
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const USER_DOT = ['bg-sky-400', 'bg-emerald-400', 'bg-violet-400', 'bg-rose-400', 'bg-cyan-400', 'bg-lime-400', 'bg-fuchsia-400', 'bg-orange-400'];
const dotFor = (userId: number) => USER_DOT[Math.abs(userId) % USER_DOT.length];

// 月の表示範囲 (前後の週を含む6週間)
export function monthRange(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return { days, from: ymd(days[0]), to: ymd(days[41]) };
}

const sortEvents = (list: CalendarEvent[]) =>
  [...list].sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.event_time || '99').localeCompare(b.event_time || '99') || a.id - b.id);

export function CalendarHoverSummary({ now, events }: { now: Date; events: CalendarEvent[] }) {
  const { days } = monthRange(now.getFullYear(), now.getMonth());
  const today = ymd(now);
  const weekLater = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const upcoming = sortEvents(events.filter(e => e.event_date >= today && e.event_date <= weekLater)).slice(0, 5);
  const hasEvent = new Set(events.map(e => e.event_date));
  return (
    <div className="space-y-2.5">
      <div className="text-white font-bold">
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 ({WEEK[now.getDay()]})
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
        {WEEK.map((w, i) => (
          <span key={w} className={i === 0 ? 'text-red-400/80' : i === 6 ? 'text-sky-400/80' : 'text-stone-500'}>{w}</span>
        ))}
        {days.map(d => {
          const key = ymd(d);
          const inMonth = d.getMonth() === now.getMonth();
          const holiday = getJapaneseHoliday(d);
          return (
            <span
              key={key}
              title={holiday || undefined}
              className={`relative py-0.5 rounded tabular-nums ${
                key === today
                  ? 'bg-amber-500 text-black font-bold'
                  : holiday || d.getDay() === 0
                    ? 'text-red-400 font-medium'
                    : d.getDay() === 6
                      ? 'text-sky-400 font-medium'
                      : inMonth
                        ? 'text-stone-300'
                        : 'text-stone-700'
              }`}
            >
              {d.getDate()}
              {hasEvent.has(key) && key !== today && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400" />}
            </span>
          );
        })}
      </div>
      <div className="pt-2 border-t border-stone-800 space-y-1">
        {upcoming.length === 0 ? (
          <div className="text-stone-500">1週間以内の予定はありません</div>
        ) : (
          upcoming.map(e => (
            <div key={e.id} className="flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotFor(e.user_id)}`} />
              <span className="text-stone-500 shrink-0 tabular-nums">{e.event_date.slice(5).replace('-', '/')}</span>
              {e.event_time && <span className="text-stone-500 shrink-0 tabular-nums">{e.event_time}</span>}
              <span className="text-stone-200 truncate">{e.title}</span>
            </div>
          ))
        )}
      </div>
      <div className="text-[10px] text-stone-600 text-right">クリックで予定を開く</div>
    </div>
  );
}

interface PanelProps {
  token: string;
  safeFetch: (input: string, init?: RequestInit) => Promise<Response>;
  currentUser: { id: number; role: string };
  events: CalendarEvent[];
  loadRange: (from: string, to: string) => void;
  upsert: (ev: CalendarEvent) => void;
  removeLocal: (id: number) => void;
  onClose: () => void;
}

export function CalendarPanel({ token, safeFetch, currentUser, events, loadRange, upsert, removeLocal, onClose }: PanelProps) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(ymd(now));
  const [onlyMine, setOnlyMine] = useState(false);
  const [form, setForm] = useState<{ id?: number; time: string; title: string; note: string } | null>(null);
  const { days, from, to } = monthRange(cursor.y, cursor.m);

  useEffect(() => {
    loadRange(from, to);
  }, [from, to]);

  const visible = events.filter(e => !onlyMine || e.user_id === currentUser.id);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of sortEvents(visible)) byDate.set(e.event_date, [...(byDate.get(e.event_date) || []), e]);
  const dayEvents = byDate.get(selected) || [];
  const today = ymd(now);
  const sel = new Date(`${selected}T00:00:00`);

  const moveMonth = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const save = async () => {
    if (!form || !form.title.trim()) {
      toast('予定の名前を入力してください', { kind: 'error' });
      return;
    }
    const res = await safeFetch(form.id ? `/api/calendar/${form.id}` : '/api/calendar', {
      method: form.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date: selected, time: form.time, title: form.title, note: form.note }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      toast(data.error || '保存に失敗しました', { kind: 'error' });
      return;
    }
    upsert(data);
    setForm(null);
    toast('予定を保存しました', { kind: 'success' });
  };

  const remove = async (ev: CalendarEvent) => {
    const ok = await confirmDialog({ title: `「${ev.title}」を削除しますか？`, confirmLabel: '削除する', danger: true });
    if (!ok) return;
    const res = await safeFetch(`/api/calendar/${ev.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (res && res.ok) {
      removeLocal(ev.id);
      toast('削除しました', { kind: 'success' });
    } else {
      toast('削除できませんでした', { kind: 'error' });
    }
  };

  return (
    <>
      <div className="p-3 sm:p-4 border-b border-stone-800 flex items-center gap-2">
        <button onClick={() => moveMonth(-1)} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-300" aria-label="前の月">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-white text-sm tabular-nums w-28 text-center">{cursor.y}年{cursor.m + 1}月</span>
        <button onClick={() => moveMonth(1)} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-300" aria-label="次の月">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setCursor({ y: now.getFullYear(), m: now.getMonth() });
            setSelected(today);
          }}
          className="px-2.5 py-1 rounded-lg border border-stone-800 text-stone-300 text-xs hover:border-amber-500/50"
        >
          今日
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer select-none">
          <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} className="accent-amber-500" />
          <span className="hidden sm:inline">自分の予定だけ</span>
          <span className="sm:hidden">自分のみ</span>
        </label>
        <button onClick={onClose} className="p-1 rounded-lg text-stone-500 hover:text-white hover:bg-stone-800" aria-label="閉じる">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden text-xs">
        <div className="flex-1 min-w-0 p-2 sm:p-3 overflow-y-auto">
          <div className="grid grid-cols-7 gap-1">
            {WEEK.map((w, i) => (
              <div key={w} className={`text-center py-1 font-bold ${i === 0 ? 'text-red-400/80' : i === 6 ? 'text-sky-400/80' : 'text-stone-500'}`}>{w}</div>
            ))}
            {days.map(d => {
              const key = ymd(d);
              const list = byDate.get(key) || [];
              const inMonth = d.getMonth() === cursor.m;
              const holiday = getJapaneseHoliday(d);
              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelected(key);
                    setForm(null);
                    if (!inMonth) setCursor({ y: d.getFullYear(), m: d.getMonth() });
                  }}
                  className={`min-h-[3.5rem] sm:min-h-[4.75rem] p-1 rounded-lg border text-left flex flex-col gap-0.5 transition ${
                    key === selected ? 'border-amber-500 bg-amber-500/10' : 'border-stone-800/70 hover:border-stone-600 bg-[#16181D]/50'
                  } ${inMonth ? '' : 'opacity-40'}`}
                >
                  <div className="flex items-center gap-1">
                    <span className={`self-start px-1 rounded tabular-nums ${
                      key === today
                        ? 'bg-amber-500 text-black font-bold'
                        : holiday || d.getDay() === 0
                          ? 'text-red-400 font-bold'
                          : d.getDay() === 6
                            ? 'text-sky-400 font-bold'
                            : 'text-stone-300'
                    }`}>
                      {d.getDate()}
                    </span>
                    {holiday && (
                      <span className="hidden sm:inline text-[9px] text-red-300 bg-red-950/60 px-1 rounded truncate max-w-[65px]" title={holiday}>
                        {holiday}
                      </span>
                    )}
                  </div>
                  {list.slice(0, 2).map(e => (
                    <span key={e.id} className="hidden sm:flex items-center gap-1 text-[10px] text-stone-300 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotFor(e.user_id)}`} />
                      <span className="truncate">{e.title}</span>
                    </span>
                  ))}
                  {list.length > 0 && (
                    <span className="sm:hidden flex gap-0.5">
                      {list.slice(0, 3).map(e => <span key={e.id} className={`w-1.5 h-1.5 rounded-full ${dotFor(e.user_id)}`} />)}
                    </span>
                  )}
                  {list.length > 2 && <span className="hidden sm:block text-[10px] text-stone-500">+{list.length - 2}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-stone-800 p-3 sm:p-4 space-y-3 overflow-y-auto max-h-[45dvh] lg:max-h-none">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white text-sm">
              {sel.getMonth() + 1}月{sel.getDate()}日 ({WEEK[sel.getDay()]})
            </span>
            {!form && (
              <button onClick={() => setForm({ time: '', title: '', note: '' })} className="flex items-center gap-1 px-2.5 py-1 rounded-lg btn-primary font-bold">
                <Plus className="w-3.5 h-3.5" /> 予定
              </button>
            )}
          </div>

          {form && (
            <div className="p-3 rounded-xl bg-[#16181D] border border-amber-500/30 space-y-2 anim-fade">
              <div className="flex gap-2">
                <input
                  type="time"
                  value={form.time}
                  onChange={e => setForm({ ...form, time: e.target.value })}
                  className="bg-[#111214] border border-stone-800 rounded-lg px-2 py-1.5 text-white"
                />
                <input
                  autoFocus
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
                  }}
                  placeholder="予定"
                  className="flex-1 min-w-0 bg-[#111214] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60"
                />
              </div>
              <textarea
                value={form.note}
                onChange={e => setForm({ ...form, note: e.target.value })}
                rows={2}
                placeholder="メモ (任意)"
                className="w-full bg-[#111214] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white resize-none focus:outline-none focus:border-amber-500/60"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setForm(null)} className="px-3 py-1.5 rounded-lg btn-ghost">キャンセル</button>
                <button onClick={save} className="px-3 py-1.5 rounded-lg btn-primary font-bold">保存</button>
              </div>
            </div>
          )}

          {dayEvents.length === 0 && !form ? (
            <div className="text-stone-500">予定はありません</div>
          ) : (
            <div className="space-y-1.5">
              {dayEvents.map(e => {
                const canEdit = e.user_id === currentUser.id || currentUser.role === 'admin';
                return (
                  <div key={e.id} className="group p-2.5 rounded-xl bg-[#16181D] border border-stone-800 anim-fade">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${dotFor(e.user_id)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold break-words">{e.title}</div>
                        <div className="text-stone-500 flex items-center gap-1.5">
                          {e.event_time && <><Clock className="w-3 h-3" />{e.event_time}</>}
                          <span>{e.username}</span>
                        </div>
                        {e.note && <div className="mt-1 text-stone-400 whitespace-pre-wrap break-words">{e.note}</div>}
                      </div>
                      {canEdit && (
                        <div className="flex gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition">
                          <button onClick={() => setForm({ id: e.id, time: e.event_time || '', title: e.title, note: e.note || '' })} className="p-1 rounded text-stone-500 hover:text-amber-400" aria-label="編集">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => remove(e)} className="p-1 rounded text-stone-500 hover:text-red-400" aria-label="削除">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
