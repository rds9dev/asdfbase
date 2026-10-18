import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  Code,
  Subtitles,
  Headphones,
  Eye,
  Book,
  Check,
  User,
  Users,
  ArrowDown,
  HelpCircle,
  SwitchCamera,
  Reply,
  Download,
  ZoomIn,
  ZoomOut,
  Film,
  Backpack,
  Sun,
  CloudRain,
  Cloud,
  Moon,
  Sunrise,
  PenTool,
  Umbrella
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  API_BASE_URL, getApiBaseUrl,
  getConnectionRoute, setConnectionRoute, getRealtimeTransport, setRealtimeTransport, getPollInterval, setPollInterval,
  type ConnectionRoute, type RealtimeTransport,
} from './config';
import { RealtimeClient, type RealtimeStatus, type ConcreteTransport } from './realtime';

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
  client_nonce?: string | null;
  pending?: boolean;
  failed?: boolean;
  reply_to?: { id: number; username?: string; user_id?: number | null; content?: string; deleted?: boolean } | null;
}

const VIDEO_NOTICE = '(動画が送信されています)';
const IMAGE_MESSAGE_RE = /^!\[[^\]]*\]\(([^)\s]+)\)$/;

// 返信プレビュー用にメッセージ本文を短く整形
function summarizeContent(content?: string): string {
  if (!content) return '';
  if (IMAGE_MESSAGE_RE.test(content.trim())) return '🖼 画像';
  return content.replace(/\s+/g, ' ').slice(0, 80);
}

// 楽観的送信メッセージ(負のID)を確定メッセージで置換しつつ、重複を排除してマージ
function mergeIncomingMessage(prev: Message[], msg: Message): Message[] {
  const exists = prev.some(m => m.id === msg.id);
  const nonceIdx = msg.client_nonce ? prev.findIndex(m => m.id < 0 && m.client_nonce === msg.client_nonce) : -1;
  if (nonceIdx >= 0) {
    const next = [...prev];
    if (exists) next.splice(nonceIdx, 1);
    else next[nonceIdx] = msg;
    return next;
  }
  if (exists) return prev;
  // 送信中メッセージは常に末尾に保つ
  const firstPending = prev.findIndex(m => m.id < 0);
  if (firstPending === -1) return [...prev, msg];
  return [...prev.slice(0, firstPending), msg, ...prev.slice(firstPending)];
}

const TRANSPORT_LABELS: Record<string, string> = {
  ws: 'WebSocket',
  sse: 'SSE',
  longpoll: 'ロングポーリング',
  poll: 'ポーリング',
};

