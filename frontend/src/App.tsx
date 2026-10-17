import React, { useState, useEffect, useRef } from 'react';
import { 
  Volume2,
  VolumeX,
  MicOff,
  Monitor,
  Search,
  Edit3,
  X,
  ChevronRight,
  ChevronLeft,
  Bell,
  BellOff,
  Key,
  
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
  LogOut,
  Send,
  Hash,
  ShieldAlert,
  Mic,
  Image,
  Pin,
  Copy,
  Lock,
  History,
  CheckCircle2,
  RefreshCw,
  Plus,
  Sparkles,
  TrendingUp,
  Award,
  Paintbrush,
  Eraser,
  Play,
  RotateCcw,
  Clipboard,
  Command,
  Calculator,
  Trash2,
  Share2,
  Link,
  Subtitles,
  Headphones
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_BASE_URL, REMOTE_API_BASE, detectApiBase, getApiBaseUrl, setApiBaseUrl, getWsUrl, getWsFallbackUrl } from './config';

interface User {
  id: number;
  username: string;
  role: string;
  status: string;
}

interface Message {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  sender_username?: string;
  content: string;
  attachments?: string[];
  reply_to_id?: number | null;
  reactions?: Record<string, number[]>;
  is_pinned?: boolean;
  created_at: string;
}

interface MemoSlot {
  slot_index: number;
  title: string;
  content: string;
  mode: 'markdown' | 'monaco';
  assigned_user_id?: number | null;
  version: number;
  updated_at: string;
}

interface TimetableItem {
  id: number;
  day_of_week: number;
  period: number;
  subject: string;
  schedule_type: string;
}

interface Assignment {
  id: number;
  title: string;
  subject: string;
  description?: string;
  deadline: string;
  resubmit_deadline?: string;
  my_status: 'unstarted' | 'in_progress' | 'submitted' | 'resubmit' | 'passed';
  is_archived: boolean;
}

