// 宿題: 「次の授業までにやってきてね」という簡単なもの (締切のしっかりした提出物は「提出物」タブ)
// 期限は時間割から「その教科の次の授業日」を自動で入れる。やったかどうかは各自でチェック
import { useEffect, useRef, useState } from 'react';
import { BookOpenCheck, Check, ChevronDown, Edit3, Plus, Settings, Trash2 } from 'lucide-react';
import { CLASS_NUMBERS, SUBJECTS, daysFromToday, shortDateLabel } from './schedule';
import { confirmDialog, toast } from './ui';

export interface Homework {
  id: number;
  class_no: number | null;
  subject: string;
  content: string;
  due_date: string;
  user_id: number | null;
  username: string | null;
  created_at: string;
  done_count: number;
  my_done: boolean;
}

interface Props {
  token: string;
  safeFetch: (input: string, init?: RequestInit) => Promise<Response>;
  currentUser: { id: number; role: string; class_no?: number | null };
  users: { id: number; class_no?: number | null }[];
  homework: Homework[];
  setHomework: React.Dispatch<React.SetStateAction<Homework[]>>;
  onOpenSettings: () => void;
}

type ClassView = number | 'all';

function dueLabel(days: number) {
  if (days < 0) return { text: `${-days}日過ぎ`, cls: 'bg-red-500/20 text-red-300 border-red-500/30' };
  if (days === 0) return { text: '今日まで', cls: 'bg-amber-500/25 text-amber-200 border-amber-500/40' };
  if (days === 1) return { text: '明日まで', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  return { text: `あと${days}日`, cls: 'bg-stone-800 text-stone-300 border-stone-700' };
}

export default function HomeworkTab({ token, safeFetch, currentUser, users, homework, setHomework, onOpenSettings }: Props) {
  const myClass = currentUser.class_no ?? null;
  const [view, setView] = useState<ClassView>(myClass ?? 'all');
  useEffect(() => {
    if (myClass) setView(myClass);
  }, [myClass]);

  // 追加フォーム
  const formClass = view === 'all' ? myClass : view;
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [content, setContent] = useState('');
  const [dueOverride, setDueOverride] = useState('');
  const [nextLesson, setNextLesson] = useState<{ date: string; fromTimetable: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<{ id: number; subject: string; content: string; due: string } | null>(null);
  const contentRef = useRef<HTMLInputElement>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // 教科を選んだら、時間割から次の授業日を調べる
  useEffect(() => {
    let cancelled = false;
    setNextLesson(null);
    const params = new URLSearchParams({ subject });
    if (formClass) params.set('classNo', String(formClass));
    safeFetch(`/api/homework/next-lesson?${params}`, { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.date) setNextLesson(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [subject, formClass]);

  const visible = homework.filter(h => view === 'all' || h.class_no == null || h.class_no === view);
  const pending = visible.filter(h => !h.my_done).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
  const done = visible.filter(h => h.my_done).sort((a, b) => b.due_date.localeCompare(a.due_date));

  // 期限ごとにまとめる
  const groups: { key: string; title: string; items: Homework[] }[] = [];
  for (const h of pending) {
    const d = daysFromToday(h.due_date);
    const key = d < 0 ? 'overdue' : h.due_date;
    const title = d < 0 ? '期限が過ぎた宿題' : `${shortDateLabel(h.due_date)}${d === 0 ? ' · 今日' : d === 1 ? ' · 明日' : ''}`;
    const g = groups.find(x => x.key === key);
    if (g) g.items.push(h);
    else groups.push({ key, title, items: [h] });
  }

  const classSize = (classNo: number | null) => {
    const n = classNo ? users.filter(u => u.class_no === classNo).length : 0;
    return n > 0 ? n : users.length;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const res = await safeFetch('/api/homework', {
        method: 'POST',
        headers,
        body: JSON.stringify({ subject, content: content.trim(), dueDate: dueOverride || undefined, classNo: formClass ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '登録できませんでした');
      setHomework(prev => (prev.some(h => h.id === data.id) ? prev : [...prev, data]));
      setContent('');
      setDueOverride('');
      toast(`宿題を登録しました (${shortDateLabel(data.due_date)}まで)`, { kind: 'success' });
      contentRef.current?.focus();
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (h: Homework) => {
    const next = !h.my_done;
    setHomework(prev => prev.map(x => (x.id === h.id ? { ...x, my_done: next, done_count: Math.max(0, x.done_count + (next ? 1 : -1)) } : x)));
    try {
      const res = await safeFetch(`/api/homework/${h.id}/done`, { method: 'PUT', headers, body: JSON.stringify({ done: next }) });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setHomework(prev => prev.map(x => (x.id === h.id ? { ...x, my_done: d.done, done_count: d.doneCount } : x)));
    } catch {
      setHomework(prev => prev.map(x => (x.id === h.id ? { ...x, my_done: h.my_done, done_count: h.done_count } : x)));
      toast('保存できませんでした', { kind: 'error' });
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.content.trim()) return;
    const res = await safeFetch(`/api/homework/${editing.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ subject: editing.subject, content: editing.content.trim(), dueDate: editing.due }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      toast(data.error || '保存できませんでした', { kind: 'error' });
      return;
    }
    setHomework(prev => prev.map(x => (x.id === data.id ? { ...x, ...data, my_done: x.my_done } : x)));
    setEditing(null);
  };

  const remove = async (h: Homework) => {
    const ok = await confirmDialog({
      title: `「${h.subject}: ${h.content.slice(0, 30)}」を削除しますか？`,
      message: '全員の一覧から消えます。設定の監査ログから復元できます。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    const res = await safeFetch(`/api/homework/${h.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (res && res.ok) setHomework(prev => prev.filter(x => x.id !== h.id));
    else toast('削除できませんでした', { kind: 'error' });
  };

  const renderItem = (h: Homework) => {
    const days = daysFromToday(h.due_date);
    const due = dueLabel(days);
    const isEditing = editing?.id === h.id;
    return (
      <div
        key={h.id}
        className={`group flex items-start gap-3 p-3 rounded-xl border transition anim-fade ${
          h.my_done ? 'bg-[#111214]/60 border-stone-800/60' : 'bg-[#111214] border-stone-800 hover:border-stone-700'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleDone(h)}
          aria-pressed={h.my_done}
          aria-label={h.my_done ? 'やっていないに戻す' : 'やった'}
          className={`mt-0.5 w-6 h-6 shrink-0 rounded-lg border-2 flex items-center justify-center transition ${
            h.my_done ? 'bg-emerald-500 border-emerald-400 text-black' : 'border-stone-600 hover:border-amber-400 text-transparent hover:text-amber-400/60'
          }`}
        >
          <Check className="w-4 h-4" strokeWidth={3} />
        </button>

        {isEditing ? (
          <div className="flex-1 min-w-0 space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <select
                value={editing.subject}
                onChange={e => setEditing({ ...editing, subject: e.target.value })}
                className="bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1.5 text-white"
              >
                {Array.from(new Set([...SUBJECTS, 'その他', editing.subject])).map(s => <option key={s}>{s}</option>)}
              </select>
              <input
                type="date"
                value={editing.due}
                onChange={e => setEditing({ ...editing, due: e.target.value })}
                className="bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1.5 text-white"
              />
            </div>
            <input
              autoFocus
              value={editing.content}
              onChange={e => setEditing({ ...editing, content: e.target.value })}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') setEditing(null);
              }}
              className="w-full bg-[#16181D] border border-amber-500/60 rounded-lg px-2.5 py-1.5 text-white focus:outline-none"
            />
            <div className="flex gap-2">
              <button onClick={saveEdit} className="px-3 py-1 rounded-lg btn-primary font-bold">保存</button>
              <button onClick={() => setEditing(null)} className="px-3 py-1 rounded-lg btn-ghost">キャンセル</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold">{h.subject}</span>
              {!h.my_done && <span className={`px-1.5 py-0.5 rounded-md border font-bold ${due.cls}`}>{due.text}</span>}
              <span className="text-stone-500">{shortDateLabel(h.due_date)}まで</span>
              {view === 'all' && <span className="text-stone-600">{h.class_no ? `${h.class_no}組` : '全クラス'}</span>}
            </div>
            <div className={`mt-1 text-sm whitespace-pre-wrap break-words ${h.my_done ? 'text-stone-500 line-through' : 'text-stone-100'}`}>{h.content}</div>
            <div className="mt-1 text-[10px] text-stone-600">
              ✓ {h.done_count}/{classSize(h.class_no)}人がやった{h.username ? ` · 登録: ${h.username}` : ''}
            </div>
          </div>
        )}

        {!isEditing && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition">
            <button
              onClick={() => setEditing({ id: h.id, subject: h.subject, content: h.content, due: h.due_date })}
              className="p-1.5 rounded-lg text-stone-500 hover:text-white hover:bg-stone-800"
              title="編集"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => remove(h)} className="p-1.5 rounded-lg text-stone-500 hover:text-red-400 hover:bg-stone-800" title="削除">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const shownDue = dueOverride || nextLesson?.date || '';

  return (
    <div className="flex-1 p-3 sm:p-6 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold font-['Space_Grotesk'] text-white flex items-center gap-2">
              <BookOpenCheck className="w-6 h-6 text-amber-400" /> 宿題
            </h2>
            <p className="text-[11px] text-stone-500 mt-0.5">次の授業までにやってくるもの。締切が決まったしっかりした提出物は「提出物」タブへ。</p>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {CLASS_NUMBERS.map(n => (
              <button
                key={n}
                onClick={() => setView(n)}
                className={`px-2.5 py-1 rounded-lg border ${
                  view === n ? 'bg-amber-500 text-black font-bold border-amber-400' : 'border-stone-800 text-stone-400 hover:text-white hover:border-stone-600'
                }`}
              >
                {n}組{n === myClass ? ' ★' : ''}
              </button>
            ))}
            <button
              onClick={() => setView('all')}
              className={`px-2.5 py-1 rounded-lg border ${
                view === 'all' ? 'bg-amber-500 text-black font-bold border-amber-400' : 'border-stone-800 text-stone-400 hover:text-white hover:border-stone-600'
              }`}
            >
              すべて
            </button>
          </div>
        </div>

        {!myClass && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            <span className="flex-1 min-w-[12rem]">自分のクラスが未設定です。設定すると、時間割から「次の授業日」が自動で入り、自分のクラスの宿題が最初に表示されます。</span>
            <button onClick={onOpenSettings} className="px-3 py-1.5 rounded-lg btn-primary font-bold flex items-center gap-1">
              <Settings className="w-3.5 h-3.5" /> クラスを設定
            </button>
          </div>
        )}

        {/* 追加フォーム */}
        <form onSubmit={handleAdd} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-3 sm:p-4 space-y-2.5 text-xs">
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {[...SUBJECTS, 'その他'].map(s => (
              <button
                type="button"
                key={s}
                onClick={() => {
                  setSubject(s);
                  setDueOverride('');
                  contentRef.current?.focus();
                }}
                className={`shrink-0 px-2.5 py-1 rounded-lg border ${
                  subject === s ? 'bg-amber-500 text-black font-bold border-amber-400' : 'bg-[#16181D] border-stone-800 text-stone-300 hover:text-white hover:border-stone-500'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              ref={contentRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={`${subject}の宿題 (例: ワーク P.12〜13、漢字練習)`}
              className="flex-1 min-w-0 bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-sm text-white placeholder-stone-600 focus:outline-none focus:border-amber-500/60"
            />
            <button type="submit" disabled={!content.trim() || saving} className="px-4 py-2 rounded-xl btn-primary font-bold disabled:opacity-40 flex items-center justify-center gap-1">
              <Plus className="w-4 h-4" /> 追加
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-stone-400">
            <span>期限:</span>
            <input
              type="date"
              value={shownDue}
              onChange={e => setDueOverride(e.target.value)}
              className="bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1 text-white"
            />
            {!dueOverride && nextLesson && (
              <span className="text-stone-500">
                {nextLesson.fromTimetable ? `次の${subject}の授業 (${formClass ?? 1}組の時間割)` : '時間割に無いので次の平日'}
              </span>
            )}
            {dueOverride && (
              <button type="button" onClick={() => setDueOverride('')} className="text-stone-500 hover:text-white underline">
                次の授業日に戻す
              </button>
            )}
            <span className="ml-auto text-stone-600">{formClass ? `${formClass}組に登録` : '全クラスに登録'}</span>
          </div>
        </form>

        {/* 一覧 */}
        {pending.length === 0 ? (
          <div className="p-8 text-center text-stone-600 text-xs border border-dashed border-stone-800 rounded-2xl">
            やっていない宿題はありません 🎉
          </div>
        ) : (
          groups.map(g => (
            <div key={g.key} className="space-y-1.5">
              <div className={`text-[11px] font-bold px-1 ${g.key === 'overdue' ? 'text-red-400' : 'text-stone-400'}`}>{g.title}</div>
              {g.items.map(renderItem)}
            </div>
          ))
        )}

        {done.length > 0 && (
          <div className="space-y-1.5">
            <button onClick={() => setShowDone(v => !v)} className="flex items-center gap-1 text-[11px] font-bold text-stone-500 hover:text-stone-300 px-1">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDone ? '' : '-rotate-90'}`} />
              やった宿題 ({done.length})
            </button>
            {showDone && done.map(renderItem)}
          </div>
        )}
      </div>
    </div>
  );
}
