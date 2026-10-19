// AI タブ: 会話はこの端末に保存。返信は少しずつ表示し、常に最下部へ追従する
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Copy, FileText, Lock, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { confirmDialog, toast } from './ui';

interface AiMessage {
  id: number;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  error?: boolean;
}

interface AiTabProps {
  active: boolean;
  userId: number;
  token: string;
  safeFetch: (input: string, init?: RequestInit) => Promise<Response>;
  buildContext: () => object;
  lock: { inSchool: boolean; until?: string };
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

export default function AiTab({ active, userId, token, safeFetch, buildContext, lock, memo, onAppendToMemo }: AiTabProps) {
  const storageKey = `asdf_ai_history_${userId}`;
  const [messages, setMessages] = useState<AiMessage[]>(() => loadHistory(storageKey));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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

  const send = async () => {
    const text = input.trim();
    if (!text || loading || lock.inSchool) return;
    const userMsg: AiMessage = { id: Date.now(), role: 'user', content: text, timestamp: timeNow() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    try {
      const res = await safeFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: next.filter(m => !m.error).slice(-30).map(m => ({ role: m.role, content: m.content })),
          contextData: buildContext(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) throw new Error(data.error || 'AI の応答に失敗しました');
      const reply: AiMessage = { id: Date.now() + 1, role: 'model', content: data.reply, timestamp: timeNow() };
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
          {lock.inSchool && (
            <span className="flex items-center gap-1 text-[10px] font-normal text-red-300 bg-red-950/40 border border-red-900/60 px-2 py-0.5 rounded-full">
              <Lock className="w-3 h-3" /> 授業時間中
            </span>
          )}
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
            <div className="py-16 flex flex-col items-center gap-2 text-stone-600 text-xs anim-fade">
              <Sparkles className="w-8 h-8 text-amber-400/50" />
              <span>何でも質問できます。#メモ名 や #チャンネル名 を書くとその内容も参照します。</span>
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
              <div className="bg-[#14161C] border border-stone-800/80 rounded-2xl px-4 py-3 flex items-center">
                <span className="typing-dots"><i /><i /><i /></span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-800/80 bg-[#111214] p-2.5 sm:p-3">
        <div className="max-w-4xl mx-auto space-y-2">
          {lock.inSchool ? (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-red-300">
              <Lock className="w-4 h-4" /> 授業時間中は AI を使えません ({lock.until} まで)
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[11px] text-stone-500">
                <button onClick={quoteMemo} className="btn-chip">
                  <FileText className="w-3 h-3 text-amber-400" /> メモ #{memo.slot} を引用
                </button>
              </div>
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
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="質問を入力 (Shift+Enter で改行)"
                  className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-600 focus:outline-none resize-none leading-relaxed max-h-[180px] py-0.5"
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
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
