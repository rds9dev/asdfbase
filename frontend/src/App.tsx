import React, { useState, useEffect } from 'react';
import { 
  CloudSun, 
  CalendarClock, 
  BookOpen, 
  MessageSquare, 
  FileText, 
  Bot, 
  CheckSquare, 
  Layout, 
  MoreHorizontal, 
  Settings,
  Camera,
  Search,
  LogOut,
  Send,
  Hash,
  Users,
  ChevronRight,
  ShieldAlert,
  Mic,
  Maximize2
} from 'lucide-react';

interface User {
  id: number;
  username: string;
  role: string;
  status: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('asdf_token'));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // Navigation Tabs: chat | memo | ai | assignments | board | more | settings
  const [activeTab, setActiveTab] = useState<'chat' | 'memo' | 'ai' | 'assignments' | 'board' | 'more' | 'settings'>('chat');

  // Header Data
  const [currentTime, setCurrentTime] = useState<string>('');
  const [weather, setWeather] = useState<{ temp: number; desc: string }>({ temp: 21, desc: '晴れ' });
  const [nextSubject, setNextSubject] = useState<{ name: string; time: string }>({ name: '数学', time: '10:45~' });
  const [showCamera, setShowCamera] = useState<boolean>(false);

  // Auth Form State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authInviteCode, setAuthInviteCode] = useState('');
  const [authError, setAuthError] = useState('');

  // Chat State
  const [channels, setChannels] = useState<{ id: number; name: string; type: string }[]>([
    { id: 1, name: 'general', type: 'text' },
    { id: 2, name: 'homework', type: 'text' },
    { id: 3, name: 'vc1', type: 'voice' },
  ]);
  const [activeChannelId, setActiveChannelId] = useState<number>(1);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);

  // Memo State (10 slots)
  const [memoSlots, setMemoSlots] = useState<{ slot_index: number; title: string; content: string; mode: string }[]>([]);
  const [selectedMemoSlot, setSelectedMemoSlot] = useState<number>(1);
  const [memoTitle, setMemoTitle] = useState('');
  const [memoContent, setMemoContent] = useState('');
  const [memoMode, setMemoMode] = useState<'markdown' | 'monaco'>('markdown');
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  // Live Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const formatted = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setCurrentTime(formatted);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Weather (Takamatsu: lat 34.34, lon 134.04)
  useEffect(() => {
    async function fetchWeather() {
      try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=34.34&longitude=134.04&current_weather=true');
        const data = await res.json();
        if (data.current_weather) {
          setWeather({
            temp: Math.round(data.current_weather.temperature),
            desc: data.current_weather.weathercode <= 3 ? '晴れ/曇り' : '雨/曇り',
          });
        }
      } catch (e) {
        console.error('Weather fetch error:', e);
      }
    }
    fetchWeather();
    const interval = setInterval(fetchWeather, 600000); // 10 min
    return () => clearInterval(interval);
  }, []);

  // Fetch Current User on Token Change
  useEffect(() => {
    if (!token) return;
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Auth failed');
        return res.json();
      })
      .then(data => setCurrentUser(data))
      .catch(() => {
        localStorage.removeItem('asdf_token');
        setToken(null);
      });
  }, [token]);

  // Load Channels & Messages & Notes
  useEffect(() => {
    if (!token) return;
    fetch('/api/channels', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setChannels(data))
      .catch(console.error);

    fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setOnlineUsers(data))
      .catch(console.error);

    fetch('/api/notes', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setMemoSlots(data);
        if (data.length > 0) {
          const first = data[0];
          setSelectedMemoSlot(first.slot_index);
          setMemoTitle(first.title);
          setMemoContent(first.content);
          setMemoMode(first.mode);
        }
      })
      .catch(console.error);
  }, [token]);

  // Load Channel Messages
  useEffect(() => {
    if (!token || !activeChannelId) return;
    fetch(`/api/channels/${activeChannelId}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setMessages(data))
      .catch(console.error);
  }, [token, activeChannelId]);

  // Auth Handler
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body: any = { username: authUsername, password: authPassword };
    if (authMode === 'register') {
      body.inviteCode = authInviteCode;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'エラーが発生しました');
        return;
      }
      localStorage.setItem('asdf_token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
    } catch (err: any) {
      setAuthError('通信に失敗しました');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('asdf_token');
    setToken(null);
    setCurrentUser(null);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !token) return;

    try {
      // 一時的な直接保存 (WS対応へのフォールバック兼用)
      const res = await fetch(`/api/channels/${activeChannelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: chatInput })
      });
      if (res.ok) {
        const newMsg = await res.json();
        setMessages(prev => [...prev, newMsg]);
        setChatInput('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveMemo = async () => {
    if (!token) return;
    setIsSavingMemo(true);
    try {
      const res = await fetch(`/api/notes/${selectedMemoSlot}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: memoTitle,
          content: memoContent,
          mode: memoMode
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setMemoSlots(prev => prev.map(m => m.slot_index === selectedMemoSlot ? updated : m));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingMemo(false);
    }
  };

  // ログイン前の認証モーダル
  if (!token || !currentUser) {
    return (
      <div className="min-h-screen bg-[#090A0C] flex flex-col items-center justify-center p-4">
        {/* Ambient Glow */}
        <div className="absolute w-[450px] h-[450px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="w-full max-w-md bg-[#111214] border border-stone-800/80 rounded-2xl p-8 shadow-2xl interactive-card">
          <div className="flex items-center justify-center gap-1 mb-6 logo-container">
            <span className="text-2xl font-black font-['Space_Grotesk'] text-white">asdfbase</span>
            <span className="logo-dot text-2xl font-black">.</span>
          </div>

          <div className="flex border-b border-stone-800 mb-6">
            <button
              onClick={() => { setAuthMode('login'); setAuthError(''); }}
              className={`flex-1 pb-3 text-xs font-mono font-bold tracking-wider transition ${
                authMode === 'login' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              LOGIN
            </button>
            <button
              onClick={() => { setAuthMode('register'); setAuthError(''); }}
              className={`flex-1 pb-3 text-xs font-mono font-bold tracking-wider transition ${
                authMode === 'register' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              REGISTER
            </button>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-400 font-mono flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4 font-mono text-sm">
            <div>
              <label className="block text-xs text-stone-400 mb-1.5 uppercase tracking-wider">Username</label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={e => setAuthUsername(e.target.value)}
                placeholder="ユーザー名"
                className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-4 py-2.5 text-white placeholder-stone-600 focus:outline-none focus:border-amber-500/80 transition"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1.5 uppercase tracking-wider">Password</label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-4 py-2.5 text-white placeholder-stone-600 focus:outline-none focus:border-amber-500/80 transition"
              />
            </div>

            {authMode === 'register' && (
              <div>
                <label className="block text-xs text-stone-400 mb-1.5 uppercase tracking-wider">Invite Code</label>
                <input
                  type="text"
                  required
                  value={authInviteCode}
                  onChange={e => setAuthInviteCode(e.target.value)}
                  placeholder="招待コード (ASDF)"
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-4 py-2.5 text-white placeholder-stone-600 focus:outline-none focus:border-amber-500/80 transition"
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs rounded-xl tracking-widest uppercase transition duration-150 interactive-btn font-['Space_Grotesk'] mt-2"
            >
              {authMode === 'login' ? 'ログイン' : 'アカウント作成'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090A0C] text-[#D6D3D1] flex flex-col font-['Inter']">
      {/* 1. TOP BAR (as specified in spec.md) */}
      <header className="h-14 border-b border-stone-800/80 bg-[#090A0C]/90 backdrop-blur-md sticky top-0 z-50 px-4 flex items-center justify-between select-none">
        {/* Left Half: Tabs */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Logo */}
          <div 
            onClick={() => setActiveTab('chat')}
            className="logo-container mr-3 font-['Space_Grotesk'] font-extrabold text-lg flex items-center tracking-wider"
          >
            <span className="text-white">asdfbase</span>
            <span className="logo-dot">.</span>
          </div>

          {/* Navigation Links: チャット, メモ, AI, 提出物, ボード, その他, 設定 */}
          <nav className="flex items-center gap-1 font-mono text-xs">
            {[
              { id: 'chat', label: 'チャット', icon: MessageSquare },
              { id: 'memo', label: 'メモ', icon: FileText },
              { id: 'ai', label: 'AI', icon: Bot },
              { id: 'assignments', label: '提出物', icon: CheckSquare },
              { id: 'board', label: 'ボード', icon: Layout },
              { id: 'more', label: 'その他', icon: MoreHorizontal },
              { id: 'settings', label: '設定', icon: Settings },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                    isActive 
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' 
                      : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Half: 日付/時間、高松市天気、次の教科 */}
        <div className="flex items-center gap-3 sm:gap-4 font-mono text-xs">
          {/* カメラ起動小窓ボタン */}
          <button
            onClick={() => setShowCamera(!showCamera)}
            title="カメラ小窓"
            className={`p-1.5 rounded-lg border transition ${
              showCamera 
                ? 'bg-amber-500 text-black border-amber-400' 
                : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:text-amber-400'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          {/* 今日の日付と時間 */}
          <div className="hidden md:flex items-center gap-1.5 text-stone-400 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70">
            <CalendarClock className="w-3.5 h-3.5 text-stone-500" />
            <span>{currentTime || 'Loading...'}</span>
          </div>

          {/* 香川県高松市の天気と温度 */}
          <div className="flex items-center gap-1.5 text-stone-300 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70">
            <CloudSun className="w-3.5 h-3.5 text-amber-400" />
            <span>高松 {weather.temp}℃ ({weather.desc})</span>
          </div>

          {/* 次の教科 (クリックで時間割に飛ぶ) */}
          <button
            onClick={() => setActiveTab('assignments')}
            title="時間割 / 提出物に移動"
            className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg hover:bg-amber-500/25 transition interactive-btn"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold">Next: {nextSubject.name}</span>
            <span className="text-stone-400 text-[10px]">({nextSubject.time})</span>
          </button>

          {/* ログアウト */}
          <button
            onClick={handleLogout}
            title="ログアウト"
            className="p-1.5 rounded-lg bg-stone-900/80 border border-stone-800 text-stone-500 hover:text-red-400 hover:border-red-900 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. MAIN CONTENT BODY */}
      <main className="flex-1 flex overflow-hidden">
        {/* TAB 1: リアルタイムチャット (3ペイン) */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: チャンネル一覧 */}
            <aside className="w-56 border-r border-stone-800/80 bg-[#0C0D10] p-3 flex flex-col justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold">
                  Channels
                </div>
                <div className="space-y-1">
                  {channels.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannelId(ch.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono transition text-left ${
                        activeChannelId === ch.id
                          ? 'bg-amber-500/10 text-amber-400 font-bold border border-amber-500/30'
                          : 'text-stone-400 hover:bg-stone-900/60 hover:text-stone-200'
                      }`}
                    >
                      <Hash className="w-3.5 h-3.5 text-stone-500" />
                      <span>{ch.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* VC join shortcut */}
              <div className="bg-[#111214] border border-stone-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-stone-400 mb-1">
                  <span className="flex items-center gap-1"><Mic className="w-3 h-3 text-emerald-400" /> Voice Channel</span>
                  <span className="text-[9px] text-stone-500">READY</span>
                </div>
                <button className="w-full py-1 text-[11px] bg-stone-800 hover:bg-stone-700 text-stone-300 rounded font-mono transition">
                  /join vc1
                </button>
              </div>
            </aside>

            {/* Center: メインチャットタイムライン */}
            <section className="flex-1 flex flex-col bg-[#090A0C] overflow-hidden">
              {/* Channel Header */}
              <div className="h-12 border-b border-stone-800/80 px-4 flex items-center justify-between bg-[#0C0D10]/50 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Hash className="w-4 h-4 text-amber-400" />
                  <span>{channels.find(c => c.id === activeChannelId)?.name || 'chat'}</span>
                </div>
                <div className="text-stone-500 text-[11px]">
                  リアルタイム同期中 (Discord / VPS)
                </div>
              </div>

              {/* Message Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-stone-600 font-mono text-xs space-y-2">
                    <MessageSquare className="w-8 h-8 opacity-40 text-amber-400" />
                    <p>まだメッセージはありません。/ai や @gemini コマンドも使えます。</p>
                  </div>
                ) : (
                  messages.map((m, idx) => (
                    <div key={idx} className="flex items-start gap-3 group">
                      <div className="w-8 h-8 rounded-lg bg-stone-800 border border-stone-700 flex items-center justify-center text-xs font-mono font-bold text-amber-400 uppercase">
                        {(m.sender_username || m.username || 'U')[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-stone-200">{m.sender_username || m.username}</span>
                          <span className="text-[10px] text-stone-500 font-mono">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-sm text-stone-300 bg-[#111214] border border-stone-800/80 rounded-xl px-3.5 py-2 inline-block max-w-2xl leading-relaxed">
                          {m.content}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-stone-800/80 bg-[#0C0D10]/50">
                <div className="flex items-center gap-2 bg-[#14161C] border border-stone-800 rounded-xl px-3 py-2 focus-within:border-amber-500/60 transition">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="メッセージを入力... (/ai, /join vc1 等のコマンド対応)"
                    className="flex-1 bg-transparent text-sm text-white focus:outline-none placeholder-stone-600 font-mono"
                  />
                  <button
                    type="submit"
                    className="p-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black transition interactive-btn"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </section>

            {/* Right: メンバー一覧 */}
            <aside className="w-52 border-l border-stone-800/80 bg-[#0C0D10] p-3 hidden lg:flex flex-col">
              <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-3 font-bold flex items-center justify-between">
                <span>Members</span>
                <span className="text-amber-400 font-normal">{onlineUsers.length}</span>
              </div>
              <div className="space-y-1">
                {onlineUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-stone-900/60 text-xs font-mono text-stone-300">
                    <span className={`w-2 h-2 rounded-full ${u.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-stone-600'}`} />
                    <span className="truncate">{u.username}</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        )}

        {/* TAB 2: リアルタイムメモ (10スロット) */}
        {activeTab === 'memo' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Slot Selector (1 to 10) */}
            <aside className="w-64 border-r border-stone-800/80 bg-[#0C0D10] p-3 flex flex-col justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-3 font-bold">
                  Memo Slots (Max 10)
                </div>
                <div className="space-y-1.5">
                  {memoSlots.map(slot => (
                    <button
                      key={slot.slot_index}
                      onClick={() => {
                        setSelectedMemoSlot(slot.slot_index);
                        setMemoTitle(slot.title);
                        setMemoContent(slot.content);
                        setMemoMode(slot.mode as any);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono transition text-left ${
                        selectedMemoSlot === slot.slot_index
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'bg-[#111214] border border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-stone-500 font-bold">#{slot.slot_index}</span>
                        <span className="truncate">{slot.title || `メモ #${slot.slot_index}`}</span>
                      </div>
                      <span className="text-[10px] text-stone-600 uppercase font-mono">{slot.mode}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            {/* Memo Editor Zone */}
            <section className="flex-1 flex flex-col bg-[#090A0C] p-4">
              <div className="flex items-center justify-between mb-3 border-b border-stone-800/80 pb-3">
                <input
                  type="text"
                  value={memoTitle}
                  onChange={e => setMemoTitle(e.target.value)}
                  placeholder="タイトルを入力..."
                  className="bg-transparent text-xl font-bold font-['Space_Grotesk'] text-white focus:outline-none flex-1 mr-4"
                />

                <div className="flex items-center gap-2 font-mono text-xs">
                  <select
                    value={memoMode}
                    onChange={e => setMemoMode(e.target.value as any)}
                    className="bg-[#14161C] border border-stone-800 text-stone-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
                  >
                    <option value="markdown">Markdown</option>
                    <option value="monaco">Monaco Editor (専用枠)</option>
                  </select>

                  <button
                    onClick={handleSaveMemo}
                    disabled={isSavingMemo}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition interactive-btn uppercase"
                  >
                    {isSavingMemo ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>

              {/* Editor Body */}
              <div className="flex-1 flex gap-4 overflow-hidden">
                <textarea
                  value={memoContent}
                  onChange={e => setMemoContent(e.target.value)}
                  placeholder="ここにリアルタイムでメモを記述..."
                  className="flex-1 h-full bg-[#111214] border border-stone-800/80 rounded-2xl p-4 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:border-amber-500/50 resize-none"
                />

                {memoMode === 'markdown' && (
                  <div className="flex-1 h-full bg-[#111214]/60 border border-stone-800/80 rounded-2xl p-4 text-stone-300 font-sans text-sm overflow-y-auto leading-relaxed">
                    <div className="text-[11px] font-mono text-stone-500 mb-2 border-b border-stone-800 pb-1">
                      LIVE PREVIEW
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-xs text-stone-400">
                      {memoContent || '（内容がありません）'}
                    </pre>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: AI (Gemini) */}
        {activeTab === 'ai' && (
          <div className="flex-1 p-6 flex flex-col items-center justify-center">
            <div className="max-w-xl w-full bg-[#111214] border border-stone-800/80 rounded-3xl p-8 text-center interactive-card">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white mb-2">Gemini AI キープール連携</h2>
              <p className="text-stone-400 text-xs font-mono mb-6 leading-relaxed">
                複数発行されたGemini APIキーの自動ローテーション管理、提出物の自動要約、チャットからの@gemini呼び出しに対応しています。
              </p>
              <div className="bg-[#16181D] border border-stone-800 rounded-xl p-4 text-left font-mono text-xs text-stone-300 space-y-2">
                <div>・チャット内メンション: <span className="text-amber-400">@gemini この問題解いて</span></div>
                <div>・スラッシュコマンド: <span className="text-amber-400">/ai 要約して</span></div>
                <div>・テスト点数アドバイス生成</div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: 提出物 & 時間割 */}
        {activeTab === 'assignments' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white">提出物 & 時間割</h2>
                  <p className="text-xs text-stone-400 font-mono">未着手 / 進行中 / 提出済み / 再提出 / 合格（全員合格でアーカイブ）</p>
                </div>
                <div className="flex gap-2 font-mono text-xs">
                  <button className="px-3 py-1.5 bg-stone-900 border border-stone-800 rounded-lg text-stone-300 hover:text-white">通常時程</button>
                  <button className="px-3 py-1.5 bg-stone-900 border border-stone-800 rounded-lg text-stone-300 hover:text-white">短縮時程</button>
                  <button className="px-3 py-1.5 bg-stone-900 border border-stone-800 rounded-lg text-stone-300 hover:text-white">S短時程</button>
                </div>
              </div>

              {/* Sample Assignment Cards */}
              <div className="space-y-3">
                {[
                  { title: '数学II 第3章 演習問題', subject: '数学', deadline: '2026/10/20', status: '進行中' },
                  { title: '物理基礎 実験レポート', subject: '物理', deadline: '2026/10/22', status: '未着手' },
                ].map((item, idx) => (
                  <div key={idx} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 flex items-center justify-between interactive-card">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">{item.subject}</span>
                        <span className="font-bold text-white text-sm">{item.title}</span>
                      </div>
                      <div className="text-xs text-stone-500 font-mono">締切: {item.deadline}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-3 py-1 bg-stone-800 text-stone-300 rounded-lg">{item.status}</span>
                      <button className="text-xs font-mono px-3 py-1 bg-amber-500 text-black font-bold rounded-lg interactive-btn">更新</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ボード */}
        {activeTab === 'board' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <Layout className="w-12 h-12 text-stone-600 mb-3" />
            <h3 className="text-xl font-bold font-['Space_Grotesk'] text-white">リアルタイム共同作業ボード</h3>
            <p className="text-xs font-mono text-stone-400 mt-1">手描きお絵描き・文章付箋・履歴タイムラプス機能</p>
          </div>
        )}

        {/* TAB 6: その他 (テスト点数メモ) */}
        {activeTab === 'more' && (
          <div className="flex-1 p-6">
            <div className="max-w-2xl mx-auto bg-[#111214] border border-stone-800/80 rounded-2xl p-6">
              <h3 className="text-lg font-bold font-['Space_Grotesk'] text-white mb-2">テスト点数メモ & AIアドバイス</h3>
              <p className="text-xs font-mono text-stone-400 mb-4">テストの各教科点数を記録し、合計点算出とGeminiからの学習アドバイスを受け取れます。</p>
            </div>
          </div>
        )}

        {/* TAB 7: 設定 (アカウント、通知、webhook、監査ログ) */}
        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-6">
              <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white">設定</h2>

              {/* Account Box */}
              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-3">
                <div className="text-stone-400 uppercase font-bold tracking-wider">Account Information</div>
                <div className="text-stone-200">ユーザー名: <span className="text-amber-400 font-bold">{currentUser.username}</span></div>
                <div className="text-stone-200">権限: <span className="text-stone-400">{currentUser.role}</span></div>
              </div>

              {/* Audit Logs Sample */}
              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-3">
                <div className="text-stone-400 uppercase font-bold tracking-wider">監査ログ & 復元</div>
                <div className="space-y-2 text-stone-300">
                  <div className="flex items-center justify-between border-b border-stone-800/60 pb-2">
                    <span>2026/10/17 09:50 ユーザー登録 (by {currentUser.username})</span>
                    <span className="text-stone-500">SYSTEM</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* カメラ小窓 (Pip風オーバーレイ) */}
      {showCamera && (
        <div className="fixed bottom-4 right-4 w-72 bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden z-50">
          <div className="p-2 border-b border-stone-800 flex items-center justify-between text-xs font-mono text-stone-400">
            <span className="flex items-center gap-1.5"><Camera className="w-3.5 h-3.5 text-amber-400" /> カメラプレビュー</span>
            <button onClick={() => setShowCamera(false)} className="text-stone-500 hover:text-white">&times;</button>
          </div>
          <div className="h-44 bg-black flex items-center justify-center text-stone-600 text-xs font-mono">
            Camera Active (WebRTC Stream)
          </div>
        </div>
      )}
    </div>
  );
}
