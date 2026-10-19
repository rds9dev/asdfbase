// AI タブ: 会話はこの端末に保存。返信は少しずつ表示し、常に最下部へ追従する
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Check, Copy, FileText, Image as ImageIcon, Plus, Search, Send, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import { confirmDialog, toast } from './ui';

interface AiStep {
  name: string;
  label: string;
  ok: boolean;
  write: boolean;
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

interface PendingImage {
  id: number;
  mimeType: string;
  data: string;
  thumb: string;
}

const SUGGESTIONS = [
  '今日の時間割と持ち物は？',
  '締切が近い提出物を教えて',
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

interface AiTabProps {
  active: boolean;
  userId: number;
  token: string;
  safeFetch: (input: string, init?: RequestInit) => Promise<Response>;
  buildContext: () => object;
  memo: { slot: number; title: string; content: string };
  onAppendToMemo: (text: string) => void;
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

export default function AiTab({ active, userId, token, safeFetch, buildContext, memo, onAppendToMemo }: AiTabProps) {
  const storageKey = `asdf_ai_history_${userId}`;
  const [messages, setMessages] = useState<AiMessage[]>(() => loadHistory(storageKey));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // 少しずつ表示中のメッセージ
  const [reveal, setReveal] = useState<{ id: number; shown: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch (_) {}
  }, [messages, storageKey]);

  const scrollToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // 開いた時は一番下から
  useLayoutEffect(() => {
    if (active) scrollToBottom(false);
  }, [active]);
  useEffect(() => scrollToBottom(true), [messages.length, loading]);
  useEffect(() => {
    if (reveal) scrollToBottom(false);
  }, [reveal]);

  // 返信を少しずつ表示
  useEffect(() => {
    if (!reveal) return;
    const msg = messages.find(m => m.id === reveal.id);
    if (!msg || reveal.shown >= msg.content.length) {
      setReveal(null);
      return;
    }
    const step = Math.max(2, Math.ceil(msg.content.length / 90));
    const t = setTimeout(() => setReveal(r => (r && r.id === msg.id ? { ...r, shown: r.shown + step } : r)), 16);
    return () => clearTimeout(t);
  }, [reveal, messages]);

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
    const userMsg: AiMessage = {
      id: Date.now(), role: 'user', content: text || 'この画像について教えて', timestamp: timeNow(),
      thumbs: sentImages.length ? sentImages.map(im => im.thumb) : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setImages([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    try {
      const res = await safeFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: next.filter(m => !m.error).slice(-30).map(m => ({ role: m.role, content: m.content })),
          contextData: buildContext(),
          images: sentImages.map(im => ({ mimeType: im.mimeType, data: im.data })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) throw new Error(data.error || 'AI の応答に失敗しました');
      const reply: AiMessage = {
        id: Date.now() + 1, role: 'model', content: data.reply, timestamp: timeNow(),
        steps: Array.isArray(data.steps) && data.steps.length ? data.steps : undefined,
      };
      if (reply.steps?.some(st => st.write && st.ok)) toast('AI が操作を実行しました', { kind: 'success' });
      setMessages(prev => [...prev, reply]);
      setReveal({ id: reply.id, shown: 0 });
    } catch (err: any) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'model', content: err.message || 'AI の応答に失敗しました', timestamp: timeNow(), error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (messages.length === 0) return;
    const ok = await confirmDialog({
      title: '会話履歴を削除しますか？',
      message: 'この端末に保存されている AI との会話がすべて消えます。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    setMessages([]);
    setReveal(null);
    toast('会話履歴を削除しました', { kind: 'success' });
  };

  const quoteMemo = () => {
    if (!memo.content.trim()) {
      toast('選択中のメモが空です', { kind: 'error' });
      return;
    }
    setInput(prev => `【#${memo.slot} ${memo.title || 'メモ'}】\n${memo.content}\n\n${prev}`);
    inputRef.current?.focus();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0C0D10]/50">
      <div className="h-12 shrink-0 border-b border-stone-800/80 px-3 sm:px-4 flex items-center justify-between gap-2 text-xs bg-[#111214]">
        <div className="flex items-center gap-2 font-bold text-white">
          <Bot className="w-4 h-4 text-amber-400" />
          <span>AI</span>
        </div>
        <button
          onClick={clearHistory}
          disabled={messages.length === 0}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-800 bg-stone-900 text-stone-300 hover:text-red-300 hover:border-red-900/70 hover:bg-red-950/30 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>履歴を削除</span>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4">
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
                          {!st.ok ? <X className="w-3 h-3" /> : st.write ? <Check className="w-3 h-3" /> : st.name.startsWith('search') ? <Search className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                          {st.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.role === 'user' || msg.error ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <>
                      <div className="markdown-body overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
                        {isRevealing && <span className="ai-caret" />}
                      </div>
                      {!isRevealing && (
                        <div className="mt-2.5 pt-2 border-t border-stone-800/80 flex flex-wrap gap-1.5 text-[11px]">
                          <button
                            onClick={() => {
                              onAppendToMemo(msg.content);
                              toast(`メモ #${memo.slot} の末尾に追記しました`, { kind: 'success' });
                            }}
                            className="btn-chip"
                          >
                            <Plus className="w-3 h-3 text-amber-400" /> メモに追記
                          </button>
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
          {loading && (
            <div className="flex gap-2.5 anim-msg">
              <div className="w-7 h-7 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-[#14161C] border border-stone-800/80 rounded-2xl px-4 py-3 flex items-center gap-2 text-xs text-stone-500">
                <span className="typing-dots"><i /><i /><i /></span>
                調べています…
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-800/80 bg-[#111214] p-2.5 sm:p-3">
        <div className="max-w-4xl mx-auto space-y-2">
          {(
            <>
              <div className="flex items-center gap-2 text-[11px] text-stone-500">
                <button onClick={quoteMemo} className="btn-chip">
                  <FileText className="w-3 h-3 text-amber-400" /> メモ #{memo.slot} を引用
                </button>
                <button onClick={() => fileRef.current?.click()} disabled={images.length >= 4} className="btn-chip disabled:opacity-40">
                  <ImageIcon className="w-3 h-3 text-amber-400" /> 画像を添付
                </button>
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
                    if (files.length === 0) return;
                    if (!e.clipboardData.getData('text/plain')) e.preventDefault();
                    addImages(files);
                  }}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="質問や頼みごとを入力 (Shift+Enter で改行・Ctrl+V で画像)"
                  className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-600 focus:outline-none resize-none leading-relaxed max-h-[180px] py-0.5"
                />
                <button
                  onClick={() => send()}
                  disabled={loading || (!input.trim() && images.length === 0)}
                  className="p-2 rounded-lg btn-primary disabled:opacity-40"
                  aria-label="送信"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
