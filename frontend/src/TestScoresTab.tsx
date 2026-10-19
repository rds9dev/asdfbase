// テスト点数: 中間 / 期末 / 学年末 / 診断テストを分けて記録・分析
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Award, Plus, Sparkles, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { confirmDialog, toast } from './ui';
import { MAIN_SUBJECTS, PRACTICAL_SUBJECTS } from './schedule';

type ExamType = 'midterm' | 'final' | 'yearend' | 'diagnostic';
const EXAM_TYPES: { id: ExamType; label: string }[] = [
  { id: 'midterm', label: '中間テスト' },
  { id: 'final', label: '期末テスト' },
  { id: 'yearend', label: '学年末テスト' },
  { id: 'diagnostic', label: '診断テスト' },
];

interface TestScore {
  id: number;
  user_id: number;
  username?: string;
  exam_type: ExamType;
  exam_label: string;
  subject: string;
  score: number | string;
  max_score: number | string;
  created_at: string;
}

interface Props {
  token: string;
  safeFetch: (input: string, init?: RequestInit) => Promise<Response>;
  currentUser: { id: number; username: string; role: string };
  users: { id: number; username: string }[];
}

export default function TestScoresTab({ token, safeFetch, currentUser, users }: Props) {
  const [examType, setExamType] = useState<ExamType>('midterm');
  const [viewUserId, setViewUserId] = useState<number>(currentUser.id);
  const [scores, setScores] = useState<TestScore[]>([]);
  const [label, setLabel] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [withPractical, setWithPractical] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advice, setAdvice] = useState<Record<string, string>>({});
  const [adviceLoading, setAdviceLoading] = useState(false);
  const isMine = viewUserId === currentUser.id;

  const load = async (userId = viewUserId) => {
    try {
      const res = await safeFetch(`/api/test-scores?userId=${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setScores(await res.json());
    } catch (_) {}
  };

  useEffect(() => {
    load(viewUserId);
  }, [viewUserId]);

  useEffect(() => {
    setWithPractical(examType === 'final' || examType === 'yearend');
  }, [examType]);

  const ofType = scores.filter(s => (s.exam_type || 'midterm') === examType);
  // 回ごと (古い順)
  const sittings = useMemo(() => {
    const map = new Map<string, TestScore[]>();
    for (const s of ofType) {
      const key = s.exam_label || '(回の指定なし)';
      map.set(key, [...(map.get(key) || []), s]);
    }
    return Array.from(map.entries()).map(([name, rows]) => {
      const total = rows.reduce((a, r) => a + Number(r.score), 0);
      const max = rows.reduce((a, r) => a + Number(r.max_score), 0);
      return { name, rows, total, max };
    });
  }, [ofType]);
  const subjects = Array.from(new Set([...MAIN_SUBJECTS, ...PRACTICAL_SUBJECTS, ...ofType.map(s => s.subject)])).filter(sub =>
    ofType.some(s => s.subject === sub)
  );
  const pastLabels = Array.from(new Set(scores.map(s => s.exam_label).filter(Boolean)));
  const inputSubjects = withPractical ? [...MAIN_SUBJECTS, ...PRACTICAL_SUBJECTS] : MAIN_SUBJECTS;

  const save = async () => {
    const entries = inputSubjects
      .filter(sub => draft[sub] !== undefined && draft[sub] !== '')
      .map(sub => ({ subject: sub, score: Number(draft[sub]), maxScore: 100 }));
    if (!label.trim()) {
      toast('何回目のテストか入力してください (例: 1年 1学期)', { kind: 'error' });
      return;
    }
    if (entries.length === 0) {
      toast('点数を1つ以上入力してください', { kind: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await safeFetch('/api/test-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ examType, examLabel: label.trim(), entries }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存に失敗しました');
      setDraft({});
      await load();
      toast(`${label.trim()} の点数を保存しました`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ids: number[], what: string) => {
    const ok = await confirmDialog({ title: `${what}を削除しますか？`, message: '削除した点数は元に戻せません。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
    for (const id of ids) {
      await safeFetch(`/api/test-scores/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    }
    setScores(prev => prev.filter(s => !ids.includes(s.id)));
    toast('削除しました', { kind: 'success' });
  };

  const getAdvice = async () => {
    setAdviceLoading(true);
    try {
      const res = await safeFetch('/api/test-scores/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ examType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.advice) throw new Error(data.error || 'アドバイスを取得できませんでした');
      setAdvice(prev => ({ ...prev, [examType]: data.advice }));
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    } finally {
      setAdviceLoading(false);
    }
  };

  const typeLabel = EXAM_TYPES.find(t => t.id === examType)!.label;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl sm:text-2xl font-bold text-white">テスト点数</h2>
          <select
            value={viewUserId}
            onChange={e => setViewUserId(Number(e.target.value))}
            className="bg-[#14161C] border border-stone-800 text-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
          >
            <option value={currentUser.id}>自分</option>
            {users.filter(u => u.id !== currentUser.id).map(u => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-1 p-1 bg-[#111214] border border-stone-800 rounded-xl overflow-x-auto text-xs">
          {EXAM_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setExamType(t.id)}
              className={`flex-1 min-w-max px-3 py-2 rounded-lg transition ${examType === t.id ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white hover:bg-stone-800/60'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isMine && (
          <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 space-y-3 text-xs anim-fade">
            <div className="flex items-center gap-1.5 text-white font-bold">
              <Plus className="w-4 h-4 text-amber-400" /> {typeLabel}の点数を記録
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                list="exam-labels"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="回 (例: 1年 2学期)"
                className="flex-1 min-w-[10rem] bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
              />
              <datalist id="exam-labels">
                {pastLabels.map(l => <option key={l} value={l} />)}
              </datalist>
              <label className="flex items-center gap-1.5 text-stone-400 cursor-pointer select-none">
                <input type="checkbox" checked={withPractical} onChange={e => setWithPractical(e.target.checked)} className="accent-amber-500" />
                実技4教科も入力
              </label>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {inputSubjects.map(sub => (
                <label key={sub} className="flex flex-col gap-1">
                  <span className="text-stone-400">{sub}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={draft[sub] ?? ''}
                    onChange={e => setDraft(d => ({ ...d, [sub]: e.target.value }))}
                    placeholder="-"
                    className="bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-2 text-white text-sm tabular-nums focus:outline-none focus:border-amber-500/60"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl btn-primary font-bold disabled:opacity-50">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}

        {sittings.length === 0 ? (
          <div className="p-8 text-center text-stone-600 text-xs border border-dashed border-stone-800 rounded-2xl">
            {typeLabel}の記録はまだありません
          </div>
        ) : (
          <>
            {/* 回ごとの合計 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...sittings].reverse().map((s, i, arr) => {
                const prev = arr[i + 1];
                const avg = s.rows.length ? s.total / s.rows.length : 0;
                const diff = prev ? s.total - prev.total : null;
                return (
                  <div key={s.name} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 space-y-2.5 text-xs interactive-card anim-fade">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white text-sm flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-amber-400" /> {s.name}
                      </span>
                      {isMine && (
                        <button onClick={() => remove(s.rows.map(r => r.id), `「${s.name}」の記録`)} className="p-1 rounded text-stone-600 hover:text-red-400" aria-label="この回を削除">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-black text-white tabular-nums">{s.total}</span>
                      <span className="text-stone-500">/ {s.max}点 · 平均 {avg.toFixed(1)}</span>
                      {diff !== null && diff !== 0 && (
                        <span className={`ml-auto flex items-center gap-0.5 font-bold ${diff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {diff > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.rows.map(r => (
                        <span key={r.id} className="group flex items-center gap-1 px-2 py-1 rounded-lg bg-[#16181D] border border-stone-800">
                          <span className="text-stone-400">{r.subject}</span>
                          <span className="font-bold text-amber-300 tabular-nums">{Number(r.score)}</span>
                          {isMine && (
                            <button onClick={() => remove([r.id], `${s.name} の ${r.subject}`)} className="hidden group-hover:inline text-stone-600 hover:text-red-400" aria-label="削除">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 教科ごとの推移 */}
            {sittings.length >= 1 && (
              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl overflow-x-auto text-xs">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="text-stone-500 border-b border-stone-800">
                      <th className="text-left font-bold px-3 py-2">教科</th>
                      {sittings.map(s => <th key={s.name} className="px-3 py-2 font-bold whitespace-nowrap">{s.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map(sub => (
                      <tr key={sub} className="border-b border-stone-800/50 last:border-0">
                        <td className="px-3 py-2 text-stone-300 font-bold whitespace-nowrap">{sub}</td>
                        {sittings.map((s, i) => {
                          const row = s.rows.find(r => r.subject === sub);
                          const prevRow = i > 0 ? sittings[i - 1].rows.find(r => r.subject === sub) : undefined;
                          const d = row && prevRow ? Number(row.score) - Number(prevRow.score) : 0;
                          return (
                            <td key={s.name} className="px-3 py-2 text-center tabular-nums">
                              {row ? (
                                <span className="text-white">
                                  {Number(row.score)}
                                  {d !== 0 && <span className={`ml-1 text-[10px] ${d > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>}
                                </span>
                              ) : (
                                <span className="text-stone-700">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {isMine && (
          <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-bold text-white">
                <Sparkles className="w-4 h-4 text-amber-400" /> {typeLabel}の AI アドバイス
              </span>
              {(
                <button onClick={getAdvice} disabled={adviceLoading || ofType.length === 0} className="px-4 py-1.5 rounded-xl btn-primary font-bold disabled:opacity-40">
                  {adviceLoading ? '分析中…' : 'アドバイスをもらう'}
                </button>
              )}
            </div>
            {advice[examType] && (
              <div className="markdown-body bg-[#16181D] border border-amber-500/20 rounded-xl p-4 text-sm text-stone-200 anim-fade">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{advice[examType]}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
