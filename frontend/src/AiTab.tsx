// AI タブ: チャンネル風の会話履歴スレッド管理 (アカウント同期) + 性格カスタマイズ対応
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Check, Copy, Globe, Hash, Image as ImageIcon, Menu, MessageSquarePlus, Pencil, Plus, Search, Send, Sparkles, Trash2, UserCheck, Wrench, X, Zap, Brain, Activity, RotateCcw } from 'lucide-react';
import { confirmDialog, toast } from './ui';

interface AiStep {
  name: string;
  label: string;
  ok: boolean;
  write: boolean;
  diff?: {
    target: string;
    slot?: number;
    oldText: string;
    newText: string;
    lines: Array<{ type: 'same' | 'add' | 'del'; text: string }>;
  };
}

interface AiMessage {
  id: number;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  error?: boolean;
  steps?: AiStep[];
  // 履歴に残すのは小さいサムネイルだけ
  thumbs?: string[];
}

interface AiThread {
  id: number;
  title: string;
  persona: string;
  custom_persona: string;
  messages: AiMessage[];
  updated_at: string;
}

interface PendingImage {
  id: number;
  mimeType: string;
  data: string;
  thumb: string;
}

export interface AvailableMemoSlot {
  slot: number;
  title: string;
}

export interface AiTabProps {
  active: boolean;
  userId: number;
  token: string;
  safeFetch: (input: string, init?: RequestInit) => Promise<Response>;
  buildContext: () => object;
  memo: { slot: number; title: string; content: string };
  availableSlots?: AvailableMemoSlot[];
  onAppendToMemo: (text: string, targetSlot?: number) => void;
  onApplyDiff?: (slot: number, newContent: string) => void;
  backgroundJobProgress?: string | null;
  onJobStarted?: () => void;
  onJobFinished?: () => void;
}