const AVATAR_COLORS = [
  'bg-sky-500/20 text-sky-300 border-sky-500/40',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'bg-violet-500/20 text-violet-300 border-violet-500/40',
  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  'bg-lime-500/20 text-lime-300 border-lime-500/40',
  'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
  'bg-orange-500/20 text-orange-300 border-orange-500/40',
];
function avatarColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function CornerReplyIcon() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" className="shrink-0 text-stone-600" aria-hidden="true">
      <path d="M2 10 V6 Q2 2 6 2 H22" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function formatDateSeparator(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return '今日';
  if (d.toDateString() === yesterday.toDateString()) return '昨日';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

interface MemoSlot {
  slot_index: number;
  title: string;
  content: string;
  mode: 'markdown' | 'monaco' | 'plain';
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
  items?: string;
  note?: string;
}

type ScheduleType = 'normal' | 'short' | 's_short';
type PeriodTime = { start: string; end: string };
const SCHEDULE_LABELS: Record<ScheduleType, string> = { normal: '通常時程', short: '短縮時程', s_short: 'S短時程' };
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ヘッダーに出す「今」の状態: 休み / 朝 / 授業中 / 休み時間 / 昼休み / 放課後
function computeSchoolStatus(now: Date, periods: PeriodTime[], today: TimetableItem[]) {
  const dow = now.getDay();
  const subjectOf = (p: number) => today.find(t => t.period === p)?.subject || '';
  if (dow === 0 || dow === 6) {
    return { kind: 'holiday' as const, label: '休み', sub: dow === 6 ? '土曜日' : '日曜日' };
  }
  if (periods.length === 0) return { kind: 'holiday' as const, label: '時程未設定', sub: '' };
  const registered = today.map(t => t.period);
  const lastPeriod = registered.length > 0 ? Math.min(Math.max(...registered), periods.length) : periods.length;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const first = periods[0];
  if (nowMin < toMinutes(first.start)) {
    return { kind: 'morning' as const, label: '朝', sub: `1限 ${subjectOf(1) || ''} ${first.start}~`.replace(/\s+/g, ' ') };
  }
  for (let i = 0; i < lastPeriod; i++) {
    const p = periods[i];
    const start = toMinutes(p.start);
    const end = toMinutes(p.end);
    if (nowMin >= start && nowMin < end) {
      return { kind: 'class' as const, label: `${i + 1}限 ${subjectOf(i + 1) || '授業中'}`, sub: `~${p.end}` };
    }
    const next = periods[i + 1];
    if (next && i + 1 < lastPeriod && nowMin >= end && nowMin < toMinutes(next.start)) {
      const isLunch = toMinutes(next.start) - end >= 30;
      return {
        kind: 'break' as const,
        label: `Next: ${i + 2}限 ${subjectOf(i + 2) || ''}`.trim(),
        sub: `${isLunch ? '昼休み' : '休み時間'} · ${next.start}~`,
      };
    }
  }
  return { kind: 'after' as const, label: '放課後', sub: `${lastPeriod}限まで終了` };
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
  user_id?: number;
  username?: string;
  exam_name: string;
  subject: string;
  score: number;
  max_score: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('asdf_token'));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = currentUser;

  const playNotificationSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Audio might be restricted
    }
  };
  
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'chat' | 'memo' | 'ai' | 'assignments' | 'board' | 'more' | 'settings'>('chat');

  // Header Data
  const [currentTime, setCurrentTime] = useState<string>('');
  const [weather, setWeather] = useState<{ temp: number | null; desc: string; weatherCode?: number; tempMax?: number | null; tempMin?: number | null; precipProb?: number | null; source?: string }>({ temp: null, desc: '取得中' });
  const [nextSubject, setNextSubject] = useState<{ name: string; time: string }>({ name: '数学', time: '10:45~' });
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string>('');

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
  const aiEndRef = useRef<HTMLDivElement | null>(null);

  // Memo AI State
  const [isMemoAiLoading, setIsMemoAiLoading] = useState(false);
  const [memoAiResultModal, setMemoAiResultModal] = useState<string | null>(null);

  // Timetables State & Modal
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [newTtDay, setNewTtDay] = useState(1);
  const [newTtPeriod, setNewTtPeriod] = useState(1);
  const [newTtSubject, setNewTtSubject] = useState('');

  // Chat UI State (Mention, Search, Edit, Member Panel, Responsive)
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [isMembersCollapsed, setIsMembersCollapsed] = useState(false);
  const [isChannelsCollapsed, setIsChannelsCollapsed] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(Boolean(localStorage.getItem('asdf_token')));
  const [isNewChannelModalOpen, setIsNewChannelModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  // Settings State (Account, Notifications, Webhook, Audit Logs, Appearance)
  const [settingsSection, setSettingsSection] = useState<'account' | 'notifications' | 'webhook' | 'audit' | 'appearance' | 'connection'>('account');
  const [latencyResult, setLatencyResult] = useState<string>('');
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordChangeStatus, setPasswordChangeStatus] = useState('');
  const [isNotificationEnabled, setIsNotificationEnabled] = useState(true);
  // ブラウザ通知: 重要 (メンション・返信・@everyone・新しい提出物) / 全メッセージ / 通知音
  const [notifyPrefs, setNotifyPrefs] = useState<{ important: boolean; messages: boolean; sound: boolean }>(() => {
    try {
      return { important: true, messages: false, sound: true, ...JSON.parse(localStorage.getItem('asdf_notify_prefs') || '{}') };
    } catch {
      return { important: true, messages: false, sound: true };
    }
  });
  const notifyPrefsRef = useRef(notifyPrefs);
  notifyPrefsRef.current = notifyPrefs;
  const updateNotifyPrefs = (patch: Partial<{ important: boolean; messages: boolean; sound: boolean }>) => {
    const next = { ...notifyPrefsRef.current, ...patch };
    setNotifyPrefs(next);
    try { localStorage.setItem('asdf_notify_prefs', JSON.stringify(next)); } catch (_) {}
    if ((patch.important || patch.messages) && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  };
  const [integrations, setIntegrations] = useState<any>(null);
  const [integrationStatus, setIntegrationStatus] = useState('');
  const [auditFilter, setAuditFilter] = useState('');
  const [expandedAuditId, setExpandedAuditId] = useState<number | null>(null);
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
  ]);
  const [activeChannelId, setActiveChannelId] = useState<number>(1);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  const [lastReadMessageIds, setLastReadMessageIds] = useState<Record<number, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('asdf_last_read') || '{}');
    } catch {
      return {};
    }
  });
  const lastReadMessageIdsRef = useRef<Record<number, number>>(lastReadMessageIds);
  lastReadMessageIdsRef.current = lastReadMessageIds;
  // チャンネルを開いた時点の既読位置 (未読ラインの表示用)
  const [unreadAnchor, setUnreadAnchor] = useState<{ channelId: number; lastReadId: number } | null>(null);
  const [newBelowCount, setNewBelowCount] = useState(0);
  const [wsStatus, setWsStatus] = useState<RealtimeStatus>('connecting');
  const [activeTransport, setActiveTransport] = useState<ConcreteTransport | null>(null);
  // 接続設定 (設定画面から変更・localStorageに保存)
  const [rtTransport, setRtTransportState] = useState<RealtimeTransport>(() => getRealtimeTransport());
  const [rtPollInterval, setRtPollIntervalState] = useState<number>(() => getPollInterval());
  const [connRoute, setConnRouteState] = useState<ConnectionRoute>(() => getConnectionRoute());
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [copiedLinkMessageId, setCopiedLinkMessageId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; zoom: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChannelIdRef = useRef<number>(activeChannelId);
  activeChannelIdRef.current = activeChannelId;

  // Memo State
  const [memoSlots, setMemoSlots] = useState<MemoSlot[]>([]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(1);
  const [memoTitle, setMemoTitle] = useState('');
  const [memoContent, setMemoContent] = useState('');
  const [memoMode, setMemoMode] = useState<'markdown' | 'monaco' | 'plain'>('markdown');
  const [memoAssignedUser, setMemoAssignedUser] = useState<number | null>(null);
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  // Phase 3 State: Timetables & Assignments
  // scheduleType: 時間割エディタで表示・編集中の時程 / todaySchedule: 全員共通の「今日の時程」
  const [scheduleType, setScheduleType] = useState<ScheduleType>('normal');
  const [todaySchedule, setTodaySchedule] = useState<ScheduleType>('normal');
  const [periodTimes, setPeriodTimes] = useState<Record<string, PeriodTime[]>>({});
  const [todayTimetables, setTodayTimetables] = useState<TimetableItem[]>([]);
  const [selectedTtCell, setSelectedTtCell] = useState<{ day: number; period: number } | null>(null);
  const [ttDetailDraft, setTtDetailDraft] = useState<{ subject: string; items: string; note: string }>({ subject: '', items: '', note: '' });
  const [ttSaveStatus, setTtSaveStatus] = useState('');
  const [isEditingPeriods, setIsEditingPeriods] = useState(false);
  const [periodDraft, setPeriodDraft] = useState<PeriodTime[]>([]);
  const [timetables, setTimetables] = useState<TimetableItem[]>([]);
  const scheduleTypeRef = useRef(scheduleType);
  scheduleTypeRef.current = scheduleType;
  const todayScheduleRef = useRef(todaySchedule);
  todayScheduleRef.current = todaySchedule;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'unstarted' | 'in_progress' | 'submitted' | 'passed'>('all');
  const [newAssignTitle, setNewAssignTitle] = useState('');
  const [newAssignSubject, setNewAssignSubject] = useState('数学');
  const [newAssignDeadline, setNewAssignDeadline] = useState('');
  const [newAssignResubmitDeadline, setNewAssignResubmitDeadline] = useState('');
  const [newAssignDesc, setNewAssignDesc] = useState('');
  const [isSummarizingAI, setIsSummarizingAI] = useState<number | null>(null);
  const [summarizedTexts, setSummarizedTexts] = useState<Record<number, string>>({});

  // Phase 3 State: Test Scores & AI
  const [testScores, setTestScores] = useState<TestScore[]>([]);
  const [testScoreUserFilter, setTestScoreUserFilter] = useState<string>('me');
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

  
  // Camera Facing Mode ('user' or 'environment')
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');

  // Memo View Mode ('split' or 'view_only') & Auto-save status
  const [memoViewMode, setMemoViewMode] = useState<'split' | 'view_only'>('split');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const memoAutoSaveTimerRef = useRef<any>(null);
  const selectedSlotIndexRef = useRef<number>(selectedSlotIndex);
  selectedSlotIndexRef.current = selectedSlotIndex;

  // Assignment Editing & Member Progress State
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [assignmentMembersProgress, setAssignmentMembersProgress] = useState<Record<number, { userId: number; username: string; status: string }[]>>({});
  const [showMemberProgressModalId, setShowMemberProgressModalId] = useState<number | null>(null);
  const [floatingAiSummary, setFloatingAiSummary] = useState<{ id: number; title: string; summary: string } | null>(null);

  // Chat Ergonomics & Pagination & Cursor Following
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(true);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState<boolean>(false);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const unreadMessageRef = useRef<HTMLDivElement | null>(null);

  // User Settings State (Persisted in localStorage)
  const [uiScale, setUiScale] = useState<number>(() => {
    const saved = localStorage.getItem('asdf_ui_scale');
    return saved ? parseFloat(saved) : 100;
  });
  const [chatAutoScrollMode, setChatAutoScrollMode] = useState<'always' | 'unread_anchor' | 'off'>(() => {
    return (localStorage.getItem('asdf_chat_scroll_mode') as any) || 'always';
  });
  const [memoAutoSaveInterval, setMemoAutoSaveInterval] = useState<number>(() => {
    const saved = localStorage.getItem('asdf_memo_autosave_interval');
    return saved ? parseInt(saved, 10) : 3;
  });

  // Realtime refs (WS/ポーリングのコールバックから最新値を参照するため)
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const chatAutoScrollModeRef = useRef(chatAutoScrollMode);
  chatAutoScrollModeRef.current = chatAutoScrollMode;
  const lastSeenMessageIdRef = useRef<number>(0);
  const processedMessageIdsRef = useRef<Set<number>>(new Set());
  const syncReadyRef = useRef(false);
  const isSyncingRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const pendingScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);

  // React の描画確定後 (2フレーム後) に最下部へ。smooth は手動ボタン用
  const scheduleScrollToBottom = (smooth = false) => {
    isNearBottomRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = chatScrollContainerRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
        isNearBottomRef.current = true;
        setNewBelowCount(0);
      });
    });
  };

  const markChannelRead = (channelId: number, messageId: number) => {
    setUnreadCounts(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    if (messageId > 0 && (lastReadMessageIdsRef.current[channelId] || 0) < messageId) {
      setLastReadMessageIds(prev => ({ ...prev, [channelId]: messageId }));
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem('asdf_last_read', JSON.stringify(lastReadMessageIds));
    } catch (_) {}
  }, [lastReadMessageIds]);

  // 総未読数をタブタイトルに表示
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + (b || 0), 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) asdfbase` : 'asdfbase';
  }, [totalUnread]);

  useEffect(() => {
    if (showCamera) {
      setCameraError('');
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacingMode,
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      })
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
  }, [showCamera, cameraFacingMode]);

  // WebSocket Ref
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const pendingNoteSyncRef = useRef<object | null>(null);
  const noteSyncTimerRef = useRef<any>(null);
  const handleFetchTimetablesRef = useRef<() => void>(() => {});

  const scrollToBottom = () => scheduleScrollToBottom(true);

  // 過去ログ読み込み後にスクロール位置を維持
  useLayoutEffect(() => {
    const restore = pendingScrollRestoreRef.current;
    const el = chatScrollContainerRef.current;
    if (restore && el) {
      el.scrollTop = restore.top + (el.scrollHeight - restore.height);
      pendingScrollRestoreRef.current = null;
    }
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
        const res = await fetch(`${getApiBaseUrl()}/api/weather`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          if (data && typeof data.temp === 'number') {
            setWeather({
              temp: data.source === 'fallback' ? null : data.temp,
              desc: data.desc || '不明',
              weatherCode: data.weatherCode,
              tempMax: data.tempMax,
              tempMin: data.tempMin,
              precipProb: data.precipProb,
              source: data.source,
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

  // Safe fetch helper: always strictly same-origin relative path
  const safeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
    let cleanPath = input;
    if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
      try {
        const parsed = new URL(cleanPath);
        cleanPath = parsed.pathname + parsed.search;
      } catch {
        // fallback
      }
    }
    if (!cleanPath.startsWith('/')) {
      cleanPath = `/${cleanPath}`;
    }
    // 直結モードでは API のみ VPS へ直接 (それ以外は常に同一オリジン)
    if (cleanPath.startsWith('/api/')) {
      cleanPath = `${getApiBaseUrl()}${cleanPath}`;
    }
    return fetch(cleanPath, init);
  };

  // Fetch Current User
  useEffect(() => {
    if (!token) {
      setIsCheckingAuth(false);
      return;
    }
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
        setCurrentUser(null);
      })
      .finally(() => {
        setIsCheckingAuth(false);
      });
  }, [token]);

  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const showBrowserNotification = (title: string, body: string) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && activeTabRef.current === 'chat') return;
    try {
      const n = new Notification(`asdfbase - ${title}`, { body, tag: 'asdfbase', icon: '/favicon.svg' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (_) {}
  };

  // ===== Realtime Chat Core =====
  // 新着メッセージは WS / ポーリング / 送信レスポンス のどこから来ても必ずここを通す
  const ingestNewMessage = (newMsg: Message) => {
    if (!newMsg || typeof newMsg.id !== 'number') return;
    if (newMsg.id > lastSeenMessageIdRef.current) lastSeenMessageIdRef.current = newMsg.id;
    if (processedMessageIdsRef.current.has(newMsg.id)) return;
    processedMessageIdsRef.current.add(newMsg.id);

    const me = currentUserRef.current;
    const isMine = Boolean(me && newMsg.user_id === me.id);
    const isActiveChannel = newMsg.channel_id === activeChannelIdRef.current;
    const isViewing = isActiveChannel && activeTabRef.current === 'chat' && !document.hidden;

    // 通知: 重要 (メンション・自分への返信・@everyone) と 通常メッセージ を別々に ON/OFF
    if (me && !isMine && newMsg.sender_username !== me.username) {
      const prefs = notifyPrefsRef.current;
      const isImportant = Boolean(
        newMsg.content?.includes(`@${me.username}`) || newMsg.content?.includes('@everyone') || newMsg.reply_to?.user_id === me.id
      );
      const sender = newMsg.sender_username || newMsg.username;
      const channelName = channelsRef.current.find(c => c.id === newMsg.channel_id)?.name || '';
      if (isImportant && prefs.important) {
        if (prefs.sound) playNotificationSound();
        showBrowserNotification(`${sender} からのメンション (#${channelName})`, summarizeContent(newMsg.content));
      } else if (prefs.messages && !isViewing) {
        showBrowserNotification(`${sender} (#${channelName})`, summarizeContent(newMsg.content));
      }
    }

    if (isActiveChannel) {
      setMessages(prev => mergeIncomingMessage(prev, newMsg));
      const mode = chatAutoScrollModeRef.current;
      // always: 常に最新へ / unread_anchor: 下端にいる時だけ / off: 自動スクロールしない
      if (isMine || mode === 'always' || (mode === 'unread_anchor' && isNearBottomRef.current)) {
        scheduleScrollToBottom();
      } else {
        setNewBelowCount(c => c + 1);
      }
    }

    if (isViewing || isMine) {
      markChannelRead(newMsg.channel_id, newMsg.id);
    } else {
      setUnreadCounts(prev => ({
        ...prev,
        [newMsg.channel_id]: (prev[newMsg.channel_id] || 0) + 1,
      }));
    }
  };
  const ingestNewMessageRef = useRef(ingestNewMessage);
  ingestNewMessageRef.current = ingestNewMessage;

  // 取りこぼし同期 (WS再接続時 / ポーリングフォールバック / タブ復帰時)
  const syncMissedMessages = async () => {
    const tk = tokenRef.current;
    if (!tk || !syncReadyRef.current || isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      // 200件ずつ追いつくまで取得
      for (let i = 0; i < 5; i++) {
        const res = await safeFetch(`/api/messages/since?afterId=${lastSeenMessageIdRef.current}`, {
          headers: { Authorization: `Bearer ${tk}` },
        });
        if (!res.ok) break;
        const rows: Message[] = await res.json();
        rows.forEach(m => ingestNewMessageRef.current(m));
        if (rows.length < 200) break;
      }
    } catch (_) {
      // network hiccup: 次のサイクルで再試行
    } finally {
      isSyncingRef.current = false;
    }
  };
  const syncMissedMessagesRef = useRef(syncMissedMessages);
  syncMissedMessagesRef.current = syncMissedMessages;

  // 再接続時: 表示中チャンネルの直近ログを取り直して編集/削除/リアクションの取りこぼしを補正
  const refreshActiveChannel = async () => {
    const tk = tokenRef.current;
    const channelId = activeChannelIdRef.current;
    if (!tk || !channelId) return;
    try {
      const res = await safeFetch(`/api/channels/${channelId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${tk}` },
      });
      if (!res.ok || channelId !== activeChannelIdRef.current) return;
      const fresh: Message[] = await res.json();
      if (fresh.length === 0) return;
      const minId = fresh[0].id;
      setMessages(prev => {
        const older = prev.filter(m => m.id > 0 && m.id < minId);
        const pending = prev.filter(m => m.id < 0 && !fresh.some(f => f.client_nonce && f.client_nonce === m.client_nonce));
        return [...older, ...fresh, ...pending];
      });
      fresh.forEach(m => {
        processedMessageIdsRef.current.add(m.id);
        if (m.id > lastSeenMessageIdRef.current) lastSeenMessageIdRef.current = m.id;
      });
    } catch (_) {}
  };
  const refreshActiveChannelRef = useRef(refreshActiveChannel);
  refreshActiveChannelRef.current = refreshActiveChannel;

  // 未読数 & 同期起点の初期化
  useEffect(() => {
    if (!token) return;
    syncReadyRef.current = false;
    safeFetch('/api/channels/unread-counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lastRead: lastReadMessageIdsRef.current }),
    })
      .then(res => (res.ok ? res.json() : []))
      .then((rows: { channelId: number; lastMessageId: number; unread: number }[]) => {
        const counts: Record<number, number> = {};
        const initRead: Record<number, number> = {};
        let maxId = 0;
        for (const r of rows) {
          maxId = Math.max(maxId, r.lastMessageId);
          if (lastReadMessageIdsRef.current[r.channelId] === undefined) {
            // 初回はそれまでの履歴を既読扱い
            initRead[r.channelId] = r.lastMessageId;
          } else if (r.channelId !== activeChannelIdRef.current && r.unread > 0) {
            counts[r.channelId] = r.unread;
          }
        }
        if (Object.keys(initRead).length > 0) {
          setLastReadMessageIds(prev => ({ ...initRead, ...prev }));
        }
        setUnreadCounts(counts);
        lastSeenMessageIdRef.current = Math.max(lastSeenMessageIdRef.current, maxId);
        syncReadyRef.current = true;
        // 初期化中に届いた分を補完
        syncMissedMessagesRef.current();
      })
      .catch(() => {
        syncReadyRef.current = true;
      });
  }, [token]);

  // リアルタイムイベント処理 (WS / SSE / ロングポーリング / ポーリング共通)
  const handleRealtimeEvent = (msg: any) => {
      if (msg.type === 'NEW_MESSAGE') {
        ingestNewMessageRef.current(msg.payload);
      } else if (msg.type === 'MESSAGE_REACTION_UPDATED') {
        setMessages(prev => prev.map(m => m.id === msg.payload.messageId ? { ...m, reactions: msg.payload.reactions } : m));
      } else if (msg.type === 'MESSAGE_PIN_UPDATED') {
        setMessages(prev => prev.map(m => m.id === msg.payload.id ? msg.payload : m));
      } else if (msg.type === 'NOTE_UPDATED') {
        setMemoSlots(prev => prev.map(n => n.slot_index === msg.payload.slot_index ? msg.payload : n));
        if (msg.payload.slot_index === selectedSlotIndexRef.current) {
          setMemoTitle(msg.payload.title);
          setMemoContent(msg.payload.content);
          setMemoMode(msg.payload.mode);
          setMemoAssignedUser(msg.payload.assigned_user_id);
        }
      } else if (msg.type === 'USER_STATUS_CHANGED') {
        setOnlineUsers(prev => {
          if (!prev.some(u => u.id === msg.payload.userId)) {
            // 新規メンバー: 一覧を取り直す
            reloadUsersRef.current();
            return prev;
          }
          return prev.map(u => u.id === msg.payload.userId ? { ...u, status: msg.payload.status } : u);
        });
      } else if (msg.type === 'TIMETABLE_UPDATED') {
        const t = msg.payload?.scheduleType;
        if (!t || t === scheduleTypeRef.current || t === todayScheduleRef.current) {
          handleFetchTimetablesRef.current();
        }
      } else if (msg.type === 'TIMETABLE_CONFIG_UPDATED') {
        applyTimetableConfigRef.current(msg.payload);
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
      } else if (msg.type === 'CHANNELS_REORDERED') {
        setChannels(msg.payload);
      } else if (msg.type === 'CHANNEL_DELETED') {
        setChannels(prev => prev.filter(c => c.id !== msg.payload.id));
      } else if (msg.type === 'ASSIGNMENT_UPDATED') {
        setAssignments(prev => prev.map(a => a.id === msg.payload.id ? { ...a, ...msg.payload } : a));
      } else if (msg.type === 'ASSIGNMENT_CREATED') {
        setAssignments(prev => (prev.some(a => a.id === msg.payload.id) ? prev : [...prev, msg.payload].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))));
        if (notifyPrefsRef.current.important) {
          if (notifyPrefsRef.current.sound) playNotificationSound();
          showBrowserNotification('新しい提出物', `${msg.payload.subject || ''} ${msg.payload.title}`);
        }
      } else if (msg.type === 'ASSIGNMENT_DELETED') {
        setAssignments(prev => prev.filter(a => a.id !== msg.payload.id));
      } else if (msg.type === 'ASSIGNMENT_PROGRESS_UPDATED') {
        const { assignmentId, userId, username, status, isArchived } = msg.payload;
        if (currentUserRef.current?.id === userId) {
          setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, my_status: status, is_archived: isArchived || a.is_archived } : a));
        } else if (isArchived) {
          setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, is_archived: true } : a));
        }
        setAssignmentMembersProgress(prev => {
          const currentList = prev[assignmentId] || [];
          const exists = currentList.some(p => p.userId === userId);
          const updated = exists 
            ? currentList.map(p => p.userId === userId ? { ...p, status } : p)
            : [...currentList, { userId, username, status }];
          return { ...prev, [assignmentId]: updated };
        });
      } else if (msg.type === 'MESSAGE_DELETED') {
        setMessages(prev => prev.filter(m => m.id !== msg.payload.messageId));
      } else if (msg.type === 'MESSAGE_UPDATED') {
        setMessages(prev => prev.map(m => m.id === msg.payload.id ? { ...m, content: msg.payload.content } : m));
      } else if (msg.type === 'NOTE_CONTENT_SYNC') {
        if (msg.payload.slotIndex === selectedSlotIndexRef.current) {
          setMemoContent(msg.payload.content);
          if (msg.payload.title) setMemoTitle(msg.payload.title);
        }
      } else if (msg.type === 'USER_DELETED') {
        setOnlineUsers(prev => prev.filter(u => u.id !== msg.payload.userId));
      }
  };
  const handleRealtimeEventRef = useRef(handleRealtimeEvent);
  handleRealtimeEventRef.current = handleRealtimeEvent;

  const reloadUsers = () => {
    const tk = tokenRef.current;
    if (!tk) return;
    safeFetch('/api/users', { headers: { Authorization: `Bearer ${tk}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (Array.isArray(data)) setOnlineUsers(data);
      })
      .catch(() => {});
  };
  const reloadUsersRef = useRef(reloadUsers);
  reloadUsersRef.current = reloadUsers;

  // クライアント→サーバー送信 (WSが使えればWS、なければHTTP)
  const rtSend = (msg: object) => {
    realtimeRef.current?.send(msg).catch(err => console.error('Realtime send failed:', err));
  };

  // Realtime 接続: 設定 (方式 / ポーリング間隔 / 経路) が変わったら張り直す
  useEffect(() => {
    if (!token) return;
    const client = new RealtimeClient({
      token,
      transport: rtTransport,
      pollInterval: rtPollInterval,
      onEvent: msg => handleRealtimeEventRef.current(msg),
      onStatus: (status, transport) => {
        setWsStatus(status);
        setActiveTransport(transport);
        if (status === 'online') {
          // 接続/再接続のたびに取りこぼしを補完
          syncMissedMessagesRef.current();
        }
      },
      onReset: () => {
        syncMissedMessagesRef.current();
        refreshActiveChannelRef.current();
        reloadUsersRef.current();
      },
    });
    realtimeRef.current = client;
    client.start();

    const handleVisibilityStatus = () => {
      client.send({ type: 'SET_STATUS', status: document.hidden ? 'away' : 'online' }).catch(() => {});
      if (!document.hidden) syncMissedMessagesRef.current();
    };
    document.addEventListener('visibilitychange', handleVisibilityStatus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityStatus);
      client.stop();
      if (realtimeRef.current === client) realtimeRef.current = null;
    };
  }, [token, rtTransport, rtPollInterval, connRoute]);


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

    safeFetch('/api/assignments/progress/all', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then((data: { assignment_id: number; user_id: number; status: string; username: string }[]) => {
        const grouped: Record<number, { userId: number; username: string; status: string }[]> = {};
        for (const row of data) {
          if (!grouped[row.assignment_id]) grouped[row.assignment_id] = [];
          grouped[row.assignment_id].push({
            userId: row.user_id,
            username: row.username,
            status: row.status
          });
        }
        setAssignmentMembersProgress(grouped);
      })
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

    safeFetch('/api/settings/webhook', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data.webhookUrl) setWebhookUrlInput(data.webhookUrl);
      })
      .catch(console.error);
  }, [token]);

  // Tab switch to board: reload latest strokes & texts (Proxy synchronization)
  useEffect(() => {
    if (activeTab === 'board' && token) {
      safeFetch('/api/board', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data.strokes) setBoardStrokes(data.strokes);
          if (data.texts) setBoardTexts(data.texts);
        })
        .catch(console.error);
    }
  }, [activeTab, token]);

  // Global Shortcuts: Ctrl+K, Escape (closes all modals)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false);
        setIsTimetableModalOpen(false);
        setIsNewChannelModalOpen(false);
        setMemoAiResultModal(null);
        setIsSearchOpen(false);
        setLightbox(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Messages Load & Channel Switch with unread line tracking
  useEffect(() => {
    if (!token || !activeChannelId) return;
    const channelId = activeChannelId;
    const anchorId = lastReadMessageIdsRef.current[channelId] || 0;
    setUnreadAnchor({ channelId, lastReadId: anchorId });
    setUnreadCounts(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    setNewBelowCount(0);
    setMessages([]);
    setHasMoreMessages(true);
    safeFetch(`${API_BASE_URL}/api/channels/${channelId}/messages?limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then((data: Message[]) => {
        if (channelId !== activeChannelIdRef.current) return;
        const maxId = data.length > 0 ? data[data.length - 1].id : 0;
        // 読み込み中に WS で届いた分は保持
        setMessages(prev => [...data, ...prev.filter(m => m.channel_id === channelId && (m.id > maxId || m.id < 0))]);
        data.forEach(m => {
          processedMessageIdsRef.current.add(m.id);
          if (m.id > lastSeenMessageIdRef.current) lastSeenMessageIdRef.current = m.id;
        });
        if (data.length < 50) {
          setHasMoreMessages(false);
        }
        if (maxId > 0) markChannelRead(channelId, maxId);
        // Scroll behavior based on unread position and user preference
        setTimeout(() => {
          const hasUnread = anchorId > 0 && maxId > anchorId;
          if (chatAutoScrollMode === 'unread_anchor' && hasUnread && unreadMessageRef.current) {
            unreadMessageRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
          } else if (chatAutoScrollMode !== 'off') {
            scheduleScrollToBottom(false);
          }
        }, 50);
      })
      .catch(console.error);
  }, [token, activeChannelId]);

  // チャットタブに戻った時: 表示中チャンネルを既読化
  useEffect(() => {
    if (activeTab !== 'chat') return;
    const realMsgs = messages.filter(m => m.id > 0);
    const last = realMsgs[realMsgs.length - 1];
    if (last) markChannelRead(activeChannelId, last.id);
  }, [activeTab]);

  const handleChatScroll = () => {
    const el = chatScrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isNearBottomRef.current = nearBottom;
    if (nearBottom && newBelowCount > 0) setNewBelowCount(0);
    // 上端付近で自動的に過去ログ読み込み
    if (el.scrollTop < 80 && hasMoreMessages && !isLoadingMoreMessages && !chatSearchQuery) {
      handleLoadMoreMessages();
    }
  };

  // Load more older messages
  const handleLoadMoreMessages = async () => {
    const oldest = messages.find(m => m.id > 0);
    if (!token || !activeChannelId || isLoadingMoreMessages || !hasMoreMessages || !oldest) return;
    setIsLoadingMoreMessages(true);
    const oldestId = oldest.id;
    const channelId = activeChannelId;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/channels/${activeChannelId}/messages?limit=30&beforeId=${oldestId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const older = await res.json();
        if (older.length < 30) {
          setHasMoreMessages(false);
        }
        if (older.length > 0 && channelId === activeChannelIdRef.current) {
          // Maintain scroll position after prepending (restored in useLayoutEffect)
          const container = chatScrollContainerRef.current;
          if (container) pendingScrollRestoreRef.current = { height: container.scrollHeight, top: container.scrollTop };
          older.forEach((m: Message) => processedMessageIdsRef.current.add(m.id));
          setMessages(prev => [...older.filter((o: Message) => !prev.some(p => p.id === o.id)), ...prev]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingMoreMessages(false);
    }
  };

  // Auth Handler
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    
    const subPath = `/api/auth/${authMode === 'login' ? 'login' : 'register'}`;
    const body: any = { username: authUsername.trim(), password: authPassword };
    if (authMode === 'register') {
      body.inviteCode = authInviteCode.trim();
    }

    try {
      const res = await fetch(`${getApiBaseUrl()}${subPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setAuthError('サーバーとの通信に失敗しました (プロキシエラー)');
        return;
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
      setAuthError('通信に失敗しました。ネットワークまたはサーバーの接続を確認してください。');
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
        const clientNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await postChatMessage(`![image](${data.url})`, activeChannelId, clientNonce, null);
        scheduleScrollToBottom();
      }
    } catch (err) {
      console.error('Image upload error:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Chat Send with Instant Local Reflection & Auto Scroll
  const tempMessageIdRef = useRef(-1);

  const postChatMessage = async (content: string, targetChannelId: number, clientNonce: string, replyToId?: number | null) => {
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/channels/${targetChannelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content, clientNonce, replyToId: replyToId || null })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const savedMessage: Message = await res.json();
      ingestNewMessageRef.current({ ...savedMessage, client_nonce: clientNonce });
      // WS経由で先に確定済みでも、残っている送信中表示を必ず消す
      setMessages(prev => mergeIncomingMessage(prev, { ...savedMessage, client_nonce: clientNonce }));
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev => prev.map(m => (m.id < 0 && m.client_nonce === clientNonce ? { ...m, pending: false, failed: true } : m)));
    }
  };

  // Chat Send: 楽観的に即時表示 → サーバー確定で置換
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !token) return;

    const content = chatInput.replace(/\s+$/, '');
    const targetChannelId = activeChannelId;
    const clientNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const replyTarget = replyToMessage && replyToMessage.channel_id === targetChannelId ? replyToMessage : null;
    setChatInput('');
    setShowMentionSuggestions(false);
    setReplyToMessage(null);

    const me = currentUserRef.current;
    const optimistic: Message = {
      id: tempMessageIdRef.current--,
      channel_id: targetChannelId,
      user_id: me?.id ?? 0,
      username: me?.username ?? '',
      sender_username: me?.username,
      content,
      created_at: new Date().toISOString(),
      client_nonce: clientNonce,
      pending: true,
      reply_to_id: replyTarget?.id ?? null,
      reply_to: replyTarget
        ? { id: replyTarget.id, username: replyTarget.sender_username || replyTarget.username, user_id: replyTarget.user_id, content: summarizeContent(replyTarget.content) }
        : null,
    };
    setMessages(prev => [...prev, optimistic]);
    scheduleScrollToBottom();

    await postChatMessage(content, targetChannelId, clientNonce, replyTarget?.id);
  };

  // ↑キー: 入力欄が空なら自分の最後のメッセージを編集
  const startEditLastOwnMessage = () => {
    const me = currentUserRef.current;
    if (!me) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.id > 0 && m.user_id === me.id && m.channel_id === activeChannelId && !IMAGE_MESSAGE_RE.test(m.content.trim())) {
        setEditingMessageId(m.id);
        setEditingContent(m.content);
        setTimeout(() => document.getElementById(`msg-${m.id}`)?.scrollIntoView({ block: 'nearest' }), 0);
        return true;
      }
    }
    return false;
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditingContent('');
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };

  const startReply = (m: Message) => {
    setReplyToMessage(m);
    setEditingMessageId(null);
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };

  const jumpToMessage = (id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-amber-400/70');
    setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400/70'), 1500);
  };

  const handleRetryMessage = (m: Message) => {
    if (!m.client_nonce) return;
    setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, pending: true, failed: false } : x)));
    postChatMessage(m.content, m.channel_id, m.client_nonce, m.reply_to_id);
  };

  const handleDiscardFailedMessage = (m: Message) => {
    setMessages(prev => prev.filter(x => x.id !== m.id));
  };

  // Reorder Channels (Up / Down)
  const handleMoveChannel = async (e: React.MouseEvent, index: number, direction: 'up' | 'down') => {
    e.stopPropagation();
    // index は表示中 (テキストチャンネルのみ) の並び
    const textChannels = channels.filter(c => c.type !== 'voice');
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= textChannels.length) return;

    const reordered = [...textChannels];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const newChannels = [...reordered, ...channels.filter(c => c.type === 'voice')];
    setChannels(newChannels);

    try {
      await safeFetch(`${API_BASE_URL}/api/channels/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ channelIds: newChannels.map(c => c.id) })
      });
    } catch (err) {
      console.error('Failed to reorder channels:', err);
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
        cancelEditing();
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
        body: JSON.stringify({ name: newChannelName, type: 'text' })
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

  const fetchTodayTimetables = async (type: ScheduleType = todayScheduleRef.current) => {
    if (!token) return;
    try {
      const res = await safeFetch(`/api/timetables?scheduleType=${type}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setTodayTimetables(await res.json());
    } catch (_) {}
  };

  const fetchTimetableConfig = async () => {
    if (!token) return;
    try {
      const res = await safeFetch('/api/timetables/config', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) applyTimetableConfig(await res.json());
    } catch (_) {}
  };

  const applyTimetableConfig = (config: { activeScheduleType: ScheduleType; periods: Record<string, PeriodTime[]> }) => {
    setPeriodTimes(config.periods || {});
    if (config.activeScheduleType && config.activeScheduleType !== todayScheduleRef.current) {
      setTodaySchedule(config.activeScheduleType);
    }
  };
  const applyTimetableConfigRef = useRef(applyTimetableConfig);
  applyTimetableConfigRef.current = applyTimetableConfig;

  handleFetchTimetablesRef.current = () => {
    handleFetchTimetables();
    fetchTodayTimetables();
  };

  // 時程切替時・ログイン時に時間割を取り直す
  useEffect(() => {
    handleFetchTimetables();
  }, [scheduleType, token]);

  useEffect(() => {
    fetchTodayTimetables(todaySchedule);
  }, [todaySchedule, token]);

  useEffect(() => {
    fetchTimetableConfig();
  }, [token]);

  // 指定コマに教科を保存 (プリセットのワンクリック保存もこれ)
  const saveTimetableSubject = async (day: number, period: number, subject: string, extra: { items?: string; note?: string } = {}) => {
    if (!token || !subject.trim()) return null;
    setTtSaveStatus('保存中…');
    try {
      const res = await safeFetch('/api/timetables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dayOfWeek: day, period, subject: subject.trim(), scheduleType, ...extra }),
      });
      if (!res.ok) throw new Error();
      const row: TimetableItem = await res.json();
      setTimetables(prev => [...prev.filter(t => !(t.day_of_week === day && t.period === period)), row]);
      if (scheduleType === todaySchedule) fetchTodayTimetables();
      setTtSaveStatus(`${DAY_LABELS[day]}曜${period}限 を「${row.subject}」に保存しました`);
      return row;
    } catch {
      setTtSaveStatus('保存に失敗しました');
      return null;
    }
  };

  const selectTtCell = (day: number, period: number) => {
    setSelectedTtCell({ day, period });
    setNewTtDay(day);
    setNewTtPeriod(period);
    const existing = timetables.find(t => t.day_of_week === day && t.period === period);
    setTtDetailDraft({ subject: existing?.subject || '', items: existing?.items || '', note: existing?.note || '' });
    setNewTtSubject(existing?.subject || '');
  };

  // プリセット: 押した瞬間に保存して次のコマへ
  const handlePresetSubject = async (subj: string) => {
    const cell = selectedTtCell || { day: newTtDay, period: newTtPeriod };
    const row = await saveTimetableSubject(cell.day, cell.period, subj);
    if (!row) return;
    const nextPeriod = cell.period < 7 ? cell.period + 1 : 1;
    const nextDay = cell.period < 7 ? cell.day : (cell.day < 5 ? cell.day + 1 : 1);
    setSelectedTtCell({ day: nextDay, period: nextPeriod });
    setNewTtDay(nextDay);
    setNewTtPeriod(nextPeriod);
    const nextExisting = timetables.find(t => t.day_of_week === nextDay && t.period === nextPeriod);
    setTtDetailDraft({ subject: nextExisting?.subject || '', items: nextExisting?.items || '', note: nextExisting?.note || '' });
    setNewTtSubject(nextExisting?.subject || '');
  };

  const handleSaveTtDetail = async () => {
    if (!selectedTtCell) return;
    await saveTimetableSubject(selectedTtCell.day, selectedTtCell.period, ttDetailDraft.subject, {
      items: ttDetailDraft.items,
      note: ttDetailDraft.note,
    });
  };

  const handleSetTodaySchedule = async (type: ScheduleType) => {
    setTodaySchedule(type);
    if (!token) return;
    const res = await safeFetch('/api/timetables/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ activeScheduleType: type }),
    }).catch(() => null);
    if (res && res.ok) applyTimetableConfig(await res.json());
  };

  const handleSavePeriodTimes = async () => {
    if (!token) return;
    const res = await safeFetch('/api/timetables/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ periods: { [scheduleType]: periodDraft } }),
    }).catch(() => null);
    if (res && res.ok) {
      applyTimetableConfig(await res.json());
      setIsEditingPeriods(false);
      setTtSaveStatus(`${SCHEDULE_LABELS[scheduleType]} の時刻を保存しました`);
    } else {
      const d = res ? await res.json().catch(() => ({})) : {};
      setTtSaveStatus(d.error || '時刻の保存に失敗しました');
    }
  };

  const handleCreateTimetableEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTtSubject.trim()) return;
    const row = await saveTimetableSubject(newTtDay, newTtPeriod, newTtSubject);
    if (row) setTtDetailDraft(d => ({ ...d, subject: row.subject }));
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
        setTodayTimetables(prev => prev.filter(t => t.id !== id));
        setTtDetailDraft({ subject: '', items: '', note: '' });
        setTtSaveStatus('コマを削除しました');
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

  const loadIntegrations = async () => {
    if (!token) return;
    try {
      const r = await safeFetch('/api/settings/integrations', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setIntegrations(await r.json());
    } catch (_) {}
  };

  const saveIntegrations = async (patch: Record<string, any>) => {
    if (!token) return;
    setIntegrationStatus('保存中…');
    try {
      const r = await safeFetch('/api/settings/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      setIntegrationStatus(r.ok ? '保存しました' : d.error || '保存に失敗しました');
      if (r.ok) setIntegrations((prev: any) => ({ ...prev, ...patch }));
    } catch {
      setIntegrationStatus('保存に失敗しました');
    }
  };

  const testIntegration = async (kind: 'important' | 'message') => {
    if (!token) return;
    setIntegrationStatus('テスト送信中…');
    const r = await safeFetch('/api/settings/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setIntegrationStatus(r && r.ok ? 'テスト送信しました。Discord を確認してください' : d.error || 'テスト送信に失敗しました');
  };

  const loadAuditLogs = async (action = auditFilter) => {
    if (!token) return;
    try {
      const r = await safeFetch(`/api/audit-logs?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setAuditLogs(await r.json());
    } catch (_) {}
  };

  const deleteAuditLog = async (id: number) => {
    if (!token) return;
    const r = await safeFetch(`/api/audit-logs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setAuditLogs(prev => prev.filter(l => l.id !== id));
    else alert((await r.json().catch(() => ({}))).error || '削除に失敗しました');
  };

  const clearAuditLogs = async () => {
    if (!token || !confirm('監査ログをすべて削除しますか？この操作は取り消せません。')) return;
    const r = await safeFetch('/api/audit-logs', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) loadAuditLogs();
    else alert((await r.json().catch(() => ({}))).error || '削除に失敗しました');
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
        loadAuditLogs();
      } else {
        const d = await res.json();
        alert(d.error || '復元に失敗しました');
      }
    } catch (err) {
      console.error(err);
    }
  };


  const handleSaveMemo = async (explicitContent?: string, explicitTitle?: string, explicitMode?: string) => {
    if (!token) return;
    setIsSavingMemo(true);
    setAutoSaveStatus('saving');
    const targetSlot = selectedSlotIndexRef.current;
    const contentToSave = explicitContent !== undefined ? explicitContent : memoContent;
    const titleToSave = explicitTitle !== undefined ? explicitTitle : memoTitle;
    const modeToSave = explicitMode !== undefined ? explicitMode : memoMode;

    try {
      const res = await safeFetch(`${API_BASE_URL}/api/notes/${targetSlot}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: titleToSave,
          content: contentToSave,
          mode: modeToSave,
          assigned_user_id: memoAssignedUser
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setMemoSlots(prev => prev.map(m => m.slot_index === targetSlot ? updated : m));
        setAutoSaveStatus('saved');
      } else {
        const err = await res.json();
        console.warn('Memo save failed:', err.error);
        setAutoSaveStatus('dirty');
      }
    } catch (err) {
      console.error(err);
      setAutoSaveStatus('dirty');
    } finally {
      setIsSavingMemo(false);
    }
  };

  const handleMemoContentChange = (newVal: string) => {
    setMemoContent(newVal);
    setAutoSaveStatus('dirty');

    // Realtime broadcast to other users
    // HTTP系トランスポートでは1文字ごとに送らず200msに間引く
    pendingNoteSyncRef.current = {
      type: 'NOTE_CONTENT_SYNC',
      slotIndex: selectedSlotIndexRef.current,
      content: newVal,
      title: memoTitle
    };
    if (realtimeRef.current?.transport === 'ws') {
      rtSend(pendingNoteSyncRef.current);
      pendingNoteSyncRef.current = null;
    } else if (!noteSyncTimerRef.current) {
      noteSyncTimerRef.current = setTimeout(() => {
        noteSyncTimerRef.current = null;
        if (pendingNoteSyncRef.current) rtSend(pendingNoteSyncRef.current);
        pendingNoteSyncRef.current = null;
      }, 200);
    }

    // Auto-save debounce
    if (memoAutoSaveTimerRef.current) {
      clearTimeout(memoAutoSaveTimerRef.current);
    }
    const intervalMs = Math.max(1, memoAutoSaveInterval) * 1000;
    memoAutoSaveTimerRef.current = setTimeout(() => {
      handleSaveMemo(newVal, memoTitle, memoMode);
    }, intervalMs);
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
          resubmitDeadline: newAssignResubmitDeadline || undefined,
          description: newAssignDesc
        })
      });
      if (res.ok) {
        const created = await res.json();
        setAssignments(prev => [...prev, { ...created, my_status: 'unstarted' }]);
        setNewAssignTitle('');
        setNewAssignDesc('');
        setNewAssignResubmitDeadline('');
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

  const handleDeleteAssignment = async (id: number) => {
    if (!confirm('この提出物を削除しますか？')) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/assignments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setAssignments(prev => prev.filter(a => a.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Phase 3: Update Assignment (Title, Subject, Deadline, Description)
  const handleUpdateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssignment || !token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/assignments/${editingAssignment.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: editingAssignment.title,
          subject: editingAssignment.subject,
          deadline: editingAssignment.deadline,
          resubmitDeadline: editingAssignment.resubmit_deadline,
          description: editingAssignment.description
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setAssignments(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
        setEditingAssignment(null);
      } else {
        const err = await res.json();
        alert(err.error || '提出物の更新に失敗しました');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Phase 3: Gemini Summarize Assignment (opens clean floating modal)
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
        setFloatingAiSummary({
          id: assignment.id,
          title: assignment.title,
          summary: data.summary
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizingAI(null);
    }
  };

  // Phase 3: Test Scores Handlers
  const handleFetchTestScores = async (userFilter: string) => {
    if (!token) return;
    setTestScoreUserFilter(userFilter);
    const query = userFilter === 'me' ? '' : `?userId=${userFilter}`;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/test-scores${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTestScores(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTestScore = async (id: number) => {
    if (!confirm('このテスト記録を削除しますか？')) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/test-scores/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setTestScores(prev => prev.filter(t => t.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

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

  const handleSaveWebhookUrl = async () => {
    if (!token) return;
    setWebhookStatus('保存中...');
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/settings/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ webhookUrl: webhookUrlInput })
      });
      if (res.ok) {
        setWebhookStatus('Webhook URLを保存しました');
      } else {
        setWebhookStatus('保存失敗');
      }
    } catch (err) {
      setWebhookStatus('通信エラー');
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

  // 画面座標 → キャンバス内部座標 (1400x800)。表示サイズ・縦横比が端末ごとに違ってもズレないよう
  // object-contain の余白 (レターボックス) を考慮して変換する
  const getCanvasCoords = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const offsetX = (rect.width - canvas.width * scale) / 2;
    const offsetY = (rect.height - canvas.height * scale) / 2;
    const x = (e.clientX - rect.left - offsetX) / scale;
    const y = (e.clientY - rect.top - offsetY) / scale;
    return {
      x: Math.round(Math.min(Math.max(x, 0), canvas.width) * 10) / 10,
      y: Math.round(Math.min(Math.max(y, 0), canvas.height) * 10) / 10,
    };
  };

  const strokePointsRef = useRef<{ x: number; y: number }[]>([]);
  const activePointerRef = useRef<number | null>(null);

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }, width: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    if (boardMode === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushWidth * 3;
    } else {
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = width;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  // Pointer Events: マウス・タッチ・ペン(Chromebook のスタイラス)を同じ処理で扱う
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (boardMode !== 'draw' && boardMode !== 'eraser') return;
    if (activePointerRef.current !== null) return; // マルチタッチの2本目は無視 (線の暴走防止)
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;
    const p = getCanvasCoords(e);
    strokePointsRef.current = [p];
    setIsDrawing(true);
    drawSegment(p, { x: p.x + 0.01, y: p.y + 0.01 }, brushWidth);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== e.pointerId) return;
    e.preventDefault();
    // ペンの速い動きも取りこぼさないよう coalesced events を使う
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [e.nativeEvent];
    for (const ev of list) {
      const p = getCanvasCoords(ev);
      const pts = strokePointsRef.current;
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.8 && Math.abs(last.y - p.y) < 0.8) continue;
      pts.push(p);
      if (last) drawSegment(last, p, brushWidth);
    }
  };

  const finishStroke = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== e.pointerId) return;
    activePointerRef.current = null;
    setIsDrawing(false);
    const points = strokePointsRef.current;
    strokePointsRef.current = [];
    if (points.length < 2 || !token) {
      if (points.length === 1 && token) points.push({ x: points[0].x + 0.5, y: points[0].y + 0.5 });
      else return;
    }
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
          points
        })
      });
    } catch (err) {
      console.error('Stroke save error:', err);
    }
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

  const isMonacoLocked = (selectedSlotIndex >= 11 || memoMode === 'monaco') && memoAssignedUser !== null && memoAssignedUser !== currentUser?.id && currentUser?.role !== 'admin';

  // Filtered assignments
  const filteredAssignments = assignments.filter(a => {
    if (assignmentFilter === 'all') return !a.is_archived;
    return a.my_status === assignmentFilter && !a.is_archived;
  });

  // Test Scores Total calculation
  const totalScore = testScores.reduce((acc, curr) => acc + Number(curr.score), 0);
  const totalMaxScore = testScores.reduce((acc, curr) => acc + Number(curr.max_score), 0);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[#090A0C] flex flex-col items-center justify-center p-4 text-stone-400 font-mono text-xs">
        <div className="flex items-center gap-2 mb-2">
          <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
          <span className="font-bold text-white">セッション確認中...</span>
        </div>
      </div>
    );
  }

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

  // ヘッダー: 今日の時程と時間割から「休み / 朝 / 授業中 / 休み時間 / 放課後」を算出 (時計と一緒に毎秒更新)
  const nowForStatus = new Date();
  const todayRows = todayTimetables.filter(t => t.day_of_week === nowForStatus.getDay());
  const schoolStatus = computeSchoolStatus(nowForStatus, periodTimes[todaySchedule] || [], todayRows);
  const todayItems = todayRows
    .filter(t => t.items && t.items.trim())
    .sort((a, b) => a.period - b.period)
    .map(t => `${t.period}限 ${t.subject}: ${t.items}`);
  const StatusIcon = schoolStatus.kind === 'holiday' ? Sun : schoolStatus.kind === 'morning' ? Sunrise : schoolStatus.kind === 'after' ? Moon : BookOpen;
  const code = weather.weatherCode ?? -1;
  const WeatherIcon = code < 0 ? CloudSun : code <= 1 ? Sun : code <= 3 ? Cloud : code >= 51 ? CloudRain : CloudSun;

  return (
    <div 
      className="bg-[#090A0C] text-[#D6D3D1] flex flex-col font-['Inter'] overflow-hidden"
      // 画面1枚に収める: zoom で縮小しても実表示がちょうど 100dvh になるよう補正
      style={{ zoom: `${uiScale}%`, height: `calc(100dvh * ${100 / uiScale})` }}
    >
      {/* 1. TOP BAR */}
      <header className="h-14 shrink-0 border-b border-stone-800/80 bg-[#090A0C]/90 backdrop-blur-md z-50 px-2 sm:px-4 flex items-center justify-between select-none overflow-x-auto gap-2">
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div 
            onClick={() => setActiveTab('chat')}
            className="logo-container mr-1 sm:mr-3 font-['Space_Grotesk'] font-extrabold text-base sm:text-lg flex items-center tracking-wider"
          >
            <span className="text-white">asdfbase</span>
            <span className="logo-dot">.</span>
          </div>

          <nav className="flex items-center gap-0.5 sm:gap-1 font-mono text-[11px] sm:text-xs">
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
                  className={`px-2 sm:px-2.5 py-1.5 rounded-lg flex items-center gap-1 sm:gap-1.5 transition whitespace-nowrap ${
                    isActive 
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' 
                      : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tab.id === 'chat' && totalUnread > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center">
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Header Block */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 font-mono text-[11px] sm:text-xs shrink-0">
          <button
            onClick={() => {
              handleFetchTimetables();
              setIsTimetableModalOpen(true);
            }}
            title={`${SCHEDULE_LABELS[todaySchedule]}${todayItems.length > 0 ? `\n今日の持ち物:\n${todayItems.join('\n')}` : ''}\n(クリックで時間割を開く)`}
            className={`flex items-center gap-1.5 border px-2.5 py-1 rounded-lg transition interactive-btn cursor-pointer ${
              schoolStatus.kind === 'holiday' || schoolStatus.kind === 'after'
                ? 'bg-stone-900/60 border-stone-800 text-stone-300 hover:bg-stone-800/60'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            <StatusIcon className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold">{schoolStatus.label}</span>
            {schoolStatus.sub && <span className="text-stone-400 text-[10px] hidden sm:inline">({schoolStatus.sub})</span>}
            {todayItems.length > 0 && <Backpack className="w-3 h-3 text-stone-400" />}
            {todaySchedule !== 'normal' && (
              <span className="text-[9px] px-1 rounded bg-amber-500 text-black font-bold">{todaySchedule === 'short' ? '短縮' : 'S短'}</span>
            )}
          </button>

          <div
            className="flex items-center gap-1.5 text-stone-300 bg-stone-900/60 px-2.5 py-1 rounded-lg border border-stone-800/70"
            title={weather.source === 'jma' ? '気象庁 (香川県) の予報' : 'Open-Meteo の現在の天気'}
          >
            <WeatherIcon className="w-3.5 h-3.5 text-amber-400" />
            <span>高松 {weather.temp === null ? '--' : weather.temp}℃ {weather.desc}</span>
            {weather.tempMax != null && weather.tempMin != null && (
              <span className="hidden lg:inline text-[10px]">
                <span className="text-red-300">{weather.tempMax}°</span>/<span className="text-sky-300">{weather.tempMin}°</span>
              </span>
            )}
            {weather.precipProb != null && (
              <span className="hidden lg:inline-flex items-center gap-0.5 text-[10px] text-sky-300">
                <Umbrella className="w-3 h-3" />{weather.precipProb}%
              </span>
            )}
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
      <main className="flex-1 min-h-0 flex overflow-hidden">
        {/* TAB 1: リアルタイムチャット (3ペイン: チャンネル / チャット / メンバー) */}
        {activeTab === 'chat' && (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Channels Sidebar: Small screen / Chromebook responsive toggle */}
            {!isChannelsCollapsed && (
              <aside className="w-48 sm:w-56 border-r border-stone-800 bg-[#0C0D10] flex flex-col shrink-0 min-h-0 overflow-hidden">
                <div className="flex-1 min-h-0 flex flex-col p-2.5 sm:p-3">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold shrink-0">
                    <span>チャンネル</span>
                    <button
                      onClick={() => setIsNewChannelModalOpen(true)}
                      className="p-1 hover:text-amber-400 rounded text-stone-400 hover:bg-stone-800 transition"
                      title="チャンネルを作成"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* チャンネル一覧: 収まらない時はこの中だけスクロール */}
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1">
                    {channels.filter(ch => ch.type !== 'voice').map((ch, idx, textChannels) => {
                      const unread = activeChannelId === ch.id ? 0 : (unreadCounts[ch.id] || 0);
                      const isActiveCh = activeChannelId === ch.id;
                      return (
                      <div
                        key={ch.id}
                        className={`group relative flex items-center justify-between pl-3 pr-2 py-2 rounded-lg text-sm transition ${
                          isActiveCh
                            ? 'bg-amber-500/15 text-amber-300 font-bold'
                            : unread > 0
                              ? 'text-white font-bold hover:bg-stone-800/60'
                              : 'text-stone-500 hover:bg-stone-900/60 hover:text-stone-300'
                        }`}
                      >
                        {/* 左端インジケーター: 選択中=アンバーのバー / 未読=白い点 */}
                        {isActiveCh ? (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-amber-400" />
                        ) : unread > 0 ? (
                          <span className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white" />
                        ) : null}
                        <button
                          onClick={() => setActiveChannelId(ch.id)}
                          className="flex items-center gap-2 flex-1 text-left truncate min-w-0"
                        >
                          {ch.type === 'voice'
                            ? <Mic className={`w-4 h-4 shrink-0 ${isActiveCh ? 'text-amber-400' : unread > 0 ? 'text-stone-200' : 'text-stone-600'}`} />
                            : <Hash className={`w-4 h-4 shrink-0 ${isActiveCh ? 'text-amber-400' : unread > 0 ? 'text-stone-200' : 'text-stone-600'}`} />}
                          <span className="truncate">{ch.name}</span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {/* 未読バッジ */}
                          {unread > 0 && (
                            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center shadow">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}

                          {/* チャンネル並び替え (↑ / ↓) */}
                          <div className="opacity-0 group-hover:opacity-100 flex items-center transition">
                            {idx > 0 && (
                              <button
                                onClick={e => handleMoveChannel(e, idx, 'up')}
                                className="p-0.5 hover:text-amber-400 text-stone-500 transition"
                                title="上へ移動"
                              >
                                ▲
                              </button>
                            )}
                            {idx < textChannels.length - 1 && (
                              <button
                                onClick={e => handleMoveChannel(e, idx, 'down')}
                                className="p-0.5 hover:text-amber-400 text-stone-500 transition"
                                title="下へ移動"
                              >
                                ▼
                              </button>
                            )}
                          </div>

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
                      </div>
                      );
                    })}
                  </div>
                </div>

              </aside>
            )}

            {/* Center: メインチャット */}
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#090A0C] overflow-hidden">
              <div className="h-12 border-b border-stone-800/80 px-3 sm:px-4 flex items-center justify-between bg-[#0C0D10]/50 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-white">
                  <button
                    onClick={() => setIsChannelsCollapsed(!isChannelsCollapsed)}
                    className="p-1 rounded hover:bg-stone-800 text-stone-400 hover:text-amber-400 transition"
                    title={isChannelsCollapsed ? 'チャンネル一覧を開く' : 'チャンネル一覧を隠す'}
                  >
                    <Layout className="w-3.5 h-3.5" />
                  </button>
                  <Hash className="w-4 h-4 text-amber-400" />
                  <span className="text-sm">{channels.find(c => c.id === activeChannelId)?.name || 'chat'}</span>
                  <span
                    className={`ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-normal cursor-pointer ${
                      wsStatus === 'online'
                        ? 'border-emerald-700/60 text-emerald-400 bg-emerald-950/30'
                        : wsStatus === 'offline'
                          ? 'border-red-800/70 text-red-400 bg-red-950/30'
                          : 'border-amber-700/60 text-amber-400 bg-amber-950/30'
                    }`}
                    title={`${activeTransport ? TRANSPORT_LABELS[activeTransport] : ''} / ${connRoute === 'proxy' ? 'プロキシ経由' : '直結'}（クリックで接続設定）`}
                    onClick={() => { setActiveTab('settings'); setSettingsSection('connection'); }}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      wsStatus === 'online' ? 'bg-emerald-400' : wsStatus === 'offline' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
                    }`} />
                    <span className="hidden sm:inline">
                      {wsStatus === 'online'
                        ? `リアルタイム${activeTransport && activeTransport !== 'ws' ? ` (${TRANSPORT_LABELS[activeTransport]})` : ''}`
                        : wsStatus === 'offline' ? 'オフライン' : wsStatus === 'connecting' ? '接続中…' : '再接続中…'}
                    </span>
                  </span>
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

              <div className="relative flex-1 min-h-0 flex flex-col">
              <div ref={chatScrollContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-2 sm:px-4 py-3">
                {/* 過去ログ読み込み (上端で自動 / 手動ボタン) */}
                {hasMoreMessages && messages.length > 0 && !chatSearchQuery && (
                  <div className="flex justify-center py-2">
                    <button
                      onClick={handleLoadMoreMessages}
                      disabled={isLoadingMoreMessages}
                      className="px-4 py-1.5 rounded-full bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 text-xs transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                    >
                      {isLoadingMoreMessages ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                          <span>過去ログを読み込み中...</span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="w-3.5 h-3.5 rotate-180 text-amber-400" />
                          <span>過去のメッセージを読み込む</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {!hasMoreMessages && messages.length > 0 && !chatSearchQuery && (
                  <div className="text-center text-[11px] text-stone-600 py-3">
                    #{channels.find(c => c.id === activeChannelId)?.name} の最初のメッセージです
                  </div>
                )}

                {messages.filter(m => !chatSearchQuery || m.content.toLowerCase().includes(chatSearchQuery.toLowerCase())).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-stone-600 text-xs space-y-2">
                    <MessageSquare className="w-8 h-8 opacity-40 text-amber-400" />
                    <p>メッセージはありません。@gemini でAIと会話できます。</p>
                  </div>
                ) : (
                  messages
                    .filter(m => !chatSearchQuery || m.content.toLowerCase().includes(chatSearchQuery.toLowerCase()))
                    .map((m, mIdx, filteredList) => {
                      const lastReadId = unreadAnchor && unreadAnchor.channelId === activeChannelId ? unreadAnchor.lastReadId : 0;
                      const prevMsg = mIdx > 0 ? filteredList[mIdx - 1] : null;
                      const isMine = m.user_id === currentUser?.id;
                      const isUnread = lastReadId > 0 && m.id > lastReadId && !isMine;
                      const isFirstUnread = isUnread && (!prevMsg || prevMsg.id <= lastReadId || prevMsg.id < 0);
                      const senderName = m.sender_username || m.username || 'unknown';
                      const isGemini = senderName === 'Gemini';
                      const created = new Date(m.created_at);
                      const prevCreated = prevMsg ? new Date(prevMsg.created_at) : null;
                      const isNewDay = !prevCreated || prevCreated.toDateString() !== created.toDateString();
                      // 同じ人が5分以内に連投した場合はアバター/名前を省略してまとめる
                      const isGrouped = Boolean(
                        prevMsg && !isNewDay && !isFirstUnread && !m.is_pinned && !prevMsg.is_pinned && !m.reply_to &&
                        (prevMsg.sender_username || prevMsg.username) === senderName &&
                        created.getTime() - (prevCreated?.getTime() || 0) < 5 * 60 * 1000
                      );
                      const isMentioningMe = Boolean(
                        currentUser && !isMine && (m.content.includes(`@${currentUser.username}`) || m.content.includes('@everyone'))
                      );
                      const timeLabel = created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                      return (
                        <React.Fragment key={m.id}>
                          {isNewDay && (
                            <div className="flex items-center gap-3 my-4">
                              <div className="flex-1 h-px bg-stone-800" />
                              <span className="text-[11px] font-bold text-stone-500">{formatDateSeparator(created)}</span>
                              <div className="flex-1 h-px bg-stone-800" />
                            </div>
                          )}

                          {isFirstUnread && (
                            <div ref={unreadMessageRef} className="flex items-center gap-2 my-2">
                              <div className="flex-1 h-px bg-red-500" />
                              <span className="text-[10px] font-bold text-white bg-red-500 px-2 py-0.5 rounded">
                                新着
                              </span>
                            </div>
                          )}

                          <div
                            id={`msg-${m.id}`}
                            className={`flex items-start gap-3 group relative px-2 rounded-lg transition hover:bg-white/[0.03] ${
                              isGrouped ? 'py-0.5' : 'pt-2 pb-0.5 mt-1.5'
                            } ${m.is_pinned ? 'bg-amber-500/5 border-l-2 border-amber-500/60' : ''} ${
                              isMentioningMe ? 'bg-amber-500/10 border-l-2 border-amber-400' : ''
                            } ${m.pending ? 'opacity-60' : ''}`}
                          >
                            {isGrouped ? (
                              <div className="w-9 shrink-0 text-[10px] text-stone-600 text-right pt-1 opacity-0 group-hover:opacity-100 select-none">
                                {timeLabel}
                              </div>
                            ) : (
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold uppercase shrink-0 border ${
                                isGemini ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : avatarColorFor(senderName)
                              }`}>
                                {isGemini ? 'AI' : senderName.replace('[Discord] ', '')[0]}
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              {!isGrouped && (
                                <div className="flex items-baseline gap-2 mb-0.5">
                                  <span className={`text-sm font-bold ${isGemini ? 'text-amber-400' : isMine ? 'text-amber-200' : 'text-stone-100'}`}>
                                    {senderName}
                                  </span>
                                  <span className="text-[11px] text-stone-500">{timeLabel}</span>
                                  {m.is_pinned && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 rounded border border-amber-400/20">
                                      <Pin className="w-2.5 h-2.5" /> ピン留め
                                    </span>
                                  )}
                                </div>
                              )}

                              {m.reply_to && (
                                <button
                                  type="button"
                                  onClick={() => jumpToMessage(m.reply_to!.id)}
                                  className="flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-stone-300 mb-0.5 max-w-full text-left"
                                >
                                  <CornerReplyIcon />
                                  {m.reply_to.deleted ? (
                                    <span className="italic">削除されたメッセージ</span>
                                  ) : (
                                    <>
                                      <span className="font-bold text-stone-400 shrink-0">@{m.reply_to.username}</span>
                                      <span className="truncate">{summarizeContent(m.reply_to.content)}</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {editingMessageId === m.id ? (
                                <div className="flex items-start gap-2 mt-1">
                                  <textarea
                                    value={editingContent}
                                    rows={Math.min(8, Math.max(1, editingContent.split('\n').length))}
                                    onChange={e => setEditingContent(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleEditMessage(m.id);
                                      }
                                      if (e.key === 'Escape') {
                                        e.stopPropagation();
                                        cancelEditing();
                                      }
                                    }}
                                    autoFocus
                                    onFocus={e => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                                    className="flex-1 bg-[#16181D] border border-amber-500 rounded-lg px-2.5 py-1 text-sm text-white focus:outline-none resize-none"
                                  />
                                  <button
                                    onClick={() => handleEditMessage(m.id)}
                                    className="px-2.5 py-1 bg-amber-500 text-black font-bold rounded-lg text-xs"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={cancelEditing}
                                    className="px-2.5 py-1 bg-stone-800 text-stone-400 rounded-lg text-xs"
                                    title="Esc"
                                  >
                                    キャンセル
                                  </button>
                                </div>
                              ) : (
                                <div className={`text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                                  isGemini ? 'text-amber-100' : 'text-stone-200'
                                }`}>
                                  {IMAGE_MESSAGE_RE.test(m.content.trim()) ? (
                                    <img
                                      src={m.content.trim().match(IMAGE_MESSAGE_RE)?.[1]}
                                      alt="attachment"
                                      loading="lazy"
                                      onLoad={() => {
                                        // 画像の読み込みで高さが変わっても最下部追従を維持
                                        if (isNearBottomRef.current || chatAutoScrollModeRef.current === 'always') {
                                          const el = chatScrollContainerRef.current;
                                          if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 600) scheduleScrollToBottom(false);
                                        }
                                      }}
                                      onClick={() => setLightbox({ src: m.content.trim().match(IMAGE_MESSAGE_RE)?.[1] || '', zoom: 1 })}
                                      className="max-h-72 max-w-full rounded-lg object-contain my-1 border border-stone-800 cursor-zoom-in hover:opacity-90 transition"
                                    />
                                  ) : m.content === VIDEO_NOTICE ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 text-xs">
                                      <Film className="w-3.5 h-3.5" /> 動画が送信されています (asdfbase では表示されません)
                                    </span>
                                  ) : (
                                    <span>{m.content}</span>
                                  )}
                                </div>
                              )}

                              {m.pending && (
                                <div className="text-[10px] text-stone-500 mt-0.5">送信中…</div>
                              )}
                              {m.failed && (
                                <div className="flex items-center gap-2 text-[11px] text-red-400 mt-0.5">
                                  <span>送信に失敗しました</span>
                                  <button onClick={() => handleRetryMessage(m)} className="underline hover:text-red-300">再送</button>
                                  <button onClick={() => handleDiscardFailedMessage(m)} className="underline text-stone-500 hover:text-stone-300">削除</button>
                                </div>
                              )}

                              {m.reactions && Object.keys(m.reactions).length > 0 && (
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  {Object.entries(m.reactions).map(([emoji, userIds]) => (
                                    <button
                                      key={emoji}
                                      onClick={() => handleToggleReaction(m.id, emoji)}
                                      className={`text-xs px-2 py-0.5 rounded-md border flex items-center gap-1 transition ${
                                        userIds.includes(currentUser?.id)
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

                            {m.id > 0 && (
                            <div className="opacity-0 group-hover:opacity-100 transition absolute right-2 -top-3 bg-[#16181D] border border-stone-800 rounded-lg p-1 flex items-center gap-1 shadow-md z-10">
                              <button
                                onClick={() => startReply(m)}
                                title="返信"
                                className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400"
                              >
                                <Reply className="w-3 h-3" />
                              </button>
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
                              {(m.user_id === currentUser?.id || currentUser?.role === 'admin') && (
                                <>
                                  {m.user_id === currentUser?.id && (
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
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })
                )}
                <div ref={messagesEndRef} />
              </div>

                {/* 新着ピル / 最下部へ */}
                {newBelowCount > 0 ? (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold shadow-lg flex items-center gap-1 transition z-20"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    新着 {newBelowCount} 件
                  </button>
                ) : (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-3 right-4 p-1.5 rounded-full bg-[#16181D]/90 border border-stone-800 text-stone-400 hover:text-amber-400 hover:border-amber-500/50 transition shadow-lg z-20"
                    title="最下部へスクロール"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Chat Input: Fixed at bottom with shrink-0 */}
              <div className="relative p-3 border-t border-stone-800/80 bg-[#0C0D10]/95 shrink-0">
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
                  {replyToMessage && (
                    <div className="flex items-center gap-2 px-3 py-1.5 mb-1 rounded-lg bg-stone-900/80 border border-stone-800 text-xs text-stone-400">
                      <Reply className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="shrink-0">
                        <span className="text-amber-300 font-bold">{replyToMessage.sender_username || replyToMessage.username}</span> に返信
                      </span>
                      <span className="truncate text-stone-500">{summarizeContent(replyToMessage.content)}</span>
                      <button
                        type="button"
                        onClick={() => setReplyToMessage(null)}
                        className="ml-auto p-0.5 rounded hover:bg-stone-800 hover:text-white"
                        title="返信をやめる (Esc)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-2 bg-[#14161C] border border-stone-800 rounded-xl px-3 py-2 focus-within:border-amber-500/60 transition">
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

                    <textarea
                      ref={chatInputRef}
                      rows={1}
                      value={chatInput}
                      onChange={e => {
                        const val = e.target.value;
                        setChatInput(val);
                        // 入力に合わせて高さを自動調整 (最大約8行)
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                        const lastAt = val.lastIndexOf('@');
                        if (lastAt !== -1 && !val.substring(lastAt).includes(' ')) {
                          setShowMentionSuggestions(true);
                          setMentionFilter(val.substring(lastAt + 1));
                        } else {
                          setShowMentionSuggestions(false);
                        }
                      }}
                      onKeyDown={e => {
                        // 日本語IMEの変換確定Enterでは送信しない
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter' && !e.shiftKey) {
                          // Enter: 送信 / Shift+Enter: 改行
                          e.preventDefault();
                          handleSendMessage(e);
                          (e.target as HTMLTextAreaElement).style.height = 'auto';
                        } else if (e.key === 'ArrowUp' && chatInput === '') {
                          if (startEditLastOwnMessage()) e.preventDefault();
                        } else if (e.key === 'Escape') {
                          e.stopPropagation();
                          if (showMentionSuggestions) setShowMentionSuggestions(false);
                          else if (replyToMessage) setReplyToMessage(null);
                          else if (chatInput) setChatInput('');
                        }
                      }}
                      placeholder={`#${channels.find(c => c.id === activeChannelId)?.name || 'chat'} へメッセージ  (Shift+Enterで改行 / ↑で直前を編集)`}
                      className="flex-1 bg-transparent text-sm text-white focus:outline-none placeholder-stone-600 resize-none leading-relaxed max-h-[200px] py-0.5"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="p-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black transition interactive-btn"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* Right: Members Sidebar (Fixed width & scrollable) */}
            {!isMembersCollapsed && (
              <aside className="w-48 sm:w-56 border-l border-stone-800 bg-[#0C0D10] p-3 hidden lg:flex flex-col shrink-0 min-h-0 overflow-y-auto">
                {(['online', 'away', 'offline'] as const).map(group => {
                  const members = onlineUsers.filter(u =>
                    group === 'offline' ? (u.status !== 'online' && u.status !== 'away') : u.status === group
                  );
                  if (members.length === 0) return null;
                  return (
                    <div key={group} className="mb-3">
                      <div className="text-[11px] uppercase tracking-wider text-stone-500 px-2 mb-1 font-bold">
                        {group === 'online' ? 'オンライン' : group === 'away' ? '離席中' : 'オフライン'} — {members.length}
                      </div>
                      <div className="space-y-0.5">
                        {members.map(u => (
                          <div
                            key={u.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-stone-900/60 text-sm ${
                              group === 'offline' ? 'text-stone-600' : 'text-stone-200'
                            }`}
                          >
                            <div className="relative shrink-0">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold uppercase border ${
                                group === 'offline' ? 'bg-stone-900 text-stone-600 border-stone-800' : avatarColorFor(u.username)
                              }`}>
                                {u.username[0]}
                              </div>
                              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0C0D10] ${
                                group === 'online' ? 'bg-emerald-400' : group === 'away' ? 'bg-amber-400' : 'bg-stone-600'
                              }`} />
                            </div>
                            <span className="truncate">{u.username}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </aside>
            )}
          </div>
        )}

        {/* TAB 2: リアルタイムメモ */}
        {activeTab === 'memo' && (
          <div className="flex-1 flex overflow-hidden">
            <aside className="w-64 border-r border-stone-800/80 bg-[#0C0D10] p-3 flex flex-col justify-between shrink-0 h-full overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* スロット1〜10: 共有メモ */}
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold flex items-center justify-between shrink-0">
                  <span>共有メモ (#1 ~ #10)</span>
                  <FileText className="w-3.5 h-3.5 text-stone-500" />
                </div>
                <div className="space-y-1 overflow-y-auto max-h-[38vh] pr-1 mb-4">
                  {memoSlots.filter(s => s.slot_index <= 10).map(slot => {
                    const cleanTitle = slot.title ? slot.title.replace(/^メモ\s*#?\d+\s*:?\s*/, '') : '';
                    const displayTitle = cleanTitle ? cleanTitle : `メモ`;

                    return (
                      <button
                        key={slot.slot_index}
                        onClick={() => {
                          setSelectedSlotIndex(slot.slot_index);
                          setMemoTitle(slot.title);
                          setMemoContent(slot.content);
                          setMemoMode(slot.mode === 'monaco' ? 'markdown' : slot.mode);
                          setMemoAssignedUser(null);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-mono transition text-left ${
                          selectedSlotIndex === slot.slot_index
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-[#111214] border border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <span className="text-amber-500/80 font-bold shrink-0">#{slot.slot_index}</span>
                          <span className="truncate">{displayTitle}</span>
                        </div>
                        <span className="text-[10px] text-stone-600 uppercase shrink-0 font-mono">
                          {slot.mode || 'md'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* スロット11以降: メンバー専用Monacoエディタ */}
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold flex items-center justify-between shrink-0 border-t border-stone-800/80 pt-3">
                  <span>専用コードゾーン (Monaco)</span>
                  <Code className="w-3.5 h-3.5 text-stone-500" />
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                  {memoSlots.filter(s => s.slot_index >= 11).map(slot => {
                    const isMySlot = slot.assigned_user_id === currentUser?.id;
                    const assignedName = (slot as any).assigned_username || `ユーザー${slot.assigned_user_id || ''}`;

                    return (
                      <button
                        key={slot.slot_index}
                        onClick={() => {
                          setSelectedSlotIndex(slot.slot_index);
                          setMemoTitle(slot.title);
                          setMemoContent(slot.content);
                          setMemoMode('monaco');
                          setMemoAssignedUser(slot.assigned_user_id || null);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono transition text-left ${
                          selectedSlotIndex === slot.slot_index
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm'
                            : 'bg-[#111214] border border-stone-800/80 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <Code className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="truncate font-bold text-white">
                            {assignedName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {isMySlot ? (
                            <span className="text-[9px] bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 px-1.5 py-0.2 rounded font-mono">
                              あなた
                            </span>
                          ) : (
                            <span className="text-[9px] bg-stone-900 border border-stone-800 text-stone-500 px-1.5 py-0.2 rounded font-mono flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" /> 閲覧専用
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
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

                  {/* 自動保存インジケーター */}
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-stone-900 border border-stone-800 text-[11px] font-mono">
                    <span className={`w-2 h-2 rounded-full ${autoSaveStatus === 'saving' ? 'bg-amber-400 animate-pulse' : autoSaveStatus === 'dirty' ? 'bg-orange-500' : 'bg-emerald-400'}`} />
                    <span className="text-stone-400">
                      {autoSaveStatus === 'saving' ? '自動保存中...' : autoSaveStatus === 'dirty' ? '未保存' : '自動保存済み'}
                    </span>
                  </div>

                  {selectedSlotIndex <= 10 ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={memoMode}
                        disabled={isMonacoLocked}
                        onChange={e => setMemoMode(e.target.value as any)}
                        className="bg-[#14161C] border border-stone-800 text-stone-300 rounded-lg px-2.5 py-1.5 focus:outline-none disabled:opacity-50 text-xs font-mono"
                      >
                        <option value="markdown">Markdownモード</option>
                        <option value="plain">プレーンテキスト</option>
                      </select>

                      {memoMode === 'markdown' && (
                        <div className="flex items-center bg-[#14161C] border border-stone-800 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => setMemoViewMode('split')}
                            className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 transition ${
                              memoViewMode === 'split' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-stone-400 hover:text-white'
                            }`}
                            title="編集とプレビューの2分割表示"
                          >
                            <Book className="w-3 h-3" />
                            <span>分割編集</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMemoViewMode('view_only')}
                            className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 transition ${
                              memoViewMode === 'view_only' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-stone-400 hover:text-white'
                            }`}
                            title="大画面でマークダウンを綺麗に閲覧"
                          >
                            <Eye className="w-3 h-3" />
                            <span>閲覧専用</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1">
                      <Code className="w-3 h-3" /> Monaco Editor
                    </span>
                  )}

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
                    onClick={() => handleSaveMemo()}
                    disabled={isSavingMemo || isMonacoLocked}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition interactive-btn uppercase disabled:opacity-50"
                  >
                    {isSavingMemo ? '保存中...' : '手動保存'}
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
                ) : memoMode === 'plain' ? (
                  /* プレーンテキスト選択時: Markdown Live Previewは非表示で全幅編集 */
                  <div className="flex-1 p-4 overflow-hidden">
                    <textarea
                      value={memoContent}
                      onChange={e => handleMemoContentChange(e.target.value)}
                      placeholder="プレーンテキストを入力..."
                      className="w-full h-full bg-[#16181D] border border-stone-800 rounded-xl p-4 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:border-amber-500/50 resize-none"
                    />
                  </div>
                ) : memoViewMode === 'view_only' ? (
                  /* Markdown閲覧専用モード: 大画面で実際のMarkdownを快適に読む */
                  <div className="flex-1 p-6 overflow-y-auto">
                    <div className="max-w-4xl mx-auto bg-[#16181D]/80 border border-stone-800 rounded-2xl p-6 sm:p-8 text-stone-200 font-sans leading-relaxed prose prose-invert max-w-none shadow-xl">
                      <div className="flex items-center justify-between pb-3 mb-4 border-b border-stone-800 text-xs font-mono text-stone-400">
                        <span className="flex items-center gap-1.5 text-amber-400 font-bold">
                          <Eye className="w-3.5 h-3.5" /> MARKDOWN VIEW-ONLY MODE
                        </span>
                        <button
                          onClick={() => setMemoViewMode('split')}
                          className="px-2.5 py-1 rounded bg-stone-900 border border-stone-700 hover:border-amber-500 text-stone-300 hover:text-white transition"
                        >
                          編集モードに戻る
                        </button>
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {memoContent || '（内容がありません）'}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  /* Markdown 2分割編集モード */
                  <div className="flex-1 flex gap-4 p-4 overflow-hidden">
                    <textarea
                      value={memoContent}
                      onChange={e => handleMemoContentChange(e.target.value)}
                      placeholder="Markdownテキストを入力..."
                      className="flex-1 h-full bg-[#16181D] border border-stone-800 rounded-xl p-3.5 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:border-amber-500/50 resize-none"
                    />
                    <div className="flex-1 h-full bg-[#16181D]/60 border border-stone-800 rounded-xl p-4 text-stone-300 font-sans text-sm overflow-y-auto leading-relaxed prose prose-invert max-w-none">
                      <div className="flex items-center justify-between text-[10px] font-mono text-stone-500 mb-2 border-b border-stone-800 pb-1">
                        <span>MARKDOWN LIVE PREVIEW</span>
                        <button
                          onClick={() => setMemoViewMode('view_only')}
                          className="hover:text-amber-400 transition"
                        >
                          [全画面閲覧]
                        </button>
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
            <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-6xl w-full mx-auto">
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
                    className={`max-w-[85%] rounded-2xl p-4 text-xs font-mono leading-relaxed shadow-lg break-words min-w-0 overflow-hidden ${
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
                      <>
                        <div className="prose prose-invert prose-xs max-w-none overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                        {/* メモ連携アクションバー */}
                        <div className="mt-3 pt-2.5 border-t border-stone-800/80 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleMemoContentChange(msg.content);
                              alert(`現在のメモ(#${selectedSlotIndex})にAIの回答を反映しました！`);
                            }}
                            className="px-2 py-1 rounded bg-stone-900 border border-stone-800 hover:border-emerald-500/50 text-stone-300 hover:text-emerald-400 text-[10px] transition flex items-center gap-1 font-mono"
                            title="現在のメモをこの回答で上書き"
                          >
                            <FileText className="w-3 h-3 text-emerald-400" />
                            <span>メモに反映(上書き)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newContent = memoContent ? `${memoContent}\n\n---\n${msg.content}` : msg.content;
                              handleMemoContentChange(newContent);
                              alert(`現在のメモ(#${selectedSlotIndex})の末尾に追記しました！`);
                            }}
                            className="px-2 py-1 rounded bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 text-[10px] transition flex items-center gap-1 font-mono"
                            title="現在のメモの末尾にこの回答を追記"
                          >
                            <Plus className="w-3 h-3 text-amber-400" />
                            <span>メモに追記</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              alert('クリップボードにコピーしました！');
                            }}
                            className="px-2 py-1 rounded bg-stone-900 border border-stone-800 hover:border-stone-600 text-stone-400 hover:text-white text-[10px] transition flex items-center gap-1 font-mono"
                          >
                            <Copy className="w-3 h-3" />
                            <span>コピー</span>
                          </button>
                        </div>
                      </>
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
              <div ref={aiEndRef} />
            </div>

            {/* Input Form: Fixed at bottom with shrink-0 */}
            <div className="p-4 border-t border-stone-800/80 bg-[#111214] shrink-0">
              <div className="max-w-6xl mx-auto mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-stone-400">
                <div className="flex items-center gap-2">
                  <span className="text-stone-500">選択中メモ:</span>
                  <span className="text-amber-400 font-bold">#{selectedSlotIndex} {memoTitle || 'メモ'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!memoContent.trim()) {
                        alert('現在のメモに本文がありません。');
                        return;
                      }
                      const quote = `【#${selectedSlotIndex} ${memoTitle || 'メモ'}の内容】\n${memoContent}\n\n`;
                      setAiInput(prev => quote + prev);
                    }}
                    className="px-2 py-0.5 rounded bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 transition flex items-center gap-1"
                    title="現在のメモの内容を質問欄に引用"
                  >
                    <FileText className="w-3 h-3 text-amber-400" />
                    <span>メモ内容を引用して質問</span>
                  </button>
                </div>
                <div className="text-[10px] text-stone-500 flex items-center gap-1">
                  <span>※質問内で <code className="text-amber-400/80">#メモ名</code> や <code className="text-amber-400/80">#チャンネル名</code> を含めると自動参照されます</span>
                </div>
              </div>
              <form onSubmit={handleSendAiMessage} className="max-w-6xl mx-auto flex gap-2">
                <input
                  type="text"
                  placeholder="Geminiに質問を入力 (#メモ名 や #チャンネル名 でDB自動取得)..."
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
                    onClick={() => handleSetTodaySchedule('normal')}
                    title="今日の時程 (全員共通) を切り替え"
                    className={`px-3 py-1.5 rounded-lg transition ${
                      todaySchedule === 'normal' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    通常時程
                  </button>
                  <button
                    onClick={() => handleSetTodaySchedule('short')}
                    title="今日の時程 (全員共通) を切り替え"
                    className={`px-3 py-1.5 rounded-lg transition ${
                      todaySchedule === 'short' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    短縮時程
                  </button>
                  <button
                    onClick={() => handleSetTodaySchedule('s_short')}
                    title="今日の時程 (全員共通) を切り替え"
                    className={`px-3 py-1.5 rounded-lg transition ${
                      todaySchedule === 's_short' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    S短時程
                  </button>
                </div>
              </div>

              {/* 提出物作成フォーム (簡易入力・選択肢充実) */}
              <form onSubmit={handleCreateAssignment} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 sm:p-5 space-y-3 font-mono text-xs shadow-lg">
                <div className="flex items-center justify-between text-stone-300 font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1.5 text-white">
                    <Plus className="w-4 h-4 text-amber-400" /> 新規提出物の登録
                  </span>
                  <span className="text-[10px] text-stone-500 font-normal">ワンタップ入力対応</span>
                </div>

                {/* クイック教科選択ボタン */}
                <div className="space-y-1.5 bg-[#16181D]/60 p-2.5 rounded-xl border border-stone-800/60">
                  <div className="text-[10px] text-stone-400 font-bold flex items-center justify-between">
                    <span>教科クイック選択:</span>
                    <span className="text-amber-400 font-bold">{newAssignSubject}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {['国語', '数学', '英語', '理科', '社会', '情報', '体育', '美術', '音楽', '技家', '総合', 'その他'].map(subj => (
                      <button
                        type="button"
                        key={subj}
                        onClick={() => setNewAssignSubject(subj)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] transition ${
                          newAssignSubject === subj
                            ? 'bg-amber-500 text-black font-bold border-amber-400 shadow-sm'
                            : 'bg-[#111214] text-stone-300 border-stone-800 hover:border-stone-600'
                        }`}
                      >
                        {subj}
                      </button>
                    ))}
                  </div>
                </div>

                {/* クイック課題プリセットボタン */}
                <div className="space-y-1.5 bg-[#16181D]/60 p-2.5 rounded-xl border border-stone-800/60">
                  <span className="text-[10px] text-stone-400 font-bold block">課題名プリセット:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '教科書ワーク', prefix: 'ワーク P.' },
                      { label: '授業プリント', prefix: 'プリント提出' },
                      { label: 'レポート課題', prefix: 'レポート' },
                      { label: 'ノート提出', prefix: 'ノート点検' },
                      { label: 'Web小テスト', prefix: 'Webテスト' },
                      { label: '週末課題', prefix: '週末課題' },
                    ].map(preset => (
                      <button
                        type="button"
                        key={preset.label}
                        onClick={() => setNewAssignTitle(prev => prev ? `${preset.prefix} (${prev})` : preset.prefix)}
                        className="px-2 py-0.5 rounded-md bg-[#111214] border border-stone-800 text-stone-400 hover:text-amber-400 hover:border-amber-500/50 text-[10px] transition"
                      >
                        +{preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="text-[10px] text-stone-400 block mb-1">課題タイトル *</label>
                    <input
                      type="text"
                      required
                      placeholder="例: 数学I ワーク P.40-45"
                      value={newAssignTitle}
                      onChange={e => setNewAssignTitle(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-400 block mb-1">提出締切日 *</label>
                    <input
                      type="date"
                      required
                      value={newAssignDeadline}
                      onChange={e => setNewAssignDeadline(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-400 block mb-1">再提出締切日 (任意)</label>
                    <input
                      type="date"
                      value={newAssignResubmitDeadline}
                      onChange={e => setNewAssignResubmitDeadline(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">指示文・持ち物・注意事項 (Gemini AI要約対応)</label>
                  <textarea
                    placeholder="問題番号、提出形式、注意点など。AIが自動要約してフローティング表示できます"
                    value={newAssignDesc}
                    onChange={e => setNewAssignDesc(e.target.value)}
                    className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-3 text-white focus:outline-none focus:border-amber-500/60 resize-none h-18 text-xs font-mono"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full sm:w-auto px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition interactive-btn uppercase tracking-wider"
                >
                  提出物を追加登録
                </button>
              </form>

              {/* フィルター */}
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
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
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/40 font-bold'
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
                  filteredAssignments.map((item) => {
                    const membersProg = assignmentMembersProgress[item.id] || [];
                    const submittedOrPassedCount = membersProg.filter(p => p.status === 'submitted' || p.status === 'passed').length;
                    const totalMembers = membersProg.length;

                    return (
                      <div key={item.id} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4.5 interactive-card space-y-3 shadow-lg">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                              {item.subject}
                            </span>
                            <span className="font-bold text-white text-base">{item.title}</span>
                          </div>

                          {/* アクションボタン群 */}
                          <div className="flex items-center gap-2 font-mono text-xs flex-wrap">
                            {/* メンバー別進捗確認ボタン */}
                            <button
                              type="button"
                              onClick={() => setShowMemberProgressModalId(item.id)}
                              className="px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 text-[11px] transition flex items-center gap-1.5"
                              title="全員の提出状況を確認"
                            >
                              <Users className="w-3.5 h-3.5 text-amber-400" />
                              <span>進捗: {submittedOrPassedCount}{totalMembers > 0 ? `/${totalMembers}人` : '人'}</span>
                            </button>

                            {/* 提出物編集ボタン */}
                            <button
                              type="button"
                              onClick={() => setEditingAssignment(item)}
                              className="p-1.5 rounded-lg bg-stone-900 border border-stone-800 hover:border-stone-600 text-stone-400 hover:text-white transition"
                              title="提出物を編集"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* ステータスセレクト */}
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

                            {/* 削除ボタン */}
                            <button
                              onClick={() => handleDeleteAssignment(item.id)}
                              className="p-1.5 rounded-lg text-stone-500 hover:text-red-400 hover:bg-stone-800 transition"
                              title="提出物を削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-stone-400">
                          <div>締切: <span className="text-stone-200 font-bold">{new Date(item.deadline).toLocaleDateString()}</span></div>
                          {item.resubmit_deadline && (
                            <div>再提出締切: <span className="text-amber-300 font-bold">{new Date(item.resubmit_deadline).toLocaleDateString()}</span></div>
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
                              <span>{isSummarizingAI === item.id ? 'Gemini 要約中...' : 'Geminiで要約・ポイント抽出 (フローティング表示)'}</span>
                            </button>
                            {summarizedTexts[item.id] && (
                              <button
                                onClick={() => setFloatingAiSummary({ id: item.id, title: item.title, summary: summarizedTexts[item.id] })}
                                className="text-[11px] font-mono text-stone-400 hover:text-amber-400 transition"
                              >
                                [要約ウィンドウを開く]
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
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
                  <PenTool className="w-3.5 h-3.5" />
                  <span>手書き</span>
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
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                onClick={handleAddBoardText}
                style={{ touchAction: 'none' }}
                className="w-full h-full object-contain select-none"
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

              {/* 一覧テーブル (ユーザー切り替え & 削除ボタン付き) */}
              <div className="bg-[#111214] border border-stone-800/80 rounded-2xl overflow-hidden font-mono text-xs">
                <div className="px-4 py-3 border-b border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-stone-400 font-bold uppercase tracking-wider">
                    記録一覧 {testScoreUserFilter === 'me' ? '(あなた)' : testScoreUserFilter === 'all' ? '(全員)' : `(ユーザーID: ${testScoreUserFilter})`}
                  </div>

                  {/* ユーザー切り替え */}
                  <div className="flex items-center gap-1.5 bg-[#16181D] p-1 rounded-xl border border-stone-800">
                    <button
                      onClick={() => handleFetchTestScores('me')}
                      className={`px-2.5 py-1 rounded-lg transition ${
                        testScoreUserFilter === 'me' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                      }`}
                    >
                      自分の点数
                    </button>
                    <button
                      onClick={() => handleFetchTestScores('all')}
                      className={`px-2.5 py-1 rounded-lg transition ${
                        testScoreUserFilter === 'all' ? 'bg-amber-500 text-black font-bold' : 'text-stone-400 hover:text-white'
                      }`}
                    >
                      全員の点数
                    </button>
                    <select
                      value={testScoreUserFilter}
                      onChange={e => handleFetchTestScores(e.target.value)}
                      className="bg-[#111214] border border-stone-800 text-stone-300 rounded-lg px-2 py-1 text-xs focus:outline-none"
                    >
                      <option value="me">自分</option>
                      <option value="all">全員</option>
                      {onlineUsers.map(u => (
                        <option key={u.id} value={String(u.id)}>{u.username}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="divide-y divide-stone-800/60">
                  {testScores.length === 0 ? (
                    <div className="p-6 text-center text-stone-600">記録された点数はありません</div>
                  ) : (
                    testScores.map(t => (
                      <div key={t.id} className="px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-stone-500">[{t.exam_name}]</span>
                          <span className="font-bold text-white">{t.subject}</span>
                          {(t as any).username && (
                            <span className="text-[10px] text-amber-500/80 bg-amber-500/10 px-1.5 py-0.2 rounded font-mono">
                              {(t as any).username}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="font-bold text-amber-400">
                            {t.score} / {t.max_score}点
                          </div>
                          {(t.user_id === currentUser?.id || currentUser?.role === 'admin') && (
                            <button
                              onClick={() => handleDeleteTestScore(t.id)}
                              className="p-1 text-stone-500 hover:text-red-400 transition"
                              title="記録を削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
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
                    { id: 'appearance', label: '表示・操作' },
                    { id: 'connection', label: '接続' },
                    { id: 'notifications', label: '通知設定' },
                    { id: 'webhook', label: 'Discord連携' },
                    { id: 'audit', label: '監査ログ' },
                  ].map(sec => (
                    <button
                      key={sec.id}
                      onClick={() => {
                        setSettingsSection(sec.id as any);
                        if (sec.id === 'audit') loadAuditLogs();
                        if (sec.id === 'webhook' || sec.id === 'notifications') loadIntegrations();
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

              {/* 接続設定: リアルタイム方式 / ポーリング間隔 / プロキシ経由 or 直結 */}
              {settingsSection === 'connection' && (
                <div className="space-y-4 text-xs">
                  {/* 現在の状態 */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-white font-bold text-sm">現在の接続</span>
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                        wsStatus === 'online' ? 'border-emerald-700/60 text-emerald-400 bg-emerald-950/30'
                          : wsStatus === 'offline' ? 'border-red-800/70 text-red-400 bg-red-950/30'
                          : 'border-amber-700/60 text-amber-400 bg-amber-950/30'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${wsStatus === 'online' ? 'bg-emerald-400' : wsStatus === 'offline' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
                        {wsStatus === 'online' ? '接続中' : wsStatus === 'offline' ? 'オフライン' : '接続を試行中…'}
                        {activeTransport && ` · ${TRANSPORT_LABELS[activeTransport]}`}
                        {` · ${connRoute === 'proxy' ? 'プロキシ経由' : '直結'}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setLatencyResult('計測中…');
                          const times: number[] = [];
                          for (let i = 0; i < 3; i++) {
                            const t0 = performance.now();
                            try {
                              const r = await safeFetch('/api/rt/info', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
                              if (!r.ok) throw new Error();
                              times.push(performance.now() - t0);
                            } catch {
                              setLatencyResult('失敗: サーバーに届きませんでした');
                              return;
                            }
                          }
                          setLatencyResult(`往復 平均 ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms (最小 ${Math.round(Math.min(...times))}ms)`);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 transition"
                      >
                        応答速度を測る
                      </button>
                      <span className="text-stone-400">{latencyResult}</span>
                    </div>
                  </div>

                  {/* リアルタイム方式 */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                    <div className="text-white font-bold text-sm">リアルタイム通信方式</div>
                    <p className="text-stone-400 leading-relaxed">
                      学校のフィルター等で WebSocket が通らない場合は、自動で他の方式に切り替わります。うまくいかない時は手動で固定してください。
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      {([
                        { id: 'auto', label: '自動', desc: 'おすすめ' },
                        { id: 'ws', label: 'WebSocket', desc: '最速・通らない環境あり' },
                        { id: 'sse', label: 'SSE', desc: 'HTTPストリーム' },
                        { id: 'longpoll', label: 'ロングポーリング', desc: '即時・ほぼ確実に通る' },
                        { id: 'poll', label: 'ポーリング', desc: '一定間隔で確認' },
                      ] as { id: RealtimeTransport; label: string; desc: string }[]).map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setRealtimeTransport(opt.id);
                            setRtTransportState(opt.id);
                          }}
                          className={`p-3 rounded-xl border text-left transition ${
                            rtTransport === opt.id
                              ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                              : 'bg-[#16181D] border-stone-800 text-stone-300 hover:border-stone-600'
                          }`}
                        >
                          <div className="font-bold">{opt.label}</div>
                          <div className="text-[10px] text-stone-500 mt-0.5">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ポーリング間隔 */}
                  <div className={`bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3 ${rtTransport === 'poll' || (rtTransport === 'auto' && activeTransport === 'poll') ? '' : 'opacity-60'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-white font-bold text-sm">ポーリング間隔</span>
                      <span className="text-stone-500">「ポーリング」方式の時に使われます</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[500, 1000, 2000, 3000, 5000].map(ms => (
                        <button
                          key={ms}
                          type="button"
                          onClick={() => {
                            setPollInterval(ms);
                            setRtPollIntervalState(ms);
                          }}
                          className={`px-4 py-2 rounded-xl border transition ${
                            rtPollInterval === ms
                              ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold'
                              : 'bg-[#16181D] border-stone-800 text-stone-300 hover:border-stone-600'
                          }`}
                        >
                          {ms < 1000 ? `${ms / 1000}秒` : `${ms / 1000}秒`}
                        </button>
                      ))}
                    </div>
                    <p className="text-stone-500">短いほど速く届きますが、通信量とバッテリー消費が増えます。</p>
                  </div>

                  {/* 経路 */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                    <div className="text-white font-bold text-sm">通信経路</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {([
                        { id: 'proxy', label: 'プロキシ経由', desc: 'このサイト経由で通信。フィルターにVPSのドメインが見えない (標準)' },
                        { id: 'direct', label: '直結', desc: 'VPS (api-asdf.rds9.net) へ直接。速いがフィルターでブロック/記録される可能性あり' },
                      ] as { id: ConnectionRoute; label: string; desc: string }[]).map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setConnectionRoute(opt.id);
                            setConnRouteState(opt.id);
                          }}
                          className={`p-3 rounded-xl border text-left transition ${
                            connRoute === opt.id
                              ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                              : 'bg-[#16181D] border-stone-800 text-stone-300 hover:border-stone-600'
                          }`}
                        >
                          <div className="font-bold">{opt.label}</div>
                          <div className="text-[10px] text-stone-500 mt-0.5 leading-relaxed">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 0. 表示・操作設定 (UI縮小・スクロール・自動保存) */}
              {settingsSection === 'appearance' && (
                <div className="space-y-4">
                  {/* UI縮小率 */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-4 shadow-lg">
                    <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                      <span className="text-white font-bold text-sm">UI縮小・画面スケール (UI Scale)</span>
                      <span className="text-amber-400 font-bold">{uiScale}%</span>
                    </div>
                    <p className="text-stone-400 leading-relaxed">
                      Chromebookや小型ノートPC、低解像度モニターでも快適に画面全体を見渡せるよう、全体の表示サイズを縮小・最適化できます。
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { scale: 75, label: '75% (超コンパクト)' },
                        { scale: 85, label: '85% (推奨・見やすい)' },
                        { scale: 100, label: '100% (標準サイズ)' },
                        { scale: 110, label: '110% (文字大きめ)' },
                      ].map(item => (
                        <button
                          key={item.scale}
                          type="button"
                          onClick={() => {
                            setUiScale(item.scale);
                            localStorage.setItem('asdf_ui_scale', String(item.scale));
                          }}
                          className={`p-3 rounded-xl border text-center transition ${
                            uiScale === item.scale
                              ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold shadow-sm'
                              : 'bg-[#16181D] border-stone-800 text-stone-400 hover:text-white hover:border-stone-700'
                          }`}
                        >
                          <div className="text-sm font-bold">{item.scale}%</div>
                          <div className="text-[10px] text-stone-500 mt-1">{item.label.split(' ')[1]}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* チャット自動スクロール */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-4 shadow-lg">
                    <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                      <span className="text-white font-bold text-sm">チャット自動スクロール挙動</span>
                      <span className="text-amber-400 font-bold uppercase">{chatAutoScrollMode}</span>
                    </div>
                    <p className="text-stone-400 leading-relaxed">
                      新着メッセージ受信時の画面スクロール動作を選択できます。「未読で停止」にすると、過去ログを読んでいる最中に勝手に最下部へ飛ばされません。
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { mode: 'always', label: '常に最新へスクロール', desc: '新着を逃さず追従' },
                        { mode: 'unread_stop', label: '未読位置で停止 (推奨)', desc: '未読があればスクロール固定' },
                        { mode: 'manual', label: '完全手動スクロール', desc: '勝手に動かない' },
                      ].map(item => (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => {
                            setChatAutoScrollMode(item.mode as any);
                            localStorage.setItem('asdf_chat_scroll_mode', item.mode);
                          }}
                          className={`p-3 rounded-xl border text-left transition ${
                            chatAutoScrollMode === item.mode
                              ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold shadow-sm'
                              : 'bg-[#16181D] border-stone-800 text-stone-400 hover:text-white hover:border-stone-700'
                          }`}
                        >
                          <div className="font-bold text-white">{item.label}</div>
                          <div className="text-[10px] text-stone-500 mt-1">{item.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* メモ自動保存間隔 */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-6 font-mono text-xs space-y-4 shadow-lg">
                    <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                      <span className="text-white font-bold text-sm">メモ自動保存間隔</span>
                      <span className="text-amber-400 font-bold">
                        {memoAutoSaveInterval === 0 ? '手動保存のみ' : `${memoAutoSaveInterval / 1000}秒`}
                      </span>
                    </div>
                    <p className="text-stone-400 leading-relaxed">
                      入力停止後、指定した時間が経過すると自動でサーバーに同期・保存されます。
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { ms: 1000, label: '1秒 (リアルタイム)' },
                        { ms: 2000, label: '2秒 (標準)' },
                        { ms: 5000, label: '5秒 (長め)' },
                        { ms: 0, label: 'オフ (手動のみ)' },
                      ].map(item => (
                        <button
                          key={item.ms}
                          type="button"
                          onClick={() => {
                            setMemoAutoSaveInterval(item.ms);
                            localStorage.setItem('asdf_memo_autosave', String(item.ms));
                          }}
                          className={`p-2.5 rounded-xl border text-center transition ${
                            memoAutoSaveInterval === item.ms
                              ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold shadow-sm'
                              : 'bg-[#16181D] border-stone-800 text-stone-400 hover:text-white hover:border-stone-700'
                          }`}
                        >
                          <div className="font-bold">{item.ms === 0 ? 'オフ' : `${item.ms / 1000}秒`}</div>
                          <div className="text-[10px] text-stone-500 mt-0.5">{item.label.split(' ')[1]}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

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
                <div className="space-y-4 text-xs">
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                    <div className="text-white font-bold text-sm flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-amber-400" /> このブラウザへの通知
                    </div>
                    {'Notification' in window && Notification.permission === 'denied' && (
                      <div className="p-2.5 rounded-xl bg-red-950/30 border border-red-900 text-red-300">
                        ブラウザで通知がブロックされています。アドレスバーのサイト設定から許可してください。
                      </div>
                    )}
                    {([
                      { key: 'important', label: '重要な通知', desc: '自分へのメンション・返信、@everyone、新しい提出物' },
                      { key: 'messages', label: 'すべてのメッセージ', desc: '見ていないチャンネルやタブ非表示中の新着メッセージ' },
                      { key: 'sound', label: '通知音', desc: '重要な通知のときに音を鳴らす' },
                    ] as const).map(item => (
                      <div key={item.key} className="flex items-center justify-between gap-3 p-3 bg-[#16181D] border border-stone-800 rounded-xl">
                        <div>
                          <div className="text-white font-bold">{item.label}</div>
                          <div className="text-stone-500 text-[11px]">{item.desc}</div>
                        </div>
                        <button
                          onClick={() => updateNotifyPrefs({ [item.key]: !notifyPrefs[item.key] })}
                          className={`w-14 shrink-0 px-3 py-1.5 rounded-lg border font-bold transition ${
                            notifyPrefs[item.key]
                              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                              : 'bg-stone-800 border-stone-700 text-stone-500'
                          }`}
                        >
                          {notifyPrefs[item.key] ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                    <div className="text-white font-bold text-sm flex items-center gap-1.5">
                      <Share2 className="w-4 h-4 text-amber-400" /> Discord への送信 (全員共通)
                    </div>
                    {!integrations ? (
                      <div className="text-stone-500">読み込み中…</div>
                    ) : (
                      ([
                        { key: 'importantEnabled', label: '重要な通知', desc: '提出物の登録・締切変更、@everyone、ピン留め → 重要通知 Webhook' },
                        { key: 'messagesEnabled', label: 'メッセージ転送', desc: 'チャットのメッセージ・画像 → Bot (未設定ならメッセージ用 Webhook)' },
                      ] as const).map(item => (
                        <div key={item.key} className="flex items-center justify-between gap-3 p-3 bg-[#16181D] border border-stone-800 rounded-xl">
                          <div>
                            <div className="text-white font-bold">{item.label}</div>
                            <div className="text-stone-500 text-[11px]">{item.desc}</div>
                          </div>
                          <button
                            onClick={() => saveIntegrations({ [item.key]: !integrations[item.key] })}
                            className={`w-14 shrink-0 px-3 py-1.5 rounded-lg border font-bold transition ${
                              integrations[item.key]
                                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                                : 'bg-stone-800 border-stone-700 text-stone-500'
                            }`}
                          >
                            {integrations[item.key] ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      ))
                    )}
                    {integrationStatus && <div className="text-amber-300">{integrationStatus}</div>}
                  </div>
                </div>
              )}

              {/* 3. Discord 連携 (Bot / 重要通知 Webhook / メッセージ Webhook) */}
              {settingsSection === 'webhook' && (
                <div className="space-y-4 text-xs">
                  {integrationStatus && (
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl">{integrationStatus}</div>
                  )}
                  {!integrations ? (
                    <div className="text-stone-500">読み込み中…</div>
                  ) : (
                    <>
                      {/* Bot */}
                      <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-white font-bold text-sm flex items-center gap-1.5">
                            <Bot className="w-4 h-4 text-amber-400" /> Discord Bot (メッセージ同期)
                          </span>
                          <span className={`px-2.5 py-1 rounded-full border ${
                            integrations.bot?.connected ? 'border-emerald-700/60 text-emerald-400 bg-emerald-950/30' : 'border-stone-700 text-stone-400'
                          }`}>
                            {!integrations.bot?.enabled ? '未設定' : integrations.bot?.connected ? `接続中: ${integrations.bot.botTag}` : '切断中'}
                          </span>
                        </div>
                        <p className="text-stone-400 leading-relaxed">
                          Discord のチャンネルで <code className="px-1 py-0.5 rounded bg-stone-800 text-amber-300">/setup</code> を実行すると、そのチャンネルと asdfbase のチャンネルが双方向に同期されます。
                          メッセージと画像は転送され、動画は「(動画が送信されています)」と表示されます。解除は <code className="px-1 py-0.5 rounded bg-stone-800 text-amber-300">/unsetup</code>。
                        </p>
                        {integrations.bot?.guildName && <div className="text-stone-500">サーバー: {integrations.bot.guildName}</div>}
                        {integrations.bot?.intentWarning && <div className="text-amber-300">⚠ {integrations.bot.intentWarning}</div>}
                        {integrations.bot?.lastError && <div className="text-red-400">エラー: {integrations.bot.lastError}</div>}
                        <div className="space-y-1">
                          {(integrations.bot?.bindings || []).length === 0 ? (
                            <div className="text-stone-500">同期中のチャンネルはありません</div>
                          ) : (
                            integrations.bot.bindings.map((b: any) => (
                              <div key={b.discordChannelId} className="flex items-center gap-2 p-2 rounded-lg bg-[#16181D] border border-stone-800">
                                <span className="text-indigo-300">Discord #{b.discordChannelName}</span>
                                <span className="text-stone-600">⇔</span>
                                <span className="text-amber-300">asdfbase #{b.asdfChannelName}</span>
                              </div>
                            ))
                          )}
                        </div>
                        <button onClick={loadIntegrations} className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center gap-1.5">
                          <RefreshCw className="w-3 h-3" /> 状態を更新
                        </button>
                      </div>

                      {/* Webhooks */}
                      {([
                        { key: 'importantWebhookUrl', kind: 'important', title: '重要通知用 Webhook', desc: '提出物の登録・締切変更、@everyone、ピン留めなど重要な通知だけを送ります。' },
                        { key: 'messageWebhookUrl', kind: 'message', title: 'メッセージ用 Webhook', desc: 'Bot の同期が設定されていないチャンネルのメッセージ・画像をこの Webhook に送ります (任意)。' },
                      ] as const).map(w => (
                        <div key={w.key} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                          <div className="text-white font-bold text-sm">{w.title}</div>
                          <p className="text-stone-400 leading-relaxed">{w.desc}</p>
                          <input
                            type="url"
                            placeholder="https://discord.com/api/webhooks/..."
                            value={integrations[w.key] || ''}
                            onChange={e => setIntegrations((prev: any) => ({ ...prev, [w.key]: e.target.value }))}
                            className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveIntegrations({ [w.key]: (integrations[w.key] || '').trim() })}
                              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => testIntegration(w.kind)}
                              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold rounded-xl transition"
                            >
                              テスト送信
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* 4. 監査ログ & 復元 */}
              {settingsSection === 'audit' && (
                <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 text-xs space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-white font-bold text-sm mr-auto">監査ログ</span>
                    <select
                      value={auditFilter}
                      onChange={e => {
                        setAuditFilter(e.target.value);
                        loadAuditLogs(e.target.value);
                      }}
                      className="bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1.5 text-stone-200 focus:outline-none"
                    >
                      <option value="">すべて</option>
                      <option value="login">ログイン</option>
                      <option value="message">メッセージ</option>
                      <option value="assignment">提出物</option>
                      <option value="timetable">時間割</option>
                      <option value="channel">チャンネル</option>
                      <option value="discord">Discord</option>
                      <option value="settings">設定</option>
                    </select>
                    <button onClick={() => loadAuditLogs()} className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300" title="更新">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    {currentUser?.role === 'admin' && (
                      <button
                        onClick={clearAuditLogs}
                        className="px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-900 text-red-300 hover:bg-red-900/40"
                      >
                        履歴を全削除
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-stone-800/60">
                    {auditLogs.length === 0 ? (
                      <div className="py-6 text-center text-stone-500">監査ログはありません</div>
                    ) : (
                      auditLogs.map(log => {
                        const details = typeof log.details === 'string' ? (() => { try { return JSON.parse(log.details); } catch { return {}; } })() : (log.details || {});
                        const isOpen = expandedAuditId === log.id;
                        const extra = Object.entries(details).filter(([k]) => k !== 'message');
                        return (
                          <div key={log.id} className="py-2">
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => setExpandedAuditId(isOpen ? null : log.id)}
                                className="flex-1 min-w-0 text-left"
                              >
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="text-stone-500 tabular-nums">
                                    {new Date(log.created_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                  <span className="text-amber-400 font-bold">{log.username || 'system'}</span>
                                  <span className="text-stone-200">{details.message || `${log.action} (${log.target_type})`}</span>
                                  {log.restored && <span className="text-emerald-400">[復元済み]</span>}
                                </div>
                                <div className="text-[10px] text-stone-600">{log.action}{log.target_id ? ` #${log.target_id}` : ''}{extra.length > 0 ? (isOpen ? ' ▲' : ' ▼ 詳細') : ''}</div>
                              </button>
                              {log.can_restore && !log.restored && (
                                <button
                                  onClick={() => handleRestoreAuditLog(log.id)}
                                  className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[10px] shrink-0"
                                >
                                  復元
                                </button>
                              )}
                              {currentUser?.role === 'admin' && (
                                <button
                                  onClick={() => deleteAuditLog(log.id)}
                                  className="p-1 rounded text-stone-600 hover:text-red-400 shrink-0"
                                  title="このログだけ削除"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {isOpen && extra.length > 0 && (
                              <div className="mt-1.5 ml-1 p-2.5 rounded-lg bg-[#16181D] border border-stone-800 space-y-1">
                                {extra.map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <span className="text-stone-500 shrink-0 w-24">{k}</span>
                                    <span className="text-stone-300 whitespace-pre-wrap break-all">
                                      {typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 画像ビューア: クリックで拡大・ホイール/ボタンでズーム・ダウンロード */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex flex-col"
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center justify-end gap-2 p-3 shrink-0" onClick={e => e.stopPropagation()}>
            <span className="mr-auto text-xs text-stone-400">{Math.round(lightbox.zoom * 100)}%</span>
            <button
              onClick={() => setLightbox(l => (l ? { ...l, zoom: Math.max(0.25, l.zoom / 1.25) } : l))}
              className="p-2 rounded-lg bg-stone-900/80 border border-stone-700 text-stone-200 hover:text-amber-400"
              title="縮小"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLightbox(l => (l ? { ...l, zoom: 1 } : l))}
              className="px-2.5 py-2 rounded-lg bg-stone-900/80 border border-stone-700 text-stone-200 hover:text-amber-400 text-xs"
              title="等倍に戻す"
            >
              1:1
            </button>
            <button
              onClick={() => setLightbox(l => (l ? { ...l, zoom: Math.min(6, l.zoom * 1.25) } : l))}
              className="p-2 rounded-lg bg-stone-900/80 border border-stone-700 text-stone-200 hover:text-amber-400"
              title="拡大"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <a
              href={lightbox.src}
              download={lightbox.src.split('/').pop() || 'image.webp'}
              className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black flex items-center gap-1 text-xs font-bold"
              title="ダウンロード"
            >
              <Download className="w-4 h-4" /> 保存
            </a>
            <button
              onClick={() => setLightbox(null)}
              className="p-2 rounded-lg bg-stone-900/80 border border-stone-700 text-stone-200 hover:text-white"
              title="閉じる (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div
            className="flex-1 min-h-0 overflow-auto flex p-4"
            onWheel={e => {
              const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
              setLightbox(l => (l ? { ...l, zoom: Math.min(6, Math.max(0.25, l.zoom * factor)) } : l));
            }}
          >
            <img
              src={lightbox.src}
              alt="拡大画像"
              onClick={e => e.stopPropagation()}
              onDoubleClick={() => setLightbox(l => (l ? { ...l, zoom: l.zoom === 1 ? 2 : 1 } : l))}
              // 拡大時は実サイズを大きくしてスクロールで見回せるようにする
              style={lightbox.zoom === 1 ? undefined : { width: `${lightbox.zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }}
              className="m-auto max-w-full max-h-full object-contain select-none"
              draggable={false}
            />
          </div>
        </div>
      )}

      {/* カメラ小窓 (実機WebRTCカメラプレビュー) */}
      {/* 4. カメラ小窓 & フロント/バック切り替え */}
      {showCamera && (
        <div className="fixed bottom-4 right-4 w-72 bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden z-50">
          <div className="p-2.5 border-b border-stone-800 flex items-center justify-between text-xs font-mono text-stone-400">
            <span className="flex items-center gap-1.5 font-bold text-white">
              <Camera className="w-3.5 h-3.5 text-amber-400" /> カメラ ({cameraFacingMode === 'user' ? 'フロント' : 'バック'})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCameraFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
                title="フロント/バック切り替え"
                className="p-1 rounded bg-stone-900 border border-stone-700 hover:text-amber-400 text-stone-300 transition flex items-center gap-1 text-[10px]"
              >
                <SwitchCamera className="w-3 h-3 text-amber-400" />
                <span>切替</span>
              </button>
              <button onClick={() => setShowCamera(false)} className="text-stone-500 hover:text-white">&times;</button>
            </div>
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
                className={`w-full h-full object-cover ${cameraFacingMode === 'user' ? 'scale-x-[-1]' : ''}`}
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

      {/* 時間割専用エディタモーダル (週間グリッド & ワンタップ編集) */}
      {isTimetableModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4" onClick={() => setIsTimetableModalOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-5xl bg-[#111214] border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden text-xs max-h-[94vh] flex flex-col"
          >
            <div className="p-3 sm:p-4 border-b border-stone-800 flex flex-wrap items-center gap-2 bg-stone-900/60">
              <BookOpen className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-white text-sm mr-2">時間割</span>
              <span className="text-stone-500">今日の時程 (全員共通):</span>
              <div className="flex gap-1">
                {(Object.keys(SCHEDULE_LABELS) as ScheduleType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => handleSetTodaySchedule(t)}
                    className={`px-2.5 py-1 rounded-lg border transition ${
                      todaySchedule === t ? 'bg-amber-500 text-black font-bold border-amber-500' : 'border-stone-800 text-stone-400 hover:text-white'
                    }`}
                  >
                    {SCHEDULE_LABELS[t]}
                  </button>
                ))}
              </div>
              <span className="ml-auto hidden sm:inline text-amber-300 font-bold">
                {schoolStatus.label}{schoolStatus.sub ? ` (${schoolStatus.sub})` : ''}
              </span>
              <button onClick={() => setIsTimetableModalOpen(false)} className="text-stone-500 hover:text-white transition ml-2" title="閉じる (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
              {/* 左: 週間グリッド */}
              <div className="flex-1 min-w-0 min-h-0 overflow-auto p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-stone-400 font-bold">編集する時程:</span>
                  {(Object.keys(SCHEDULE_LABELS) as ScheduleType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => {
                        setScheduleType(t);
                        setIsEditingPeriods(false);
                      }}
                      className={`px-2.5 py-1 rounded-lg border transition ${
                        scheduleType === t ? 'bg-stone-200 text-black font-bold border-stone-200' : 'border-stone-800 text-stone-400 hover:text-white'
                      }`}
                    >
                      {SCHEDULE_LABELS[t]}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setPeriodDraft((periodTimes[scheduleType] || []).map(p => ({ ...p })));
                      setIsEditingPeriods(v => !v);
                    }}
                    className="ml-auto px-2.5 py-1 rounded-lg border border-stone-800 text-stone-300 hover:border-amber-500/50 hover:text-amber-300 flex items-center gap-1"
                  >
                    <CalendarClock className="w-3.5 h-3.5" /> {isEditingPeriods ? '時刻の編集を閉じる' : '時刻を編集'}
                  </button>
                </div>

                {isEditingPeriods && (
                  <div className="p-3 rounded-xl bg-[#16181D] border border-stone-800 space-y-2">
                    <div className="text-stone-300 font-bold">{SCHEDULE_LABELS[scheduleType]} の各時限の時刻</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {periodDraft.map((p, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="w-8 text-amber-400 font-bold">{i + 1}限</span>
                          <input
                            type="time"
                            value={p.start}
                            onChange={e => setPeriodDraft(d => d.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                            className="bg-[#111214] border border-stone-800 rounded px-1.5 py-1 text-white"
                          />
                          <span className="text-stone-500">〜</span>
                          <input
                            type="time"
                            value={p.end}
                            onChange={e => setPeriodDraft(d => d.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                            className="bg-[#111214] border border-stone-800 rounded px-1.5 py-1 text-white"
                          />
                        </div>
                      ))}
                    </div>
                    <button onClick={handleSavePeriodTimes} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg">
                      時刻を保存
                    </button>
                  </div>
                )}

                <div className="overflow-x-auto rounded-xl border border-stone-800 bg-[#0C0D10]">
                  <table className="w-full text-center border-collapse min-w-[520px]">
                    <thead>
                      <tr className="bg-stone-900/80 border-b border-stone-800 text-stone-400">
                        <th className="py-2 px-2 w-20 border-r border-stone-800 font-bold">時限</th>
                        {[1, 2, 3, 4, 5].map(day => (
                          <th
                            key={day}
                            className={`py-2 px-2 border-r border-stone-800 last:border-r-0 font-bold ${
                              nowForStatus.getDay() === day ? 'text-amber-300 bg-amber-500/10' : 'text-white'
                            }`}
                          >
                            {DAY_LABELS[day]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4, 5, 6, 7].map(period => {
                        const pt = periodTimes[scheduleType]?.[period - 1];
                        return (
                          <tr key={period} className="border-b border-stone-800/80">
                            <td className="py-1.5 px-2 border-r border-stone-800 bg-stone-950/40">
                              <div className="font-bold text-amber-500/90">{period}限</div>
                              {pt && <div className="text-[10px] text-stone-500 tabular-nums">{pt.start}〜{pt.end}</div>}
                            </td>
                            {[1, 2, 3, 4, 5].map(day => {
                              const existing = timetables.find(tt => tt.day_of_week === day && tt.period === period);
                              const isSelected = selectedTtCell?.day === day && selectedTtCell?.period === period;
                              return (
                                <td
                                  key={day}
                                  onClick={() => selectTtCell(day, period)}
                                  className={`p-1 border-r border-stone-800 last:border-r-0 cursor-pointer transition align-top ${
                                    isSelected ? 'bg-amber-500/20 ring-1 ring-inset ring-amber-500' : 'hover:bg-stone-900/60'
                                  }`}
                                >
                                  {existing ? (
                                    <div className="px-1.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left min-h-[40px]">
                                      <div className="text-amber-200 font-bold truncate">{existing.subject}</div>
                                      {(existing.items || existing.note) && (
                                        <div className="text-[10px] text-stone-400 truncate flex items-center gap-1">
                                          {existing.items && <Backpack className="w-2.5 h-2.5 shrink-0" />}
                                          {existing.items || existing.note}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="min-h-[40px] flex items-center justify-center text-stone-700 text-[11px]">+</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {ttSaveStatus && <div className="text-emerald-400">{ttSaveStatus}</div>}
              </div>

              {/* 右: 選択中のコマ (プリセットはワンクリックで即保存) */}
              <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-stone-800 p-3 sm:p-4 space-y-3 overflow-y-auto max-h-[45vh] lg:max-h-none">
                {!selectedTtCell ? (
                  <div className="text-stone-500 leading-relaxed">
                    表のマスをクリックすると、教科・持ち物・メモを入力できます。<br />
                    教科のプリセットは押した瞬間に保存され、次のコマへ進みます。
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-white font-bold text-sm">
                        {DAY_LABELS[selectedTtCell.day]}曜 {selectedTtCell.period}限
                        <span className="text-stone-500 font-normal ml-1">({SCHEDULE_LABELS[scheduleType]})</span>
                      </span>
                      <button onClick={() => setSelectedTtCell(null)} className="text-stone-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {['国語', '数学', '英語', '物理', '化学', '生物', '日本史', '世界史', '地理', '情報', '体育', '美術', '音楽', 'HR', '自習'].map(subj => (
                        <button
                          type="button"
                          key={subj}
                          onClick={() => handlePresetSubject(subj)}
                          className={`px-2 py-1 rounded border transition ${
                            ttDetailDraft.subject === subj
                              ? 'bg-amber-500 text-black font-bold border-amber-400'
                              : 'bg-[#16181D] border-stone-800 text-stone-300 hover:text-white hover:border-stone-600'
                          }`}
                        >
                          {subj}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-stone-400">教科</span>
                        <input
                          value={ttDetailDraft.subject}
                          onChange={e => setTtDetailDraft(d => ({ ...d, subject: e.target.value }))}
                          placeholder="例: 数学A"
                          className="mt-1 w-full bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60"
                        />
                      </label>
                      <label className="block">
                        <span className="text-stone-400 flex items-center gap-1"><Backpack className="w-3 h-3" /> 持ち物</span>
                        <textarea
                          value={ttDetailDraft.items}
                          onChange={e => setTtDetailDraft(d => ({ ...d, items: e.target.value }))}
                          rows={2}
                          placeholder="例: 教科書、ワーク、関数電卓"
                          className="mt-1 w-full bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60 resize-none"
                        />
                      </label>
                      <label className="block">
                        <span className="text-stone-400">メモ・詳細</span>
                        <textarea
                          value={ttDetailDraft.note}
                          onChange={e => setTtDetailDraft(d => ({ ...d, note: e.target.value }))}
                          rows={3}
                          placeholder="例: 教室移動 (理科室)、小テストあり"
                          className="mt-1 w-full bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60 resize-none"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveTtDetail}
                        disabled={!ttDetailDraft.subject.trim()}
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold rounded-lg"
                      >
                        保存
                      </button>
                      {(() => {
                        const existing = timetables.find(t => t.day_of_week === selectedTtCell.day && t.period === selectedTtCell.period);
                        return existing ? (
                          <button
                            onClick={() => handleDeleteTimetableEntry(existing.id)}
                            className="px-3 py-2 rounded-lg bg-stone-800 hover:bg-red-950/50 text-stone-300 hover:text-red-300"
                            title="このコマを削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : null;
                      })()}
                    </div>
                  </>
                )}

                {/* 今日の持ち物 (確認用) */}
                <div className="pt-3 border-t border-stone-800 space-y-1.5">
                  <div className="text-stone-300 font-bold flex items-center gap-1"><Backpack className="w-3.5 h-3.5 text-amber-400" /> 今日の持ち物・メモ</div>
                  {todayRows.filter(t => (t.items && t.items.trim()) || (t.note && t.note.trim())).length === 0 ? (
                    <div className="text-stone-500">{nowForStatus.getDay() === 0 || nowForStatus.getDay() === 6 ? '今日は休みです' : '登録されていません'}</div>
                  ) : (
                    todayRows
                      .filter(t => (t.items && t.items.trim()) || (t.note && t.note.trim()))
                      .sort((a, b) => a.period - b.period)
                      .map(t => (
                        <div key={t.id} className="p-2 rounded-lg bg-[#16181D] border border-stone-800">
                          <div className="text-amber-300 font-bold">{t.period}限 {t.subject}</div>
                          {t.items && <div className="text-stone-300 whitespace-pre-wrap">🎒 {t.items}</div>}
                          {t.note && <div className="text-stone-400 whitespace-pre-wrap">📝 {t.note}</div>}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 提出物編集モーダル */}
      {editingAssignment && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-lg bg-[#111214] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden interactive-card font-mono text-xs flex flex-col max-h-[85vh]"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                <Edit3 className="w-4 h-4 text-amber-400" />
                <span>提出物の編集</span>
              </div>
              <button 
                onClick={() => setEditingAssignment(null)}
                className="text-stone-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateAssignment} className="p-4 space-y-3 overflow-y-auto flex-1">
              <div>
                <label className="text-[10px] text-stone-400 block mb-1">タイトル *</label>
                <input
                  type="text"
                  required
                  value={editingAssignment.title}
                  onChange={e => setEditingAssignment({ ...editingAssignment, title: e.target.value })}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">教科 *</label>
                  <select
                    value={editingAssignment.subject}
                    onChange={e => setEditingAssignment({ ...editingAssignment, subject: e.target.value })}
                    className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    {['国語', '数学', '英語', '理科', '社会', '情報', '保健体育', '美術', '音楽', 'その他'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">提出締切日 *</label>
                  <input
                    type="date"
                    required
                    value={editingAssignment.deadline ? editingAssignment.deadline.slice(0, 10) : ''}
                    onChange={e => setEditingAssignment({ ...editingAssignment, deadline: e.target.value })}
                    className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-stone-400 block mb-1">再提出締切日 (任意)</label>
                <input
                  type="date"
                  value={editingAssignment.resubmit_deadline ? editingAssignment.resubmit_deadline.slice(0, 10) : ''}
                  onChange={e => setEditingAssignment({ ...editingAssignment, resubmit_deadline: e.target.value || undefined })}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] text-stone-400 block mb-1">指示文・持ち物・注意事項</label>
                <textarea
                  value={editingAssignment.description || ''}
                  onChange={e => setEditingAssignment({ ...editingAssignment, description: e.target.value })}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-3 text-white focus:outline-none resize-none h-24"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-stone-800">
                <button
                  type="button"
                  onClick={() => setEditingAssignment(null)}
                  className="px-4 py-2 rounded-xl bg-stone-900 border border-stone-800 text-stone-300 hover:text-white transition"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition"
                >
                  保存する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 提出物のメンバー別進捗確認モーダル */}
      {showMemberProgressModalId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-lg bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden interactive-card font-mono text-xs flex flex-col max-h-[85vh]"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between bg-stone-900/60">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-white text-sm">メンバー別提出状況</span>
              </div>
              <button 
                onClick={() => setShowMemberProgressModalId(null)}
                className="text-stone-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {(() => {
                const targetAssignment = assignments.find(a => a.id === showMemberProgressModalId);
                const progressList = assignmentMembersProgress[showMemberProgressModalId] || [];
                const passedCount = progressList.filter(p => p.status === 'passed').length;
                const submittedCount = progressList.filter(p => p.status === 'submitted').length;
                const total = progressList.length || 1;
                const rate = Math.round(((passedCount + submittedCount) / total) * 100);

                return (
                  <div className="space-y-4">
                    {targetAssignment && (
                      <div className="bg-[#16181D] p-3 rounded-xl border border-stone-800">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-bold">
                            {targetAssignment.subject}
                          </span>
                          <span className="font-bold text-white text-sm">{targetAssignment.title}</span>
                        </div>
                        <div className="text-[11px] text-stone-400">
                          締切: {new Date(targetAssignment.deadline).toLocaleDateString()}
                        </div>
                        {/* 進捗プログレスバー */}
                        <div className="mt-2.5 space-y-1">
                          <div className="flex justify-between text-[10px] text-stone-400 font-bold">
                            <span>提出率: {rate}%</span>
                            <span>{passedCount + submittedCount} / {total} 人完了</span>
                          </div>
                          <div className="h-2 rounded-full bg-stone-900 border border-stone-800 overflow-hidden flex">
                            <div style={{ width: `${(passedCount / total) * 100}%` }} className="bg-emerald-500" title="合格" />
                            <div style={{ width: `${(submittedCount / total) * 100}%` }} className="bg-sky-500" title="提出済み" />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-stone-400 uppercase tracking-wider px-1">メンバー一覧</div>
                      {progressList.length === 0 ? (
                        <div className="p-4 text-center text-stone-600 bg-[#16181D] rounded-xl border border-stone-800">
                          進捗データがまだありません
                        </div>
                      ) : (
                        progressList.map(member => {
                          const statusConfig: Record<string, { label: string; cls: string }> = {
                            passed: { label: '合格', cls: 'bg-emerald-950/60 border-emerald-800 text-emerald-300 font-bold' },
                            submitted: { label: '提出済み', cls: 'bg-sky-950/60 border-sky-800 text-sky-300 font-bold' },
                            in_progress: { label: '進行中', cls: 'bg-amber-950/60 border-amber-800 text-amber-300' },
                            resubmit: { label: '再提出', cls: 'bg-red-950/60 border-red-800 text-red-300 font-bold' },
                            unstarted: { label: '未着手', cls: 'bg-stone-900 border-stone-800 text-stone-500' }
                          };
                          const conf = statusConfig[member.status] || statusConfig.unstarted;

                          return (
                            <div
                              key={member.userId}
                              className="flex items-center justify-between p-2.5 bg-[#16181D] border border-stone-800/80 rounded-xl"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center text-white font-bold text-xs uppercase">
                                  {member.username.slice(0, 1)}
                                </div>
                                <span className="font-bold text-white text-xs">{member.username}</span>
                              </div>
                              <span className={`px-2.5 py-1 rounded-lg border text-[11px] ${conf.cls}`}>
                                {conf.label}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="p-3 border-t border-stone-800 flex justify-end bg-stone-900/60">
              <button
                type="button"
                onClick={() => setShowMemberProgressModalId(null)}
                className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-xl transition"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提出物AI要約フローティングモーダル (JSON解析 & リッチ表示) */}
      {floatingAiSummary && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-xl bg-[#111214] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden interactive-card font-mono text-xs flex flex-col max-h-[85vh]"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-2 text-amber-300 font-bold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Gemini AI 要約: {floatingAiSummary.title}</span>
              </div>
              <button 
                onClick={() => setFloatingAiSummary(null)}
                className="text-stone-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto flex-1 select-text">
              {(() => {
                let parsed: any = null;
                try {
                  const clean = floatingAiSummary.summary.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                  if (clean.startsWith('{') && clean.endsWith('}')) {
                    parsed = JSON.parse(clean);
                  }
                } catch {}

                if (parsed && typeof parsed === 'object') {
                  return (
                    <div className="space-y-3 font-sans text-xs">
                      {parsed.title && (
                        <div className="text-sm font-bold text-amber-300 font-mono pb-1 border-b border-stone-800">
                          {parsed.title}
                        </div>
                      )}
                      {parsed.summary && (
                        <div className="bg-[#16181D] border border-stone-800 p-3 rounded-xl leading-relaxed text-stone-200">
                          {parsed.summary}
                        </div>
                      )}
                      {Object.entries(parsed).filter(([k]) => !['title', 'summary'].includes(k)).map(([key, val]) => {
                        const keyLabel = key === 'deadline' ? '締切' : key === 'items' ? '持ち物' : key === 'points' ? '重要事項' : key;
                        return (
                          <div key={key} className="bg-[#14161C] border border-stone-800/80 p-3 rounded-xl">
                            <div className="text-[10px] font-mono uppercase font-bold text-amber-400 mb-1">{keyLabel}</div>
                            {Array.isArray(val) ? (
                              <ul className="list-disc list-inside space-y-1 text-stone-300">
                                {val.map((item, idx) => (
                                  <li key={idx}>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-stone-300">{String(val)}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div className="prose prose-invert prose-xs max-w-none text-stone-200 font-sans leading-relaxed whitespace-pre-wrap">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {floatingAiSummary.summary}
                    </ReactMarkdown>
                  </div>
                );
              })()}
            </div>

            <div className="p-3 border-t border-stone-800 flex justify-end gap-2 bg-[#16181D]">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(floatingAiSummary.summary);
                  alert('クリップボードに要約内容をコピーしました！');
                }}
                className="px-3 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-white rounded-lg transition flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5 text-amber-400" />
                <span>コピー</span>
              </button>
              <button
                type="button"
                onClick={() => setFloatingAiSummary(null)}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* メモAI処理結果モーダル (反映ボタン付き) */}
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
            <div className="p-3 border-t border-stone-800 flex items-center justify-between bg-[#16181D]">
              <button
                type="button"
                onClick={() => {
                  handleMemoContentChange(memoAiResultModal);
                  setMemoAiResultModal(null);
                  alert('現在のメモにAI処理結果を反映しました！');
                }}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm"
                title="現在のメモをこの結果で上書き反映"
              >
                <Check className="w-3.5 h-3.5" />
                <span>メモに反映する</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(memoAiResultModal);
                    alert('クリップボードにコピーしました！');
                  }}
                  className="px-3 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-white rounded-lg transition flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5 text-amber-400" />
                  <span>コピー</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMemoAiResultModal(null)}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg transition"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
