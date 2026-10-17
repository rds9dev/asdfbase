import React, { useState, useEffect, useRef } from 'react';
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
  Share2
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const [boardMode, setBoardMode] = useState<'draw' | 'text'>('draw');
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

  // Weather (Takamatsu)
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
        console.error('Weather error:', e);
      }
    }
    fetchWeather();
    const interval = setInterval(fetchWeather, 600000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Current User
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

  // WebSocket Setup
  useEffect(() => {
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

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
          setSelectedSlotIndex(first.slot_index);
          setMemoTitle(first.title);
          setMemoContent(first.content);
          setMemoMode(first.mode);
          setMemoAssignedUser(first.assigned_user_id);
        }
      })
      .catch(console.error);

    fetch('/api/assignments', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAssignments(data))
      .catch(console.error);

    fetch('/api/test-scores', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setTestScores(data))
      .catch(console.error);

    fetch('/api/board', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.strokes) setBoardStrokes(data.strokes);
        if (data.texts) setBoardTexts(data.texts);
      })
      .catch(console.error);

    fetch('/api/clipboard', { headers: { Authorization: `Bearer ${token}` } })
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

  // Image Upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.url) {
        await fetch(`/api/channels/${activeChannelId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            content: `![image](${data.url})`,
            attachments: [data.url]
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
      await fetch(`/api/channels/${activeChannelId}/messages`, {
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
      await fetch(`/api/messages/${messageId}/reactions`, {
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
      await fetch(`/api/messages/${messageId}/pin`, {
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

  const handleSaveMemo = async () => {
    if (!token) return;
    setIsSavingMemo(true);
    try {
      const res = await fetch(`/api/notes/${selectedSlotIndex}`, {
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
      const res = await fetch('/api/assignments', {
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
      const res = await fetch(`/api/assignments/${id}/progress`, {
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
      const res = await fetch('/api/assignments/summarize', {
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
      const res = await fetch('/api/test-scores', {
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
      const res = await fetch('/api/test-scores/advice', {
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

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (boardMode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    setCurrentStrokePoints([{ x, y }]);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || boardMode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newPoints = [...currentStrokePoints, { x, y }];
    setCurrentStrokePoints(newPoints);

    const ctx = canvas.getContext('2d');
    if (ctx && newPoints.length >= 2) {
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = brushWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(newPoints[newPoints.length - 2].x, newPoints[newPoints.length - 2].y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const handleCanvasMouseUp = async () => {
    if (!isDrawing || boardMode !== 'draw') return;
    setIsDrawing(false);

    if (currentStrokePoints.length >= 2 && token) {
      try {
        await fetch('/api/board/stroke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            color: drawColor,
            width: brushWidth,
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    try {
      await fetch('/api/board/text', {
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
      await fetch('/api/board/clear', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  // タイムラプス再生 (履歴を最初から順次描画)
  const handlePlayTimelapse = () => {
    if (boardStrokes.length === 0 || isTimelapsePlaying) return;
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
        setIsTimelapsePlaying(false);
        redrawCanvas(boardStrokes, boardTexts);
        return;
      }
      const stroke = boardStrokes[i];
      if (stroke.points && stroke.points.length >= 2) {
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
      i++;
    }, 120);
  };

  // Phase 4: Shared Clipboard Handlers
  const handleUpdateClipboard = async (newText: string) => {
    setClipboardText(newText);
    if (!token) return;
    try {
      await fetch('/api/clipboard', {
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
        <div className="flex items-center gap-3 sm:gap-4 font-mono text-xs">
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

          <div className="hidden md:flex items-center gap-1.5 text-stone-400 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70">
            <CalendarClock className="w-3.5 h-3.5 text-stone-500" />
            <span>{currentTime || 'Loading...'}</span>
          </div>

          <div className="flex items-center gap-1.5 text-stone-300 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70">
            <CloudSun className="w-3.5 h-3.5 text-amber-400" />
            <span>高松 {weather.temp}℃ ({weather.desc})</span>
          </div>

          <button
            onClick={() => setActiveTab('assignments')}
            title="時間割 / 提出物に移動"
            className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg hover:bg-amber-500/25 transition interactive-btn"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold">Next: {nextSubject.name}</span>
            <span className="text-stone-400 text-[10px]">({nextSubject.time})</span>
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

              <div className="bg-[#111214] border border-stone-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-stone-400 mb-1">
                  <span className="flex items-center gap-1"><Mic className="w-3 h-3 text-emerald-400" /> VC & 画面共有</span>
                  <span className="text-[9px] text-stone-500">VOICEVOX</span>
                </div>
                <button className="w-full py-1 text-[11px] bg-stone-800 hover:bg-stone-700 text-stone-300 rounded font-mono transition">
                  /join vc1
                </button>
              </div>
            </aside>

            {/* Center: メインチャット */}
            <section className="flex-1 flex flex-col bg-[#090A0C] overflow-hidden">
              <div className="h-12 border-b border-stone-800/80 px-4 flex items-center justify-between bg-[#0C0D10]/50 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Hash className="w-4 h-4 text-amber-400" />
                  <span>{channels.find(c => c.id === activeChannelId)?.name || 'chat'}</span>
                </div>
                <div className="text-stone-500 text-[11px]">
                  WebSocket + WebP圧縮 + @gemini自動応答 + Discord中継
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-stone-600 font-mono text-xs space-y-2">
                    <MessageSquare className="w-8 h-8 opacity-40 text-amber-400" />
                    <p>メッセージはありません。@gemini や /ai コマンドでAIと会話できます。</p>
                  </div>
                ) : (
                  messages.map((m) => (
                    <div 
                      key={m.id} 
                      id={`msg-${m.id}`}
                      className={`flex items-start gap-3 group relative p-1 rounded-xl transition ${
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
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="p-3 border-t border-stone-800/80 bg-[#0C0D10]/50">
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
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="メッセージを入力... (@gemini, /ai, /join vc1 等のコマンド対応)"
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
                      onChange={val => setMemoContent(val || '')}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex gap-4 p-4 overflow-hidden">
                    <textarea
                      value={memoContent}
                      onChange={e => setMemoContent(e.target.value)}
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
          <div className="flex-1 p-6 flex flex-col items-center justify-center">
            <div className="max-w-2xl w-full bg-[#111214] border border-stone-800/80 rounded-3xl p-8 text-center interactive-card">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white mb-2">Gemini AI キープール連携</h2>
              <p className="text-stone-400 text-xs font-mono mb-6 leading-relaxed">
                複数のGemini APIキーを自動ローテーション管理。レートリミットを回避しながら提出物の自動要約やアドバイスを生成します。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-left font-mono text-xs">
                <div className="p-3 bg-[#16181D] border border-stone-800 rounded-xl">
                  <div className="text-amber-400 font-bold mb-1">💬 チャット連動</div>
                  <div className="text-stone-400">@gemini や /ai でリアルタイムにチャット内で自動返信</div>
                </div>
                <div className="p-3 bg-[#16181D] border border-stone-800 rounded-xl">
                  <div className="text-amber-400 font-bold mb-1">📝 提出物要約</div>
                  <div className="text-stone-400">長い課題指示文を重要ポイント・持ち物・締切にJSON要約</div>
                </div>
                <div className="p-3 bg-[#16181D] border border-stone-800 rounded-xl">
                  <div className="text-amber-400 font-bold mb-1">📊 テスト分析</div>
                  <div className="text-stone-400">各教科の得点傾向からAIが学習アドバイスを提供</div>
                </div>
              </div>
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
                  onClick={() => setBoardMode('text')}
                  className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition ${
                    boardMode === 'text' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                  }`}
                >
                  <span>付箋/文章</span>
                </button>

                {boardMode === 'draw' && (
                  <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
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

                    <span className="text-stone-500 ml-2">Size:</span>
                    {[2, 4, 8].map(w => (
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

        {/* TAB 7: 設定 */}
        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-6">
              <h2 className="text-2xl font-bold font-['Space_Grotesk'] text-white">設定</h2>

              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-3">
                <div className="text-stone-400 uppercase font-bold tracking-wider">Account Information</div>
                <div className="text-stone-200">ユーザー名: <span className="text-amber-400 font-bold">{currentUser.username}</span></div>
                <div className="text-stone-200">権限: <span className="text-stone-400">{currentUser.role}</span></div>
              </div>

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

      {/* カメラ小窓 */}
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
    </div>
  );
}