interface TestScore {
  id: number;
  exam_name: string;
  subject: string;
  score: number;
  max_score: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('asdf_token'));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'chat' | 'memo' | 'ai' | 'assignments' | 'board' | 'more' | 'settings'>('chat');

  // Header Data
  const [currentTime, setCurrentTime] = useState<string>('');
  const [weather, setWeather] = useState<{ temp: number; desc: string }>({ temp: 21, desc: '晴れ' });
  const [nextSubject, setNextSubject] = useState<{ name: string; time: string }>({ name: '数学', time: '10:45~' });
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string>('');

  // Voice Chat (VC) State & WebRTC Refs
  const [inVoiceChannel, setInVoiceChannel] = useState<boolean>(false);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isDeafened, setIsDeafened] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [vcSubtitles, setVcSubtitles] = useState<string>('');
  const [isTtsEnabled, setIsTtsEnabled] = useState<boolean>(false);
  const [activeVcUsers, setActiveVcUsers] = useState<{ userId: number; username: string; isMuted?: boolean; isScreenSharing?: boolean }[]>([]);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // AI Tab State
  const [aiMessages, setAiMessages] = useState<{ id: number; role: 'user' | 'model'; content: string; timestamp: string }[]>([
    {
      id: 1,
      role: 'model',
      content: 'こんにちは！asdfbaseのAIアシスタントです。学校生活、課題の要約、勉強の質問、プログラミングの質問など何でも聞いてください。',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [includeContextInAi, setIncludeContextInAi] = useState(true);

  // Memo AI State
  const [isMemoAiLoading, setIsMemoAiLoading] = useState(false);
  const [memoAiResultModal, setMemoAiResultModal] = useState<string | null>(null);

  // Timetables State & Modal
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [newTtDay, setNewTtDay] = useState(1);
  const [newTtPeriod, setNewTtPeriod] = useState(1);
  const [newTtSubject, setNewTtSubject] = useState('');

  // Chat UI State (Mention, Search, Edit, Member Panel)
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [isMembersCollapsed, setIsMembersCollapsed] = useState(false);
  const [isNewChannelModalOpen, setIsNewChannelModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');

  // Settings State (Account, Notifications, Webhook, Audit Logs)
  const [settingsSection, setSettingsSection] = useState<'account' | 'notifications' | 'webhook' | 'audit'>('account');
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordChangeStatus, setPasswordChangeStatus] = useState('');
  const [isNotificationEnabled, setIsNotificationEnabled] = useState(true);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [webhookStatus, setWebhookStatus] = useState('');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Timetable Customization & Live Class State
  const [isClassActive, setIsClassActive] = useState<boolean>(false);
  const [classStartTime, setClassStartTime] = useState<string>('');
  const [memoSearchQuery, setMemoSearchQuery] = useState('');

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [copiedLinkMessageId, setCopiedLinkMessageId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Memo State
  const [memoSlots, setMemoSlots] = useState<MemoSlot[]>([]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(1);
  const [memoTitle, setMemoTitle] = useState('');
  const [memoContent, setMemoContent] = useState('');
  const [memoMode, setMemoMode] = useState<'markdown' | 'monaco'>('markdown');
  const [memoAssignedUser, setMemoAssignedUser] = useState<number | null>(null);
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  // Phase 3 State: Timetables & Assignments
  const [scheduleType, setScheduleType] = useState<'normal' | 'short' | 's_short'>('normal');
  const [timetables, setTimetables] = useState<TimetableItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'unstarted' | 'in_progress' | 'submitted' | 'passed'>('all');
  const [newAssignTitle, setNewAssignTitle] = useState('');
  const [newAssignSubject, setNewAssignSubject] = useState('数学');
  const [newAssignDeadline, setNewAssignDeadline] = useState('');
  const [newAssignDesc, setNewAssignDesc] = useState('');
  const [isSummarizingAI, setIsSummarizingAI] = useState<number | null>(null);
  const [summarizedTexts, setSummarizedTexts] = useState<Record<number, string>>({});

  // Phase 3 State: Test Scores & AI
  const [testScores, setTestScores] = useState<TestScore[]>([]);
  const [newExamName, setNewExamName] = useState('中間考査');
  const [newExamSubject, setNewExamSubject] = useState('英語');
  const [newExamScore, setNewExamScore] = useState<number>(85);
  const [newExamMaxScore, setNewExamMaxScore] = useState<number>(100);
  const [aiAdvice, setAiAdvice] = useState<string>('');
  const [isLoadingAdvice, setIsLoadingAdvice] = useState(false);

  // Phase 4 State: Collaborative Whiteboard
  const [boardStrokes, setBoardStrokes] = useState<any[]>([]);
  const [boardTexts, setBoardTexts] = useState<any[]>([]);
  const [drawColor, setDrawColor] = useState<string>('#f59e0b');
  const [brushWidth, setBrushWidth] = useState<number>(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStrokePoints, setCurrentStrokePoints] = useState<{ x: number; y: number }[]>([]);
  const [boardMode, setBoardMode] = useState<'draw' | 'eraser' | 'text'>('draw');
  const [newBoardText, setNewBoardText] = useState('');
  const [isTimelapsePlaying, setIsTimelapsePlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Phase 4 State: Shared Clipboard
  const [clipboardText, setClipboardText] = useState<string>('');
  const [clipboardUpdatedBy, setClipboardUpdatedBy] = useState<string>('');
  const [isCopiedToOS, setIsCopiedToOS] = useState(false);

  // Phase 4 State: Ctrl+K Command Palette
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [calcResult, setCalcResult] = useState<string | null>(null);

  
  // Camera Stream Toggle
  useEffect(() => {
    if (showCamera) {
      setCameraError('');
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        .then(stream => {
          setCameraStream(stream);
          if (cameraVideoRef.current) {
            cameraVideoRef.current.srcObject = stream;
          }
        })
        .catch(err => {
          console.warn('Camera access denied or unavailable:', err);
          setCameraError('カメラが利用できないか許可されていません');
        });
    } else {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
      }
    }
  }, [showCamera]);

  // WebSocket Ref
  const wsRef = useRef<WebSocket | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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



  // Weather (Takamatsu - via internal backend API to bypass external domain filters)
  useEffect(() => {
    async function fetchWeather() {
      try {
        let res = await fetch(`${getApiBaseUrl()}/api/weather`).catch(() => null);
        if (!res || !res.ok) {
          res = await fetch(`${REMOTE_API_BASE}/api/weather`).catch(() => null);
        }
        if (res && res.ok) {
          const data = await res.json();
          if (data && typeof data.temp === 'number') {
            setWeather({
              temp: data.temp,
              desc: data.desc || '晴れ',
            });
          }
        }
      } catch (e) {
        console.error('Weather error:', e);
      }
    }
    fetchWeather();
    const interval = setInterval(fetchWeather, 600000);
    return () => clearInterval(interval);
  }, []);

  // Safe fetch helper with automatic failover to remote VPS if relative proxy fails
  const safeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
    let cleanPath = input;
    if (cleanPath.startsWith(REMOTE_API_BASE)) {
      cleanPath = cleanPath.slice(REMOTE_API_BASE.length);
    }
    if (!cleanPath.startsWith('/')) {
      cleanPath = `/${cleanPath}`;
    }

    let baseUrl = getApiBaseUrl();
    let url = `${baseUrl}${cleanPath}`;
    try {
      let res = await fetch(url, init);
      const contentType = res.headers.get('content-type') || '';
      if (baseUrl === '' && (res.status === 404 || contentType.includes('text/html'))) {
        setApiBaseUrl(REMOTE_API_BASE);
        url = `${REMOTE_API_BASE}${cleanPath}`;
        res = await fetch(url, init);
      }
      return res;
    } catch (err) {
      if (baseUrl === '') {
        setApiBaseUrl(REMOTE_API_BASE);
        url = `${REMOTE_API_BASE}${cleanPath}`;
        return await fetch(url, init);
      }
      throw err;
    }
  };

  // Fetch Current User
  useEffect(() => {
    if (!token) return;
    safeFetch('/api/auth/me', {
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

  // WebSocket Setup
  useEffect(() => {
    if (!token) return;

    const wsUrl = getWsUrl();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'AUTH', token }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'NEW_MESSAGE') {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.payload.id)) return prev;
            return [...prev, msg.payload];
          });
        } else if (msg.type === 'MESSAGE_REACTION_UPDATED') {
          setMessages(prev => prev.map(m => m.id === msg.payload.messageId ? { ...m, reactions: msg.payload.reactions } : m));
        } else if (msg.type === 'MESSAGE_PIN_UPDATED') {
          setMessages(prev => prev.map(m => m.id === msg.payload.id ? msg.payload : m));
        } else if (msg.type === 'NOTE_UPDATED') {
          setMemoSlots(prev => prev.map(n => n.slot_index === msg.payload.slot_index ? msg.payload : n));
          if (msg.payload.slot_index === selectedSlotIndex) {
            setMemoTitle(msg.payload.title);
            setMemoContent(msg.payload.content);
            setMemoMode(msg.payload.mode);
            setMemoAssignedUser(msg.payload.assigned_user_id);
          }
        } else if (msg.type === 'USER_STATUS_CHANGED') {
          setOnlineUsers(prev => prev.map(u => u.id === msg.payload.userId ? { ...u, status: msg.payload.status } : u));
        } else if (msg.type === 'BOARD_NEW_STROKE') {
          setBoardStrokes(prev => [...prev, msg.payload]);
        } else if (msg.type === 'BOARD_NEW_TEXT') {
          setBoardTexts(prev => [...prev, msg.payload]);
        } else if (msg.type === 'BOARD_CLEARED') {
          setBoardStrokes([]);
          setBoardTexts([]);
        } else if (msg.type === 'CLIPBOARD_UPDATED') {
          setClipboardText(msg.payload.content);
          setClipboardUpdatedBy(msg.payload.updated_by);
        } else if (msg.type === 'CHANNEL_CREATED') {
          setChannels(prev => prev.some(c => c.id === msg.payload.id) ? prev : [...prev, msg.payload]);
        } else if (msg.type === 'CHANNEL_DELETED') {
          setChannels(prev => prev.filter(c => c.id !== msg.payload.id));
        } else if (msg.type === 'MESSAGE_DELETED') {
          setMessages(prev => prev.filter(m => m.id !== msg.payload.messageId));
        } else if (msg.type === 'MESSAGE_UPDATED') {
          setMessages(prev => prev.map(m => m.id === msg.payload.id ? { ...m, content: msg.payload.content } : m));
        } else if (msg.type === 'NOTE_CONTENT_SYNC') {
          if (msg.payload.slotIndex === selectedSlotIndex) {
            setMemoContent(msg.payload.content);
            if (msg.payload.title) setMemoTitle(msg.payload.title);
          }
        } else if (msg.type === 'USER_DELETED') {
          setOnlineUsers(prev => prev.filter(u => u.id !== msg.payload.userId));
        } else if (msg.type === 'VC_USER_JOINED') {
          setActiveVcUsers(prev => prev.some(u => u.userId === msg.payload.userId) ? prev : [...prev, msg.payload]);
        } else if (msg.type === 'VC_USER_LEFT') {
          setActiveVcUsers(prev => prev.filter(u => u.userId !== msg.payload.userId));
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    const handleVisibilityChange = () => {
      if (ws.readyState === WebSocket.OPEN) {
        const status = document.hidden ? 'away' : 'online';
        ws.send(JSON.stringify({ type: 'SET_STATUS', status }));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      ws.close();
    };
  }, [token, selectedSlotIndex]);

  // Initial Data Load
  useEffect(() => {
    if (!token) return;

    safeFetch('/api/channels', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setChannels(data))
      .catch(console.error);

    safeFetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setOnlineUsers(data))
      .catch(console.error);

    safeFetch('/api/notes', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setMemoSlots(data);
        if (data.length > 0) {
          const first = data[0];
          setSelectedSlotIndex(first.slot_index);
          setMemoTitle(first.title);
          setMemoContent(first.content);
          setMemoMode(first.mode);
          setMemoAssignedUser(first.assigned_user_id);
        }
      })
      .catch(console.error);

    safeFetch('/api/assignments', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAssignments(data))
      .catch(console.error);

    safeFetch('/api/test-scores', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setTestScores(data))
      .catch(console.error);

    safeFetch('/api/board', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.strokes) setBoardStrokes(data.strokes);
        if (data.texts) setBoardTexts(data.texts);
      })
      .catch(console.error);

    safeFetch('/api/clipboard', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.content) {
          setClipboardText(data.content);
          setClipboardUpdatedBy(data.updated_by || 'system');
        }
      })
      .catch(console.error);
  }, [token]);

  // Global Ctrl+K Keydown Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Messages Load
  useEffect(() => {
    if (!token || !activeChannelId) return;
    safeFetch(`${API_BASE_URL}/api/channels/${activeChannelId}/messages`, {
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
    await detectApiBase();
    
    let baseUrl = getApiBaseUrl();
    const subPath = `/api/auth/${authMode === 'login' ? 'login' : 'register'}`;
    const body: any = { username: authUsername, password: authPassword };
    if (authMode === 'register') {
      body.inviteCode = authInviteCode;
    }

    try {
      let res = await fetch(`${baseUrl}${subPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      // If relative proxy returned 404 or HTML (common on static servers without node proxy)
      const contentType = res.headers.get('content-type') || '';
      if (baseUrl === '' && (res.status === 404 || contentType.includes('text/html'))) {
        baseUrl = REMOTE_API_BASE;
        setApiBaseUrl(REMOTE_API_BASE);
        res = await fetch(`${REMOTE_API_BASE}${subPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'エラーが発生しました');
        return;
      }
      localStorage.setItem('asdf_token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
    } catch (err: any) {
      // Network error on relative path: fallback to direct VPS
      try {
        setApiBaseUrl(REMOTE_API_BASE);
        const res = await fetch(`${REMOTE_API_BASE}${subPath}`, {
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
      } catch (fErr) {
        setAuthError('通信に失敗しました。サーバーの稼働状態を確認してください。');
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('asdf_token');
    setToken(null);
    setCurrentUser(null);
  };

  // Image Upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await safeFetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.url) {
        await safeFetch(`${API_BASE_URL}/api/channels/${activeChannelId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            content: `![image](${API_BASE_URL}${data.url})`,
            attachments: [`${API_BASE_URL}${data.url}`]
          })
        });
      }
    } catch (err) {
      console.error('Image upload error:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Chat Send
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !token) return;

    const content = chatInput;
    setChatInput('');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'SEND_MESSAGE',
        channelId: activeChannelId,
        content,
      }));
    } else {
      await safeFetch(`${API_BASE_URL}/api/channels/${activeChannelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content })
      });
    }
  };

  const handleToggleReaction = async (messageId: number, emoji: string) => {
    if (!token) return;
    try {
      await safeFetch(`${API_BASE_URL}/api/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ emoji })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleTogglePin = async (messageId: number) => {
    if (!token) return;
    try {
      await safeFetch(`${API_BASE_URL}/api/messages/${messageId}/pin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyMessageLink = (messageId: number) => {
    const url = `${window.location.origin}/#msg-${messageId}`;
    navigator.clipboard.writeText(url);
    setCopiedLinkMessageId(messageId);
    setTimeout(() => setCopiedLinkMessageId(null), 2000);
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!token) return;
    try {
      await safeFetch(`${API_BASE_URL}/api/messages/${messageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditMessage = async (messageId: number) => {
    if (!token || !editingContent.trim()) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/messages/${messageId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: editingContent })
      });
      if (res.ok) {
        const updated = await res.json();
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: updated.content } : m));
        setEditingMessageId(null);
        setEditingContent('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim() || !token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: newChannelName, type: newChannelType })
      });
      if (res.ok) {
        const created = await res.json();
        setChannels(prev => [...prev, created]);
        setActiveChannelId(created.id);
        setIsNewChannelModalOpen(false);
        setNewChannelName('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    if (!token || channels.length <= 1) return;
    if (!confirm('このチャンネルを削除しますか？')) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/channels/${channelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setChannels(prev => prev.filter(c => c.id !== channelId));
        if (activeChannelId === channelId) {
          const remaining = channels.filter(c => c.id !== channelId);
          if (remaining.length > 0) setActiveChannelId(remaining[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // AI Tab Send Handler (with context JSON support)
  const handleSendAiMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || !token || isLoadingAi) return;

    const userText = aiInput.trim();
    const newMsg = {
      id: Date.now(),
      role: 'user' as const,
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const nextMessages = [...aiMessages, newMsg];
    setAiMessages(nextMessages);
    setAiInput('');
    setIsLoadingAi(true);

    try {
      let contextData: any = undefined;
      if (includeContextInAi) {
        contextData = {
          current_user: currentUser?.username,
          active_tab: activeTab,
          channels: channels.map(c => ({ id: c.id, name: c.name, type: c.type })),
          memo_slots: memoSlots.map(m => ({ slot: m.slot_index, title: m.title, mode: m.mode })),
          assignments: assignments.map(a => ({ title: a.title, subject: a.subject, deadline: a.deadline })),
          weather: weather,
          next_subject: nextSubject,
        };
      }

      const res = await safeFetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          contextData
        })
      });

      const data = await res.json();
      if (data.reply) {
        setAiMessages(prev => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'model',
            content: data.reply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch (err) {
      console.error(err);
      setAiMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'model',
          content: '申し訳ありません。AIの応答中にエラーが発生しました。',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoadingAi(false);
    }
  };

  // Memo AI Assistant Handler
  const handleMemoAiAssist = async (type: 'summarize' | 'proofread' | 'explain_code' | 'continue') => {
    if (!token || !memoContent.trim() || isMemoAiLoading) return;
    setIsMemoAiLoading(true);
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/ai/memo-assist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          content: memoContent,
          type
        })
      });
      const data = await res.json();
      if (data.result) {
        setMemoAiResultModal(data.result);
      }
    } catch (err) {
      console.error('Memo AI error:', err);
      alert('AIアシストの実行に失敗しました');
    } finally {
      setIsMemoAiLoading(false);
    }
  };

  // VC Join / Leave with MediaStream and SpeechRecognition
  const handleToggleVoiceChannel = async () => {
    if (inVoiceChannel) {
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(t => t.stop());
        localAudioStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
        speechRecognitionRef.current = null;
      }
      setIsScreenSharing(false);
      setInVoiceChannel(false);
      setVcSubtitles('');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'VC_LEAVE' }));
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localAudioStreamRef.current = stream;
        setInVoiceChannel(true);
        setIsMicMuted(false);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'VC_JOIN' }));
        }

        // VC字幕化 (SpeechRecognition)
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'ja-JP';
          rec.onresult = (e: any) => {
            let transcript = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              transcript += e.results[i][0].transcript;
            }
            setVcSubtitles(transcript);
          };
          rec.onerror = () => {};
          try {
            rec.start();
            speechRecognitionRef.current = rec;
          } catch {}
        }
      } catch (err) {
        console.warn('Audio permission denied or device unavailable:', err);
        setInVoiceChannel(true);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'VC_JOIN' }));
        }
      }
    }
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = stream;
        }
        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          screenStreamRef.current = null;
        };
      } catch (err) {
        console.warn('Screen share canceled or error:', err);
      }
    }
  };

  const handleToggleMicMute = () => {
    const next = !isMicMuted;
    setIsMicMuted(next);
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = !next;
      });
    }
  };

  const handleFetchTimetables = async () => {
    if (!token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/timetables?scheduleType=${scheduleType}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTimetables(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateTimetableEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTtSubject.trim() || !token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/timetables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          dayOfWeek: newTtDay,
          period: newTtPeriod,
          subject: newTtSubject.trim(),
          scheduleType
        })
      });
      if (res.ok) {
        setNewTtSubject('');
        handleFetchTimetables();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteTimetableEntry = async (id: number) => {
    if (!token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/timetables/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setTimetables(prev => prev.filter(t => t.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !currentPasswordInput || !newPasswordInput) return;
    setPasswordChangeStatus('変更中...');
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword: currentPasswordInput, newPassword: newPasswordInput })
      });
      if (res.ok) {
        setPasswordChangeStatus('パスワードを変更しました');
        setCurrentPasswordInput('');
        setNewPasswordInput('');
      } else {
        const d = await res.json();
        setPasswordChangeStatus(d.error || '失敗しました');
      }
    } catch (err) {
      setPasswordChangeStatus('通信エラー');
    }
  };

  const handleDeleteAccount = async () => {
    if (!token || !currentUser) return;
    if (!confirm('本当にアカウントを削除しますか？この操作は元に戻せません。')) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/users/${currentUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        handleLogout();
      } else {
        const d = await res.json();
        alert(d.error || '削除できませんでした');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestWebhook = async () => {
    if (!token) return;
    setWebhookStatus('テスト送信中...');
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/webhook/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ webhookUrl: webhookUrlInput })
      });
      if (res.ok) {
        setWebhookStatus('Discordへ送信成功！');
      } else {
        const d = await res.json();
        setWebhookStatus(d.error || '送信失敗');
      }
    } catch (err) {
      setWebhookStatus('通信エラー');
    }
  };

  const handleRestoreAuditLog = async (logId: number) => {
    if (!token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/audit-logs/${logId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        alert('復元が完了しました');
        safeFetch(`${API_BASE_URL}/api/audit-logs`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then(data => setAuditLogs(data))
          .catch(console.error);
      } else {
        const d = await res.json();
        alert(d.error || '復元に失敗しました');
      }
    } catch (err) {
      console.error(err);
    }
  };


  const handleMemoContentChange = (newVal: string) => {
    setMemoContent(newVal);
    // Realtime broadcast to other users
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'NOTE_CONTENT_SYNC',
        slotIndex: selectedSlotIndex,
        content: newVal,
        title: memoTitle
      }));
    }
  };

  const handleSaveMemo = async () => {
    if (!token) return;
    setIsSavingMemo(true);
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/notes/${selectedSlotIndex}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: memoTitle,
          content: memoContent,
          mode: memoMode,
          assigned_user_id: memoAssignedUser
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setMemoSlots(prev => prev.map(m => m.slot_index === selectedSlotIndex ? updated : m));
      } else {
        const err = await res.json();
        alert(err.error || '保存に失敗しました');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingMemo(false);
    }
  };

  // Phase 3: Create Assignment
  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssignTitle || !newAssignDeadline || !token) return;

    try {
      const res = await safeFetch(`${API_BASE_URL}/api/assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: newAssignTitle,
          subject: newAssignSubject,
          deadline: newAssignDeadline,
          description: newAssignDesc
        })
      });
      if (res.ok) {
        const created = await res.json();
        setAssignments(prev => [...prev, { ...created, my_status: 'unstarted' }]);
        setNewAssignTitle('');
        setNewAssignDesc('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Phase 3: Update Assignment Status
  const handleUpdateAssignmentStatus = async (id: number, status: string) => {
    if (!token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/assignments/${id}/progress`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        setAssignments(prev => prev.map(a => a.id === id ? { ...a, my_status: status as any } : a));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Phase 3: Gemini Summarize Assignment
  const handleSummarizeAssignment = async (assignment: Assignment) => {
    if (!token || !assignment.description) return;
    setIsSummarizingAI(assignment.id);
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/assignments/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ description: assignment.description })
      });
      const data = await res.json();
      if (data.summary) {
        setSummarizedTexts(prev => ({ ...prev, [assignment.id]: data.summary }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizingAI(null);
    }
  };

  // Phase 3: Create Test Score
  const handleCreateTestScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      const res = await safeFetch(`${API_BASE_URL}/api/test-scores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          examName: newExamName,
          subject: newExamSubject,
          score: newExamScore,
          maxScore: newExamMaxScore
        })
      });
      if (res.ok) {
        const created = await res.json();
        setTestScores(prev => [...prev, created]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Phase 3: Get AI Advice on Test Scores
  const handleGetAiAdvice = async () => {
    if (!token) return;
    setIsLoadingAdvice(true);
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/test-scores/advice`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.advice) {
        setAiAdvice(data.advice);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingAdvice(false);
    }
  };

  // Phase 4: Board Drawing Handlers
  const redrawCanvas = (strokes: any[], texts: any[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw strokes
    for (const stroke of strokes) {
      if (!stroke.points || stroke.points.length < 2) continue;
      if (stroke.color === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = stroke.width || 9;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = stroke.color || '#f59e0b';
        ctx.lineWidth = stroke.width || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
    }

    // Draw texts
    for (const t of texts) {
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.text, t.x, t.y);
    }
  };

  useEffect(() => {
    if (activeTab === 'board' && !isTimelapsePlaying) {
      redrawCanvas(boardStrokes, boardTexts);
    }
  }, [activeTab, boardStrokes, boardTexts, isTimelapsePlaying]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (boardMode !== 'draw' && boardMode !== 'eraser') return;
    const { x, y } = getCanvasCoords(e);
    setIsDrawing(true);
    setCurrentStrokePoints([{ x, y }]);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || (boardMode !== 'draw' && boardMode !== 'eraser')) return;
    const { x, y } = getCanvasCoords(e);
    const newPoints = [...currentStrokePoints, { x, y }];
    setCurrentStrokePoints(newPoints);

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && newPoints.length >= 2) {
      if (boardMode === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = brushWidth * 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(newPoints[newPoints.length - 2].x, newPoints[newPoints.length - 2].y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = brushWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(newPoints[newPoints.length - 2].x, newPoints[newPoints.length - 2].y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  };

  const handleCanvasMouseUp = async () => {
    if (!isDrawing || (boardMode !== 'draw' && boardMode !== 'eraser')) return;
    setIsDrawing(false);

    if (currentStrokePoints.length >= 2 && token) {
      try {
        await safeFetch(`${API_BASE_URL}/api/board/stroke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            color: boardMode === 'eraser' ? 'eraser' : drawColor,
            width: boardMode === 'eraser' ? brushWidth * 3 : brushWidth,
            points: currentStrokePoints
          })
        });
      } catch (err) {
        console.error('Stroke save error:', err);
      }
    }
    setCurrentStrokePoints([]);
  };

  const handleAddBoardText = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (boardMode !== 'text' || !newBoardText.trim() || !token) return;
    const { x, y } = getCanvasCoords(e);

    try {
      await safeFetch(`${API_BASE_URL}/api/board/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ x, y, text: newBoardText })
      });
      setNewBoardText('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearBoard = async () => {
    if (!token || !confirm('ホワイトボードを全員分クリアしますか？')) return;
    try {
      await safeFetch(`${API_BASE_URL}/api/board/clear`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  // タイムラプス再生 (履歴を最初から順次描画)
  const handlePlayTimelapse = () => {
    if ((boardStrokes.length === 0 && boardTexts.length === 0) || isTimelapsePlaying) return;
    setIsTimelapsePlaying(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let i = 0;
    const interval = setInterval(() => {
      if (i >= boardStrokes.length) {
        clearInterval(interval);
        // テキストも描画して終了
        for (const t of boardTexts) {
          ctx.font = '14px "JetBrains Mono", monospace';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(t.text, t.x, t.y);
        }
        setIsTimelapsePlaying(false);
        return;
      }
      const stroke = boardStrokes[i];
      if (stroke.points && stroke.points.length >= 2) {
        if (stroke.color === 'eraser') {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.lineWidth = stroke.width || 9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let p = 1; p < stroke.points.length; p++) {
            ctx.lineTo(stroke.points[p].x, stroke.points[p].y);
          }
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.strokeStyle = stroke.color || '#f59e0b';
          ctx.lineWidth = stroke.width || 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let p = 1; p < stroke.points.length; p++) {
            ctx.lineTo(stroke.points[p].x, stroke.points[p].y);
          }
          ctx.stroke();
        }
      }
      i++;
    }, 100);
  };

  // Phase 4: Shared Clipboard Handlers
  const handleUpdateClipboard = async (newText: string) => {
    setClipboardText(newText);
    if (!token) return;
    try {
      await safeFetch(`${API_BASE_URL}/api/clipboard`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: newText })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyClipboardToOS = () => {
    navigator.clipboard.writeText(clipboardText);
    setIsCopiedToOS(true);
    setTimeout(() => setIsCopiedToOS(false), 2000);
  };

  // Phase 4: Command Palette & Calculator Query Evaluator
  const handlePaletteInput = (val: string) => {
    setPaletteQuery(val);
    setCalcResult(null);

    // Simple calculator regex evaluation: e.g. "12 * 45", "100 / 4"
    if (/^[\d\s+\-*/().%^]+$/.test(val.trim())) {
      try {
        // Safe evaluation of simple arithmetic
        const sanitized = val.replace(/\^/g, '**');
        // eslint-disable-next-line no-eval
        const res = Function(`'use strict'; return (${sanitized})`)();
        if (typeof res === 'number' && !isNaN(res)) {
          setCalcResult(String(res));
        }
      } catch {
        setCalcResult(null);
      }
    }
  };

  const isMonacoLocked = memoMode === 'monaco' && memoAssignedUser !== null && memoAssignedUser !== currentUser?.id;

  // Filtered assignments
  const filteredAssignments = assignments.filter(a => {
    if (assignmentFilter === 'all') return !a.is_archived;
    return a.my_status === assignmentFilter && !a.is_archived;
  });

  // Test Scores Total calculation
  const totalScore = testScores.reduce((acc, curr) => acc + Number(curr.score), 0);
  const totalMaxScore = testScores.reduce((acc, curr) => acc + Number(curr.max_score), 0);

  if (!token || !currentUser) {
    return (
      <div className="min-h-screen bg-[#090A0C] flex flex-col items-center justify-center p-4">
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
                  placeholder="招待コード"
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
      {/* 1. TOP BAR */}
      <header className="h-14 border-b border-stone-800/80 bg-[#090A0C]/90 backdrop-blur-md sticky top-0 z-50 px-4 flex items-center justify-between select-none">
        <div className="flex items-center gap-1 sm:gap-2">
          <div 
            onClick={() => setActiveTab('chat')}
            className="logo-container mr-3 font-['Space_Grotesk'] font-extrabold text-lg flex items-center tracking-wider"
          >
            <span className="text-white">asdfbase</span>
            <span className="logo-dot">.</span>
          </div>

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

        {/* Right Header Block */}
        <div className="flex items-center gap-2 sm:gap-3 font-mono text-xs">
          <button
            onClick={() => {
              handleFetchTimetables();
              setIsTimetableModalOpen(true);
            }}
            title="クリックで時間割・時程の管理を開く"
            className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg hover:bg-amber-500/25 transition interactive-btn cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold">Next: {nextSubject.name}</span>
            <span className="text-stone-400 text-[10px]">({nextSubject.time})</span>
          </button>

          <div className="flex items-center gap-1.5 text-stone-300 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70">
            <CloudSun className="w-3.5 h-3.5 text-amber-400" />
            <span>高松 {weather.temp}℃ ({weather.desc})</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-stone-400 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70">
            <CalendarClock className="w-3.5 h-3.5 text-stone-500" />
            <span>{currentTime || 'Loading...'}</span>
          </div>



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
            <aside className="w-56 border-r border-stone-800/80 bg-[#0C0D10] p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold">
                  <span>Channels</span>
                  <button
                    onClick={() => setIsNewChannelModalOpen(true)}
                    className="p-1 hover:text-amber-400 rounded text-stone-400 hover:bg-stone-800 transition"
                    title="チャンネルを作成"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {channels.map(ch => (
                    <div
                      key={ch.id}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition ${
                        activeChannelId === ch.id
                          ? 'bg-amber-500/10 text-amber-400 font-bold border border-amber-500/30'
                          : 'text-stone-400 hover:bg-stone-900/60 hover:text-stone-200'
                      }`}
                    >
                      <button
                        onClick={() => setActiveChannelId(ch.id)}
                        className="flex items-center gap-2 flex-1 text-left truncate"
                      >
                        {ch.type === 'voice' ? <Mic className="w-3.5 h-3.5 text-stone-500" /> : <Hash className="w-3.5 h-3.5 text-stone-500" />}
                        <span className="truncate">{ch.name}</span>
                      </button>
                      {channels.length > 1 && currentUser?.role === 'admin' && (
                        <button
                          onClick={() => handleDeleteChannel(ch.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 rounded text-stone-600 transition"
                          title="チャンネル削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* VC コントロール & 画面共有 */}
              <div className="bg-[#111214] border border-stone-800 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-stone-400">
                  <span className="flex items-center gap-1.5 font-bold text-white">
                    <Mic className={`w-3.5 h-3.5 ${inVoiceChannel ? 'text-emerald-400 animate-pulse' : 'text-stone-500'}`} />
                    ボイスチャット
                  </span>
                  <span className="text-[10px] text-stone-500">{inVoiceChannel ? '接続中' : '未接続'}</span>
                </div>

                {inVoiceChannel ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-1 pt-1">
                      <button
                        onClick={handleToggleMicMute}
                        className={`p-2 rounded-lg border text-xs flex-1 flex items-center justify-center gap-1 transition ${
                          isMicMuted ? 'bg-red-950/40 border-red-800 text-red-400' : 'bg-stone-800/80 border-stone-700 text-stone-200'
                        }`}
                        title={isMicMuted ? 'ミュート解除' : 'マイクミュート'}
                      >
                        {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={() => setIsDeafened(!isDeafened)}
                        className={`p-2 rounded-lg border text-xs flex-1 flex items-center justify-center gap-1 transition ${
                          isDeafened ? 'bg-red-950/40 border-red-800 text-red-400' : 'bg-stone-800/80 border-stone-700 text-stone-200'
                        }`}
                        title={isDeafened ? 'スピーカー有効化' : 'スピーカーミュート'}
                      >
                        {isDeafened ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={handleToggleScreenShare}
                        className={`p-2 rounded-lg border text-xs flex-1 flex items-center justify-center gap-1 transition ${
                          isScreenSharing ? 'bg-amber-500 text-black border-amber-400 font-bold' : 'bg-stone-800/80 border-stone-700 text-stone-200'
                        }`}
                        title="画面共有"
                      >
                        <Monitor className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setIsTtsEnabled(!isTtsEnabled)}
                        className={`p-2 rounded-lg border text-xs flex-1 flex items-center justify-center gap-1 transition ${
                          isTtsEnabled ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-stone-800/80 border-stone-700 text-stone-400'
                        }`}
                        title="聞き専モード（チャット読み上げ）"
                      >
                        <Headphones className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={handleToggleVoiceChannel}
                      className="w-full py-1 text-xs bg-red-950/50 hover:bg-red-900/60 border border-red-800/80 text-red-400 rounded-lg font-mono transition"
                    >
                      切断
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleToggleVoiceChannel}
                    className="w-full py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg font-mono transition"
                  >
                    参加する
                  </button>
                )}
              </div>
            </aside>

            {/* Center: メインチャット */}
            <section className="flex-1 flex flex-col bg-[#090A0C] overflow-hidden">
              <div className="h-12 border-b border-stone-800/80 px-4 flex items-center justify-between bg-[#0C0D10]/50 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Hash className="w-4 h-4 text-amber-400" />
                  <span>{channels.find(c => c.id === activeChannelId)?.name || 'chat'}</span>
                </div>

                <div className="flex items-center gap-2">
                  {isSearchOpen ? (
                    <div className="flex items-center gap-1.5 bg-[#16181D] border border-stone-800 px-2 py-1 rounded-lg">
                      <Search className="w-3.5 h-3.5 text-stone-500" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="メッセージを検索..."
                        value={chatSearchQuery}
                        onChange={e => setChatSearchQuery(e.target.value)}
                        className="bg-transparent text-white focus:outline-none w-36 sm:w-48 text-[11px]"
                      />
                      <button onClick={() => { setIsSearchOpen(false); setChatSearchQuery(''); }} className="text-stone-500 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsSearchOpen(true)}
                      className="p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 hover:text-white transition"
                      title="検索"
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => setIsMembersCollapsed(!isMembersCollapsed)}
                    className="p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 hover:text-white transition"
                    title={isMembersCollapsed ? 'メンバー一覧を表示' : 'メンバー一覧を隠す'}
                  >
                    {isMembersCollapsed ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* 画面共有プレビュー */}
              {isScreenSharing && (
                <div className="p-3 bg-[#111214] border-b border-stone-800 flex flex-col items-center justify-center">
                  <div className="w-full max-w-xl aspect-video bg-black rounded-xl overflow-hidden border border-stone-800 relative">
                    <video
                      ref={screenVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-[10px] font-mono px-2 py-0.5 rounded text-amber-400 border border-amber-500/30">
                      LIVE 画面共有中
                    </div>
                  </div>
                </div>
              )}

              {/* VC字幕化バー */}
              {inVoiceChannel && vcSubtitles && (
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs font-mono text-amber-300 flex items-center gap-2">
                  <Subtitles className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">{vcSubtitles}</span>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.filter(m => !chatSearchQuery || m.content.toLowerCase().includes(chatSearchQuery.toLowerCase())).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-stone-600 font-mono text-xs space-y-2">
                    <MessageSquare className="w-8 h-8 opacity-40 text-amber-400" />
                    <p>メッセージはありません。@gemini でAIと会話できます。</p>
                  </div>
                ) : (
                  messages
                    .filter(m => !chatSearchQuery || m.content.toLowerCase().includes(chatSearchQuery.toLowerCase()))
                    .map((m) => (
                    <div 
                      key={m.id} 
                      id={`msg-${m.id}`}
                      className={`flex items-start gap-3 group relative p-1.5 rounded-xl transition ${
                        m.is_pinned ? 'bg-amber-500/5 border border-amber-500/20' : ''
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold uppercase shrink-0 ${
                        m.sender_username === 'Gemini' 
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' 
                          : 'bg-stone-800 border border-stone-700 text-stone-300'
                      }`}>
                        {m.sender_username === 'Gemini' ? 'AI' : (m.sender_username || m.username || 'U')[0]}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-bold ${m.sender_username === 'Gemini' ? 'text-amber-400 font-mono' : 'text-stone-200'}`}>
                            {m.sender_username || m.username}
                          </span>
                          <span className="text-[10px] text-stone-500 font-mono">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {m.is_pinned && (
                            <span className="flex items-center gap-0.5 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.2 rounded border border-amber-400/20">
                              <Pin className="w-2.5 h-2.5" /> ピン留め
                            </span>
                          )}
                        </div>

                        {editingMessageId === m.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="text"
                              value={editingContent}
                              onChange={e => setEditingContent(e.target.value)}
                              className="flex-1 bg-[#16181D] border border-amber-500 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                            />
                            <button
                              onClick={() => handleEditMessage(m.id)}
                              className="px-2.5 py-1 bg-amber-500 text-black font-bold rounded-lg text-xs"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingMessageId(null)}
                              className="px-2.5 py-1 bg-stone-800 text-stone-400 rounded-lg text-xs"
                            >
                              キャンセル
                            </button>
                          </div>
                        ) : (
                          <div className={`text-sm rounded-xl px-3.5 py-2 inline-block max-w-2xl leading-relaxed ${
                            m.sender_username === 'Gemini' 
                              ? 'bg-[#151720] border border-amber-500/30 text-amber-100' 
                              : 'bg-[#111214] border border-stone-800/80 text-stone-300'
                          }`}>
                            {m.content.startsWith('![image]') ? (
                              <img 
                                src={m.content.match(/\((.*?)\)/)?.[1]} 
                                alt="attachment" 
                                className="max-h-72 rounded-lg object-contain my-1 border border-stone-800"
                              />
                            ) : (
                              <span>{m.content}</span>
                            )}
                          </div>
                        )}

                        {m.reactions && Object.keys(m.reactions).length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {Object.entries(m.reactions).map(([emoji, userIds]) => (
                              <button
                                key={emoji}
                                onClick={() => handleToggleReaction(m.id, emoji)}
                                className={`text-xs px-2 py-0.5 rounded-md border font-mono flex items-center gap-1 transition ${
                                  userIds.includes(currentUser.id)
                                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                    : 'bg-[#14161C] border-stone-800 text-stone-400 hover:border-stone-700'
                                }`}
                              >
                                <span>{emoji}</span>
                                <span>{userIds.length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="opacity-0 group-hover:opacity-100 transition absolute right-2 top-2 bg-[#16181D] border border-stone-800 rounded-lg p-1 flex items-center gap-1 shadow-md">
                        <button
                          onClick={() => handleToggleReaction(m.id, '👍')}
                          title="いいね"
                          className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400 text-xs"
                        >
                          👍
                        </button>
                        <button
                          onClick={() => handleToggleReaction(m.id, '❤️')}
                          title="ハート"
                          className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-red-400 text-xs"
                        >
                          ❤️
                        </button>
                        <button
                          onClick={() => handleTogglePin(m.id)}
                          title="ピン留め"
                          className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400"
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleCopyMessageLink(m.id)}
                          title="メッセージリンクをコピー"
                          className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"
                        >
                          {copiedLinkMessageId === m.id ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                        {(m.user_id === currentUser.id || currentUser.role === 'admin') && (
                          <>
                            {m.user_id === currentUser.id && (
                              <button
                                onClick={() => { setEditingMessageId(m.id); setEditingContent(m.content); }}
                                title="編集"
                                className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteMessage(m.id)}
                              title="削除"
                              className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-red-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input with @mention suggestions */}
              <div className="relative p-3 border-t border-stone-800/80 bg-[#0C0D10]/50">
                {showMentionSuggestions && (
                  <div className="absolute bottom-full left-4 mb-2 w-64 bg-[#111214] border border-stone-800 rounded-xl shadow-2xl p-2 font-mono text-xs space-y-1 z-30">
                    <div className="text-[10px] text-stone-500 uppercase px-2 font-bold">メンバー補完</div>
                    {[{ id: 0, username: 'gemini' }, ...onlineUsers]
                      .filter(u => u.username.toLowerCase().includes(mentionFilter.toLowerCase()))
                      .map(u => (
                        <button
                          key={u.id}
                          onClick={() => {
                            const lastAt = chatInput.lastIndexOf('@');
                            const prefix = chatInput.substring(0, lastAt);
                            setChatInput(`${prefix}@${u.username} `);
                            setShowMentionSuggestions(false);
                          }}
                          className="w-full px-2 py-1.5 rounded-lg flex items-center gap-2 hover:bg-stone-800 text-stone-300 hover:text-white transition text-left"
                        >
                          <span className="text-amber-400">@{u.username}</span>
                        </button>
                      ))}
                  </div>
                )}

                <form onSubmit={handleSendMessage}>
                  <div className="flex items-center gap-2 bg-[#14161C] border border-stone-800 rounded-xl px-3 py-2 focus-within:border-amber-500/60 transition">
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      title="画像添付 (自動WebP圧縮)"
                      className="p-1 rounded-lg text-stone-400 hover:text-amber-400 transition"
                    >
                      {isUploading ? <RefreshCw className="w-4 h-4 animate-spin text-amber-400" /> : <Image className="w-4 h-4" />}
                    </button>

                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => {
                        const val = e.target.value;
                        setChatInput(val);
                        const lastAt = val.lastIndexOf('@');
                        if (lastAt !== -1 && !val.substring(lastAt).includes(' ')) {
                          setShowMentionSuggestions(true);
                          setMentionFilter(val.substring(lastAt + 1));
                        } else {
                          setShowMentionSuggestions(false);
                        }
                      }}
                      placeholder="メッセージを入力... (@gemini でAI応答)"
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
              </div>
            </section>

            {/* Right: Members Sidebar (Collapsible) */}
            {!isMembersCollapsed && (
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
            )}
          </div>
        )}

        {/* TAB 2: リアルタイムメモ */}
        {activeTab === 'memo' && (
          <div className="flex-1 flex overflow-hidden">
            <aside className="w-64 border-r border-stone-800/80 bg-[#0C0D10] p-3 flex flex-col justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-3 font-bold flex items-center justify-between">
                  <span>Memo Slots (Max 10)</span>
                  <History className="w-3.5 h-3.5 text-stone-500" />
                </div>
                <div className="space-y-1.5">
                  {memoSlots.map(slot => (
                    <button
                      key={slot.slot_index}
                      onClick={() => {
                        setSelectedSlotIndex(slot.slot_index);
                        setMemoTitle(slot.title);
                        setMemoContent(slot.content);
                        setMemoMode(slot.mode);
                        setMemoAssignedUser(slot.assigned_user_id || null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono transition text-left ${
                        selectedSlotIndex === slot.slot_index
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'bg-[#111214] border border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-stone-500 font-bold">#{slot.slot_index}</span>
                        <span className="truncate">{slot.title || `メモ #${slot.slot_index}`}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {slot.mode === 'monaco' && <Lock className="w-2.5 h-2.5 text-stone-500" />}
                        <span className="text-[10px] text-stone-600 uppercase font-mono">{slot.mode}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <section className="flex-1 flex flex-col bg-[#090A0C] p-4">
              <div className="flex items-center justify-between mb-3 border-b border-stone-800/80 pb-3">
                <input
                  type="text"
                  disabled={isMonacoLocked}
                  value={memoTitle}
                  onChange={e => setMemoTitle(e.target.value)}
                  placeholder="タイトルを入力..."
                  className="bg-transparent text-xl font-bold font-['Space_Grotesk'] text-white focus:outline-none flex-1 mr-4 disabled:opacity-50"
                />

                <div className="flex items-center gap-2 font-mono text-xs">
                  {isMonacoLocked && (
                    <span className="text-red-400 flex items-center gap-1 bg-red-950/40 border border-red-800/60 px-2.5 py-1 rounded-lg">
                      <Lock className="w-3 h-3" /> 他ユーザーの専用ゾーン（閲覧専用）
                    </span>
                  )}

                  <select
                    value={memoMode}
                    disabled={isMonacoLocked}
                    onChange={e => setMemoMode(e.target.value as any)}
                    className="bg-[#14161C] border border-stone-800 text-stone-300 rounded-lg px-2.5 py-1.5 focus:outline-none disabled:opacity-50"
                  >
                    <option value="markdown">Markdownモード</option>
                    <option value="monaco">Monaco Editor (専用枠)</option>
                  </select>

                  {/* Memo AI Assistants */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleMemoAiAssist('summarize')}
                      disabled={isMemoAiLoading || !memoContent.trim()}
                      className="px-2.5 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 rounded-lg transition disabled:opacity-40 flex items-center gap-1 text-[11px]"
                      title="メモの内容を要約"
                    >
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span>{isMemoAiLoading ? '要約中...' : 'AI要約'}</span>
                    </button>
                    <button
                      onClick={() => handleMemoAiAssist('proofread')}
                      disabled={isMemoAiLoading || !memoContent.trim()}
                      className="px-2.5 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 rounded-lg transition disabled:opacity-40 flex items-center gap-1 text-[11px]"
                      title="誤字脱字・表現の校正"
                    >
                      <CheckCircle2 className="w-3 h-3 text-amber-400" />
                      <span>AI校正</span>
                    </button>
                    <button
                      onClick={() => handleMemoAiAssist('explain_code')}
                      disabled={isMemoAiLoading || !memoContent.trim()}
                      className="px-2.5 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 rounded-lg transition disabled:opacity-40 flex items-center gap-1 text-[11px]"
                      title="コードの解説"
                    >
                      <Bot className="w-3 h-3 text-amber-400" />
                      <span>コード解説</span>
                    </button>
                  </div>

                  <button
                    onClick={handleSaveMemo}
                    disabled={isSavingMemo || isMonacoLocked}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition interactive-btn uppercase disabled:opacity-50"
                  >
                    {isSavingMemo ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>

              <div className="flex-1 flex gap-4 overflow-hidden rounded-2xl border border-stone-800/80 bg-[#111214]">
                {memoMode === 'monaco' ? (
                  <div className="w-full h-full rounded-2xl overflow-hidden">
                    <Editor
                      height="100%"
                      defaultLanguage="typescript"
                      theme="vs-dark"
                      value={memoContent}
                      options={{
                        readOnly: isMonacoLocked,
                        minimap: { enabled: false },
                        fontSize: 13,
                        fontFamily: "'JetBrains Mono', monospace",
                        automaticLayout: true,
                      }}
                      onChange={val => handleMemoContentChange(val || '')}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex gap-4 p-4 overflow-hidden">
                    <textarea
                      value={memoContent}
                      onChange={e => handleMemoContentChange(e.target.value)}
                      placeholder="Markdownテキストを入力..."
                      className="flex-1 h-full bg-[#16181D] border border-stone-800 rounded-xl p-3.5 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:border-amber-500/50 resize-none"
                    />
                    <div className="flex-1 h-full bg-[#16181D]/60 border border-stone-800 rounded-xl p-4 text-stone-300 font-sans text-sm overflow-y-auto leading-relaxed prose prose-invert max-w-none">
                      <div className="text-[10px] font-mono text-stone-500 mb-2 border-b border-stone-800 pb-1">
                        MARKDOWN LIVE PREVIEW
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {memoContent || '（内容がありません）'}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: AI (Gemini Console) */}
        {activeTab === 'ai' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0C0D10]/50">
            {/* Header / Config Bar */}
            <div className="h-12 border-b border-stone-800/80 px-4 flex items-center justify-between font-mono text-xs bg-[#111214]">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-white">Gemini AI Console</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                  キープール稼働中
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-stone-400 hover:text-stone-200">
                  <input
                    type="checkbox"
                    checked={includeContextInAi}
                    onChange={e => setIncludeContextInAi(e.target.checked)}
                    className="accent-amber-500 rounded"
                  />
                  <span className="text-[11px]">システム情報(JSON)を渡す</span>
                </label>
                <button
                  onClick={() => setAiMessages([{
                    id: Date.now(),
                    role: 'model',
                    content: '会話履歴をリセットしました。何かお手伝いできることはありますか？',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }])}
                  className="p-1 hover:text-amber-400 text-stone-500 rounded transition"
                  title="履歴をクリア"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* AI Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl w-full mx-auto">
              {aiMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'model' && (
                    <div className="w-7 h-7 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-2xl rounded-2xl p-4 text-xs font-mono leading-relaxed shadow-lg ${
                      msg.role === 'user'
                        ? 'bg-amber-500 text-black font-semibold'
                        : 'bg-[#14161C] border border-stone-800/80 text-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1.5 opacity-60 text-[10px]">
                      <span>{msg.role === 'user' ? 'あなた' : 'Gemini AI'}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="prose prose-invert prose-xs max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoadingAi && (
                <div className="flex gap-3 justify-start">
                  <div className="w-7 h-7 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 animate-spin" />
                  </div>
                  <div className="bg-[#14161C] border border-stone-800/80 rounded-2xl p-4 text-xs font-mono text-stone-400 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span>Geminiが回答を生成中...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Form */}
            <div className="p-4 border-t border-stone-800/80 bg-[#111214]">
              <form onSubmit={handleSendAiMessage} className="max-w-4xl mx-auto flex gap-2">
                <input
                  type="text"
                  placeholder="Geminiに質問を入力 (例: 次の数学のテスト対策どうすればいい？、この課題の要約して)..."
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  disabled={isLoadingAi}
                  className="flex-1 bg-[#16181D] border border-stone-800 rounded-xl px-4 py-2.5 text-xs text-stone-200 font-mono focus:outline-none focus:border-amber-500/50"
                />
                <button
                  type="submit"
                  disabled={isLoadingAi || !aiInput.trim()}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold rounded-xl text-xs font-mono transition flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>送信</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: 提出物 & 時間割 (Phase 3 Full Feature) */}
        {activeTab === 'assignments' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Header & 時程切り替え */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-800/80 pb-4">
                <div>
                  <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white">提出物 & 時間割</h2>
                  <p className="text-xs text-stone-400 font-mono">
                    締め切り管理・再提出締め切り・教科フィルター・全員合格アーカイブ機能
                  </p>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-xs bg-[#111214] p-1 rounded-xl border border-stone-800">
                  <button
                    onClick={() => setScheduleType('normal')}
                    className={`px-3 py-1.5 rounded-lg transition ${
                      scheduleType === 'normal' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    通常時程
                  </button>
                  <button
                    onClick={() => setScheduleType('short')}
                    className={`px-3 py-1.5 rounded-lg transition ${
                      scheduleType === 'short' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    短縮時程
                  </button>
                  <button
                    onClick={() => setScheduleType('s_short')}
                    className={`px-3 py-1.5 rounded-lg transition ${
                      scheduleType === 's_short' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    S短時程
                  </button>
                </div>
              </div>

              {/* 提出物作成フォーム */}
              <form onSubmit={handleCreateAssignment} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 space-y-3 font-mono text-xs">
                <div className="text-stone-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-amber-400" /> 新規提出物の登録
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="課題タイトル"
                    value={newAssignTitle}
                    onChange={e => setNewAssignTitle(e.target.value)}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                  />
                  <select
                    value={newAssignSubject}
                    onChange={e => setNewAssignSubject(e.target.value)}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    {['国語', '数学', '英語', '理科', '社会', '情報', '保健体育', 'その他'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    required
                    value={newAssignDeadline}
                    onChange={e => setNewAssignDeadline(e.target.value)}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                  />
                </div>
                <textarea
                  placeholder="指示文・持ち物・注意事項（Geminiによる自動要約が使えます）"
                  value={newAssignDesc}
                  onChange={e => setNewAssignDesc(e.target.value)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-3 text-white focus:outline-none focus:border-amber-500/60 resize-none h-18"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition interactive-btn uppercase"
                >
                  提出物を追加
                </button>
              </form>

              {/* フィルター */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-stone-500">Filter:</span>
                {[
                  { id: 'all', label: 'すべて' },
                  { id: 'unstarted', label: '未着手' },
                  { id: 'in_progress', label: '進行中' },
                  { id: 'submitted', label: '提出済み' },
                  { id: 'passed', label: '合格' },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setAssignmentFilter(f.id as any)}
                    className={`px-2.5 py-1 rounded-lg border transition ${
                      assignmentFilter === f.id
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/40'
                        : 'bg-[#111214] text-stone-400 border-stone-800 hover:border-stone-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* 提出物カード一覧 */}
              <div className="space-y-3">
                {filteredAssignments.length === 0 ? (
                  <div className="p-8 text-center text-stone-600 font-mono text-xs border border-dashed border-stone-800 rounded-2xl">
                    表示できる提出物はありません。
                  </div>
                ) : (
                  filteredAssignments.map((item) => (
                    <div key={item.id} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4.5 interactive-card space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                            {item.subject}
                          </span>
                          <span className="font-bold text-white text-base">{item.title}</span>
                        </div>

                        {/* ステータスセレクト */}
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <select
                            value={item.my_status}
                            onChange={e => handleUpdateAssignmentStatus(item.id, e.target.value)}
                            className={`px-3 py-1 rounded-lg border font-bold focus:outline-none ${
                              item.my_status === 'passed'
                                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                                : item.my_status === 'submitted'
                                ? 'bg-sky-950/40 border-sky-800 text-sky-400'
                                : item.my_status === 'in_progress'
                                ? 'bg-amber-950/40 border-amber-800 text-amber-400'
                                : 'bg-stone-900 border-stone-800 text-stone-400'
                            }`}
                          >
                            <option value="unstarted">未着手</option>
                            <option value="in_progress">進行中</option>
                            <option value="submitted">提出済み</option>
                            <option value="resubmit">再提出</option>
                            <option value="passed">合格</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-stone-400">
                        <div>締切: <span className="text-stone-200 font-bold">{new Date(item.deadline).toLocaleDateString()}</span></div>
                        {item.resubmit_deadline && (
                          <div>再提出締切: <span className="text-stone-200">{new Date(item.resubmit_deadline).toLocaleDateString()}</span></div>
                        )}
                      </div>

                      {item.description && (
                        <div className="bg-[#16181D] border border-stone-800/60 rounded-xl p-3 text-xs text-stone-300 font-sans leading-relaxed">
                          {item.description}
                        </div>
                      )}

                      {/* Gemini 要約ボタン & 要約表示 */}
                      <div className="flex flex-col gap-2 pt-1 border-t border-stone-800/50">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => handleSummarizeAssignment(item)}
                            disabled={isSummarizingAI === item.id || !item.description}
                            className="text-xs font-mono flex items-center gap-1.5 text-amber-400 hover:text-amber-300 disabled:opacity-40 transition"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{isSummarizingAI === item.id ? 'Gemini 要約中...' : 'Geminiで要約・重要ポイント抽出'}</span>
                          </button>
                        </div>

                        {summarizedTexts[item.id] && (
                          <div className="bg-[#141720] border border-amber-500/30 rounded-xl p-3 text-xs text-amber-100 font-mono whitespace-pre-wrap leading-relaxed">
                            <div className="text-[10px] text-amber-400 font-bold mb-1">AI要約結果:</div>
                            {summarizedTexts[item.id]}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: リアルタイム共同作業ボード & クリップボード同期 (Phase 4 Full Feature) */}
        {activeTab === 'board' && (
          <div className="flex-1 flex flex-col p-4 bg-[#090A0C] overflow-hidden">
            {/* Whiteboard Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#111214] border border-stone-800/80 rounded-2xl p-3 mb-3 font-mono text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBoardMode('draw')}
                  className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition ${
                    boardMode === 'draw' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <Paintbrush className="w-3.5 h-3.5" />
                  <span>ペン描画</span>
                </button>

                <button
                  onClick={() => setBoardMode('eraser')}
                  className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition ${
                    boardMode === 'eraser' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>消しゴム</span>
                </button>

                <button
                  onClick={() => setBoardMode('text')}
                  className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition ${
                    boardMode === 'text' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <span>付箋/文章</span>
                </button>

                {(boardMode === 'draw' || boardMode === 'eraser') && (
                  <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
                    {boardMode === 'draw' && (
                      <>
                        <span className="text-stone-500">Color:</span>
                        {['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#ffffff'].map(c => (
                          <button
                            key={c}
                            onClick={() => setDrawColor(c)}
                            style={{ backgroundColor: c }}
                            className={`w-5 h-5 rounded-full border-2 transition ${
                              drawColor === c ? 'border-white scale-110' : 'border-transparent'
                            }`}
                          />
                        ))}
                      </>
                    )}

                    <span className="text-stone-500 ml-2">Size:</span>
                    {[2, 4, 8, 16].map(w => (
                      <button
                        key={w}
                        onClick={() => setBrushWidth(w)}
                        className={`px-2 py-0.5 rounded border transition ${
                          brushWidth === w ? 'border-amber-400 text-amber-400' : 'border-stone-800 text-stone-500'
                        }`}
                      >
                        {w}px
                      </button>
                    ))}
                  </div>
                )}

                {boardMode === 'text' && (
                  <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
                    <input
                      type="text"
                      placeholder="配置する文章を入力してボードをクリック"
                      value={newBoardText}
                      onChange={e => setNewBoardText(e.target.value)}
                      className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-1 text-white w-64 focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePlayTimelapse}
                  disabled={isTimelapsePlaying || boardStrokes.length === 0}
                  className="px-3 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-amber-400 rounded-xl flex items-center gap-1.5 transition disabled:opacity-40"
                >
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                  <span>{isTimelapsePlaying ? 'タイムラプス再生中...' : 'タイムラプス再生'}</span>
                </button>

                <button
                  onClick={handleClearBoard}
                  className="p-1.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-500 hover:text-red-400 hover:border-red-900 transition"
                  title="全員分クリア"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 relative border border-stone-800/80 rounded-2xl bg-[#0C0D10] overflow-hidden flex items-center justify-center cursor-crosshair">
              <canvas
                ref={canvasRef}
                width={1400}
                height={800}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onClick={handleAddBoardText}
                className="w-full h-full object-contain"
              />

              {/* クリップボード同期ドック (右下にPinP風配置) */}
              <div className="absolute bottom-4 left-4 w-80 bg-[#111214]/90 backdrop-blur-md border border-stone-800/80 rounded-2xl p-3 shadow-2xl font-mono text-xs space-y-2">
                <div className="flex items-center justify-between text-stone-400">
                  <span className="flex items-center gap-1.5 font-bold text-white">
                    <Clipboard className="w-3.5 h-3.5 text-amber-400" /> クリップボード同期
                  </span>
                  <span className="text-[10px] text-stone-500">by {clipboardUpdatedBy || 'system'}</span>
                </div>
                <textarea
                  value={clipboardText}
                  onChange={e => handleUpdateClipboard(e.target.value)}
                  placeholder="ここに貼り付け・記入すると全員と即座に同期されます..."
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-2 text-stone-200 focus:outline-none focus:border-amber-500/60 resize-none h-18 text-xs leading-relaxed"
                />
                <button
                  onClick={handleCopyClipboardToOS}
                  className="w-full py-1.5 bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-300 rounded-lg flex items-center justify-center gap-1.5 transition text-[11px]"
                >
                  {isCopiedToOS ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopiedToOS ? 'クリップボードにコピー完了！' : 'OSのクリップボードへコピー'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: その他 (テスト点数メモ & Gemini学習アドバイス) */}
        {activeTab === 'more' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white">テスト点数メモ & AIアドバイス</h2>
                <p className="text-xs text-stone-400 font-mono">テスト結果の記録、合計点・平均点の集計、Geminiによる個別学習アドバイス</p>
              </div>

              {/* 点数サマリー */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 interactive-card">
                  <div className="flex items-center gap-2 text-xs font-mono text-stone-400 mb-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span>TOTAL SCORE</span>
                  </div>
                  <div className="text-3xl font-black font-['Space_Grotesk'] text-white">
                    {totalScore} <span className="text-sm font-normal text-stone-500">/ {totalMaxScore}点</span>
                  </div>
                </div>

                <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 interactive-card">
                  <div className="flex items-center gap-2 text-xs font-mono text-stone-400 mb-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>AVERAGE SCORE</span>
                  </div>
                  <div className="text-3xl font-black font-['Space_Grotesk'] text-white">
                    {testScores.length > 0 ? (totalScore / testScores.length).toFixed(1) : 0} <span className="text-sm font-normal text-stone-500">点</span>
                  </div>
                </div>
              </div>

              {/* 点数登録フォーム */}
              <form onSubmit={handleCreateTestScore} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 font-mono text-xs space-y-3">
                <div className="text-stone-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-amber-400" /> 点数の記録
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="テスト名 (中間考査)"
                    value={newExamName}
                    onChange={e => setNewExamName(e.target.value)}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                  <input
                    type="text"
                    required
                    placeholder="教科名 (英語)"
                    value={newExamSubject}
                    onChange={e => setNewExamSubject(e.target.value)}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                  <input
                    type="number"
                    required
                    placeholder="得点"
                    value={newExamScore}
                    onChange={e => setNewExamScore(Number(e.target.value))}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                  <input
                    type="number"
                    required
                    placeholder="満点"
                    value={newExamMaxScore}
                    onChange={e => setNewExamMaxScore(Number(e.target.value))}
                    className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition interactive-btn uppercase"
                >
                  点数を追加
                </button>
              </form>

              {/* 一覧テーブル */}
              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl overflow-hidden font-mono text-xs">
                <div className="px-4 py-3 border-b border-stone-800 text-stone-400 font-bold uppercase tracking-wider">
                  記録一覧
                </div>
                <div className="divide-y divide-stone-800/60">
                  {testScores.map(t => (
                    <div key={t.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <span className="text-stone-500 mr-3">[{t.exam_name}]</span>
                        <span className="font-bold text-white">{t.subject}</span>
                      </div>
                      <div className="font-bold text-amber-400">
                        {t.score} / {t.max_score}点
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gemini アドバイス生成エリア */}
              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span className="font-bold font-['Space_Grotesk'] text-white">Gemini 学習アドバイス</span>
                  </div>
                  <button
                    onClick={handleGetAiAdvice}
                    disabled={isLoadingAdvice || testScores.length === 0}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-mono font-bold rounded-xl transition interactive-btn uppercase disabled:opacity-40"
                  >
                    {isLoadingAdvice ? 'AI分析中...' : 'アドバイスを生成'}
                  </button>
                </div>

                {aiAdvice && (
                  <div className="bg-[#16181D] border border-amber-500/30 rounded-xl p-4 text-xs font-mono text-amber-100 whitespace-pre-wrap leading-relaxed">
                    {aiAdvice}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: 設定 (アカウント・通知・Webhook・監査ログ) */}
        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center justify-between border-b border-stone-800/80 pb-4">
                <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white">設定</h2>
                <div className="flex gap-1.5 font-mono text-xs bg-[#111214] p-1 rounded-xl border border-stone-800">
                  {[
                    { id: 'account', label: 'アカウント' },
                    { id: 'notifications', label: '通知設定' },
                    { id: 'webhook', label: 'Webhook' },
                    { id: 'audit', label: '監査ログ' },
                  ].map(sec => (
                    <button
                      key={sec.id}
                      onClick={() => {
                        setSettingsSection(sec.id as any);
                        if (sec.id === 'audit' && token) {
                          safeFetch(`${API_BASE_URL}/api/audit-logs`, { headers: { Authorization: `Bearer ${token}` } })
                            .then(r => r.json())
                            .then(data => setAuditLogs(data))
                            .catch(console.error);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        settingsSection === sec.id
                          ? 'bg-amber-500 text-black font-bold'
                          : 'text-stone-400 hover:text-white'
                      }`}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 1. アカウント設定 */}
              {settingsSection === 'account' && (
                <div className="space-y-4">
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-3">
                    <div className="text-stone-400 uppercase font-bold tracking-wider">Account Information</div>
                    <div className="text-stone-200">ユーザー名: <span className="text-amber-400 font-bold">{currentUser.username}</span></div>
                    <div className="text-stone-200">権限: <span className="text-stone-400">{currentUser.role}</span></div>
                  </div>

                  {/* パスワード変更 */}
                  <form onSubmit={handleChangePassword} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-3">
                    <div className="text-stone-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" /> パスワード変更
                    </div>
                    {passwordChangeStatus && (
                      <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl">
                        {passwordChangeStatus}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="password"
                        required
                        placeholder="現在のパスワード"
                        value={currentPasswordInput}
                        onChange={e => setCurrentPasswordInput(e.target.value)}
                        className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                      />
                      <input
                        type="password"
                        required
                        placeholder="新しいパスワード"
                        value={newPasswordInput}
                        onChange={e => setNewPasswordInput(e.target.value)}
                        className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition uppercase"
                    >
                      変更を保存
                    </button>
                  </form>

                  {/* アカウント削除 */}
                  <div className="bg-red-950/20 border border-red-900/40 rounded-2xl p-6 font-mono text-xs space-y-3">
                    <div className="text-red-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> アカウント削除
                    </div>
                    <p className="text-stone-400">
                      アカウントを削除すると、チャットやメモの割り当てを含むすべての権限が削除されます。
                    </p>
                    <button
                      onClick={handleDeleteAccount}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition uppercase"
                    >
                      アカウントを完全に削除する
                    </button>
                  </div>
                </div>
              )}

              {/* 2. 通知設定 */}
              {settingsSection === 'notifications' && (
                <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-4">
                  <div className="text-stone-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-amber-400" /> 通知設定
                  </div>
                  <div className="flex items-center justify-between p-3 bg-[#16181D] border border-stone-800 rounded-xl">
                    <div>
                      <div className="text-white font-bold">チャット・提出物通知</div>
                      <div className="text-stone-500 text-[11px]">新着メッセージや提出物リマインドを受信します</div>
                    </div>
                    <button
                      onClick={() => setIsNotificationEnabled(!isNotificationEnabled)}
                      className={`px-3 py-1.5 rounded-lg border font-bold transition ${
                        isNotificationEnabled
                          ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                          : 'bg-stone-800 border-stone-700 text-stone-500'
                      }`}
                    >
                      {isNotificationEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              )}

              {/* 3. Webhook設定 */}
              {settingsSection === 'webhook' && (
                <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-4">
                  <div className="text-stone-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5 text-amber-400" /> Discord Webhook 連携
                  </div>
                  <p className="text-stone-400 leading-relaxed">
                    DiscordのチャンネルWebhook URLを設定すると、asdfbaseのメッセージや重要な通知がDiscordに自動転送されます。
                  </p>
                  {webhookStatus && (
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl">
                      {webhookStatus}
                    </div>
                  )}
                  <div className="space-y-2">
                    <input
                      type="url"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={webhookUrlInput}
                      onChange={e => setWebhookUrlInput(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                    />
                    <button
                      onClick={handleTestWebhook}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition uppercase"
                    >
                      テスト送信
                    </button>
                  </div>
                </div>
              )}

              {/* 4. 監査ログ & 復元 */}
              {settingsSection === 'audit' && (
                <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-3">
                  <div className="text-stone-400 uppercase font-bold tracking-wider flex items-center justify-between">
                    <span>監査ログ & 復元</span>
                    <button
                      onClick={() => {
                        if (token) {
                          safeFetch(`${API_BASE_URL}/api/audit-logs`, { headers: { Authorization: `Bearer ${token}` } })
                            .then(r => r.json())
                            .then(data => setAuditLogs(data))
                            .catch(console.error);
                        }
                      }}
                      className="text-stone-400 hover:text-white"
                      title="更新"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-2 text-stone-300 divide-y divide-stone-800/60">
                    {auditLogs.length === 0 ? (
                      <div className="py-4 text-center text-stone-500">監査ログはありません</div>
                    ) : (
                      auditLogs.map(log => (
                        <div key={log.id} className="pt-2 flex items-center justify-between">
                          <div>
                            <span className="text-stone-500 mr-2">[{new Date(log.created_at).toLocaleDateString()}]</span>
                            <span>{log.action} ({log.target_type}) by <span className="text-amber-400">{log.username || 'system'}</span></span>
                          </div>
                          {log.can_restore && (
                            <button
                              onClick={() => handleRestoreAuditLog(log.id)}
                              disabled={log.restored}
                              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[10px] disabled:opacity-40 transition"
                            >
                              {log.restored ? '復元済み' : '復元'}
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* カメラ小窓 (実機WebRTCカメラプレビュー) */}
      {showCamera && (
        <div className="fixed bottom-4 right-4 w-72 bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden z-50">
          <div className="p-2.5 border-b border-stone-800 flex items-center justify-between text-xs font-mono text-stone-400">
            <span className="flex items-center gap-1.5 font-bold text-white">
              <Camera className="w-3.5 h-3.5 text-amber-400" /> カメラプレビュー
            </span>
            <button onClick={() => setShowCamera(false)} className="text-stone-500 hover:text-white">&times;</button>
          </div>
          <div className="h-48 bg-black flex items-center justify-center relative overflow-hidden">
            {cameraError ? (
              <div className="p-4 text-center text-red-400 font-mono text-xs">
                {cameraError}
              </div>
            ) : (
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            )}
          </div>
        </div>
      )}

      {/* チャンネル作成モーダル */}
      {isNewChannelModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl font-mono text-xs space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm">新規チャンネル作成</span>
              <button onClick={() => setIsNewChannelModalOpen(false)} className="text-stone-500 hover:text-white">&times;</button>
            </div>
            <form onSubmit={handleCreateChannel} className="space-y-3">
              <div>
                <label className="block text-stone-400 mb-1">チャンネル名</label>
                <input
                  type="text"
                  required
                  placeholder="例: study-room"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-stone-400 mb-1">タイプ</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewChannelType('text')}
                    className={`flex-1 py-1.5 rounded-lg border transition ${
                      newChannelType === 'text' ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold' : 'border-stone-800 text-stone-400'
                    }`}
                  >
                    テキスト
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewChannelType('voice')}
                    className={`flex-1 py-1.5 rounded-lg border transition ${
                      newChannelType === 'voice' ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold' : 'border-stone-800 text-stone-400'
                    }`}
                  >
                    ボイス
                  </button>
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition"
              >
                作成
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Ctrl+K コマンドパレット (Spotlight風モーダル) */}
      {isPaletteOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 p-4">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-xl bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden interactive-card font-mono text-xs"
          >
            <div className="p-3 border-b border-stone-800 flex items-center gap-2">
              <Command className="w-4 h-4 text-amber-400" />
              <input
                autoFocus
                type="text"
                placeholder="コマンド、計算式 (例: 12 * 85)、タブ名を入力..."
                value={paletteQuery}
                onChange={e => handlePaletteInput(e.target.value)}
                className="w-full bg-transparent text-white focus:outline-none placeholder-stone-600 text-sm"
              />
              <span className="text-[10px] text-stone-500 border border-stone-800 px-1.5 py-0.5 rounded">ESC</span>
            </div>

            {/* 計算機結果 */}
            {calcResult !== null && (
              <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-amber-400" />
                  <span>計算結果:</span>
                </div>
                <span className="text-base font-bold font-['Space_Grotesk'] text-white">{calcResult}</span>
              </div>
            )}

            {/* ナビゲーションショートカット候補 */}
            <div className="p-2 space-y-1">
              <div className="text-[10px] uppercase text-stone-500 px-2 py-1 font-bold">Quick Navigation</div>
              {[
                { id: 'chat', label: 'チャットへ移動', desc: '/chat' },
                { id: 'memo', label: 'リアルタイムメモへ移動', desc: '/memo' },
                { id: 'assignments', label: '提出物・時間割へ移動', desc: '/assignments' },
                { id: 'board', label: 'ホワイトボードへ移動', desc: '/board' },
                { id: 'ai', label: 'Gemini AIへ移動', desc: '/ai' },
                { id: 'more', label: 'テスト点数メモへ移動', desc: '/more' },
                { id: 'settings', label: '設定へ移動', desc: '/settings' },
              ].filter(c => c.label.includes(paletteQuery) || c.desc.includes(paletteQuery) || !paletteQuery).map(cmd => (
                <button
                  key={cmd.id}
                  onClick={() => {
                    setActiveTab(cmd.id as any);
                    setIsPaletteOpen(false);
                    setPaletteQuery('');
                  }}
                  className="w-full px-3 py-2 rounded-xl flex items-center justify-between hover:bg-stone-900/80 text-stone-300 hover:text-white transition text-left"
                >
                  <span>{cmd.label}</span>
                  <span className="text-stone-500 text-[10px]">{cmd.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 時間割管理モーダル (ヘッダーの「次の教科」クリック時など) */}
      {isTimetableModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-2xl bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden interactive-card font-mono text-xs max-h-[90vh] flex flex-col"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-white text-sm">時間割・時程の管理</span>
              </div>
              <button 
                onClick={() => setIsTimetableModalOpen(false)}
                className="text-stone-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* 時程選択 */}
              <div className="flex items-center gap-2 bg-[#16181D] border border-stone-800 p-2.5 rounded-xl">
                <span className="text-stone-400 font-bold">時程タイプ:</span>
                <div className="flex gap-1.5 flex-1">
                  {[
                    { id: 'normal', label: '通常時程' },
                    { id: 'short', label: '短縮時程' },
                    { id: 's_short', label: 'S短時程' }
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setScheduleType(t.id as any)}
                      className={`px-3 py-1 rounded-lg border transition ${
                        scheduleType === t.id
                          ? 'bg-amber-500 text-black font-bold border-amber-500'
                          : 'border-stone-800 text-stone-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 時間割登録フォーム */}
              <form onSubmit={handleCreateTimetableEntry} className="bg-[#16181D] border border-stone-800 p-3 rounded-xl space-y-3">
                <div className="text-[11px] font-bold text-stone-300">新しいコマを登録</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-stone-500 block mb-1">曜日</label>
                    <select
                      value={newTtDay}
                      onChange={e => setNewTtDay(Number(e.target.value))}
                      className="w-full bg-[#111214] border border-stone-800 rounded-lg px-2 py-1.5 text-white focus:outline-none"
                    >
                      <option value={1}>月曜日</option>
                      <option value={2}>火曜日</option>
                      <option value={3}>水曜日</option>
                      <option value={4}>木曜日</option>
                      <option value={5}>金曜日</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-500 block mb-1">時限</label>
                    <select
                      value={newTtPeriod}
                      onChange={e => setNewTtPeriod(Number(e.target.value))}
                      className="w-full bg-[#111214] border border-stone-800 rounded-lg px-2 py-1.5 text-white focus:outline-none"
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map(p => (
                        <option key={p} value={p}>{p}限</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-500 block mb-1">教科名</label>
                    <input
                      type="text"
                      required
                      placeholder="数学、物理など"
                      value={newTtSubject}
                      onChange={e => setNewTtSubject(e.target.value)}
                      className="w-full bg-[#111214] border border-stone-800 rounded-lg px-2 py-1.5 text-white focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition"
                >
                  コマを追加
                </button>
              </form>

              {/* 登録済み時間割一覧 */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-stone-300">登録済みコマ一覧 ({scheduleType})</div>
                {timetables.length === 0 ? (
                  <div className="text-center py-6 text-stone-600">登録されたコマはありません</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {timetables.map((tt: any) => {
                      const dayNames = ['', '月', '火', '水', '木', '金'];
                      return (
                        <div key={tt.id} className="flex items-center justify-between p-2.5 bg-[#16181D] border border-stone-800 rounded-xl">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-center justify-center font-bold">
                              {dayNames[tt.day_of_week] || '月'}
                            </span>
                            <span className="text-stone-400">{tt.period}限</span>
                            <span className="text-white font-bold">{tt.subject}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteTimetableEntry(tt.id)}
                            className="p-1 text-stone-500 hover:text-red-400 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* メモAI処理結果モーダル */}
      {memoAiResultModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-xl bg-[#111214] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden interactive-card font-mono text-xs flex flex-col max-h-[80vh]"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-2 text-amber-300 font-bold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Gemini AI による処理結果</span>
              </div>
              <button 
                onClick={() => setMemoAiResultModal(null)}
                className="text-stone-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-stone-200 whitespace-pre-wrap leading-relaxed select-text">
              {memoAiResultModal}
            </div>
            <div className="p-3 border-t border-stone-800 flex justify-end gap-2 bg-[#16181D]">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(memoAiResultModal);
                  alert('クリップボードにコピーしました！');
                }}
                className="px-3 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-white rounded-lg transition flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5 text-amber-400" />
                <span>結果をコピー</span>
              </button>
              <button
                onClick={() => setMemoAiResultModal(null)}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