function CodeBlockWithCopy({ inline, className, children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const text = String(children).replace(/\n$/, '');

  if (inline) {
    return (
      <code className="bg-[#1c1d22] text-amber-300 font-mono text-[12px] px-1.5 py-0.5 rounded border border-stone-800" {...props}>
        {children}
      </code>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group/code my-3 rounded-xl border border-stone-800 bg-[#0B0C0E] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#121316] border-b border-stone-800/80 text-[11px] font-mono text-stone-400">
        <span className="uppercase text-[10px] tracking-wider text-amber-400/80 font-bold">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white transition text-[10px]"
          title="コードをコピー"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'コピー完了' : 'コピー'}</span>
        </button>
      </div>
      <pre className="p-3 font-mono text-xs overflow-x-auto text-stone-200 leading-relaxed">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function DiffViewer({
  diff,
  onApply,
}: {
  diff: NonNullable<AiStep['diff']>;
  onApply?: (slot: number, newContent: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [applied, setApplied] = useState(false);

  return (
    <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-[#0F1013] overflow-hidden text-xs shadow-lg">
      <div className="px-3 py-2 bg-gradient-to-r from-stone-900 via-[#15171E] to-stone-900 border-b border-stone-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 font-mono text-[11px] text-amber-300 hover:text-white font-bold"
        >
          <span>{open ? '▼' : '▶'}</span>
          <span>変更差分: {diff.target}</span>
        </button>
        <div className="flex items-center gap-1.5">
          {onApply && diff.slot && !applied && (
            <button
              type="button"
              onClick={() => {
                onApply(diff.slot!, diff.newText);
                setApplied(true);
                toast(`メモ #${diff.slot} に差分を適用しました`, { kind: 'success' });
              }}
              className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold text-[11px] flex items-center gap-1.5 transition shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-pulse hover:animate-none"
            >
              <Check className="w-3.5 h-3.5 stroke-[3]" />
              差分を適用する
            </button>
          )}
          {onApply && diff.slot && applied && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> 適用済み
              </span>
              <button
                type="button"
                onClick={() => {
                  onApply(diff.slot!, diff.oldText);
                  setApplied(false);
                  toast(`メモ #${diff.slot} の差分を元に戻しました`, { kind: 'success' });
                }}
                className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-[10px] font-bold flex items-center gap-1 transition border border-stone-700"
                title="適用前の状態に戻す"
              >
                <RotateCcw className="w-3 h-3 text-amber-400" />
                元に戻す
              </button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="p-2 font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto space-y-0.5 divide-y divide-stone-900/40">
          {diff.lines.map((l, i) => (
            <div
              key={i}
              className={`px-2 py-0.5 rounded flex items-start gap-2 ${
                l.type === 'add'
                  ? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500'
                  : l.type === 'del'
                  ? 'bg-red-950/40 text-red-300 border-l-2 border-red-500 line-through opacity-80'
                  : 'text-stone-400'
              }`}
            >
              <span className="select-none font-bold shrink-0 w-3 text-center opacity-60">
                {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
              </span>
              <span className="break-all whitespace-pre-wrap">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PERSONA_OPTIONS = [
  { id: 'standard', label: '標準 (親切・簡潔)', short: '標準' },
  { id: 'teacher', label: 'やさしい先生 (丁寧・わかりやすい)', short: '先生' },
  { id: 'friend', label: '友達・タメ口 (気軽・親しみやすい)', short: '友達' },
  { id: 'coach', label: '厳格コーチ (論理的・ストイック)', short: 'コーチ' },
  { id: 'cheer', label: 'ハイテンション応援団 (全力肯定)', short: '応援団' },
  { id: 'tsundere', label: 'ツンデレ (ぶっきらぼう・心は親切)', short: 'ツンデレ' },
  { id: 'kansai', label: '関西弁 (親しみやすい・テンポ良い)', short: '関西弁' },
  { id: 'custom', label: 'カスタム (自由入力)', short: 'カスタム' },
];

const SUGGESTIONS = [
  '今日の時間割と持ち物は？',
  '未提出・締切が近い提出物を要約してチェックして',
  '現在のメモの内容を校正・改善して',
  '今週の予定をまとめて',
  'テストの点数から苦手な教科を分析して',
  '明日の天気は？',
];

// 画像を縮小して base64 に (送信用は長辺1536px、履歴用サムネイルは160px)
async function shrinkImage(file: File): Promise<{ mimeType: string; data: string; thumb: string }> {
  const bitmap = await createImageBitmap(file);
  const draw = (max: number, quality: number) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
  const full = draw(1536, 0.85);
  const thumb = draw(160, 0.7);
  bitmap.close();
  return { mimeType: 'image/jpeg', data: full.split(',')[1], thumb };
}

const MAX_HISTORY = 200;
const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function loadHistory(key: string): AiMessage[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function AiTab({
  active,
  userId,
  token,
  safeFetch,
  buildContext,
  memo,
  availableSlots,
  onAppendToMemo,
  onApplyDiff,
  backgroundJobProgress,
  onJobStarted,
  onJobFinished,
}: AiTabProps) {
  const storageKey = `asdf_ai_history_${userId}`;
  const [threads, setThreads] = useState<AiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const activeThreadIdRef = useRef<number | null>(null);
  activeThreadIdRef.current = activeThreadId;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>(() => loadHistory(storageKey));
  const [persona, setPersona] = useState<string>('standard');
  const [customPersona, setCustomPersona] = useState<string>('');
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingThreadId, setLoadingThreadId] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isNearBottomRef = useRef(true);
  const [images, setImages] = useState<PendingImage[]>([]);
  // モデル切り替え: 高速 (gemini-3.5-flash-lite) / 思考 (gemini-3.8-flash)
  const [modelMode, setModelMode] = useState<'fast' | 'thinking'>('fast');
  const [usageStats, setUsageStats] = useState<any>(null);
  const [showUsageModal, setShowUsageModal] = useState(false);
  // 「Web検索」ボタン: 押した時はこの質問で必ず検索する (押さなくても AI が必要と判断すれば検索する)
  const [forceWebSearch, setForceWebSearch] = useState(false);
  const [appendMenuMsgId, setAppendMenuMsgId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 少しずつ表示中のメッセージ
  const [reveal, setReveal] = useState<{ id: number; shown: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // スレッド一覧の取得と初期化
  const fetchThreads = async () => {
    try {
      const res = await safeFetch('/api/ai/threads', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const list: AiThread[] = await res.json();
      if (list.length > 0) {
        setThreads(list);
        const cur = list.find(t => t.id === activeThreadId) || list[0];
        setActiveThreadId(cur.id);
        setMessages(Array.isArray(cur.messages) ? cur.messages : []);
        setPersona(cur.persona || 'default');
        setCustomPersona(cur.custom_persona || '');
      } else {
        // 既存のローカル履歴があれば初回スレッドとして移行
        const legacy = loadHistory(storageKey);
        const createRes = await safeFetch('/api/ai/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title: legacy.length > 0 ? (legacy[0].content.slice(0, 24) || 'これまでの会話') : '新しい会話',
            persona: 'default',
            custom_persona: '',
            messages: legacy.slice(-MAX_HISTORY),
          }),
        });
        if (createRes.ok) {
          const created: AiThread = await createRes.json();
          setThreads([created]);
          setActiveThreadId(created.id);
          setMessages(Array.isArray(created.messages) ? created.messages : []);
          setPersona(created.persona || 'default');
          setCustomPersona(created.custom_persona || '');
        }
      }
    } catch (_) {}
  };

  // 利用枠統計の取得
  const fetchUsage = async () => {
    try {
      const res = await safeFetch('/api/ai/usage', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUsageStats(data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchThreads();
  }, [userId]);

  useEffect(() => {
    if (active) fetchUsage();
  }, [active]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch (_) {}
  }, [messages, storageKey]);

  const selectThread = (t: AiThread) => {
    setActiveThreadId(t.id);
    setMessages(Array.isArray(t.messages) ? t.messages : []);
    setPersona(t.persona || 'default');
    setCustomPersona(t.custom_persona || '');
    setReveal(null);
    setSidebarOpen(false);
  };

  const syncThreadToServer = async (
    threadId: number | null,
    patch: { title?: string; persona?: string; custom_persona?: string; messages?: AiMessage[] }
  ) => {
    if (!threadId) return null;
    try {
      const res = await safeFetch(`/api/ai/threads/${threadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated: AiThread = await res.json();
        setThreads(prev => [updated, ...prev.filter(t => t.id !== updated.id)]);
        return updated;
      }
    } catch (_) {}
    return null;
  };

  const createNewThread = async () => {
    try {
      const res = await safeFetch('/api/ai/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: '新しい会話',
          persona,
          custom_persona: customPersona,
          messages: [],
        }),
      });
      if (res.ok) {
        const created: AiThread = await res.json();
        setThreads(prev => [created, ...prev]);
        selectThread(created);
      }
    } catch (_) {
      toast('新しい会話の作成に失敗しました', { kind: 'error' });
    }
  };

  const deleteThread = async (t: AiThread) => {
    const ok = await confirmDialog({
      title: `「${t.title}」を削除しますか？`,
      message: 'このスレッドの会話履歴が削除されます。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    try {
      await safeFetch(`/api/ai/threads/${t.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const remaining = threads.filter(item => item.id !== t.id);
      setThreads(remaining);
      if (activeThreadId === t.id) {
        if (remaining.length > 0) {
          selectThread(remaining[0]);
        } else {
          await createNewThread();
        }
      }
      toast('会話を削除しました', { kind: 'success' });
    } catch (_) {
      toast('削除に失敗しました', { kind: 'error' });
    }
  };

  const savePersonaSettings = async (nextPersona: string, nextCustom: string) => {
    setPersona(nextPersona);
    setCustomPersona(nextCustom);
    if (activeThreadId) {
      await syncThreadToServer(activeThreadId, { persona: nextPersona, custom_persona: nextCustom });
    }
    toast('AIの性格設定を更新しました', { kind: 'success' });
    setShowPersonaModal(false);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setLoadingThreadId(null);
    onJobFinished?.();
    toast('AIの応答を中断しました', { kind: 'success' });
  };

  // 開いた時は一番下から
  useLayoutEffect(() => {
    if (active) scrollToBottom(false);
  }, [active, activeThreadId]);
  useEffect(() => {
    if (isNearBottomRef.current) scrollToBottom(true);
  }, [messages.length, loading, loadingThreadId]);

  // 返信を 60fps の requestAnimationFrame で滑らかにストリーミング表示 + スムーズスクロール追従
  useEffect(() => {
    if (!reveal) return;
    const msg = messages.find(m => m.id === reveal.id);
    if (!msg || reveal.shown >= msg.content.length) {
      setReveal(null);
      return;
    }
    let rafId = 0;
    let lastTime = performance.now();
    let floatShown = reveal.shown;
    const totalLen = msg.content.length;
    // 全文を約 0.9〜2.2 秒で滑らかに流し込む速度 (文字数に応じて自動調整)
    const charsPerMs = Math.max(0.09, Math.min(0.85, totalLen / 1600));

    const tick = (now: number) => {
      const dt = Math.min(50, Math.max(8, now - lastTime));
      lastTime = now;
      floatShown = Math.min(totalLen, floatShown + dt * charsPerMs);
      const nextShown = Math.ceil(floatShown);

      setReveal(prev => {
        if (!prev || prev.id !== msg.id) return null;
        if (nextShown >= totalLen) return null;
        return prev.shown === nextShown ? prev : { id: msg.id, shown: nextShown };
      });

      if (isNearBottomRef.current && scrollRef.current) {
        const el = scrollRef.current;
        const target = el.scrollHeight - el.clientHeight;
        const diff = target - el.scrollTop;
        if (diff > 1) {
          el.scrollTop += diff * 0.25;
        }
      }

      if (nextShown < totalLen) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [reveal?.id, messages]);

  const addImages = async (files: File[]) => {
    const list = files.filter(f => f.type.startsWith('image/')).slice(0, 4 - images.length);
    if (list.length === 0) return;
    try {
      const shrunk = await Promise.all(list.map(shrinkImage));
      setImages(prev => [...prev, ...shrunk.map((im, i) => ({ ...im, id: Date.now() + i }))].slice(0, 4));
    } catch {
      toast('画像を読み込めませんでした', { kind: 'error' });
    }
    inputRef.current?.focus();
  };

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if ((!text && images.length === 0) || loading) return;
    const sentImages = images;
    const webSearch = forceWebSearch;
    const targetThreadId = activeThreadId;
    const userMsg: AiMessage = {
      id: Date.now(), role: 'user', content: text || 'この画像について教えて', timestamp: timeNow(),
      thumbs: sentImages.length ? sentImages.map(im => im.thumb) : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setImages([]);
    setForceWebSearch(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    setLoadingThreadId(targetThreadId);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const currentThread = threads.find(t => t.id === targetThreadId);
    const autoTitle =
      currentThread && (currentThread.title === '新しい会話' || !currentThread.title) && text
        ? text.replace(/\s+/g, ' ').slice(0, 26)
        : currentThread?.title;

    onJobStarted?.();

    try {
      // 1. まず非同期ジョブ API (タイムアウト対策) を試行
      const jobRes = await safeFetch('/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: abortController.signal,
        body: JSON.stringify({
          messages: next.filter(m => !m.error).slice(-30).map(m => ({ role: m.role, content: m.content })),
          contextData: buildContext(),
          images: sentImages.map(im => ({ mimeType: im.mimeType, data: im.data })),
          webSearch,
          modelMode,
          persona,
          customPersona,
          threadId: targetThreadId,
        }),
      });

      let finalReply = '';
      let finalSteps: AiStep[] | undefined = undefined;

      if (jobRes.status === 202) {
        const { jobId } = await jobRes.json();
        // ジョブ完了までポーリング監視 (最大180秒)
        let done = false;
        let attempts = 0;
        while (!done && attempts < 90) {
          if (abortController.signal.aborted) throw new Error('ユーザーにより中断されました');
          await new Promise(r => setTimeout(r, 2000));
          attempts++;
          try {
            const checkRes = await safeFetch(`/api/ai/jobs/${jobId}`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: abortController.signal,
            });
            if (checkRes.ok) {
              const jobData = await checkRes.json();
              if (jobData.status === 'completed') {
                finalReply = jobData.result?.reply || '';
                finalSteps = jobData.result?.steps;
                done = true;
                break;
              } else if (jobData.status === 'failed') {
                throw new Error(jobData.error || 'AI の処理に失敗しました');
              }
            }
          } catch (e: any) {
            if (abortController.signal.aborted) throw e;
            if (attempts > 60) throw e;
          }
        }
        if (!done) throw new Error('AI の応答がタイムアウトしました');
      } else {
        // フォールバック: 通常の同期 chat
        const res = await safeFetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          signal: abortController.signal,
          body: JSON.stringify({
            messages: next.filter(m => !m.error).slice(-30).map(m => ({ role: m.role, content: m.content })),
            contextData: buildContext(),
            images: sentImages.map(im => ({ mimeType: im.mimeType, data: im.data })),
            webSearch,
            modelMode,
            persona,
            customPersona,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.reply) throw new Error(data.error || 'AI の応答に失敗しました');
        finalReply = data.reply;
        finalSteps = Array.isArray(data.steps) && data.steps.length ? data.steps : undefined;
      }

      const reply: AiMessage = {
        id: Date.now() + 1,
        role: 'model',
        content: finalReply,
        timestamp: timeNow(),
        steps: finalSteps,
      };
      if (reply.steps?.some(st => st.write && st.ok)) toast('AI が操作を実行しました', { kind: 'success' });
      const finalMessages = [...next, reply].slice(-MAX_HISTORY);
      if (activeThreadIdRef.current === targetThreadId) {
        setMessages(finalMessages);
        setReveal({ id: reply.id, shown: 0 });
      }
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, messages: finalMessages, title: autoTitle || t.title } : t));
      await syncThreadToServer(targetThreadId, {
        title: autoTitle,
        persona,
        custom_persona: customPersona,
        messages: finalMessages,
      });
      fetchUsage();
    } catch (err: any) {
      const errMsg: AiMessage = {
        id: Date.now() + 1,
        role: 'model',
        content: err.message || 'AI の応答に失敗しました',
        timestamp: timeNow(),
        error: true,
      };
      const finalMessages = [...next, errMsg].slice(-MAX_HISTORY);
      if (activeThreadIdRef.current === targetThreadId) {
        setMessages(finalMessages);
      }
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, messages: finalMessages, title: autoTitle || t.title } : t));
      await syncThreadToServer(targetThreadId, {
        title: autoTitle,
        messages: finalMessages,
      });
    } finally {
      setLoading(false);
      setLoadingThreadId(null);
      onJobFinished?.();
    }
  };

  const clearHistory = async () => {
    const target = threads.find(t => t.id === activeThreadId);
    if (!target) return;
    await deleteThread(target);
  };

  const activeThread = threads.find(t => t.id === activeThreadId);
  const currentPersonaObj = PERSONA_OPTIONS.find(p => p.id === persona) || PERSONA_OPTIONS[0];

  return (
    <div className="flex-1 min-h-0 flex bg-[#0C0D10]/50 relative overflow-hidden">
      {/* モバイル用オーバーレイ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 左サイドバー: チャンネル風 AI 会話スレッド一覧 */}
      <aside
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } fixed md:static inset-y-0 left-0 z-40 w-64 shrink-0 bg-[#111214] border-r border-stone-800/80 flex flex-col transition-transform duration-200`}
      >
        <div className="h-12 px-3 border-b border-stone-800/80 flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-stone-300 flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-amber-400" />
            AI 会話チャンネル
          </span>
          <button
            onClick={createNewThread}
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] flex items-center gap-1 transition"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            新規作成
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {threads.map(t => {
            const isSelected = t.id === activeThreadId;
            const isEditing = editingThreadId === t.id;
            const pLabel = PERSONA_OPTIONS.find(p => p.id === t.persona)?.short || '標準';
            return (
              <div
                key={t.id}
                onClick={() => !isEditing && selectThread(t)}
                className={`group rounded-xl px-2.5 py-2 text-xs cursor-pointer transition flex items-center justify-between gap-1.5 ${
                  isSelected
                    ? 'bg-amber-500/15 border border-amber-500/40 text-white font-semibold'
                    : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-200 border border-transparent'
                }`}
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={e => setEditingTitle(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={async e => {
                        if (e.key === 'Enter') {
                          await syncThreadToServer(t.id, { title: editingTitle.trim() || '新しい会話' });
                          setEditingThreadId(null);
                        } else if (e.key === 'Escape') {
                          setEditingThreadId(null);
                        }
                      }}
                      onBlur={async () => {
                        await syncThreadToServer(t.id, { title: editingTitle.trim() || '新しい会話' });
                        setEditingThreadId(null);
                      }}
                      className="w-full bg-[#16181D] border border-amber-500/60 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 truncate">
                        <Hash className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-stone-500'}`} />
                        <span className="truncate">{t.title || '新しい会話'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-stone-500 pl-5">
                        <span className="px-1.5 py-0.2 rounded bg-stone-800/80 text-stone-400">{pLabel}</span>
                        <span>{(t.messages || []).length}件</span>
                      </div>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setEditingThreadId(t.id);
                        setEditingTitle(t.title || '');
                      }}
                      className="p-1 rounded text-stone-500 hover:text-stone-200"
                      title="名前を変更"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        deleteThread(t);
                      }}
                      className="p-1 rounded text-stone-500 hover:text-red-400"
                      title="セッションを削除"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* メイン会話エリア */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="h-12 shrink-0 border-b border-stone-800/80 px-3 sm:px-4 flex items-center justify-between gap-2 text-xs bg-[#111214]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(v => !v)}
              className="md:hidden p-1.5 rounded-lg border border-stone-800 text-stone-300 hover:text-white"
              title="会話一覧を開く"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 font-bold text-white truncate">
              <Hash className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate max-w-[8rem] sm:max-w-[14rem]">{activeThread?.title || '新しい会話'}</span>
            </div>

            {/* モデル切り替え */}
            <div className="flex items-center p-0.5 rounded-lg bg-stone-900 border border-stone-800 text-[11px] shrink-0">
              <button
                onClick={() => setModelMode('fast')}
                title="gemini-3.5-flash-lite (RPM:30, TPM:10M, RPD:1500)"
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition ${
                  modelMode === 'fast'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                <Zap className="w-3 h-3 text-amber-400" />
                <span>高速</span>
              </button>
              <button
                onClick={() => setModelMode('thinking')}
                title="gemini-3.8-flash (RPM:15, TPM:3M, RPD:1500)"
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition ${
                  modelMode === 'thinking'
                    ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                <Brain className="w-3 h-3 text-sky-400" />
                <span>思考</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* 利用枠インジケーター */}
            {usageStats && (
              <button
                onClick={() => setShowUsageModal(true)}
                title="クリックして5枠ローテーションとリセット時刻の詳細を表示"
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-stone-800 bg-stone-900/80 text-[11px] text-stone-300 hover:border-stone-700 hover:bg-stone-800/60"
              >
                <Activity className="w-3 h-3 text-emerald-400" />
                <span className="font-mono text-emerald-400 font-bold">
                  本日 {usageStats.dailySummary?.[modelMode]?.used ?? 0}
                </span>
                <span className="text-stone-500 hidden sm:inline">
                  / {usageStats.dailySummary?.[modelMode]?.max ?? 7500}回
                </span>
              </button>
            )}

            <button
              onClick={clearHistory}
              disabled={!activeThread}
              title="このチャットセッションを削除"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-stone-800 bg-stone-900 text-stone-300 hover:text-red-300 hover:border-red-900/70 hover:bg-red-950/30 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">チャット削除</span>
            </button>
          </div>
        </div>

        {/* 性格カスタマイズモーダル */}
        {showPersonaModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade" onClick={() => setShowPersonaModal(false)}>
            <div className="w-full max-w-md bg-[#111214] border border-stone-800 rounded-2xl p-4 sm:p-5 space-y-4 anim-pop text-xs text-stone-300" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-2 border-b border-stone-800">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <UserCheck className="w-4 h-4 text-amber-400" />
                  <span>AI の性格・話し方設定</span>
                </div>
                <button onClick={() => setShowPersonaModal(false)} className="text-stone-500 hover:text-white p-1 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="text-stone-400 font-bold">プリセットから選ぶ</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {PERSONA_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPersona(opt.id)}
                      className={`px-3 py-2 rounded-xl border text-left transition ${
                        persona === opt.id
                          ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 font-bold'
                          : 'bg-[#16181D] border-stone-800 text-stone-300 hover:border-stone-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-stone-400 font-bold">
                  カスタム性格・追加指示 (自由入力)
                </label>
                <textarea
                  rows={3}
                  value={customPersona}
                  onChange={e => setCustomPersona(e.target.value)}
                  placeholder="例: 語尾に「なのだ」をつけて話して / 数学の先生としてステップごとにヒントを出して"
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500/60 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowPersonaModal(false)}
                  className="px-4 py-2 rounded-xl border border-stone-800 text-stone-400 hover:text-white"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => savePersonaSettings(persona, customPersona)}
                  className="px-5 py-2 rounded-xl btn-primary font-bold"
                >
                  このスレッドに適用
                </button>
              </div>
            </div>
          </div>
        )}

      {/* 利用状況詳細モーダル */}
      {showUsageModal && usageStats && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade" onClick={() => setShowUsageModal(false)}>
          <div className="w-full max-w-lg bg-[#111214] border border-stone-800 rounded-2xl p-4 sm:p-5 space-y-4 anim-pop text-xs text-stone-300" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-stone-800">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>AI 枠ローテーション & 利用量</span>
              </div>
              <button onClick={() => setShowUsageModal(false)} className="text-stone-500 hover:text-white p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 bg-stone-900/50 border border-stone-800/80 rounded-xl p-3">
              <div className="text-white font-bold flex items-center justify-between">
                <span>次回リセット (PT 0:00 / 米国太平洋時間)</span>
                <span className="text-amber-400 font-mono text-[11px]">{usageStats.resetTime?.label}</span>
              </div>
              <div className="text-[11px] text-stone-500">
                5つのAPIキー枠を自動でローテーションして負荷分散しています。モデルごとに制限枠は独立してカウントされます。
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-stone-400 font-bold">5つのAPIスロット別利用状況</div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {usageStats.slots?.map((s: any) => (
                  <div key={s.slot} className="bg-stone-900/60 border border-stone-800 rounded-lg p-2.5 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">スロット #{s.slot}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] ${s.hasKey ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                          {s.hasKey ? '有効' : '未設定'}
                        </span>
                        <span className="text-stone-500 font-mono text-[10px]">{s.keyMasked}</span>
                      </div>
                      <div className="text-[10px] text-stone-400 flex gap-3">
                        <span>高速 RPD: <b className="text-stone-200">{s.fast.rpd}</b> / {s.fast.rpdLimit}</span>
                        <span>思考 RPD: <b className="text-stone-200">{s.thinking.rpd}</b> / {s.thinking.rpdLimit}</span>
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-stone-500">
                      <div>直近1分: {modelMode === 'fast' ? s.fast.rpm : s.thinking.rpm} req/m</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && !loading && (
            <div className="py-12 flex flex-col items-center gap-3 text-stone-500 text-xs anim-fade text-center">
              <Sparkles className="w-8 h-8 text-amber-400/60" />
              <div className="leading-relaxed">
                時間割・提出物・予定・メモ・チャット・テスト・天気を AI が自分で調べて答えます。<br />
                「来週の金曜に数学のワーク提出を登録して」のように頼めば、登録や追記もします。画像は Ctrl+V で貼り付けられます。
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 max-w-xl">
                {SUGGESTIONS.map(q => (
                  <button key={q} onClick={() => send(q)} className="btn-chip text-[11px]">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map(msg => {
            const isRevealing = reveal?.id === msg.id;
            const shown = isRevealing ? msg.content.slice(0, reveal!.shown) : msg.content;
            return (
              <div key={msg.id} className={`flex gap-2.5 anim-msg ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'model' && (
                  <div className="w-7 h-7 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div
                  className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3.5 py-3 text-sm leading-relaxed break-words min-w-0 ${
                    msg.role === 'user'
                      ? 'bg-amber-500 text-black'
                      : msg.error
                        ? 'bg-red-950/30 border border-red-900/60 text-red-200'
                        : 'bg-[#14161C] border border-stone-800/80 text-stone-200'
                  }`}
                >
                  <div className="text-[10px] opacity-60 mb-1">{msg.timestamp}</div>
                  {msg.thumbs && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {msg.thumbs.map((t, i) => (
                        <img key={i} src={t} alt="" className="w-16 h-16 object-cover rounded-lg border border-black/20" />
                      ))}
                    </div>
                  )}
                  {msg.steps && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {msg.steps.map((st, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] ${
                            !st.ok
                              ? 'border-red-900/60 bg-red-950/30 text-red-300'
                              : st.write
                                ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
                                : 'border-stone-700 bg-stone-900 text-stone-400'
                          }`}
                        >
                          {!st.ok ? <X className="w-3 h-3" /> : st.write ? <Check className="w-3 h-3" /> : st.name === 'web_search' || st.name === 'read_webpage' ? <Globe className="w-3 h-3" /> : st.name.startsWith('search') ? <Search className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                          {st.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.role === 'user' || msg.error ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <>
                      <div className={`markdown-body overflow-x-auto ${isRevealing ? 'ai-streaming' : ''}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlockWithCopy }}>{shown}</ReactMarkdown>
                        {isRevealing && <span className="ai-caret" />}
                      </div>
                      {/* Diff (変更差分) プレビュー */}
                      {msg.steps?.map((st, i) => st.diff ? (
                        <DiffViewer key={i} diff={st.diff} onApply={onApplyDiff} />
                      ) : null)}
                      {!isRevealing && (
                        <div className="mt-2.5 pt-2 border-t border-stone-800/80 flex flex-wrap items-center gap-1.5 text-[11px] relative">
                          <button
                            type="button"
                            onClick={() => setAppendMenuMsgId(prev => prev === msg.id ? null : msg.id)}
                            className="btn-chip"
                          >
                            <Plus className="w-3 h-3 text-amber-400" /> メモに追記
                          </button>
                          {appendMenuMsgId === msg.id && (
                            <div className="absolute top-full left-0 mt-1 z-30 bg-[#16181D] border border-stone-800 rounded-xl p-1.5 shadow-2xl min-w-[200px] space-y-0.5 anim-pop">
                              <div className="text-[10px] text-stone-500 font-bold px-2 py-1">追記先メモを選択</div>
                              <button
                                type="button"
                                onClick={() => {
                                  onAppendToMemo(msg.content, memo.slot);
                                  toast(`メモ #${memo.slot} に追記しました`, { kind: 'success' });
                                  setAppendMenuMsgId(null);
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-800 text-stone-200 text-xs flex items-center justify-between"
                              >
                                <span>現在のメモ (#{memo.slot})</span>
                                <span className="text-[10px] text-amber-400 font-bold">現在</span>
                              </button>
                              {availableSlots?.filter(s => s.slot !== memo.slot).map(s => (
                                <button
                                  key={s.slot}
                                  type="button"
                                  onClick={() => {
                                    onAppendToMemo(msg.content, s.slot);
                                    toast(`メモ #${s.slot}「${s.title}」に追記しました`, { kind: 'success' });
                                    setAppendMenuMsgId(null);
                                  }}
                                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-800 text-stone-300 text-xs truncate"
                                >
                                  #{s.slot} {s.title || '無題'}
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              toast('コピーしました', { kind: 'success' });
                            }}
                            className="btn-chip"
                          >
                            <Copy className="w-3 h-3" /> コピー
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {loadingThreadId === activeThreadId && (
            <div className="flex gap-2.5 anim-msg items-center justify-between">
              <div className="flex gap-2.5 items-center">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500/20 to-indigo-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
                  <Bot className="w-4 h-4 animate-pulse" />
                </div>
                <div className="bg-[#14161C] border border-stone-800/80 rounded-2xl px-4 py-3 flex items-center gap-3 text-xs text-stone-300 shadow-lg">
                  <div className="flex items-center gap-1.5 text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span className="typing-dots"><i /><i /><i /></span>
                  </div>
                  <span className="font-medium bg-gradient-to-r from-amber-200 via-stone-200 to-indigo-200 bg-clip-text text-transparent">
                    {backgroundJobProgress || '思考中・ツールを実行中…'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={stopGenerating}
                className="px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 text-red-300 hover:text-white font-bold text-xs flex items-center gap-1.5 transition active:scale-95 shrink-0"
              >
                <X className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>停止</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-800/80 bg-[#111214] p-2.5 sm:p-3">
        <div className="max-w-4xl mx-auto space-y-2">
          {(
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                <button onClick={() => fileRef.current?.click()} disabled={images.length >= 4} className="btn-chip disabled:opacity-40">
                  <ImageIcon className="w-3 h-3 text-amber-400" /> 画像を添付
                </button>
                <button
                  onClick={() => {
                    setForceWebSearch(v => !v);
                    inputRef.current?.focus();
                  }}
                  aria-pressed={forceWebSearch}
                  title="オンにすると、次の質問で必ずインターネットを検索してから答えます (オフでも必要なら AI が自分で検索します)"
                  className={`btn-chip ${forceWebSearch ? '!bg-sky-500/20 !border-sky-400/60 !text-sky-200 font-bold' : ''}`}
                >
                  <Globe className={`w-3 h-3 ${forceWebSearch ? 'text-sky-300' : 'text-amber-400'}`} /> Web検索{forceWebSearch ? ' ON' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => send('未提出や締切が近い提出物の要約とやるべきことをリストアップして')}
                  className="btn-chip hover:text-amber-300"
                  title="提出物の状態をAIが要約"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" /> 提出物を要約
                </button>
                {memo.content.trim() && (
                  <button
                    type="button"
                    onClick={() => send(`現在のメモ (スロット #${memo.slot}: 「${memo.title || '無題'}」) の内容を校正・推敲して改善案や差分を提示して`)}
                    className="btn-chip hover:text-amber-300"
                    title="現在開いているメモをAIで校正"
                  >
                    <Wrench className="w-3 h-3 text-amber-400" /> メモ #{memo.slot} を校正
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => {
                    addImages(Array.from(e.target.files || []));
                    e.target.value = '';
                  }}
                />
              </div>
              {images.length > 0 && (
                <div className="flex gap-2 anim-fade">
                  {images.map(im => (
                    <div key={im.id} className="relative anim-pop">
                      <img src={im.thumb} alt="" className="w-16 h-16 object-cover rounded-lg border border-stone-700" />
                      <button
                        onClick={() => setImages(prev => prev.filter(p => p.id !== im.id))}
                        aria-label="この画像を外す"
                        className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-800 border border-stone-600 text-stone-300 hover:bg-red-600 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 focus-within:border-amber-500/60 transition">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                  }}
                  onPaste={e => {
                    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
                    if (files.length > 0) {
                      e.preventDefault();
                      addImages(files);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={forceWebSearch ? 'Web で調べたいことを入力' : '質問や頼みごとを入力 (Shift+Enter で改行・Ctrl+V で画像)'}
                  className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-600 focus:outline-none resize-none leading-relaxed max-h-[180px] py-0.5"
                />
                {loadingThreadId === activeThreadId ? (
                  <button
                    type="button"
                    onClick={stopGenerating}
                    className="p-2 rounded-lg bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 transition"
                    aria-label="停止"
                    title="生成を中断"
                  >
                    <X className="w-4 h-4 stroke-[2.5]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => send()}
                    disabled={loading || (!input.trim() && images.length === 0)}
                    className="p-2 rounded-lg btn-primary disabled:opacity-40"
                    aria-label="送信"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
