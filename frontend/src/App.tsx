import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
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
  Menu,
  Umbrella,
  Undo2,
  BellRing,
  WifiOff,
  ChevronDown,
  BookOpenCheck,
  Square,
  Shield,
  Server,
  Smile,
  Upload,
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
import { UiHost, HoverCard, Modal, confirmDialog, toast } from './ui';
import {
  DEFAULT_CONFIG, SCHEDULE_LABELS, DAY_LABELS, MAX_PERIODS, SUBJECTS, CLASS_NUMBERS,
  computeSchoolStatus, daySlots, periodCountFor, closingFor,
  type ScheduleType, type ScheduleDef, type TimetableConfig, type TimetableItem,
} from './schedule';
import {
  renderMessageText, renderComposerHighlight, findCompletionToken, rankCandidates,
  DiscordBadge, splitSenderName, memoSlotId, toProxiedMediaUrl,
  BUILTIN_SHORTCODES, type CustomEmojiItem, SmartMarkdown, renderEmojiToken, resolveEmojiUrl,
} from './chatText';
import { ReactionBar, DEFAULT_QUICK_EMOJIS, renderReactionEmoji } from './Reactions';
import HomeworkTab, { type Homework } from './HomeworkTab';
import { drawStroke, drawText, playTimelapse, timelapsePlan } from './boardTimelapse';
import { setFaviconBadge } from './favicon';
import AiTab from './AiTab';
import TestScoresTab from './TestScoresTab';
import HelpTab from './HelpTab';
import { WeatherDetail, WeatherHoverSummary, weatherIcon, type WeatherInfo } from './WeatherPanel';
import { CalendarHoverSummary, CalendarPanel, monthRange, ymd, type CalendarEvent } from './CalendarPanel';

interface User {
  id: number;
  username: string;
  role: string;
  status: string;
  avatar_url?: string | null;
  class_no?: number | null;
  custom_roles?: string[];
  preferences?: Record<string, any>;
}

interface RoleDefinition {
  id: string;
  name: string;
  color: string;
  system?: boolean;
}

interface ChannelItem {
  id: number;
  name: string;
  type: string;
  server_id?: string | null;
  view_roles?: string[];
  write_roles?: string[];
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
  edited_at?: string | null;
  // Discord から来たメッセージのアイコン (サーバーに保存済みの /uploads/...)
  author_avatar?: string | null;
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
// 確定メッセージは常に ID 順 (再接続時の取りこぼし補完が後から届いても並びが崩れない)
function mergeIncomingMessage(prev: Message[], msg: Message): Message[] {
  const exists = prev.some(m => m.id === msg.id);
  const nonceIdx = msg.client_nonce ? prev.findIndex(m => m.id < 0 && m.client_nonce === msg.client_nonce) : -1;
  const base = nonceIdx >= 0 ? [...prev.slice(0, nonceIdx), ...prev.slice(nonceIdx + 1)] : prev;
  if (exists) return base;
  // 送信中メッセージは常に末尾に保つ
  const firstPending = base.findIndex(m => m.id < 0);
  let idx = firstPending === -1 ? base.length : firstPending;
  while (idx > 0 && base[idx - 1].id > msg.id) idx--;
  return [...base.slice(0, idx), msg, ...base.slice(idx)];
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

// アイコン画像があれば画像、なければ頭文字
function Avatar({ name, url, size = 'w-9 h-9 text-sm', dim = false }: { name: string; url?: string | null; size?: string; dim?: boolean }) {
  const clean = name.replace('[Discord] ', '');
  if (url) {
    return <img src={url} alt="" loading="lazy" className={`${size} rounded-full object-cover shrink-0 border border-stone-800 ${dim ? 'opacity-50' : ''}`} />;
  }
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-bold uppercase shrink-0 border ${
      dim ? 'bg-stone-900 text-stone-600 border-stone-800' : clean === 'Gemini' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : avatarColorFor(clean)
    }`}>
      {clean === 'Gemini' ? 'AI' : clean[0]}
    </div>
  );
}

const LS = {
  get(key: string, fallback = ''): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  },
};

type TabId = 'chat' | 'memo' | 'ai' | 'assignments' | 'homework' | 'board' | 'more' | 'settings' | 'help';
const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'chat', label: 'チャット', icon: MessageSquare },
  { id: 'memo', label: 'メモ', icon: FileText },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'assignments', label: '提出物', icon: CheckSquare },
  { id: 'homework', label: '宿題', icon: BookOpenCheck },
  { id: 'board', label: 'ボード', icon: Layout },
  { id: 'more', label: 'その他', icon: MoreHorizontal },
  { id: 'settings', label: '設定', icon: Settings },
  { id: 'help', label: 'ヘルプ', icon: HelpCircle },
];

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

// スマホの下部タブバーに直接出す主要4タブ (残りは「メニュー」に整理)
const MOBILE_MAIN_TABS: TabId[] = ['chat', 'memo', 'ai', 'homework'];

// ボードの描画領域 (全員共通の座標)。横長の画面に合わせて横を広めに取る
const BOARD_WIDTH = 2200;
const BOARD_HEIGHT = 1000;

interface Assignment {
  id: number;
  class_no?: number | null;
  title: string;
  subject: string;
  description?: string;
  deadline: string;
  resubmit_deadline?: string;
  my_status: 'unstarted' | 'in_progress' | 'submitted' | 'resubmit' | 'passed';
  is_archived: boolean;
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
  
  // Navigation Tabs (リロードしても同じタブを開く)
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    const saved = LS.get('asdf_active_tab') as TabId;
    return TABS.some(t => t.id === saved) ? saved : 'chat';
  });
  const setActiveTab = (tab: TabId) => {
    setActiveTabState(tab);
    setIsNotifyPopoverOpen(false);
    LS.set('asdf_active_tab', tab);
    syncPreferencesToServer({ activeTab: tab });
  };
  const isSmallScreen = () => typeof window !== 'undefined' && window.innerWidth < 768;

  // Header Data
  const [now, setNow] = useState<Date>(() => new Date());
  const [weather, setWeather] = useState<WeatherInfo>({ temp: null, desc: '取得中' });
  const [showWeather, setShowWeather] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [notifyBannerDismissed, setNotifyBannerDismissed] = useState(() => LS.get('asdf_notify_banner_dismissed') === '1');
  const [notifyPermission, setNotifyPermission] = useState<string>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string>('');

  // Memo AI State (校正だけはメモへ反映でき、反映前の内容に戻せる)
  const [isMemoAiLoading, setIsMemoAiLoading] = useState(false);
  const [memoAiResultModal, setMemoAiResultModal] = useState<{ type: 'summarize' | 'proofread' | 'explain_code'; result: string } | null>(null);
  const [memoUndo, setMemoUndo] = useState<{ slot: number; content: string } | null>(null);

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
  // @メンション / #チャンネル / :絵文字: の補完 (Tab・↑↓で選択、Enterで決定)
  const [completion, setCompletion] = useState<{ kind: '@' | '#' | ':'; query: string; start: number; index: number } | null>(null);
  const composerBackdropRef = useRef<HTMLDivElement | null>(null);
  // 入力中のユーザー (userId → 表示期限)
  const [typingUsers, setTypingUsers] = useState<Record<number, { username: string; channelId: number; until: number }>>({});
  const lastTypingSentRef = useRef(0);
  const [isMembersCollapsed, setIsMembersCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const [isChannelsCollapsed, setIsChannelsCollapsed] = useState(isSmallScreen);
  const [isMemoListOpen, setIsMemoListOpen] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(Boolean(localStorage.getItem('asdf_token')));
  const [isNewChannelModalOpen, setIsNewChannelModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelServerId, setNewChannelServerId] = useState<string>('');
  const [editingChannel, setEditingChannel] = useState<{ id: number; name: string } | null>(null);
  const [editChannelNameInput, setEditChannelNameInput] = useState('');

  // Discord サーバー連携・左レール・簡単紐付け・履歴取得ステート
  const [discordServers, setDiscordServers] = useState<any[]>([]);
  const [discordBindings, setDiscordBindings] = useState<any[]>([]);
  const [discordLinkRequests, setDiscordLinkRequests] = useState<any[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('1524703392927191100');
  const [showDiscordServerModal, setShowDiscordServerModal] = useState<boolean>(false);
  const [isSyncingDiscordHistory, setIsSyncingDiscordHistory] = useState<boolean>(false);
  const [linkGuildId, setLinkGuildId] = useState<string>('');
  const [linkDiscordChannelId, setLinkDiscordChannelId] = useState<string>('');
  const [linkAsdfChannelId, setLinkAsdfChannelId] = useState<string>('new');
  const [linkNewChannelName, setLinkNewChannelName] = useState<string>('');

  const discordUsernames = useMemo(() => {
    const s = new Set<string>();
    for (const srv of discordServers) {
      for (const m of (srv.members || [])) {
        if (m.displayName) s.add(m.displayName);
        if (m.username) s.add(m.username);
      }
    }
    return s;
  }, [discordServers]);

  // カスタム絵文字 & ピッカー・アップロード
  const [customEmojisList, setCustomEmojisList] = useState<CustomEmojiItem[]>([
    { name: 'swim', url: '/uploads/emoji-swim.svg' },
  ]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [emojiUploadName, setEmojiUploadName] = useState<string>('');
  const [emojiUploadFile, setEmojiUploadFile] = useState<File | null>(null);
  const [isUploadingEmoji, setIsUploadingEmoji] = useState<boolean>(false);

  // ロール定義 & チャンネルごと権限設定 (admin用)
  const [roleDefs, setRoleDefs] = useState<RoleDefinition[]>([
    { id: 'admin', name: '管理者', color: '#f43f5e', system: true },
    { id: 'member', name: 'メンバー', color: '#64748b', system: true },
  ]);
  const [channelPermModal, setChannelPermModal] = useState<ChannelItem | null>(null);
  const [showRoleManagerModal, setShowRoleManagerModal] = useState<boolean>(false);
  const [newRoleIdInput, setNewRoleIdInput] = useState<string>('');
  const [newRoleNameInput, setNewRoleNameInput] = useState<string>('');
  const [newRoleColorInput, setNewRoleColorInput] = useState<string>('#10b981');

  // Markdown プレビュー & エディタのスクロール同期用 Ref
  const memoTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const memoPreviewRef = useRef<HTMLDivElement | null>(null);
  const memoScrollLockRef = useRef<'editor' | 'preview' | null>(null);

  // お知らせ & 通知ポップオーバー
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isNotifyPopoverOpen, setIsNotifyPopoverOpen] = useState(false);
  const notifyPopoverContainerRef = useRef<HTMLDivElement | null>(null);
  const [isNewAnnouncementModalOpen, setIsNewAnnouncementModalOpen] = useState(false);
  const [newAnnouncementTitle, setNewAnnouncementTitle] = useState('');
  const [newAnnouncementContent, setNewAnnouncementContent] = useState('');
  const [newAnnouncementDiscord, setNewAnnouncementDiscord] = useState(true);
  const [lastReadAnnouncementTime, setLastReadAnnouncementTime] = useState<number>(() => {
    return Number(localStorage.getItem('asdf_last_read_announcement') || '0');
  });

  // モバイル メニューシート & スラッシュコマンド補完
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);

  // アカウント同期設定のサーバー保存 (デバウンス)
  // ※ 接続設定 (方式・ポーリング間隔・プロキシ/直結経路) は端末ごとに異なる環境用のためアカウント同期せず端末ローカルに保持
  const prefSyncTimerRef = useRef<any>(null);
  const pendingPrefsRef = useRef<Record<string, any>>({});
  const syncPreferencesToServer = (patch: Record<string, any>) => {
    // 接続設定関連のキーは絶対にアカウント同期に含めない
    const { rtTransport, rtPollInterval, connRoute, connectionRoute, ...allowedPatch } = patch;
    if (Object.keys(allowedPatch).length === 0) return;
    pendingPrefsRef.current = { ...pendingPrefsRef.current, ...allowedPatch };
    clearTimeout(prefSyncTimerRef.current);
    prefSyncTimerRef.current = setTimeout(() => {
      const tk = tokenRef.current;
      const body = pendingPrefsRef.current;
      pendingPrefsRef.current = {};
      if (!tk || Object.keys(body).length === 0) return;
      safeFetch(`/api/users/me/preferences?connId=${encodeURIComponent(realtimeRef.current?.connId || '')}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ preferences: body }),
      }).catch(() => {});
    }, 500);
  };

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
      return { important: true, messages: false, sound: false, ...JSON.parse(localStorage.getItem('asdf_notify_prefs') || '{}') };
    } catch {
      return { important: true, messages: false, sound: false };
    }
  });
  const notifyPrefsRef = useRef(notifyPrefs);
  notifyPrefsRef.current = notifyPrefs;
  const updateNotifyPrefs = (patch: Partial<{ important: boolean; messages: boolean; sound: boolean }>) => {
    const next = { ...notifyPrefsRef.current, ...patch };
    setNotifyPrefs(next);
    try { localStorage.setItem('asdf_notify_prefs', JSON.stringify(next)); } catch (_) {}
    syncPreferencesToServer({ notifyPrefs: next });
    if ((patch.important || patch.messages) && 'Notification' in window && Notification.permission === 'default') {
      requestNotifyPermission();
    }
  };
  const requestNotifyPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setNotifyPermission(result);
      if (result === 'granted') toast('通知をオンにしました', { kind: 'success' });
      else if (result === 'denied') toast('通知がブロックされました。アドレスバーのサイト設定から許可できます', { kind: 'error' });
    } catch (_) {}
  };
  const [integrations, setIntegrations] = useState<any>(null);
  const [integrationStatus, setIntegrationStatus] = useState('');
  const [auditFilter, setAuditFilter] = useState('');
  // '' = 全員 / 'system' = 操作者なし / ユーザーID
  const [auditUserFilter, setAuditUserFilter] = useState('');
  const [auditSummary, setAuditSummary] = useState<{ text: string; count: number } | null>(null);
  const [isSummarizingAudit, setIsSummarizingAudit] = useState(false);
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
  const [channels, setChannels] = useState<ChannelItem[]>([
    { id: 1, name: 'general', type: 'text' },
    { id: 2, name: 'homework', type: 'text' },
  ]);
  const [activeChannelId, setActiveChannelIdState] = useState<number>(() => Number(LS.get('asdf_active_channel', '1')) || 1);
  const setActiveChannelId = (id: number) => {
    setActiveChannelIdState(id);
    LS.set('asdf_active_channel', String(id));
    syncPreferencesToServer({ activeChannelId: id });
    if (isSmallScreen()) setIsChannelsCollapsed(true);
  };
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  // 自分宛て (メンション・返信・@everyone) の未読数。赤い数字はこれだけ
  const [mentionCounts, setMentionCounts] = useState<Record<number, number>>({});
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
  const [discordVcs, setDiscordVcs] = useState<{ guildName: string; channelName: string; channelId: string; members: { id: string; name: string; avatarUrl: string | null }[] }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  // 送信待ちの画像 (Ctrl+V / ドロップ / 画像ボタン)。入力欄の上に小さくプレビューする
  const [pendingImages, setPendingImages] = useState<{ id: string; file: File; url: string }[]>([]);
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
  // scheduleType: 時間割エディタで表示・編集中の時程 / ttConfig.activeScheduleType: 全員共通の「今日の時程」(その日だけ有効)
  const [scheduleType, setScheduleType] = useState<ScheduleType>('normal');
  const [ttConfig, setTtConfig] = useState<TimetableConfig>(DEFAULT_CONFIG);
  const todaySchedule = ttConfig.activeScheduleType;
  const [todayTimetables, setTodayTimetables] = useState<TimetableItem[]>([]);
  const [selectedTtCell, setSelectedTtCell] = useState<{ day: number; period: number } | null>(null);
  const [ttDetailDraft, setTtDetailDraft] = useState<{ subject: string; items: string; note: string }>({ subject: '', items: '', note: '' });
  const [ttSaveStatus, setTtSaveStatus] = useState('');
  const [isEditingPeriods, setIsEditingPeriods] = useState(false);
  const [periodDraft, setPeriodDraft] = useState<ScheduleDef | null>(null);
  const [timetables, setTimetables] = useState<TimetableItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'unstarted' | 'in_progress' | 'submitted' | 'passed'>('all');
  const [newAssignTitle, setNewAssignTitle] = useState('');
  const [newAssignSubject, setNewAssignSubject] = useState('数学');
  const [isAssignFormOpen, setIsAssignFormOpen] = useState(false);
  const [newAssignDeadline, setNewAssignDeadline] = useState('');
  const [newAssignResubmitDeadline, setNewAssignResubmitDeadline] = useState('');
  const [newAssignDesc, setNewAssignDesc] = useState('');
  const [isSummarizingAI, setIsSummarizingAI] = useState<number | null>(null);
  const [summarizedTexts, setSummarizedTexts] = useState<Record<number, string>>({});
  // 提出物の表示クラス ('mine' = 自分のクラス) と、登録するクラス (null = 全クラス共通)
  const [assignClassView, setAssignClassView] = useState<number | 'all' | 'mine'>('mine');
  const [newAssignClass, setNewAssignClass] = useState<number | null | 'mine'>('mine');
  // 宿題
  const [homework, setHomework] = useState<Homework[]>([]);
  // 時間割モーダルで表示・編集するクラス
  const [ttClassNo, setTtClassNo] = useState<number>(1);
  const ttClassNoRef = useRef(ttClassNo);
  ttClassNoRef.current = ttClassNo;
  const myClassRef = useRef<number | null>(null);
  myClassRef.current = currentUser?.class_no ?? null;

  // Phase 4 State: Collaborative Whiteboard
  const [boardStrokes, setBoardStrokes] = useState<any[]>([]);
  const [boardTexts, setBoardTexts] = useState<any[]>([]);
  const [drawColor, setDrawColor] = useState<string>('#f59e0b');
  const [brushWidth, setBrushWidth] = useState<number>(3);
  const [eraserWidth, setEraserWidth] = useState<number>(48);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStrokePoints, setCurrentStrokePoints] = useState<{ x: number; y: number }[]>([]);
  const [boardMode, setBoardMode] = useState<'draw' | 'eraser' | 'text'>('draw');
  const [newBoardText, setNewBoardText] = useState('');
  const [isTimelapsePlaying, setIsTimelapsePlaying] = useState(false);
  const [timelapseProgress, setTimelapseProgress] = useState(0);
  const stopTimelapseRef = useRef<(() => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Phase 4 State: Shared Clipboard
  const [clipboardText, setClipboardText] = useState<string>('');
  const [clipboardUpdatedBy, setClipboardUpdatedBy] = useState<string>('');
  const [isCopiedToOS, setIsCopiedToOS] = useState(false);
  const [isClipboardOpen, setIsClipboardOpen] = useState(() => !isSmallScreen());
  const clipboardTimerRef = useRef<any>(null);

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
  // チャンネルの読み込み状態 (失敗したら自動で再試行し、再接続時にも読み直す)
  const [channelLoadState, setChannelLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const channelLoadStateRef = useRef(channelLoadState);
  channelLoadStateRef.current = channelLoadState;
  const channelLoadSeqRef = useRef(0);
  // リンクから過去の位置を開いている間は、表示より新しいメッセージがある (新着は末尾に足さない)
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const hasNewerRef = useRef(false);
  hasNewerRef.current = hasNewerMessages;
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);
  const pendingJumpRef = useRef<{ channelId: number; context: any } | null>(null);
  // スマホ: メッセージ長押しの操作メニュー
  const [msgActionSheet, setMsgActionSheet] = useState<Message | null>(null);
  const msgLongPressRef = useRef<{ timer: any; x: number; y: number } | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const unreadMessageRef = useRef<HTMLDivElement | null>(null);

  // User Settings State (Persisted in localStorage)
  const [uiScale, setUiScale] = useState<number>(() => {
    const saved = localStorage.getItem('asdf_ui_scale');
    return saved ? parseFloat(saved) : 100;
  });
  const [chatAutoScrollMode, setChatAutoScrollMode] = useState<'always' | 'unread_anchor' | 'off'>(() => {
    // 旧設定値 (unread_stop / manual) も読み替える
    const v = LS.get('asdf_chat_scroll_mode', 'always');
    return v === 'unread_stop' || v === 'unread_anchor' ? 'unread_anchor' : v === 'manual' || v === 'off' ? 'off' : 'always';
  });
  // メモ自動保存までの待ち時間 (ミリ秒, 0 = 手動のみ)
  const [memoAutoSaveInterval, setMemoAutoSaveInterval] = useState<number>(() => {
    const v = parseInt(LS.get('asdf_memo_autosave_ms', ''), 10);
    return [0, 1000, 2000, 5000].includes(v) ? v : 1000;
  });
  const memoAutoSaveIntervalRef = useRef(memoAutoSaveInterval);
  memoAutoSaveIntervalRef.current = memoAutoSaveInterval;
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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
  const hasBeenOnlineRef = useRef(false);
  const lastRtStatusRef = useRef<RealtimeStatus>('connecting');
  const retryFailedMessagesRef = useRef<() => void>(() => {});
  // メモに未保存の変更があるか (他人の保存で上書きしない / 自動保存の対象)
  const memoDirtyRef = useRef(false);
  // チャンネルを開いた時点の最新ID。これより新しいメッセージだけ登場アニメーション
  const lastSeenAtMountRef = useRef(Number.MAX_SAFE_INTEGER);

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

  // 既読位置はサーバーにも保存して、他の端末 (スマホ ⇔ PC) と揃える。まとめて0.8秒ごとに送る
  const serverReadRef = useRef<Record<number, number>>({});
  const pendingReadsRef = useRef<Record<number, number>>({});
  const readFlushTimerRef = useRef<any>(null);
  const pushReadToServer = (channelId: number, messageId: number) => {
    if (messageId <= 0 || messageId <= (serverReadRef.current[channelId] || 0) || messageId <= (pendingReadsRef.current[channelId] || 0)) return;
    pendingReadsRef.current[channelId] = messageId;
    if (readFlushTimerRef.current) return;
    readFlushTimerRef.current = setTimeout(() => {
      readFlushTimerRef.current = null;
      const batch = pendingReadsRef.current;
      pendingReadsRef.current = {};
      const tk = tokenRef.current;
      if (!tk) return;
      for (const [ch, id] of Object.entries(batch)) {
        safeFetch(`/api/channels/${ch}/read?connId=${encodeURIComponent(realtimeRef.current?.connId || '')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
          body: JSON.stringify({ messageId: id }),
        })
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (d?.lastReadId) serverReadRef.current[Number(ch)] = Math.max(serverReadRef.current[Number(ch)] || 0, d.lastReadId);
          })
          .catch(() => {
            // 送れなかった分は次に既読にした時にまとめて送られる
          });
      }
    }, 800);
  };

  const markChannelRead = (channelId: number, messageId: number) => {
    setUnreadCounts(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    setMentionCounts(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    if (messageId > 0 && (lastReadMessageIdsRef.current[channelId] || 0) < messageId) {
      lastReadMessageIdsRef.current = { ...lastReadMessageIdsRef.current, [channelId]: messageId };
      setLastReadMessageIds(prev => ((prev[channelId] || 0) >= messageId ? prev : { ...prev, [channelId]: messageId }));
    }
    pushReadToServer(channelId, messageId);
  };

  useEffect(() => {
    try {
      localStorage.setItem('asdf_last_read', JSON.stringify(lastReadMessageIds));
    } catch (_) {}
  }, [lastReadMessageIds]);

  // 赤い数字はメンションだけ。普通の未読はハイライトのみ
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + (b || 0), 0);
  const totalMentions = Object.values(mentionCounts).reduce((a, b) => a + (b || 0), 0);
  useEffect(() => {
    document.title = totalMentions > 0 ? `(${totalMentions}) asdfbase` : totalUnread > 0 ? '• asdfbase' : 'asdfbase';
    setFaviconBadge(totalMentions);
  }, [totalUnread, totalMentions]);

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
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);



  // Weather (Takamatsu - via internal backend API to bypass external domain filters)
  // 取得に失敗したら 15秒 → 30秒 → … (最大5分) で取り直す。成功したら10分ごと
  const refetchWeatherRef = useRef<() => void>(() => {});
  const weatherFailedRef = useRef(false);
  useEffect(() => {
    let timer: any = null;
    let failures = 0;
    let cancelled = false;
    const run = async () => {
      clearTimeout(timer);
      let ok = false;
      try {
        const headers: Record<string, string> = {};
        if (tokenRef.current) headers['Authorization'] = `Bearer ${tokenRef.current}`;
        const res = await fetch(`${getApiBaseUrl()}/api/weather`, { cache: 'no-store', headers });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.temp === 'number' && data.source !== 'fallback') {
            if (!cancelled) setWeather({ ...data, desc: data.desc || '不明' });
            ok = true;
          }
        }
      } catch (e) {
        console.warn('Weather error:', e);
      }
      if (cancelled) return;
      // 取れなかった時は、前に取れていた情報があればそのまま表示しておく
      if (!ok) setWeather(prev => (prev.temp === null ? { temp: null, desc: '取得失敗' } : prev));
      weatherFailedRef.current = !ok;
      failures = ok ? 0 : failures + 1;
      timer = setTimeout(run, ok ? 600000 : Math.min(15000 * 2 ** (failures - 1), 300000));
    };
    refetchWeatherRef.current = () => {
      failures = 0;
      run();
    };
    run();
    const onOnline = () => {
      if (weatherFailedRef.current) refetchWeatherRef.current();
    };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
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

  const applySyncedPreferences = (prefs: Record<string, any> | undefined, isInitial = false) => {
    if (!prefs || typeof prefs !== 'object') return;
    if (typeof prefs.uiScale === 'number' && [75, 85, 100, 110].includes(prefs.uiScale)) {
      setUiScale(prefs.uiScale);
      LS.set('asdf_ui_scale', String(prefs.uiScale));
    }
    if (typeof prefs.chatAutoScrollMode === 'string' && ['always', 'unread_anchor', 'off'].includes(prefs.chatAutoScrollMode)) {
      setChatAutoScrollMode(prefs.chatAutoScrollMode as any);
      LS.set('asdf_chat_scroll_mode', prefs.chatAutoScrollMode);
    }
    if (typeof prefs.memoAutoSaveInterval === 'number' && [0, 1000, 2000, 5000].includes(prefs.memoAutoSaveInterval)) {
      setMemoAutoSaveInterval(prefs.memoAutoSaveInterval);
      LS.set('asdf_memo_autosave_ms', String(prefs.memoAutoSaveInterval));
    }
    if (prefs.notifyPrefs && typeof prefs.notifyPrefs === 'object') {
      const merged = { ...notifyPrefsRef.current, ...prefs.notifyPrefs };
      setNotifyPrefs(merged);
      try { localStorage.setItem('asdf_notify_prefs', JSON.stringify(merged)); } catch (_) {}
    }
    if (typeof prefs.lastReadAnnouncementTime === 'number' && prefs.lastReadAnnouncementTime > 0) {
      setLastReadAnnouncementTime(prev => {
        const next = Math.max(prev, prefs.lastReadAnnouncementTime);
        LS.set('asdf_last_read_announcement', String(next));
        return next;
      });
    }
    if (isInitial) {
      if (typeof prefs.activeTab === 'string' && TABS.some(t => t.id === prefs.activeTab)) {
        setActiveTabState(prefs.activeTab as TabId);
        LS.set('asdf_active_tab', prefs.activeTab);
      }
      if (typeof prefs.activeChannelId === 'number' && prefs.activeChannelId > 0) {
        setActiveChannelIdState(prefs.activeChannelId);
        LS.set('asdf_active_channel', String(prefs.activeChannelId));
      }
    }
  };

  // 通知ポップオーバーの外側クリックで閉じる
  useEffect(() => {
    if (!isNotifyPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (notifyPopoverContainerRef.current && !notifyPopoverContainerRef.current.contains(e.target as Node)) {
        setIsNotifyPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isNotifyPopoverOpen]);

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
      .then(data => {
        setCurrentUser(data);
        applySyncedPreferences(data?.preferences, true);
      })
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
    // 長時間開きっぱなしでも増え続けないように古いIDは捨てる
    if (processedMessageIdsRef.current.size > 3000) {
      processedMessageIdsRef.current = new Set(Array.from(processedMessageIdsRef.current).slice(-1500));
    }

    const me = currentUserRef.current;
    const isMine = Boolean(me && newMsg.user_id === me.id);
    const isActiveChannel = newMsg.channel_id === activeChannelIdRef.current;
    // リンクで過去の位置を見ている間は、新着を末尾に足さず「最新へ」から読み込む
    const isDetached = isActiveChannel && hasNewerRef.current;
    const isViewing = isActiveChannel && !isDetached && activeTabRef.current === 'chat' && !document.hidden;

    const isImportant = Boolean(
      me && !isMine && newMsg.sender_username !== me.username &&
      (newMsg.content?.includes(`@${me.username}`) || newMsg.content?.includes('@everyone') || newMsg.reply_to?.user_id === me.id)
    );
    if (newMsg.user_id) {
      setTypingUsers(prev => {
        if (!prev[newMsg.user_id]) return prev;
        const next = { ...prev };
        delete next[newMsg.user_id];
        return next;
      });
    }

    // 通知: 重要 (メンション・自分への返信・@everyone) と 通常メッセージ を別々に ON/OFF
    if (me && !isMine && newMsg.sender_username !== me.username) {
      const prefs = notifyPrefsRef.current;
      const sender = newMsg.sender_username || newMsg.username;
      const channelName = channelsRef.current.find(c => c.id === newMsg.channel_id)?.name || '';
      if (isImportant && prefs.important) {
        if (prefs.sound) playNotificationSound();
        showBrowserNotification(`${sender} からのメンション (#${channelName})`, summarizeContent(newMsg.content));
      } else if (prefs.messages && !isViewing) {
        showBrowserNotification(`${sender} (#${channelName})`, summarizeContent(newMsg.content));
      }
    }

    if (isDetached) {
      setNewBelowCount(c => c + 1);
    } else if (isActiveChannel) {
      setMessages(prev => {
        const next = mergeIncomingMessage(prev, newMsg);
        // 最下部を見ている間は、画面に持つメッセージを直近400件に抑える (上へスクロールすれば再取得)
        if (next.length > 500 && isNearBottomRef.current) {
          setHasMoreMessages(true);
          return next.slice(-400);
        }
        return next;
      });
      const mode = chatAutoScrollModeRef.current;
      // always: 常に最新へ / unread_anchor: 下端にいる時だけ / off: 自動スクロールしない
      if (isMine || mode === 'always' || (mode === 'unread_anchor' && isNearBottomRef.current)) {
        scheduleScrollToBottom();
      } else {
        setNewBelowCount(c => c + 1);
      }
    }

    if (isViewing || (isMine && !isDetached)) {
      markChannelRead(newMsg.channel_id, newMsg.id);
    } else {
      setUnreadCounts(prev => ({
        ...prev,
        [newMsg.channel_id]: (prev[newMsg.channel_id] || 0) + 1,
      }));
      if (isImportant) {
        setMentionCounts(prev => ({ ...prev, [newMsg.channel_id]: (prev[newMsg.channel_id] || 0) + 1 }));
      }
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
    // まだ読み込めていない (起動直後の失敗など) なら最初から読み込む
    if (channelLoadStateRef.current !== 'ready') {
      loadChannelMessagesRef.current(channelId);
      return;
    }
    // 過去の位置を見ている間は、表示中の範囲を崩さない
    if (hasNewerRef.current) return;
    try {
      const res = await safeFetch(`/api/channels/${channelId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${tk}` },
      });
      if (!res.ok || channelId !== activeChannelIdRef.current) return;
      const fresh: Message[] = await res.json();
      if (fresh.length === 0) return;
      const minId = fresh[0].id;
      setMessages(prev => {
        const confirmed = prev.filter(m => m.id > 0);
        const prevMax = confirmed.length ? confirmed[confirmed.length - 1].id : 0;
        const pending = prev.filter(m => m.id < 0 && !fresh.some(f => f.client_nonce && f.client_nonce === m.client_nonce));
        // 切断中に50件より多く届いた: 手元の古いログとの間が抜けるので、最新50件から表示し直す
        if (fresh.length >= 50 && prevMax > 0 && prevMax < minId) {
          setHasMoreMessages(true);
          return [...fresh, ...pending];
        }
        const older = confirmed.filter(m => m.id < minId);
        return [...older, ...fresh, ...pending];
      });
      fresh.forEach(m => {
        processedMessageIdsRef.current.add(m.id);
        if (m.id > lastSeenMessageIdRef.current) lastSeenMessageIdRef.current = m.id;
      });
      if (activeTabRef.current === 'chat' && !document.hidden) markChannelRead(channelId, fresh[fresh.length - 1].id);
    } catch (_) {}
  };
  const refreshActiveChannelRef = useRef(refreshActiveChannel);
  refreshActiveChannelRef.current = refreshActiveChannel;

  // 未読数と既読位置 (サーバー ⇔ この端末) を取り直す。最新のメッセージIDを返す
  const unreadCountsRef = useRef(unreadCounts);
  unreadCountsRef.current = unreadCounts;
  const refreshUnreadCounts = async (): Promise<number | null> => {
    const tk = tokenRef.current;
    if (!tk) return null;
    try {
      const res = await safeFetch('/api/channels/unread-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ lastRead: lastReadMessageIdsRef.current }),
      });
      if (!res.ok) return null;
      const rows: { channelId: number; lastMessageId: number; lastReadId: number | null; unread: number; mentions?: number }[] = await res.json();
      const counts: Record<number, number> = {};
      const mentions: Record<number, number> = {};
      const reads: Record<number, number> = {};
      const viewing = activeTabRef.current === 'chat' && !document.hidden && !hasNewerRef.current ? activeChannelIdRef.current : null;
      let maxId = 0;
      for (const r of rows) {
        maxId = Math.max(maxId, r.lastMessageId);
        if (r.lastReadId == null) {
          // どの端末でも開いたことがないチャンネル: それまでの履歴は既読扱い
          reads[r.channelId] = r.lastMessageId;
          continue;
        }
        serverReadRef.current[r.channelId] = Math.max(serverReadRef.current[r.channelId] || 0, r.lastReadId);
        if ((lastReadMessageIdsRef.current[r.channelId] || 0) < r.lastReadId) reads[r.channelId] = r.lastReadId;
        if (r.channelId !== viewing && r.unread > 0) {
          counts[r.channelId] = r.unread;
          if (r.mentions) mentions[r.channelId] = r.mentions;
        }
      }
      if (Object.keys(reads).length > 0) {
        lastReadMessageIdsRef.current = { ...lastReadMessageIdsRef.current, ...reads };
        setLastReadMessageIds(prev => {
          const next = { ...prev };
          for (const [ch, id] of Object.entries(reads)) if ((next[Number(ch)] || 0) < id) next[Number(ch)] = id;
          return next;
        });
      }
      setUnreadCounts(counts);
      setMentionCounts(mentions);
      return maxId;
    } catch (_) {
      return null;
    }
  };
  const refreshUnreadCountsRef = useRef(refreshUnreadCounts);
  refreshUnreadCountsRef.current = refreshUnreadCounts;
  const unreadRefreshTimerRef = useRef<any>(null);
  const scheduleUnreadRefresh = () => {
    clearTimeout(unreadRefreshTimerRef.current);
    unreadRefreshTimerRef.current = setTimeout(() => refreshUnreadCountsRef.current(), 400);
  };

  // チャット画面に戻ってきた時: 見ていなかった間の新着に「新着」線を付けてから既読にする
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const markActiveChannelSeen = () => {
    if (activeTabRef.current !== 'chat' || document.hidden || hasNewerRef.current) return;
    const ch = activeChannelIdRef.current;
    if ((unreadCountsRef.current[ch] || 0) > 0) {
      setUnreadAnchor({ channelId: ch, lastReadId: lastReadMessageIdsRef.current[ch] || 0 });
    }
    const confirmed = messagesRef.current.filter(m => m.id > 0 && m.channel_id === ch);
    const last = confirmed[confirmed.length - 1];
    if (last) markChannelRead(ch, last.id);
    else setUnreadCounts(prev => (prev[ch] ? { ...prev, [ch]: 0 } : prev));
  };
  const markActiveChannelSeenRef = useRef(markActiveChannelSeen);
  markActiveChannelSeenRef.current = markActiveChannelSeen;

  // 未読数 & 同期起点の初期化
  useEffect(() => {
    if (!token) return;
    syncReadyRef.current = false;
    refreshUnreadCountsRef.current().then(maxId => {
      if (maxId) lastSeenMessageIdRef.current = Math.max(lastSeenMessageIdRef.current, maxId);
      syncReadyRef.current = true;
      // 初期化中に届いた分を補完
      syncMissedMessagesRef.current();
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
        setMemoSlots(prev => prev.map(n => n.slot_index === msg.payload.slot_index ? { ...n, ...msg.payload, assigned_username: msg.payload.assigned_username || (n as any).assigned_username } : n));
        // 自分の保存の反映は無視 (保存中に打った文字が巻き戻らないように)
        const isOwnSave = msg.sender && msg.sender === currentUserRef.current?.username;
        if (msg.payload.slot_index === selectedSlotIndexRef.current && !isOwnSave && !memoDirtyRef.current) {
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
        const c = msg.payload?.classNo;
        if (c == null || c === ttClassNoRef.current || c === (myClassRef.current ?? 1)) {
          handleFetchTimetablesRef.current();
        }
      } else if (msg.type === 'TIMETABLE_CONFIG_UPDATED') {
        applyTimetableConfigRef.current(msg.payload);
      } else if (msg.type === 'USER_UPDATED') {
        setOnlineUsers(prev => prev.map(u => (u.id === msg.payload.id ? { ...u, ...msg.payload } : u)));
        if (currentUserRef.current?.id === msg.payload.id) setCurrentUser(u => (u ? { ...u, ...msg.payload } : u));
      } else if (msg.type === 'USER_TYPING') {
        const p = msg.payload || {};
        if (p.userId === currentUserRef.current?.id || Date.now() - (p.t || 0) > 6000) return;
        setTypingUsers(prev => ({ ...prev, [p.userId]: { username: p.username, channelId: p.channelId, until: Date.now() + 5000 } }));
      } else if (msg.type === 'DISCORD_VOICE_STATUS') {
        setDiscordVcs(msg.payload || []);
      } else if (msg.type === 'CALENDAR_UPDATED') {
        setCalendarEvents(prev => [...prev.filter(e => e.id !== msg.payload.id), msg.payload]);
      } else if (msg.type === 'CALENDAR_DELETED') {
        setCalendarEvents(prev => prev.filter(e => e.id !== msg.payload.id));
      } else if (msg.type === 'BOARD_NEW_STROKE') {
        setBoardStrokes(prev => [...prev, msg.payload]);
        if (canvasRef.current && activeTabRef.current === 'board') {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) drawStroke(ctx, msg.payload);
        }
      } else if (msg.type === 'BOARD_NEW_TEXT') {
        setBoardTexts(prev => [...prev, msg.payload]);
        if (canvasRef.current && activeTabRef.current === 'board') {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) drawText(ctx, msg.payload);
        }
      } else if (msg.type === 'BOARD_CLEARED') {
        setBoardStrokes([]);
        setBoardTexts([]);
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      } else if (msg.type === 'CLIPBOARD_UPDATED') {
        setClipboardText(msg.payload.content);
        setClipboardUpdatedBy(msg.payload.updated_by);
      } else if (msg.type === 'CHANNEL_CREATED') {
        setChannels(prev => prev.some(c => c.id === msg.payload.id) ? prev : [...prev, msg.payload]);
      } else if (msg.type === 'CHANNEL_UPDATED') {
        setChannels(prev => prev.map(c => c.id === msg.payload.id ? { ...c, ...msg.payload } : c));
      } else if (msg.type === 'CHANNELS_REORDERED') {
        setChannels(msg.payload);
      } else if (msg.type === 'CHANNEL_DELETED') {
        setChannels(prev => prev.filter(c => c.id !== msg.payload.id));
      } else if (msg.type === 'ANNOUNCEMENT_CREATED') {
        setAnnouncements(prev => [msg.payload, ...prev.filter(a => a.id !== msg.payload.id)]);
        const isMyAnnouncement =
          msg.payload?.user_id === currentUserRef.current?.id ||
          msg.payload?.username === currentUserRef.current?.username;
        if (!isMyAnnouncement && notifyPrefsRef.current.important) {
          if (notifyPrefsRef.current.sound) playNotificationSound();
          showBrowserNotification(`お知らせ: ${msg.payload.title}`, msg.payload.content || '');
        }
      } else if (msg.type === 'ANNOUNCEMENT_DELETED') {
        setAnnouncements(prev => prev.filter(a => a.id !== msg.payload.id));
      } else if (msg.type === 'ASSIGNMENT_UPDATED') {
        setAssignments(prev => prev.map(a => a.id === msg.payload.id ? { ...a, ...msg.payload } : a));
      } else if (msg.type === 'ASSIGNMENT_CREATED') {
        setAssignments(prev => (prev.some(a => a.id === msg.payload.id) ? prev : [...prev, msg.payload].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))));
        const isMyAssignment =
          msg.payload?.created_by === currentUserRef.current?.id ||
          msg.payload?.author_id === currentUserRef.current?.id;
        if (!isMyAssignment && notifyPrefsRef.current.important) {
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
        const p = msg.payload;
        setMessages(prev => prev.map(m => m.id === p.id ? { ...m, content: p.content, edited_at: p.edited_at ?? m.edited_at } : m));
      } else if (msg.type === 'READ_STATE_UPDATED') {
        // 他の端末で読んだ
        const { channelId, lastReadId } = msg.payload || {};
        if (channelId && lastReadId) {
          serverReadRef.current[channelId] = Math.max(serverReadRef.current[channelId] || 0, lastReadId);
          if ((lastReadMessageIdsRef.current[channelId] || 0) < lastReadId) {
            lastReadMessageIdsRef.current = { ...lastReadMessageIdsRef.current, [channelId]: lastReadId };
            setLastReadMessageIds(prev => ((prev[channelId] || 0) >= lastReadId ? prev : { ...prev, [channelId]: lastReadId }));
          }
          scheduleUnreadRefresh();
        }
      } else if (msg.type === 'HOMEWORK_CREATED') {
        setHomework(prev => (prev.some(h => h.id === msg.payload.id) ? prev : [...prev, { ...msg.payload, my_done: false }]));
      } else if (msg.type === 'HOMEWORK_UPDATED') {
        setHomework(prev => prev.map(h => (h.id === msg.payload.id ? { ...h, ...msg.payload, my_done: h.my_done } : h)));
      } else if (msg.type === 'HOMEWORK_DELETED') {
        setHomework(prev => prev.filter(h => h.id !== msg.payload.id));
      } else if (msg.type === 'HOMEWORK_PROGRESS') {
        const { id, userId, done, doneCount } = msg.payload;
        setHomework(prev => prev.map(h => (h.id === id ? { ...h, done_count: doneCount, my_done: userId === currentUserRef.current?.id ? done : h.my_done } : h)));
      } else if (msg.type === 'NOTE_CONTENT_SYNC') {
        if (msg.payload.slotIndex === selectedSlotIndexRef.current) {
          setMemoContent(msg.payload.content);
          if (msg.payload.title) setMemoTitle(msg.payload.title);
        }
      } else if (msg.type === 'USER_DELETED') {
        setOnlineUsers(prev => prev.filter(u => u.id !== msg.payload.userId));
      } else if (msg.type === 'USER_PREFERENCES_UPDATED') {
        applySyncedPreferences(msg.payload, false);
      } else if (msg.type === 'EMOJI_UPDATED') {
        setCustomEmojisList(prev => [msg.payload, ...prev.filter(e => e.name !== msg.payload.name)]);
      } else if (msg.type === 'EMOJI_DELETED') {
        setCustomEmojisList(prev => prev.filter(e => e.id !== msg.payload.id && e.name !== msg.payload.name));
      } else if (msg.type === 'ROLES_UPDATED') {
        if (Array.isArray(msg.payload)) setRoleDefs(msg.payload);
      } else if (
        msg.type === 'DISCORD_BINDINGS_CHANGED' ||
        msg.type === 'DISCORD_LINK_REQUEST_CREATED' ||
        msg.type === 'DISCORD_LINK_REQUEST_UPDATED'
      ) {
        fetchDiscordServersRef.current();
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
          // 接続/再接続のたびに取りこぼしを補完。切断から戻った時は表示中のデータも取り直す
          syncMissedMessagesRef.current();
          if (hasBeenOnlineRef.current && lastRtStatusRef.current !== 'online') {
            refreshActiveChannelRef.current();
            loadInitialDataRef.current();
            retryFailedMessagesRef.current();
            scheduleUnreadRefresh();
            if (weatherFailedRef.current) refetchWeatherRef.current();
          } else if (channelLoadStateRef.current === 'error') {
            refreshActiveChannelRef.current();
          }
          hasBeenOnlineRef.current = true;
        }
        lastRtStatusRef.current = status;
      },
      onReset: () => {
        syncMissedMessagesRef.current();
        refreshActiveChannelRef.current();
        loadInitialDataRef.current();
        scheduleUnreadRefresh();
      },
    });
    realtimeRef.current = client;
    client.start();

    const handleVisibilityStatus = () => {
      client.send({ type: 'SET_STATUS', status: document.hidden ? 'away' : 'online' }).catch(() => {});
      if (!document.hidden) {
        syncMissedMessagesRef.current();
        // 取りこぼし補完が届いてから既読にする
        setTimeout(() => markActiveChannelSeenRef.current(), 600);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityStatus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityStatus);
      client.stop();
      if (realtimeRef.current === client) realtimeRef.current = null;
    };
  }, [token, rtTransport, rtPollInterval, connRoute]);


  const fetchDiscordServers = async () => {
    const tk = tokenRef.current;
    if (!tk) return;
    try {
      const res = await safeFetch('/api/discord/servers', { headers: { Authorization: `Bearer ${tk}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.servers)) setDiscordServers(data.servers);
      if (Array.isArray(data?.status?.bindings)) setDiscordBindings(data.status.bindings);
      if (Array.isArray(data?.linkRequests)) setDiscordLinkRequests(data.linkRequests);
    } catch (_) {}
  };
  const fetchDiscordServersRef = useRef(fetchDiscordServers);
  fetchDiscordServersRef.current = fetchDiscordServers;

  // Initial Data Load: リロード直後 (プロキシの起動待ちなど) に失敗しても再試行する
  const loadInitialData = async (attempt = 0) => {
    const tk = tokenRef.current;
    if (!tk) return;
    const headers = { Authorization: `Bearer ${tk}` };
    const get = async (path: string) => {
      const res = await safeFetch(path, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const results = await Promise.allSettled([
      get('/api/channels').then(data => Array.isArray(data) && setChannels(data)),
      get('/api/users').then(data => Array.isArray(data) && setOnlineUsers(data)),
      get('/api/discord/voice-status').then(data => data?.vcs && setDiscordVcs(data.vcs)).catch(() => {}),
      fetchDiscordServers(),
      get('/api/emojis').then(data => Array.isArray(data) && data.length > 0 && setCustomEmojisList(data)).catch(() => {}),
      get('/api/roles').then(data => Array.isArray(data?.roles) && setRoleDefs(data.roles)).catch(() => {}),
      get('/api/notes').then((data: MemoSlot[]) => {
        if (!Array.isArray(data)) return;
        setMemoSlots(data);
        // 編集中のメモは上書きしない
        if (memoDirtyRef.current) return;
        const current = data.find(n => n.slot_index === selectedSlotIndexRef.current) || data[0];
        if (current) {
          setSelectedSlotIndex(current.slot_index);
          setMemoTitle(current.title);
          setMemoContent(current.content);
          setMemoMode(current.slot_index >= 11 ? 'monaco' : current.mode === 'monaco' ? 'markdown' : current.mode);
          setMemoAssignedUser(current.assigned_user_id ?? null);
        }
      }),
      get('/api/assignments').then(data => Array.isArray(data) && setAssignments(data)),
      get('/api/homework').then(data => Array.isArray(data) && setHomework(data)),
      get('/api/assignments/progress/all').then((data: { assignment_id: number; user_id: number; status: string; username: string }[]) => {
        const grouped: Record<number, { userId: number; username: string; status: string }[]> = {};
        for (const row of data) {
          if (!grouped[row.assignment_id]) grouped[row.assignment_id] = [];
          grouped[row.assignment_id].push({ userId: row.user_id, username: row.username, status: row.status });
        }
        setAssignmentMembersProgress(grouped);
      }),
      get('/api/board').then(data => {
        if (data.strokes) setBoardStrokes(data.strokes);
        if (data.texts) setBoardTexts(data.texts);
      }),
      get('/api/clipboard').then(data => {
        if (typeof data.content === 'string') {
          setClipboardText(data.content);
          setClipboardUpdatedBy(data.updated_by || 'system');
        }
      }),
      fetchTimetableConfig(),
      fetchTodayTimetables(),
    ]);
    if (results.some(r => r.status === 'rejected') && attempt < 4 && tokenRef.current === tk) {
      setTimeout(() => loadInitialDataRef.current(attempt + 1), 1500 * 2 ** attempt);
    }
  };
  const loadInitialDataRef = useRef(loadInitialData);
  loadInitialDataRef.current = loadInitialData;

  useEffect(() => {
    if (!token) return;
    loadInitialData();
    const { from, to } = monthRange(new Date().getFullYear(), new Date().getMonth());
    loadCalendarRange(from, to);
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
      // ブラウザ標準の Tab によるフォーカス移動は使わない (補完・インデントは各入力欄で処理)
      if (e.key === 'Tab' && !e.defaultPrevented && !(e.target as HTMLElement)?.closest?.('[data-allow-tab]')) {
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false);
        setIsTimetableModalOpen(false);
        setIsNewChannelModalOpen(false);
        setMemoAiResultModal(null);
        setIsSearchOpen(false);
        setLightbox(null);
        setShowWeather(false);
        setShowCalendar(false);
        setEditingAssignment(null);
        setShowMemberProgressModalId(null);
        setFloatingAiSummary(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 入力中表示の期限切れを掃除
  useEffect(() => {
    const t = setInterval(() => {
      setTypingUsers(prev => {
        const nowMs = Date.now();
        const alive = Object.entries(prev).filter(([, v]) => v.until > nowMs);
        return alive.length === Object.keys(prev).length ? prev : Object.fromEntries(alive);
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const loadCalendarRange = async (from: string, to: string) => {
    const tk = tokenRef.current;
    if (!tk) return;
    try {
      const res = await safeFetch(`/api/calendar?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${tk}` } });
      if (!res.ok) return;
      const rows: CalendarEvent[] = await res.json();
      setCalendarEvents(prev => [...prev.filter(e => e.event_date < from || e.event_date > to), ...rows]);
    } catch (_) {}
  };

  // ===== チャンネルの読み込み =====
  // 最新50件 (aroundId 指定時はそのメッセージの前後)。失敗したら 1→2→4…秒で再試行 (Render の起動待ちなど)
  const loadChannelMessages = async (channelId: number, attempt = 0) => {
    const tk = tokenRef.current;
    if (!tk) return;
    const seq = ++channelLoadSeqRef.current;
    const anchorId = lastReadMessageIdsRef.current[channelId] || 0;
    setChannelLoadState('loading');
    try {
      const res = await safeFetch(`/api/channels/${channelId}/messages?limit=50`, { headers: { Authorization: `Bearer ${tk}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Message[] = await res.json();
      if (seq !== channelLoadSeqRef.current || channelId !== activeChannelIdRef.current) return;
      const maxId = data.length > 0 ? data[data.length - 1].id : 0;
      lastSeenAtMountRef.current = maxId;
      // 読み込み中に WS で届いた分と送信中の分は保持
      setMessages(prev => {
        let next = data;
        for (const m of prev) {
          if (m.channel_id === channelId && (m.id > maxId || m.id < 0)) next = mergeIncomingMessage(next, m);
        }
        return next;
      });
      data.forEach(m => {
        processedMessageIdsRef.current.add(m.id);
        if (m.id > lastSeenMessageIdRef.current) lastSeenMessageIdRef.current = m.id;
      });
      setHasMoreMessages(data.length >= 50);
      setHasNewerMessages(false);
      setNewBelowCount(0);
      setChannelLoadState('ready');
      if (maxId > 0 && activeTabRef.current === 'chat' && !document.hidden) markChannelRead(channelId, maxId);
      // Scroll behavior based on unread position and user preference
      setTimeout(() => {
        const hasUnread = anchorId > 0 && maxId > anchorId;
        const mode = chatAutoScrollModeRef.current;
        if (mode === 'unread_anchor' && hasUnread && unreadMessageRef.current) {
          unreadMessageRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
        } else if (mode !== 'off' || !hasUnread) {
          scheduleScrollToBottom(false);
        }
      }, 50);
    } catch (err) {
      if (seq !== channelLoadSeqRef.current) return;
      console.warn('Channel load failed:', err);
      setChannelLoadState('error');
      if (attempt < 6) {
        setTimeout(() => {
          if (seq === channelLoadSeqRef.current && channelId === activeChannelIdRef.current) {
            loadChannelMessagesRef.current(channelId, attempt + 1);
          }
        }, Math.min(1000 * 2 ** attempt, 30000));
      }
    }
  };
  const loadChannelMessagesRef = useRef(loadChannelMessages);
  loadChannelMessagesRef.current = loadChannelMessages;

  // メッセージの前後 (GET /api/messages/:id/context の結果) を表示して、そのメッセージへスクロール
  const applyMessageContext = (ctx: { channelId: number; messageId: number; hasOlder: boolean; hasNewer: boolean; messages: Message[] }) => {
    channelLoadSeqRef.current++;
    const maxId = ctx.messages.length > 0 ? ctx.messages[ctx.messages.length - 1].id : 0;
    setMessages(ctx.messages);
    ctx.messages.forEach(m => processedMessageIdsRef.current.add(m.id));
    lastSeenAtMountRef.current = maxId;
    setHasMoreMessages(ctx.hasOlder);
    setHasNewerMessages(ctx.hasNewer);
    hasNewerRef.current = ctx.hasNewer;
    setNewBelowCount(0);
    setChannelLoadState('ready');
    isNearBottomRef.current = false;
    if (!ctx.hasNewer && maxId > 0) markChannelRead(ctx.channelId, maxId);
    // 描画後にジャンプ (画像の読み込みで位置がずれないよう少し後にもう一度合わせる)
    setTimeout(() => jumpToMessage(ctx.messageId, 'auto'), 60);
    setTimeout(() => jumpToMessage(ctx.messageId, 'auto', false), 600);
  };

  // メッセージリンク・返信元へのジャンプ。読み込んでいなければ前後を取ってきて表示する
  const openMessageLink = async (messageId: number) => {
    setActiveTab('chat');
    setMsgActionSheet(null);
    if (messagesRef.current.some(m => m.id === messageId && m.channel_id === activeChannelIdRef.current)) {
      requestAnimationFrame(() => jumpToMessage(messageId));
      return;
    }
    const tk = tokenRef.current;
    if (!tk) return;
    try {
      const res = await safeFetch(`/api/messages/${messageId}/context?limit=25`, { headers: { Authorization: `Bearer ${tk}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'メッセージを開けませんでした', { kind: 'error' });
        return;
      }
      if (data.channelId !== activeChannelIdRef.current) {
        // チャンネル切替の読み込みで上書きされないよう、切替後にこの内容を使ってもらう
        pendingJumpRef.current = { channelId: data.channelId, context: data };
        setActiveChannelId(data.channelId);
      } else {
        applyMessageContext(data);
      }
    } catch {
      toast('メッセージを開けませんでした (通信エラー)', { kind: 'error' });
    }
  };
  const openMessageLinkRef = useRef(openMessageLink);
  openMessageLinkRef.current = openMessageLink;

  // 最新へ戻る (リンクで過去の位置を見ていた時)
  const jumpToLatest = () => {
    if (hasNewerRef.current) {
      setHasNewerMessages(false);
      hasNewerRef.current = false;
      loadChannelMessages(activeChannelIdRef.current);
    } else {
      scheduleScrollToBottom(true);
    }
  };

  // Messages Load & Channel Switch with unread line tracking
  useEffect(() => {
    if (!token || !activeChannelId) return;
    const channelId = activeChannelId;
    const anchorId = lastReadMessageIdsRef.current[channelId] || 0;
    setUnreadAnchor({ channelId, lastReadId: anchorId });
    setUnreadCounts(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    setMentionCounts(prev => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev));
    setNewBelowCount(0);
    setMessages([]);
    setHasMoreMessages(true);
    setHasNewerMessages(false);
    hasNewerRef.current = false;
    lastSeenAtMountRef.current = Number.MAX_SAFE_INTEGER;
    const jump = pendingJumpRef.current;
    if (jump && jump.channelId === channelId) {
      pendingJumpRef.current = null;
      applyMessageContext(jump.context);
    } else {
      loadChannelMessages(channelId);
    }
  }, [token, activeChannelId]);

  // URL の #msg-123 (コピーしたメッセージリンク) を開いた時: そのメッセージへ移動
  const isLoggedIn = Boolean(currentUser);
  useEffect(() => {
    if (!token || !isLoggedIn) return;
    const handleHash = () => {
      const m = window.location.hash.match(/^#msg-(\d+)$/);
      if (m) {
        // 同じリンクを何度も処理しないよう、URL からは消しておく
        history.replaceState(null, '', window.location.pathname + window.location.search);
        openMessageLinkRef.current(Number(m[1]));
        return;
      }
      const memoMatch = window.location.hash.match(/^#memo-(\d+)$/);
      if (memoMatch) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        setActiveTab('memo');
        setSelectedSlotIndex(Number(memoMatch[1]));
        toast(`メモ #${memoMatch[1]} を開きました`, { kind: 'success' });
        return;
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [token, isLoggedIn]);

  // チャットタブに戻った時: 表示中チャンネルを既読化し、スクロール位置を戻す
  const chatScrollTopRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeTab !== 'chat') return;
    markActiveChannelSeen();
    if (hasNewerRef.current) return;
    // タブを開き直すと表示が作り直されるので、自動スクロールが有効なら最新へ
    if (chatAutoScrollModeRef.current !== 'off' || chatScrollTopRef.current === null) {
      scheduleScrollToBottom(false);
    } else {
      const top = chatScrollTopRef.current;
      requestAnimationFrame(() => {
        if (chatScrollContainerRef.current) chatScrollContainerRef.current.scrollTop = top;
      });
    }
  }, [activeTab]);

  const handleChatScroll = () => {
    const el = chatScrollContainerRef.current;
    if (!el) return;
    chatScrollTopRef.current = el.scrollTop;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isNearBottomRef.current = nearBottom && !hasNewerRef.current;
    if (nearBottom && newBelowCount > 0 && !hasNewerMessages) setNewBelowCount(0);
    // 上端付近で自動的に過去ログ読み込み
    if (el.scrollTop < 80 && hasMoreMessages && !isLoadingMoreMessages && !chatSearchQuery) {
      handleLoadMoreMessages();
    }
    // 過去の位置を見ている時は、下端で新しい側を読み込む
    if (nearBottom && hasNewerMessages && !isLoadingNewer && !chatSearchQuery) {
      handleLoadNewerMessages();
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

  // 過去の位置を見ている時の、新しい側の読み込み。最新まで追いついたら通常表示に戻る
  const handleLoadNewerMessages = async () => {
    const confirmed = messages.filter(m => m.id > 0);
    const newest = confirmed[confirmed.length - 1];
    if (!token || !newest || isLoadingNewer || !hasNewerMessages) return;
    const channelId = activeChannelId;
    setIsLoadingNewer(true);
    try {
      const res = await safeFetch(`/api/channels/${channelId}/messages?limit=50&afterId=${newest.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || channelId !== activeChannelIdRef.current) return;
      const newer: Message[] = await res.json();
      newer.forEach(m => {
        processedMessageIdsRef.current.add(m.id);
        if (m.id > lastSeenMessageIdRef.current) lastSeenMessageIdRef.current = m.id;
      });
      setMessages(prev => newer.reduce((acc, m) => mergeIncomingMessage(acc, m), prev));
      if (newer.length < 50) {
        setHasNewerMessages(false);
        hasNewerRef.current = false;
        setNewBelowCount(0);
        const last = newer[newer.length - 1] || newest;
        markChannelRead(channelId, last.id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingNewer(false);
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

  const handleLogout = async () => {
    const ok = await confirmDialog({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト', danger: true });
    if (!ok) return;
    forceLogout();
  };
  const forceLogout = () => {
    localStorage.removeItem('asdf_token');
    setToken(null);
    setCurrentUser(null);
  };

  // Image Upload: 送信時までは手元でプレビューだけ
  const MAX_PENDING_IMAGES = 10;
  const addPendingImages = (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setPendingImages(prev => {
      const room = MAX_PENDING_IMAGES - prev.length;
      if (images.length > room) toast(`画像は一度に${MAX_PENDING_IMAGES}枚までです`, { kind: 'error' });
      const added = images.slice(0, Math.max(room, 0)).map(file => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
      }));
      return [...prev, ...added];
    });
    chatInputRef.current?.focus();
  };

  const removePendingImage = (id: string) => {
    setPendingImages(prev => {
      const target = prev.find(p => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter(p => p.id !== id);
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPendingImages(Array.from(e.target.files || []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    // 画像だけのコピーならテキスト貼り付けは起きないようにする
    if (!e.clipboardData.getData('text/plain')) e.preventDefault();
    addPendingImages(files);
  };

  const uploadChatImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('image', file);
    const res = await safeFetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || '画像を送信できませんでした');
    return data.url;
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
    const images = pendingImages;
    if ((!chatInput.trim() && images.length === 0) || !token) return;

    const content = chatInput.replace(/\s+$/, '');
    const targetChannelId = activeChannelId;
    const replyTarget = replyToMessage && replyToMessage.channel_id === targetChannelId ? replyToMessage : null;
    setChatInput('');
    setPendingImages([]);
    setCompletion(null);
    setReplyToMessage(null);
    lastTypingSentRef.current = 0;

    // 時短 /コマンドの処理
    if (content.startsWith('/') && !content.startsWith('//')) {
      const parts = content.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(' ').trim();

      if (cmd === 'ai') {
        setActiveTab('ai');
        toast('AI タブへ移動しました', { kind: 'success' });
        return;
      } else if (cmd === 'timetable' || cmd === 'tt') {
        handleFetchTimetables();
        setIsTimetableModalOpen(true);
        return;
      } else if (cmd === 'hw' || cmd === 'homework') {
        setActiveTab('homework');
        return;
      } else if (cmd === 'tasks' || cmd === 'assignments') {
        setActiveTab('assignments');
        return;
      } else if (cmd === 'memo') {
        const slotNum = parseInt(rest, 10);
        if (slotNum >= 1) setSelectedSlotIndex(slotNum);
        setActiveTab('memo');
        return;
      } else if (cmd === 'board') {
        setActiveTab('board');
        return;
      } else if (cmd === 'help') {
        setActiveTab('help');
        return;
      } else if (cmd === 'clear') {
        toast('入力をクリアしました', { kind: 'success' });
        return;
      } else if (cmd === 'status') {
        if (rest === 'online' || rest === 'away') {
          realtimeRef.current?.send({ type: 'SET_STATUS', status: rest }).catch(() => {});
          toast(`ステータスを設定しました: ${rest}`, { kind: 'success' });
        } else {
          toast('/status <online|away> を指定してください', { kind: 'error' });
        }
        return;
      } else {
        toast(`未知のコマンド: /${cmd}`, { kind: 'error' });
        return;
      }
    }

    const me = currentUserRef.current;
    const newNonce = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const makeOptimistic = (body: string, clientNonce: string, withReply: boolean): Message => ({
      id: tempMessageIdRef.current--,
      channel_id: targetChannelId,
      user_id: me?.id ?? 0,
      username: me?.username ?? '',
      sender_username: me?.username,
      content: body,
      created_at: new Date().toISOString(),
      client_nonce: clientNonce,
      pending: true,
      reply_to_id: withReply ? replyTarget?.id ?? null : null,
      reply_to: withReply && replyTarget
        ? { id: replyTarget.id, username: replyTarget.sender_username || replyTarget.username, user_id: replyTarget.user_id, content: summarizeContent(replyTarget.content) }
        : null,
    });

    // 本文 → 画像の順に1件ずつ送る (返信先は最初の1件にだけ付ける)
    const textNonce = content.trim() ? newNonce() : null;
    const imageNonces = images.map(() => newNonce());
    const optimistic: Message[] = [];
    if (textNonce) optimistic.push(makeOptimistic(content, textNonce, true));
    images.forEach((img, i) => optimistic.push(makeOptimistic(`![image](${img.url})`, imageNonces[i], !textNonce && i === 0)));
    setMessages(prev => [...prev, ...optimistic]);
    scheduleScrollToBottom();

    if (textNonce) await postChatMessage(content, targetChannelId, textNonce, replyTarget?.id);
    if (images.length === 0) return;

    setIsUploading(true);
    const uploads = images.map(img => uploadChatImage(img.file).then(url => ({ url }), (err: Error) => ({ error: err })));
    const failed: typeof images = [];
    for (let i = 0; i < images.length; i++) {
      const result = await uploads[i];
      const nonce = imageNonces[i];
      if ('url' in result) {
        // 再送に備えて、表示中の仮メッセージも本物のURLに差し替えておく
        const body = `![image](${result.url})`;
        setMessages(prev => prev.map(m => (m.id < 0 && m.client_nonce === nonce ? { ...m, content: body } : m)));
        await postChatMessage(`![image](${result.url})`, targetChannelId, nonce, !textNonce && i === 0 ? replyTarget?.id : null);
        URL.revokeObjectURL(images[i].url);
      } else {
        setMessages(prev => prev.filter(m => !(m.id < 0 && m.client_nonce === nonce)));
        failed.push(images[i]);
      }
    }
    setIsUploading(false);
    if (failed.length > 0) {
      // 送れなかった画像はプレビューに戻して、もう一度送れるようにする
      setPendingImages(prev => [...failed, ...prev]);
      toast(`画像${failed.length}枚を送信できませんでした。もう一度送信してください`, { kind: 'error' });
    }
  };

  // ↑キー: 入力欄が空なら自分の最後のメッセージを編集
  const startEditLastOwnMessage = () => {
    const me = currentUserRef.current;
    if (!me) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.id > 0 && m.user_id === me.id && m.channel_id === activeChannelId && !IMAGE_MESSAGE_RE.test((m.content || '').trim())) {
        setEditingMessageId(m.id);
        setEditingContent(m.content || '');
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

  const jumpToMessage = (id: number, behavior: ScrollBehavior = 'smooth', highlight = true, retryCount = 0) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      if (retryCount < 20) {
        setTimeout(() => jumpToMessage(id, behavior, highlight, retryCount + 1), 80);
      }
      return;
    }
    el.scrollIntoView({ behavior, block: 'center' });
    if (!highlight) return;
    el.classList.remove('msg-highlight');
    void el.offsetWidth;
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 3000);
  };

  const handleRetryMessage = (m: Message) => {
    if (!m.client_nonce) return;
    setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, pending: true, failed: false } : x)));
    postChatMessage(m.content, m.channel_id, m.client_nonce, m.reply_to_id);
  };

  const handleDiscardFailedMessage = (m: Message) => {
    setMessages(prev => prev.filter(x => x.id !== m.id));
  };

  // オンライン復帰時: 送れなかったメッセージを自動で再送
  retryFailedMessagesRef.current = () => {
    messages.filter(m => m.failed && m.client_nonce).forEach(m => handleRetryMessage(m));
  };

  // 入力中であることを3秒おきに知らせる
  const notifyTyping = () => {
    const nowMs = Date.now();
    if (nowMs - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = nowMs;
    rtSend({ type: 'TYPING', channelId: activeChannelIdRef.current });
  };

  // Reorder Channels (Up / Down)
  const handleMoveChannel = async (e: React.MouseEvent, index: number, direction: 'up' | 'down', visibleList?: ChannelItem[]) => {
    e.stopPropagation();
    const textChannels = visibleList || channels.filter(c => c.type !== 'voice');
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= textChannels.length) return;

    const chA = textChannels[index];
    const chB = textChannels[targetIndex];
    const idxA = channels.findIndex(c => c.id === chA.id);
    const idxB = channels.findIndex(c => c.id === chB.id);
    if (idxA < 0 || idxB < 0) return;

    const newChannels = [...channels];
    newChannels[idxA] = chB;
    newChannels[idxB] = chA;
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
    navigator.clipboard.writeText(url).then(
      () => toast('メッセージのリンクをコピーしました', { kind: 'success' }),
      () => toast('コピーできませんでした', { kind: 'error' })
    );
    setCopiedLinkMessageId(messageId);
    setTimeout(() => setCopiedLinkMessageId(null), 2000);
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!token) return;
    const ok = await confirmDialog({ title: 'メッセージを削除しますか？', message: '削除したメッセージは監査ログから復元できます。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
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
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: updated.content, edited_at: updated.edited_at ?? m.edited_at } : m));
        cancelEditing();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || '編集できませんでした', { kind: 'error' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim() || !token) return;
    const cleanName = newChannelName.trim().toLowerCase();
    const fallbackServerId = selectedServerId !== 'all'
      ? selectedServerId
      : (discordServers[0]?.id || '1524703392927191100');
    const targetServerId = cleanName === 'general'
      ? null
      : (newChannelServerId || fallbackServerId);
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newChannelName,
          type: 'text',
          server_id: targetServerId,
        })
      });
      if (res.ok) {
        const created = await res.json();
        setChannels(prev => prev.some(c => c.id === created.id) ? prev : [...prev, created]);
        if (created.server_id) setSelectedServerId(created.server_id);
        setActiveChannelId(created.id);
        setIsNewChannelModalOpen(false);
        setNewChannelName('');
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'チャンネル作成に失敗しました', { kind: 'error' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    if (!token || channels.length <= 1) return;
    const name = channels.find(c => c.id === channelId)?.name;
    const ok = await confirmDialog({ title: `#${name} を削除しますか？`, message: 'チャンネル内のメッセージもすべて削除されます。元に戻せません。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
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

  // AI に毎回渡すアプリの状態
  const buildAiContext = () => {
    const d = new Date();
    const todayRowsNow = todayTimetables.filter(t => t.day_of_week === d.getDay());
    const today = ymd(d);
    return {
      current_user: currentUser?.username,
      now: d.toLocaleString('ja-JP'),
      today_schedule: SCHEDULE_LABELS[todaySchedule],
      today_timetable: daySlots(ttConfig, d.getDay(), todayRowsNow).map(s => ({
        name: s.label, time: `${s.time.start}-${s.time.end}`, subject: s.subject || undefined,
        items: todayRowsNow.find(t => `p${t.period}` === s.key)?.items || undefined,
      })),
      my_class: currentUser?.class_no ? `${currentUser.class_no}組` : '未設定',
      assignments: assignments
        .filter(a => !a.is_archived && (a.class_no == null || !currentUser?.class_no || a.class_no === currentUser.class_no))
        .map(a => ({
          title: a.title, subject: a.subject, deadline: a.deadline, resubmit_deadline: a.resubmit_deadline, my_status: a.my_status,
        })),
      homework: homework
        .filter(h => !h.my_done && (h.class_no == null || !currentUser?.class_no || h.class_no === currentUser.class_no))
        .map(h => ({ subject: h.subject, content: h.content, due: h.due_date })),
      upcoming_events: calendarEvents.filter(e => e.event_date >= today).slice(0, 20).map(e => ({ date: e.event_date, time: e.event_time, title: e.title, by: e.username })),
      channels: channels.map(c => c.name),
      memo_slots: memoSlots.filter(m => m.slot_index <= 10).map(m => ({ slot: m.slot_index, title: m.title })),
      weather: { temp: weather.temp, desc: weather.desc, max: weather.tempMax, min: weather.tempMin, precip: weather.precipProb },
    };
  };

  // Memo AI Assistant Handler
  const handleMemoAiAssist = async (type: 'summarize' | 'proofread' | 'explain_code') => {
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.result) throw new Error(data.error || 'AI の実行に失敗しました');
      setMemoAiResultModal({ type, result: data.result });
    } catch (err: any) {
      console.error('Memo AI error:', err);
      toast(err.message || 'AI の実行に失敗しました', { kind: 'error' });
    } finally {
      setIsMemoAiLoading(false);
    }
  };

  // AI 校正の結果をメモに反映 (確認 → 反映 → 元に戻せる)
  const applyProofread = async (result: string) => {
    const ok = await confirmDialog({
      title: '校正結果をメモに反映しますか？',
      message: `メモ #${selectedSlotIndex} の本文が校正後の文章に置き換わります。反映後も「元に戻す」で戻せます。`,
      confirmLabel: '反映する',
    });
    if (!ok) return;
    const slot = selectedSlotIndexRef.current;
    setMemoUndo({ slot, content: memoContent });
    setMemoAiResultModal(null);
    handleMemoContentChange(result);
    toast('校正結果を反映しました', { kind: 'success', action: { label: '元に戻す', onClick: () => undoMemoAi() } });
  };

  const undoMemoAiRef = useRef<() => void>(() => {});
  const undoMemoAi = () => undoMemoAiRef.current();
  undoMemoAiRef.current = () => {
    if (!memoUndo || memoUndo.slot !== selectedSlotIndexRef.current) return;
    handleMemoContentChange(memoUndo.content);
    setMemoUndo(null);
    toast('校正前の内容に戻しました', { kind: 'success' });
  };

  // 時間割 (教科) はクラスごと。短縮・S短でも教科は同じで、時刻だけが変わる
  const handleFetchTimetables = async (classNo = ttClassNoRef.current) => {
    if (!token) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/timetables?classNo=${classNo}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok && classNo === ttClassNoRef.current) {
        const data = await res.json();
        setTimetables(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ヘッダー用: 自分のクラスの時間割
  const fetchTodayTimetables = async () => {
    const tk = tokenRef.current;
    if (!tk) return;
    const classNo = myClassRef.current ?? 1;
    const res = await safeFetch(`/api/timetables?classNo=${classNo}`, { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (classNo === (myClassRef.current ?? 1)) setTodayTimetables(rows);
  };

  const fetchTimetableConfig = async () => {
    const tk = tokenRef.current;
    if (!tk) return;
    const res = await safeFetch('/api/timetables/config', { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyTimetableConfig(await res.json());
  };

  const applyTimetableConfig = (config: Partial<TimetableConfig>) => {
    if (!config || !config.schedules) return;
    setTtConfig({
      activeScheduleType: config.activeScheduleType || 'normal',
      schedules: { ...DEFAULT_CONFIG.schedules, ...config.schedules },
      dayPeriodCounts: { ...DEFAULT_CONFIG.dayPeriodCounts, ...(config.dayPeriodCounts || {}) },
    });
  };
  const applyTimetableConfigRef = useRef(applyTimetableConfig);
  applyTimetableConfigRef.current = applyTimetableConfig;

  handleFetchTimetablesRef.current = () => {
    handleFetchTimetables();
    fetchTodayTimetables().catch(() => {});
  };

  // クラス切替時・ログイン時に時間割を取り直す
  useEffect(() => {
    handleFetchTimetables(ttClassNo);
  }, [ttClassNo, token]);

  const myClassNo = currentUser?.class_no ?? null;
  useEffect(() => {
    fetchTodayTimetables().catch(() => {});
    if (myClassNo) setTtClassNo(myClassNo);
  }, [myClassNo, token]);

  // 日付が変わったら「今日の時程」を取り直す (前日の短縮時程が残らないように)
  const todayKey = ymd(now);
  useEffect(() => {
    fetchTimetableConfig().catch(() => {});
  }, [token, todayKey]);

  // 指定コマに教科を保存 (プリセットのワンクリック保存もこれ)
  const saveTimetableSubject = async (day: number, period: number, subject: string, extra: { items?: string; note?: string } = {}) => {
    if (!token || !subject.trim()) return null;
    setTtSaveStatus('保存中…');
    try {
      const res = await safeFetch('/api/timetables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dayOfWeek: day, period, subject: subject.trim(), classNo: ttClassNo, ...extra }),
      });
      if (!res.ok) throw new Error();
      const row: TimetableItem = await res.json();
      setTimetables(prev => [...prev.filter(t => !(t.day_of_week === day && t.period === period)), row]);
      if (ttClassNo === (myClassRef.current ?? 1)) fetchTodayTimetables().catch(() => {});
      setTtSaveStatus(`${ttClassNo}組 ${DAY_LABELS[day]}曜${period}限 を「${row.subject}」に保存しました`);
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
    const lastPeriod = periodCountFor(ttConfig, cell.day);
    const nextPeriod = cell.period < lastPeriod ? cell.period + 1 : 1;
    const nextDay = cell.period < lastPeriod ? cell.day : (cell.day < 5 ? cell.day + 1 : 1);
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

  // 「今日の時程」は全員の表示が変わるので確認してから。翌日には通常時程へ戻る
  const handleSetTodaySchedule = async (type: ScheduleType) => {
    if (!token || type === todaySchedule) return;
    const ok = await confirmDialog({
      title: `今日の時程を「${SCHEDULE_LABELS[type]}」にしますか？`,
      message: '全員のヘッダー表示が変わります。明日になると自動で通常時程に戻ります。',
      confirmLabel: '変更する',
    });
    if (!ok) return;
    const res = await safeFetch('/api/timetables/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ activeScheduleType: type }),
    }).catch(() => null);
    if (res && res.ok) {
      applyTimetableConfig(await res.json());
      toast(`今日の時程を${SCHEDULE_LABELS[type]}にしました`, { kind: 'success' });
    } else {
      toast('時程を変更できませんでした', { kind: 'error' });
    }
  };

  const saveTimetableConfig = async (body: object, okMessage: string) => {
    if (!token) return false;
    const res = await safeFetch('/api/timetables/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) {
      applyTimetableConfig(await res.json());
      setTtSaveStatus(okMessage);
      return true;
    }
    const d = res ? await res.json().catch(() => ({})) : {};
    setTtSaveStatus(d.error || '保存に失敗しました');
    return false;
  };

  const handleSavePeriodTimes = async () => {
    if (!periodDraft) return;
    if (await saveTimetableConfig({ schedules: { [scheduleType]: periodDraft } }, `${SCHEDULE_LABELS[scheduleType]} の時刻を保存しました`)) {
      setIsEditingPeriods(false);
    }
  };

  // お知らせ機能 (Admin作成 & 取得)
  const fetchAnnouncements = async () => {
    if (!token) return;
    try {
      const res = await safeFetch('/api/announcements', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (token) fetchAnnouncements();
  }, [token]);

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnouncementTitle.trim() || !token) return;
    try {
      const res = await safeFetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: newAnnouncementTitle.trim(),
          content: newAnnouncementContent.trim(),
          notifyDiscord: newAnnouncementDiscord,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'お知らせの作成に失敗しました');
      }
      const saved = await res.json();
      setAnnouncements(prev => [saved, ...prev.filter(a => a.id !== saved.id)]);
      setNewAnnouncementTitle('');
      setNewAnnouncementContent('');
      setIsNewAnnouncementModalOpen(false);
      toast('お知らせを投稿しました', { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    if (!token) return;
    const ok = await confirmDialog({
      title: 'お知らせを削除しますか？',
      message: 'このお知らせを削除すると全員の一覧から消えます。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await safeFetch(`/api/announcements/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAnnouncements(prev => prev.filter(a => a.id !== id));
        toast('お知らせを削除しました', { kind: 'success' });
      }
    } catch (_) {}
  };

  // チャンネル名変更 (admin限定)
  const handleEditChannelName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel || !editChannelNameInput.trim() || !token) return;
    try {
      const res = await safeFetch(`/api/channels/${editingChannel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: editChannelNameInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'チャンネル名の変更に失敗しました');
      setChannels(prev => prev.map(c => c.id === data.id ? { ...c, name: data.name } : c));
      setEditingChannel(null);
      setEditChannelNameInput('');
      toast(`チャンネル名を #${data.name} に変更しました`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  // Discord 同期チャンネル解除 (オプションでチャンネル自体も削除可能)
  const handleUnbindDiscordChannel = async (opts: { discordChannelId?: string; asdfChannelId?: number; label?: string; deleteChannel?: boolean }) => {
    if (!token) return;
    const ok = await confirmDialog({
      title: opts.deleteChannel ? '同期チャンネルを削除しますか？' : 'Discord チャンネルとの同期を解除しますか？',
      message: opts.deleteChannel
        ? `${opts.label || 'このチャンネル'} の Discord 同期を解除し、asdfbase 側のチャンネルと履歴も削除します。`
        : `${opts.label || 'このチャンネル'} と Discord の双方向同期を解除します。（メッセージ履歴は残ります）`,
      confirmLabel: opts.deleteChannel ? 'チャンネルごと削除' : '同期を解除',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await safeFetch('/api/discord/bindings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          discordChannelId: opts.discordChannelId,
          asdfChannelId: opts.asdfChannelId,
          deleteChannel: Boolean(opts.deleteChannel),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '同期解除に失敗しました');
      if (data.status?.bindings) setDiscordBindings(data.status.bindings);
      if (opts.deleteChannel && opts.asdfChannelId) {
        setChannels(prev => {
          const remaining = prev.filter(c => c.id !== opts.asdfChannelId);
          if (activeChannelId === opts.asdfChannelId && remaining.length > 0) {
            setActiveChannelId(remaining[0].id);
          }
          return remaining;
        });
      }
      fetchDiscordServers().catch(() => {});
      loadIntegrations().catch(() => {});
      toast(opts.deleteChannel ? '同期を解除してチャンネルを削除しました' : 'Discord チャンネル同期を解除しました', { kind: 'success' });
    } catch (err: any) {
      toast(err.message || '同期解除に失敗しました', { kind: 'error' });
    }
  };

  // Bot ダウンタイム後のメッセージ履歴キャッチアップ同期
  const handleSyncDiscordHistory = async (opts?: { asdfChannelId?: number; discordChannelId?: string; guildId?: string }) => {
    if (!token || isSyncingDiscordHistory) return;
    setIsSyncingDiscordHistory(true);
    try {
      const res = await safeFetch('/api/discord/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...opts, limit: 60 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '履歴の取得に失敗しました');
      await fetchDiscordServers().catch(() => {});
      if (activeChannelId) loadChannelMessages(activeChannelId);
      toast(`Discord から未取得メッセージ ${data.syncedCount || 0} 件を同期しました`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message || '履歴同期に失敗しました', { kind: 'error' });
    } finally {
      setIsSyncingDiscordHistory(false);
    }
  };

  // サーバー内のすべてのチャンネルを一括で asdfbase と同期
  const [isSyncingAllChannels, setIsSyncingAllChannels] = useState<boolean>(false);
  const handleSyncAllChannels = async (guildId: string, guildName?: string) => {
    if (!token || !guildId || isSyncingAllChannels) return;
    setIsSyncingAllChannels(true);
    try {
      const res = await safeFetch('/api/discord/sync-all-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guildId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '一括同期に失敗しました');
      if (data.servers) setDiscordServers(data.servers);
      if (data.status?.bindings) setDiscordBindings(data.status.bindings);
      const chRes = await safeFetch('/api/channels', { headers: { Authorization: `Bearer ${token}` } });
      const chData = await chRes.json().catch(() => null);
      if (Array.isArray(chData)) setChannels(chData);
      await loadIntegrations();
      toast(`「${guildName || 'サーバー'}」の全チャンネル同期を開始しました (新規: ${data.createdCount}件, 紐付け: ${data.boundCount}件)`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message || '一括同期に失敗しました', { kind: 'error' });
    } finally {
      setIsSyncingAllChannels(false);
    }
  };

  // Discord 簡単チャンネル紐付け (admin/rds9 は即時、メンバーは承認申請)
  const handleRequestOrCreateDiscordBinding = async (opts: {
    guildId: string;
    guildName: string;
    discordChannelId: string;
    discordChannelName: string;
    asdfChannelId: number | null;
    asdfChannelName: string;
  }) => {
    if (!token || !opts.discordChannelId.trim()) return;
    try {
      const res = await safeFetch('/api/discord/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          guildId: opts.guildId,
          guildName: opts.guildName,
          discordChannelId: opts.discordChannelId.trim(),
          discordChannelName: opts.discordChannelName,
          asdfChannelId: opts.asdfChannelId,
          newChannelName: opts.asdfChannelId ? '' : opts.asdfChannelName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Discord 連携の設定に失敗しました');
      if (data.pendingApproval) {
        toast('rds9 (管理者) へ連携リクエストを送信しました！承認されると自動で同期が始まります', { kind: 'success' });
      } else {
        toast('Discord チャンネルを紐付け、履歴を同期しました！', { kind: 'success' });
        if (data.asdfChannelId) setActiveChannelId(Number(data.asdfChannelId));
      }
      setLinkNewChannelName('');
      fetchDiscordServers().catch(() => {});
      loadIntegrations().catch(() => {});
    } catch (err: any) {
      toast(err.message || '連携設定に失敗しました', { kind: 'error' });
    }
  };

  const handleApproveDiscordRequest = async (id: number) => {
    if (!token) return;
    try {
      const res = await safeFetch(`/api/discord/link-requests/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '承認に失敗しました');
      toast('連携申請を承認し、同期を開始しました', { kind: 'success' });
      fetchDiscordServers().catch(() => {});
      loadIntegrations().catch(() => {});
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  const handleRejectDiscordRequest = async (id: number) => {
    if (!token) return;
    try {
      const res = await safeFetch(`/api/discord/link-requests/${id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('却下に失敗しました');
      toast('連携申請を却下しました', { kind: 'info' });
      fetchDiscordServers().catch(() => {});
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  const handleToggleApproveGuild = async (guildId: string, approve: boolean) => {
    if (!token) return;
    try {
      const res = await safeFetch(`/api/discord/guilds/${guildId}/approve`, {
        method: approve ? 'POST' : 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'サーバー設定の更新に失敗しました');
      if (Array.isArray(data.servers)) setDiscordServers(data.servers);
      toast(approve ? 'サーバーを連携許可しました' : 'サーバーの連携許可を解除しました', { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  // カスタム絵文字アップロード & 削除
  const handleUploadCustomEmoji = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !emojiUploadFile || !emojiUploadName.trim() || isUploadingEmoji) return;
    setIsUploadingEmoji(true);
    try {
      const fd = new FormData();
      fd.append('name', emojiUploadName.trim().toLowerCase().replace(/^:+|:+$/g, ''));
      fd.append('image', emojiUploadFile);
      const res = await safeFetch('/api/emojis', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '絵文字のアップロードに失敗しました');
      setCustomEmojisList(prev => [...prev.filter(x => x.name !== data.name), data].sort((a, b) => a.name.localeCompare(b.name)));
      setEmojiUploadName('');
      setEmojiUploadFile(null);
      toast(`カスタム絵文字 :${data.name}: を追加しました！`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    } finally {
      setIsUploadingEmoji(false);
    }
  };

  const handleDeleteCustomEmoji = async (id: number | undefined, name: string) => {
    if (!token || !id) return;
    const ok = await confirmDialog({
      title: `:${name}: を削除しますか？`,
      message: 'カスタム絵文字を削除します。',
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await safeFetch(`/api/emojis/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setCustomEmojisList(prev => prev.filter(e => e.id !== id));
        toast(`:${name}: を削除しました`, { kind: 'success' });
      }
    } catch (_) {}
  };

  // チャンネル権限 & サーバー紐付け保存 (admin限定)
  const handleSaveChannelPermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelPermModal || !token) return;
    try {
      const res = await safeFetch(`/api/channels/${channelPermModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: channelPermModal.name,
          server_id: channelPermModal.server_id || null,
          view_roles: channelPermModal.view_roles || [],
          write_roles: channelPermModal.write_roles || [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'チャンネル権限の保存に失敗しました');
      setChannels(prev => prev.map(c => (c.id === data.id ? { ...c, ...data } : c)));
      setChannelPermModal(null);
      toast(`#${data.name} のロール・権限設定を保存しました`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  // ロール定義の追加・削除 & ユーザーへのロール付与 (admin限定)
  const saveRoleDefsToServer = async (nextRoles: RoleDefinition[]) => {
    if (!token) return;
    const res = await safeFetch('/api/roles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roles: nextRoles }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'ロール設定の保存に失敗しました');
    if (Array.isArray(data.roles)) setRoleDefs(data.roles);
  };

  const handleAddRoleDef = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = newRoleIdInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const name = newRoleNameInput.trim();
    if (!id || !name) {
      toast('ロールID (半角英数) と表示名を入力してください', { kind: 'error' });
      return;
    }
    if (roleDefs.some(r => r.id === id)) {
      toast('同じIDのロールが既に存在します', { kind: 'error' });
      return;
    }
    try {
      await saveRoleDefsToServer([...roleDefs, { id, name, color: newRoleColorInput || '#10b981', system: false }]);
      setNewRoleIdInput('');
      setNewRoleNameInput('');
      toast(`ロール「${name}」を作成しました`, { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  const handleDeleteRoleDef = async (roleId: string) => {
    try {
      await saveRoleDefsToServer(roleDefs.filter(r => r.id !== roleId || r.system));
      toast('ロールを削除しました', { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  const handleToggleUserCustomRole = async (u: User, roleId: string) => {
    if (!token) return;
    const current = Array.isArray(u.custom_roles) ? u.custom_roles : [];
    const next = current.includes(roleId) ? current.filter(r => r !== roleId) : [...current, roleId];
    try {
      const res = await safeFetch(`/api/users/${u.id}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ custom_roles: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ロールの更新に失敗しました');
      setOnlineUsers(prev => prev.map(x => (x.id === u.id ? { ...x, custom_roles: data.custom_roles || next } : x)));
      if (currentUser?.id === u.id) setCurrentUser(prev => (prev ? { ...prev, custom_roles: data.custom_roles || next } : prev));
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  // メモの Markdown エディタ ⇔ プレビュー スクロール同期
  const handleMemoEditorScroll = () => {
    if (memoScrollLockRef.current === 'preview') return;
    const ed = memoTextareaRef.current;
    const pr = memoPreviewRef.current;
    if (!ed || !pr) return;
    const edMax = ed.scrollHeight - ed.clientHeight;
    const prMax = pr.scrollHeight - pr.clientHeight;
    if (edMax <= 0 || prMax <= 0) return;
    memoScrollLockRef.current = 'editor';
    pr.scrollTop = (ed.scrollTop / edMax) * prMax;
    requestAnimationFrame(() => {
      if (memoScrollLockRef.current === 'editor') memoScrollLockRef.current = null;
    });
  };

  const handleMemoPreviewScroll = () => {
    if (memoScrollLockRef.current === 'editor') return;
    const ed = memoTextareaRef.current;
    const pr = memoPreviewRef.current;
    if (!ed || !pr) return;
    const edMax = ed.scrollHeight - ed.clientHeight;
    const prMax = pr.scrollHeight - pr.clientHeight;
    if (edMax <= 0 || prMax <= 0) return;
    memoScrollLockRef.current = 'preview';
    ed.scrollTop = (pr.scrollTop / prMax) * edMax;
    requestAnimationFrame(() => {
      if (memoScrollLockRef.current === 'preview') memoScrollLockRef.current = null;
    });
  };

  // 曜日ごとに 5限 / 6限 を切り替え
  const handleToggleDayPeriods = (day: number) => {
    const next = periodCountFor(ttConfig, day) === 6 ? 5 : 6;
    saveTimetableConfig({ dayPeriodCounts: { [day]: next } }, `${DAY_LABELS[day]}曜日を ${next}限授業にしました`);
  };

  const handleCreateTimetableEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTtSubject.trim()) return;
    const row = await saveTimetableSubject(newTtDay, newTtPeriod, newTtSubject);
    if (row) setTtDetailDraft(d => ({ ...d, subject: row.subject }));
  };

  const handleDeleteTimetableEntry = async (id: number) => {
    if (!token) return;
    const ok = await confirmDialog({ title: 'このコマを削除しますか？', message: '教科・持ち物・メモが消えます。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
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
    const ok = await confirmDialog({
      title: '本当にアカウントを削除しますか？',
      message: 'この操作は元に戻せません。メモの担当やテストの記録も消えます。',
      confirmLabel: 'アカウントを削除',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/users/${currentUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        forceLogout();
      } else {
        const d = await res.json();
        toast(d.error || '削除できませんでした', { kind: 'error' });
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

  const loadAuditLogs = async (action = auditFilter, user = auditUserFilter) => {
    if (!token) return;
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (action) params.set('action', action);
      if (user) params.set('user', user);
      const r = await safeFetch(`/api/audit-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setAuditLogs(await r.json());
    } catch (_) {}
  };

  // 表示中の条件 (種類・ユーザー) のログを AI で要約
  const summarizeAuditLogs = async () => {
    if (!token || isSummarizingAudit) return;
    setIsSummarizingAudit(true);
    try {
      const r = await safeFetch('/api/audit-logs/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: auditFilter || undefined, user: auditUserFilter || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.summary) throw new Error(d.error || '要約できませんでした');
      setAuditSummary({ text: d.summary, count: d.count });
    } catch (err: any) {
      toast(err.message || '要約できませんでした', { kind: 'error' });
    } finally {
      setIsSummarizingAudit(false);
    }
  };

  const deleteAuditLog = async (id: number) => {
    if (!token) return;
    const ok = await confirmDialog({ title: 'このログを削除しますか？', message: '削除したログからは復元できなくなります。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
    const r = await safeFetch(`/api/audit-logs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setAuditLogs(prev => prev.filter(l => l.id !== id));
    else toast((await r.json().catch(() => ({}))).error || '削除に失敗しました', { kind: 'error' });
  };

  const clearAuditLogs = async () => {
    if (!token) return;
    const ok = await confirmDialog({ title: '監査ログをすべて削除しますか？', message: 'この操作は取り消せません。削除したものは復元もできなくなります。', confirmLabel: 'すべて削除', danger: true });
    if (!ok) return;
    const r = await safeFetch('/api/audit-logs', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) loadAuditLogs();
    else toast((await r.json().catch(() => ({}))).error || '削除に失敗しました', { kind: 'error' });
  };

  const handleRestoreAuditLog = async (logId: number) => {
    if (!token) return;
    const ok = await confirmDialog({ title: 'このログの内容を復元しますか？', confirmLabel: '復元する' });
    if (!ok) return;
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/audit-logs/${logId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast('復元しました', { kind: 'success' });
        loadAuditLogs();
      } else {
        const d = await res.json();
        toast(d.error || '復元に失敗しました', { kind: 'error' });
      }
    } catch (err) {
      console.error(err);
    }
  };


  // メモ保存: 保存先スロットは呼び出し時点で固定する (保存待ちの間にスロットを切り替えても混ざらない)
  const memoStateRef = useRef({ title: memoTitle, content: memoContent, mode: memoMode });
  memoStateRef.current = { title: memoTitle, content: memoContent, mode: memoMode };
  const pendingMemoSaveRef = useRef<{ slot: number; timer: any } | null>(null);

  const handleSaveMemo = async (slot = selectedSlotIndexRef.current, data = memoStateRef.current) => {
    if (!token) return;
    if (pendingMemoSaveRef.current?.slot === slot) {
      clearTimeout(pendingMemoSaveRef.current.timer);
      pendingMemoSaveRef.current = null;
    }
    setIsSavingMemo(true);
    setAutoSaveStatus('saving');
    try {
      const res = await safeFetch(`${API_BASE_URL}/api/notes/${slot}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: data.title, content: data.content, mode: data.mode })
      });
      if (res.ok) {
        const updated = await res.json();
        setMemoSlots(prev => prev.map(m => m.slot_index === slot ? { ...m, ...updated, assigned_username: (m as any).assigned_username } : m));
        // 保存中にさらに編集されていなければ保存済み
        const cur = memoStateRef.current;
        if (slot === selectedSlotIndexRef.current && cur.content === data.content && cur.title === data.title) {
          memoDirtyRef.current = false;
          setAutoSaveStatus('saved');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        if (slot === selectedSlotIndexRef.current) setAutoSaveStatus('dirty');
        toast(err.error || 'メモを保存できませんでした', { kind: 'error' });
      }
    } catch (err) {
      console.error(err);
      if (slot === selectedSlotIndexRef.current) setAutoSaveStatus('dirty');
    } finally {
      setIsSavingMemo(false);
    }
  };

  // 入力が止まったら自動保存
  const scheduleMemoAutoSave = (data: typeof memoStateRef.current) => {
    const slot = selectedSlotIndexRef.current;
    if (pendingMemoSaveRef.current) clearTimeout(pendingMemoSaveRef.current.timer);
    pendingMemoSaveRef.current = null;
    const wait = memoAutoSaveIntervalRef.current;
    if (wait <= 0) return;
    pendingMemoSaveRef.current = { slot, timer: setTimeout(() => handleSaveMemo(slot, data), wait) };
  };

  // スロットを切り替える前に、保存待ちの変更をすぐ保存
  const flushMemoSave = () => {
    const pending = pendingMemoSaveRef.current;
    if (pending) {
      clearTimeout(pending.timer);
      pendingMemoSaveRef.current = null;
      handleSaveMemo(pending.slot, { ...memoStateRef.current });
    }
  };

  const selectMemoSlot = (slot: MemoSlot) => {
    if (slot.slot_index === selectedSlotIndexRef.current) return;
    flushMemoSave();
    memoDirtyRef.current = false;
    setAutoSaveStatus('saved');
    setMemoUndo(null);
    setSelectedSlotIndex(slot.slot_index);
    setMemoTitle(slot.title);
    setMemoContent(slot.content);
    setMemoMode(slot.slot_index >= 11 ? 'monaco' : slot.mode === 'monaco' ? 'markdown' : slot.mode);
    setMemoAssignedUser(slot.assigned_user_id ?? null);
    setIsMemoListOpen(false);
  };

  const broadcastNoteSync = (content: string, title: string) => {
    // HTTP系トランスポートでは1文字ごとに送らず200msに間引く
    pendingNoteSyncRef.current = {
      type: 'NOTE_CONTENT_SYNC',
      slotIndex: selectedSlotIndexRef.current,
      content,
      title
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
  };

  const flushMemoSaveRef = useRef(flushMemoSave);
  flushMemoSaveRef.current = flushMemoSave;

  const handleMemoContentChange = (newVal: string) => {
    setMemoContent(newVal);
    memoDirtyRef.current = true;
    setAutoSaveStatus('dirty');
    broadcastNoteSync(newVal, memoStateRef.current.title);
    scheduleMemoAutoSave({ ...memoStateRef.current, content: newVal });
  };

  const handleMemoTitleChange = (newTitle: string) => {
    setMemoTitle(newTitle);
    memoDirtyRef.current = true;
    setAutoSaveStatus('dirty');
    broadcastNoteSync(memoStateRef.current.content, newTitle);
    scheduleMemoAutoSave({ ...memoStateRef.current, title: newTitle });
  };

  const handleMemoModeChange = (mode: 'markdown' | 'plain') => {
    setMemoMode(mode);
    handleSaveMemo(selectedSlotIndexRef.current, { ...memoStateRef.current, mode });
  };

  // メモ欄で Tab を押したら字下げ (フォーカスは移動しない)
  const handleMemoTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd, value } = el;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    handleMemoContentChange(next);
    requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2));
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
          description: newAssignDesc,
          classNo: newAssignClass === 'mine' ? myClassRef.current : newAssignClass,
        })
      });
      if (res.ok) {
        const created = await res.json();
        setAssignments(prev => (prev.some(a => a.id === created.id) ? prev : [...prev, { ...created, my_status: 'unstarted' }]));
        setNewAssignTitle('');
        setNewAssignDesc('');
        setNewAssignResubmitDeadline('');
        setIsAssignFormOpen(false);
        toast(`「${created.title}」を登録しました`, { kind: 'success' });
      } else {
        toast('登録できませんでした', { kind: 'error' });
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
    const target = assignments.find(a => a.id === id);
    const ok = await confirmDialog({ title: `「${target?.title || ''}」を削除しますか？`, message: '全員の進捗も消えます。監査ログから復元できます。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
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
          description: editingAssignment.description,
          classNo: editingAssignment.class_no ?? null,
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setAssignments(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
        setEditingAssignment(null);
      } else {
        const err = await res.json();
        toast(err.error || '提出物の更新に失敗しました', { kind: 'error' });
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.summary) throw new Error(data.error || '要約できませんでした');
      setSummarizedTexts(prev => ({ ...prev, [assignment.id]: data.summary }));
      setFloatingAiSummary({
        id: assignment.id,
        title: assignment.title,
        summary: data.summary
      });
    } catch (err: any) {
      toast(err.message || '要約できませんでした', { kind: 'error' });
    } finally {
      setIsSummarizingAI(null);
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
    for (const stroke of strokes) drawStroke(ctx, stroke);
    for (const t of texts) drawText(ctx, t);
  };

  useEffect(() => {
    if (activeTab === 'board' && !isTimelapsePlaying) {
      redrawCanvas(boardStrokes, boardTexts);
    }
  }, [activeTab, isTimelapsePlaying]);

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
      ctx.lineWidth = eraserWidth;
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
    drawSegment(p, { x: p.x + 0.01, y: p.y + 0.01 }, boardMode === 'eraser' ? eraserWidth : brushWidth);
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
      if (last) drawSegment(last, p, boardMode === 'eraser' ? eraserWidth : brushWidth);
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
          width: boardMode === 'eraser' ? eraserWidth : brushWidth,
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
    if (!token) return;
    const ok = await confirmDialog({ title: 'ボードを全員分消しますか？', message: '描いた線と付箋がすべて消えます。元に戻せません。', confirmLabel: 'すべて消す', danger: true });
    if (!ok) return;
    try {
      await safeFetch(`${API_BASE_URL}/api/board/clear`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error(err);
    }
  };

  // タイムラプス再生: 描いた順に少しずつ描き直す。長い時は全体が約30秒になるよう倍速
  const handlePlayTimelapse = () => {
    const canvas = canvasRef.current;
    if (!canvas || (boardStrokes.length === 0 && boardTexts.length === 0) || isTimelapsePlaying) return;
    setIsTimelapsePlaying(true);
    setTimelapseProgress(0);
    stopTimelapseRef.current = playTimelapse(canvas, boardStrokes, boardTexts, {
      onProgress: setTimelapseProgress,
      onDone: () => {
        stopTimelapseRef.current = null;
        setIsTimelapsePlaying(false);
      },
    });
  };

  const stopTimelapse = () => {
    stopTimelapseRef.current?.();
    stopTimelapseRef.current = null;
    setIsTimelapsePlaying(false);
  };

  // ボードを離れたら再生を止める
  useEffect(() => {
    if (activeTab !== 'board') stopTimelapse();
  }, [activeTab]);

  // Phase 4: Shared Clipboard Handlers
  // 1文字ごとに送らず、入力が止まってから共有
  const handleUpdateClipboard = (newText: string) => {
    setClipboardText(newText);
    if (!token) return;
    clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => {
      safeFetch(`${API_BASE_URL}/api/clipboard`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: newText })
      }).catch(err => console.error(err));
    }, 400);
  };

  const handleCopyClipboardToOS = () => {
    navigator.clipboard.writeText(clipboardText).catch(() => toast('コピーできませんでした', { kind: 'error' }));
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

  // Filtered assignments (クラス: 全クラス共通のものはどのクラスにも出す)
  const assignViewClass = assignClassView === 'mine' ? (currentUser?.class_no ?? null) : assignClassView === 'all' ? null : assignClassView;
  const filteredAssignments = assignments.filter(a => {
    if (assignViewClass && a.class_no != null && a.class_no !== assignViewClass) return false;
    if (assignmentFilter === 'all') return !a.is_archived;
    return a.my_status === assignmentFilter && !a.is_archived;
  });

  // アイコン画像の変更
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !token) return;
    setIsUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await safeFetch('/api/users/me/avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'アイコンを変更できませんでした');
      setCurrentUser(u => (u ? { ...u, avatar_url: data.avatar_url } : u));
      setOnlineUsers(prev => prev.map(u => (u.id === currentUser?.id ? { ...u, avatar_url: data.avatar_url } : u)));
      toast('アイコンを変更しました', { kind: 'success' });
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // 自分のクラス (時間割・提出物・宿題の既定の表示)
  const handleSetMyClass = async (classNo: number | null) => {
    if (!token) return;
    const res = await safeFetch('/api/users/me/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ classNo }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      toast(d.error || 'クラスを保存できませんでした', { kind: 'error' });
      return;
    }
    setCurrentUser(u => (u ? { ...u, class_no: d.class_no } : u));
    setOnlineUsers(prev => prev.map(u => (u.id === currentUser?.id ? { ...u, class_no: d.class_no } : u)));
    toast(d.class_no ? `自分のクラスを ${d.class_no}組 にしました` : 'クラスの設定を外しました', { kind: 'success' });
  };

  const handleRemoveAvatar = async () => {
    if (!token) return;
    const ok = await confirmDialog({ title: 'アイコンを削除しますか？', message: '頭文字の表示に戻ります。', confirmLabel: '削除する', danger: true });
    if (!ok) return;
    const res = await safeFetch('/api/users/me/avatar', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (res && res.ok) {
      setCurrentUser(u => (u ? { ...u, avatar_url: null } : u));
      setOnlineUsers(prev => prev.map(u => (u.id === currentUser?.id ? { ...u, avatar_url: null } : u)));
      toast('アイコンを削除しました', { kind: 'success' });
    }
  };

  const getMainServerId = (): string => {
    const srv = discordServers.find(s => /2年|２年/.test(s.name || '')) || discordServers[0];
    return srv?.id || '1524703392927191100';
  };

  // チャンネルを所属する Discord サーバーに振り分ける
  const resolveChannelServerId = (ch: ChannelItem): string => {
    if (ch.server_id) return ch.server_id;
    const b = discordBindings.find((x: any) => Number(x.asdfChannelId) === ch.id && x.guildId);
    if (b?.guildId) return b.guildId;
    const chName = String(ch.name || '').toLowerCase();
    if (/rds9|bot/i.test(chName)) {
      const rds9Srv = discordServers.find(s => s.id === '1550475182643347466' || /rds9/i.test(s.name || ''));
      return rds9Srv?.id || '1550475182643347466';
    }
    return getMainServerId();
  };

  useEffect(() => {
    const activeCh = channels.find(c => c.id === activeChannelId);
    if (!activeCh) return;
    const srvId = resolveChannelServerId(activeCh);
    if (srvId !== selectedServerId) {
      setSelectedServerId(srvId);
    }
  }, [activeChannelId, channels]);

  // 画面を離れる時は保存待ちのメモをすぐ保存
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) flushMemoSaveRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

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

          <form onSubmit={handleAuthSubmit} data-allow-tab className="space-y-4 font-mono text-sm">
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

  // ヘッダー: 今日の時程と時間割から「休み / 登校前 / 朝の会 / 授業中 / 休み時間 / 帰りの会 / 放課後」を算出 (毎秒更新)
  const nowForStatus = now;
  const todayRows = todayTimetables.filter(t => t.day_of_week === nowForStatus.getDay());
  const schoolStatus = computeSchoolStatus(nowForStatus, ttConfig, todayRows);
  const todaySlots = daySlots(ttConfig, nowForStatus.getDay(), todayRows);
  const todayItems = todayRows
    .filter(t => t.items && t.items.trim())
    .sort((a, b) => a.period - b.period)
    .map(t => `${t.period}限 ${t.subject}: ${t.items}`);
  const StatusIcon = schoolStatus.kind === 'holiday' ? Sun : schoolStatus.kind === 'before' ? Sunrise : schoolStatus.kind === 'after' ? Moon : BookOpen;
  const WeatherIcon = weatherIcon(weather.weatherCode);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const clockText = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const dateText = `${now.getMonth() + 1}/${now.getDate()}(${DAY_LABELS[now.getDay()]})`;
  const showNotifyBanner = notifyPermission === 'default' && !notifyBannerDismissed && (notifyPrefs.important || notifyPrefs.messages);
  const userById = new Map(onlineUsers.map(u => [u.id, u]));
  const knownUsernames = new Set(onlineUsers.map(u => u.username));
  const channelByName = new Map(channels.filter(c => c.type !== 'voice').map(c => [c.name, c.id]));
  const typingHere = Object.entries(typingUsers).filter(([, v]) => v.channelId === activeChannelId).map(([, v]) => v.username);
  // 今日・明日が期限で、まだやっていない自分のクラスの宿題
  const urgentHomeworkList = homework.filter(h => {
    if (h.my_done || (currentUser.class_no && h.class_no != null && h.class_no !== currentUser.class_no)) return false;
    const d = new Date(`${h.due_date}T00:00:00`).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return d <= 86400000;
  });
  const urgentHomework = urgentHomeworkList.length;
  const unreadAnnouncements = announcements.filter(a => new Date(a.created_at).getTime() > lastReadAnnouncementTime).length;
  const pendingLinkRequests = discordLinkRequests.filter(r => r.status === 'pending');
  const totalNotifications = urgentHomework + unreadAnnouncements + (currentUser.role === 'admin' ? pendingLinkRequests.length : 0);
  const nameOfUser = (id: number) => userById.get(id)?.username;
  const activeChannelObj = channels.find(c => c.id === activeChannelId);
  const activeChannelName = activeChannelObj?.name || 'chat';
  const customEmojisMap = new Map(customEmojisList.map(e => [e.name.toLowerCase(), e.url]));
  const bindingByAsdfId = new Map(discordBindings.map((b: any) => [Number(b.asdfChannelId), b]));
  const activeChannelBinding = bindingByAsdfId.get(activeChannelId);
  const selectedServer = selectedServerId !== 'all' ? discordServers.find(s => s.id === selectedServerId) : null;

  // 補完候補
  const completionItems: { key: string; label: string; insert: string; sub?: string; avatar?: string | null; emojiUrl?: string }[] = (() => {
    if (!completion) return [];
    if (completion.kind === '@') {
      const asdfPool = [
        { key: 'everyone', label: 'everyone', insert: '@everyone', sub: '全員に通知' },
        { key: 'gemini', label: 'gemini', insert: '@gemini', sub: 'AI に質問' },
        ...onlineUsers.filter(u => u.id !== currentUser.id).map(u => ({
          key: `u${u.id}`,
          label: u.username,
          insert: `@${u.username}`,
          avatar: u.avatar_url,
          sub: u.status === 'online' ? 'asdfbase (オンライン)' : 'asdfbase メンバー',
        })),
      ];
      const dcMembers = selectedServer?.members || [];
      const dcPool: { key: string; label: string; insert: string; avatar?: string | null; sub?: string }[] = dcMembers.map((m: any) => ({
        key: `dc-${m.id}`,
        label: m.displayName || m.username,
        insert: `@${m.displayName || m.username}`,
        avatar: m.avatarUrl,
        sub: `Discord (${m.status === 'online' ? 'オンライン' : m.status || 'メンバー'})`,
      }));
      const rankedAsdf = rankCandidates(asdfPool, completion.query, (x: any) => x.label).slice(0, 5);
      const rankedDc = rankCandidates(dcPool, completion.query, (x: any) => x.label).slice(0, 5);
      return [...rankedAsdf, ...rankedDc];
    }
    if (completion.kind === ':') {
      const customPool = customEmojisList.map(e => ({
        key: `ce-${e.name}`,
        label: e.name,
        insert: `:${e.name}:`,
        sub: 'カスタム絵文字',
        emojiUrl: e.url,
      }));
      const builtinPool = Object.entries(BUILTIN_SHORTCODES)
        .filter(([k]) => !customEmojisMap.has(k))
        .map(([k, v]) => ({
          key: `be-${k}`,
          label: k,
          insert: `:${k}:`,
          sub: v,
        }));
      return rankCandidates([...customPool, ...builtinPool], completion.query, x => x.label).slice(0, 8);
    }
    const pool = channels.filter(c => c.type !== 'voice').map(c => ({ key: `c${c.id}`, label: c.name, insert: `#${c.name}` }));
    return rankCandidates(pool, completion.query, x => x.label).slice(0, 8);
  })();

  const slashCandidates = chatInput.startsWith('/') && !chatInput.startsWith('//') && !chatInput.includes(' ')
    ? [
        { cmd: '/ai', label: '/ai <質問>', desc: 'AIに直接質問します' },
        { cmd: '/timetable', label: '/timetable', desc: '時間割モーダルを開きます' },
        { cmd: '/tt', label: '/tt', desc: '時間割モーダルを開きます (短縮)' },
        { cmd: '/hw', label: '/hw', desc: '宿題タブへ移動します' },
        { cmd: '/tasks', label: '/tasks', desc: '提出物タブへ移動します' },
        { cmd: '/memo', label: '/memo <1-10>', desc: '指定のメモスロットを開きます' },
        { cmd: '/board', label: '/board', desc: 'ホワイトボードを開きます' },
        { cmd: '/status', label: '/status <online|busy|away>', desc: 'ステータスを変更します' },
        { cmd: '/clear', label: '/clear', desc: '入力欄をクリアします' },
        { cmd: '/help', label: '/help', desc: 'ヘルプを開きます' },
      ].filter(c => c.cmd.startsWith(chatInput.toLowerCase()))
    : [];

  const updateCompletion = (value: string, caret: number) => {
    const tok = findCompletionToken(value, caret);
    setCompletion(prev => (tok ? { ...tok, index: prev && prev.kind === tok.kind && prev.start === tok.start ? prev.index : 0 } : null));
  };

  const applyCompletion = (item: { insert: string }) => {
    if (!completion) return;
    const el = chatInputRef.current;
    const caret = el ? el.selectionStart : chatInput.length;
    const before = chatInput.slice(0, completion.start);
    const after = chatInput.slice(caret).replace(/^\S*/, '');
    const inserted = `${item.insert} `;
    const next = `${before}${inserted}${after.replace(/^\s/, '')}`;
    setChatInput(next);
    setCompletion(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = before.length + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const headerChip = 'flex items-center gap-1.5 border px-2 sm:px-2.5 py-1 rounded-lg transition hover:-translate-y-px';

  return (
    <div 
      className="bg-[#090A0C] text-[#D6D3D1] flex flex-col font-['Inter'] overflow-hidden"
      // 画面1枚に収める: zoom で縮小しても実表示がちょうど 100dvh になるよう補正
      style={{ zoom: `${uiScale}%`, height: `calc(100dvh * ${100 / uiScale})` }}
    >
      {/* 1. TOP BAR */}
      <header className="relative h-12 md:h-14 shrink-0 border-b border-stone-800/80 bg-[#090A0C]/90 backdrop-blur-md z-50 px-2 sm:px-4 flex items-center justify-between select-none gap-2">
        <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0 overflow-hidden mr-1">
          <div 
            onClick={() => setActiveTab('chat')}
            className="logo-container mr-1 lg:mr-2 font-['Space_Grotesk'] font-extrabold text-base sm:text-lg flex items-center tracking-wider shrink-0"
          >
            <span className="text-white">asdfbase</span>
            <span className="logo-dot">.</span>
          </div>

          <nav className="hidden md:flex items-center gap-0.5 lg:gap-1 font-mono text-xs overflow-x-auto no-scrollbar min-w-0 py-1">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  className={`relative px-2 lg:px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 whitespace-nowrap border ${
                    isActive 
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                      : 'text-stone-400 border-transparent hover:text-stone-100 hover:bg-stone-800/70 hover:border-stone-700/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{tab.label}</span>
                  {tab.id === 'chat' && totalMentions > 0 && (
                    <span className="anim-badge min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center">
                      {totalMentions > 99 ? '99+' : totalMentions}
                    </span>
                  )}
                  {tab.id === 'chat' && totalMentions === 0 && totalUnread > 0 && activeTab !== 'chat' && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
                  )}
                  {tab.id === 'homework' && urgentHomework > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold leading-[18px] text-center" title="今日・明日までの宿題">
                      {urgentHomework}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Header Block: ホバーで概要、クリックで詳細 */}
        <div className="flex items-center gap-1 sm:gap-1.5 font-mono text-[11px] sm:text-xs shrink-0">
          {/* 通知ボタン (放課後などの左隣) */}
          <div ref={notifyPopoverContainerRef} className="relative">
            <button
              onClick={() => {
                const nowTs = Date.now();
                setIsNotifyPopoverOpen(v => !v);
                setLastReadAnnouncementTime(nowTs);
                localStorage.setItem('asdf_last_read_announcement', String(nowTs));
                syncPreferencesToServer({ lastReadAnnouncementTime: nowTs });
              }}
              title="通知とお知らせ"
              className={`${headerChip} relative text-stone-300 bg-stone-900/60 border-stone-800/70 hover:bg-stone-800/80 hover:border-stone-600 ${
                totalNotifications > 0 ? '!border-amber-500/50 !bg-amber-500/10 text-amber-300' : ''
              }`}
            >
              <Bell className={`w-3.5 h-3.5 ${totalNotifications > 0 ? 'text-amber-400' : 'text-stone-400'}`} />
              <span className="hidden sm:inline">通知</span>
              {totalNotifications > 0 && (
                <span className="anim-badge min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold leading-[16px] text-center">
                  {totalNotifications}
                </span>
              )}
            </button>

            {/* 通知ポップオーバー */}
            {isNotifyPopoverOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl z-50 p-3 space-y-3 anim-pop text-xs text-stone-300 max-h-[80vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 border-b border-stone-800">
                  <div className="flex items-center gap-2 font-bold text-white text-sm">
                    <Bell className="w-4 h-4 text-amber-400" />
                    <span>通知とお知らせ</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {currentUser?.role === 'admin' && (
                      <button
                        onClick={() => {
                          setIsNotifyPopoverOpen(false);
                          setIsNewAnnouncementModalOpen(true);
                        }}
                        className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold hover:bg-amber-500/30"
                      >
                        + お知らせ作成
                      </button>
                    )}
                    <button onClick={() => setIsNotifyPopoverOpen(false)} className="p-1 text-stone-500 hover:text-white rounded-lg">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Discord連携承認待ちリクエスト (admin / rds9 専用) */}
                {currentUser?.role === 'admin' && pendingLinkRequests.length > 0 && (
                  <div className="space-y-1.5 pb-2 border-b border-stone-800/80">
                    <div className="text-[10px] uppercase font-bold text-indigo-400 flex items-center gap-1">
                      <Server className="w-3 h-3" />
                      <span>Discord 連携の承認待ち ({pendingLinkRequests.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {pendingLinkRequests.map((req: any) => (
                        <div key={req.id} className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-1.5">
                          <div className="text-[11px] text-indigo-200 font-bold">
                            {req.requester_username} が Discord #{req.discord_channel_name} の同期をリクエスト
                          </div>
                          <div className="text-[10px] text-stone-400">
                            サーバー: {req.guild_name || req.guild_id} → asdfbase #{req.new_channel_name || req.asdf_channel_id}
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleApproveDiscordRequest(req.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500 text-black font-bold text-[10px] hover:bg-emerald-400"
                            >
                              許可して連携
                            </button>
                            <button
                              onClick={() => handleRejectDiscordRequest(req.id)}
                              className="px-2.5 py-1 rounded-lg bg-stone-800 text-stone-300 text-[10px] hover:bg-red-950 hover:text-red-300"
                            >
                              却下
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* システム通知: 宿題期限 */}
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase font-bold text-amber-400 flex items-center gap-1">
                    <BookOpenCheck className="w-3 h-3" />
                    <span>宿題・提出物リマインド</span>
                  </div>
                  {urgentHomeworkList.length === 0 ? (
                    <div className="text-stone-500 text-[11px] py-1">直近締切の宿題はありません 👍</div>
                  ) : (
                    <div className="space-y-1">
                      {urgentHomeworkList.map(h => (
                        <div
                          key={h.id}
                          onClick={() => {
                            setActiveTab('homework');
                            setIsNotifyPopoverOpen(false);
                          }}
                          className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 cursor-pointer transition flex items-center justify-between"
                        >
                          <div>
                            <div className="font-bold text-amber-200">[{h.subject}] {h.content}</div>
                            <div className="text-[10px] text-amber-400/80">期限: {h.due_date}</div>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black font-bold">宿題へ</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* adminからのお知らせ */}
                <div className="space-y-1.5 pt-2 border-t border-stone-800/80">
                  <div className="text-[10px] uppercase font-bold text-sky-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>お知らせ</span>
                  </div>
                  {announcements.length === 0 ? (
                    <div className="text-stone-500 text-[11px] py-1">お知らせはありません</div>
                  ) : (
                    <div className="space-y-1.5">
                      {announcements.map(a => (
                        <div key={a.id} className="p-2.5 rounded-xl bg-stone-900/70 border border-stone-800 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white text-[12px]">{a.title}</span>
                            {currentUser?.role === 'admin' && (
                              <button
                                onClick={() => handleDeleteAnnouncement(a.id)}
                                className="text-stone-500 hover:text-red-400 p-0.5"
                                title="削除"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="text-stone-300 text-[11px] whitespace-pre-wrap leading-relaxed">{a.content}</div>
                          <div className="text-[10px] text-stone-500 flex items-center justify-between pt-1">
                            <span>投稿者: {a.username}</span>
                            <span>{new Date(a.created_at).toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <HoverCard
            title="時間割"
            onClick={() => {
              handleFetchTimetables();
              setIsTimetableModalOpen(true);
            }}
            className={`${headerChip} ${
              schoolStatus.kind === 'holiday' || schoolStatus.kind === 'after' || schoolStatus.kind === 'before'
                ? 'bg-stone-900/60 border-stone-800 text-stone-300 hover:bg-stone-800/80 hover:border-stone-600'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
            }`}
            trigger={
              <>
                <StatusIcon className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-bold max-w-[7rem] sm:max-w-none truncate">{schoolStatus.label}</span>
                {schoolStatus.sub && <span className="text-stone-400 text-[10px] hidden xl:inline">({schoolStatus.sub})</span>}
                {todayItems.length > 0 && <Backpack className="w-3 h-3 text-stone-400 hidden sm:block" />}
                {todaySchedule !== 'normal' && (
                  <span className="text-[9px] px-1 rounded bg-amber-500 text-black font-bold">{todaySchedule === 'short' ? '短縮' : 'S短'}</span>
                )}
              </>
            }
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold">今日の時間割</span>
                <span className="text-stone-500">{SCHEDULE_LABELS[todaySchedule]}</span>
              </div>
              {schoolStatus.kind === 'holiday' ? (
                <div className="text-stone-500">今日は休みです</div>
              ) : (
                <div className="space-y-0.5">
                  {todaySlots.map(slot => (
                    <div
                      key={slot.key}
                      className={`flex items-center gap-2 px-2 py-1 rounded-lg ${slot.key === schoolStatus.currentKey ? 'bg-amber-500/15 text-amber-200' : 'text-stone-300'}`}
                    >
                      <span className="w-14 shrink-0 font-bold text-amber-400/90">{slot.label}</span>
                      <span className="flex-1 truncate">{slot.subject || (slot.key.startsWith('p') ? '—' : '')}</span>
                      <span className="text-stone-500 tabular-nums text-[10px]">{slot.time.start}〜{slot.time.end}</span>
                    </div>
                  ))}
                </div>
              )}
              {todayItems.length > 0 && (
                <div className="pt-2 border-t border-stone-800 space-y-0.5">
                  <div className="text-stone-400 font-bold flex items-center gap-1"><Backpack className="w-3 h-3" /> 持ち物</div>
                  {todayItems.map(item => <div key={item} className="text-stone-300">{item}</div>)}
                </div>
              )}
              <div className="text-[10px] text-stone-600 text-right">クリックで時間割を開く</div>
            </div>
          </HoverCard>

          <HoverCard
            title="天気"
            onClick={() => setShowWeather(true)}
            className={`${headerChip} text-stone-300 bg-stone-900/60 border-stone-800/70 hover:bg-stone-800/80 hover:border-stone-600`}
            trigger={
              <>
                <WeatherIcon className="w-3.5 h-3.5 text-amber-400" />
                <span className="tabular-nums">{weather.temp === null ? '--' : weather.temp}℃</span>
                <span className="hidden sm:inline">{weather.desc}</span>
                {weather.precipProb != null && (
                  <span className="hidden lg:inline-flex items-center gap-0.5 text-[10px] text-sky-300">
                    <Umbrella className="w-3 h-3" />{weather.precipProb}%
                  </span>
                )}
              </>
            }
          >
            <WeatherHoverSummary weather={weather} />
          </HoverCard>

          <HoverCard
            title="カレンダー"
            onClick={() => setShowCalendar(true)}
            panelClassName="w-72"
            className={`${headerChip} text-stone-300 bg-stone-900/60 border-stone-800/70 hover:bg-stone-800/80 hover:border-stone-600`}
            trigger={
              <>
                <CalendarClock className="w-3.5 h-3.5 text-amber-400 hidden sm:block" />
                <span className="hidden lg:inline text-stone-400">{dateText}</span>
                <span className="tabular-nums">{clockText}<span className="hidden xl:inline text-stone-500">:{pad2(now.getSeconds())}</span></span>
              </>
            }
          >
            <CalendarHoverSummary now={now} events={calendarEvents} />
          </HoverCard>

          <button
            onClick={() => setShowCamera(!showCamera)}
            title="カメラ小窓"
            className={`hidden sm:block p-1.5 rounded-lg border ${
              showCamera 
                ? 'bg-amber-500 text-black border-amber-400' 
                : 'bg-stone-900/80 border-stone-800 text-stone-400 hover:text-amber-400 hover:border-stone-600'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleLogout}
            title="ログアウト"
            className="hidden sm:block p-1.5 rounded-lg bg-stone-900/80 border border-stone-800 text-stone-500 hover:text-red-400 hover:border-red-900"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 通知の許可・オフライン表示 */}
      {showNotifyBanner && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-200 anim-fade">
          <BellRing className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="flex-1 min-w-0">メンションや新しい提出物を通知で受け取るには、通知を許可してください</span>
          <button onClick={requestNotifyPermission} className="shrink-0 px-3 py-1 rounded-lg btn-primary font-bold">許可する</button>
          <button
            onClick={() => {
              setNotifyBannerDismissed(true);
              LS.set('asdf_notify_banner_dismissed', '1');
            }}
            className="shrink-0 p-1 rounded text-amber-300/70 hover:text-white"
            aria-label="閉じる"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {wsStatus === 'offline' && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-red-950/50 border-b border-red-900/60 text-xs text-red-200 anim-fade">
          <WifiOff className="w-3.5 h-3.5" /> オフラインです。つながると自動で同期します
        </div>
      )}

      {/* 2. MAIN CONTENT BODY */}
      <main className="flex-1 min-h-0 flex overflow-hidden">
        {/* TAB 1: リアルタイムチャット (3ペイン: チャンネル / チャット / メンバー) */}
        {activeTab === 'chat' && (
          <div className="flex-1 min-h-0 flex overflow-hidden relative anim-tab">
            {/* スマホ: チャンネル・メンバー一覧はドロワー */}
            {(!isChannelsCollapsed || !isMembersCollapsed) && (
              <div
                className={`absolute inset-0 bg-black/50 z-30 anim-fade ${!isChannelsCollapsed ? 'md:hidden' : 'lg:hidden'}`}
                onClick={() => {
                  if (isSmallScreen()) setIsChannelsCollapsed(true);
                  if (window.innerWidth < 1024) setIsMembersCollapsed(true);
                }}
              />
            )}

            {/* Channels Sidebar (左にサーバーレール + チャンネル一覧) */}
            {!isChannelsCollapsed && (
              <aside className="absolute md:static inset-y-0 left-0 z-40 w-80 md:w-72 lg:w-80 border-r border-stone-800 bg-[#0C0D10] flex flex-row shrink-0 min-h-0 overflow-hidden anim-slide-left md:animate-none shadow-2xl md:shadow-none">
                {/* 左端: Discord風 サーバーレール (プロキシ/ローカルキャッシュアイコン表示 & VC/メンションバッジ) */}
                <div className="w-12 border-r border-stone-800/80 bg-[#08090B] flex flex-col items-center py-2.5 gap-2 overflow-y-auto shrink-0 select-none">
                  {discordServers.map((srv: any) => {
                    const isSelected = selectedServerId === srv.id;
                    const vcsList = Array.isArray(srv.voiceChannels) ? srv.voiceChannels : Array.isArray(srv.vcs) ? srv.vcs : [];
                    const vcCount = vcsList.reduce((s: number, v: any) => s + (v.members?.length || 0), 0);
                    const srvChannels = channels.filter(c => c.type !== 'voice' && resolveChannelServerId(c) === srv.id);
                    const srvUnread = srvChannels.reduce((s, c) => s + (c.id === activeChannelId ? 0 : (unreadCounts[c.id] || 0)), 0);
                    const srvMentions = srvChannels.reduce((s, c) => s + (c.id === activeChannelId ? 0 : (mentionCounts[c.id] || 0)), 0);
                    return (
                      <button
                        key={srv.id}
                        type="button"
                        onClick={() => {
                          setSelectedServerId(srv.id);
                          if (srvChannels.length > 0 && !srvChannels.some(c => c.id === activeChannelId)) {
                            setActiveChannelId(srvChannels[0].id);
                          }
                        }}
                        title={`${srv.name}${vcCount > 0 ? ` (VC ${vcCount}人)` : ''}`}
                        className={`relative w-9 h-9 rounded-2xl flex items-center justify-center transition group ${
                          isSelected
                            ? 'ring-2 ring-indigo-400 rounded-xl bg-indigo-500/20'
                            : 'bg-[#14161C] hover:bg-stone-800 hover:rounded-xl border border-stone-800/80'
                        }`}
                      >
                        {isSelected ? (
                          <span className="absolute -left-1.5 w-1 h-5 rounded-r bg-indigo-400" />
                        ) : srvUnread > 0 ? (
                          <span className="absolute -left-1.5 w-1 h-2.5 rounded-r bg-white" />
                        ) : null}
                        {srv.iconUrl ? (
                          <img
                            src={toProxiedMediaUrl(srv.iconUrl, token)}
                            alt={srv.name}
                            className="w-full h-full rounded-[inherit] object-cover"
                          />
                        ) : (
                          <span className="text-xs font-bold text-indigo-200 truncate px-1">
                            {String(srv.name || 'DC').slice(0, 2)}
                          </span>
                        )}
                        {srvMentions > 0 ? (
                          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-4 text-center border border-[#08090B]">
                            {srvMentions > 99 ? '99+' : srvMentions}
                          </span>
                        ) : vcCount > 0 ? (
                          <span
                            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-indigo-500 text-white text-[9px] font-bold leading-4 text-center border border-[#08090B]"
                            title={`VC参加中 ${vcCount}人`}
                          >
                            🔊
                          </span>
                        ) : null}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      fetchDiscordServers();
                      if (!linkGuildId && discordServers[0]?.id) setLinkGuildId(discordServers[0].id);
                      setShowDiscordServerModal(true);
                    }}
                    title="Discord サーバー・簡単チャンネル紐付け・履歴取得"
                    className="relative w-9 h-9 rounded-2xl bg-[#14161C] border border-dashed border-stone-700 hover:border-indigo-400 text-stone-400 hover:text-indigo-300 flex items-center justify-center transition mt-auto"
                  >
                    <Server className="w-4 h-4" />
                    {currentUser?.role === 'admin' && pendingLinkRequests.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold leading-4 text-center">
                        {pendingLinkRequests.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* 右側: サーバー情報 & チャンネル一覧 */}
                <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2 sm:p-2.5">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-stone-400 px-1.5 mb-1.5 font-bold shrink-0 gap-1">
                    <span className="truncate text-stone-200">
                      {selectedServer ? selectedServer.name : 'asdfbase'}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSyncDiscordHistory(selectedServer ? { guildId: selectedServer.id } : undefined)}
                        disabled={isSyncingDiscordHistory}
                        className="p-1 hover:text-indigo-300 rounded text-stone-400 hover:bg-stone-800 disabled:opacity-40"
                        title="Botダウンタイム中のDiscord未取得履歴を同期"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingDiscordHistory ? 'animate-spin text-indigo-400' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          fetchDiscordServers();
                          if (selectedServer) setLinkGuildId(selectedServer.id);
                          else if (!linkGuildId && discordServers[0]?.id) setLinkGuildId(discordServers[0].id);
                          setShowDiscordServerModal(true);
                        }}
                        className="p-1 hover:text-indigo-300 rounded text-stone-400 hover:bg-stone-800"
                        title="Discord Bot 簡単紐付け・サーバー状態"
                      >
                        <Link className="w-3.5 h-3.5" />
                      </button>
                      {currentUser?.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setShowRoleManagerModal(true)}
                          className="p-1 hover:text-amber-400 rounded text-stone-400 hover:bg-stone-800"
                          title="ロール管理・メンバー権限設定 (admin専用)"
                        >
                          <Shield className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {currentUser?.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewChannelServerId(
                              selectedServerId !== 'all'
                                ? selectedServerId
                                : (discordServers[0]?.id || '1524703392927191100')
                            );
                            setIsNewChannelModalOpen(true);
                          }}
                          className="p-1 hover:text-amber-400 rounded text-stone-400 hover:bg-stone-800"
                          title="チャンネルを作成"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 選択中のDiscordサーバーの人数・オンライン・VC・喋ってる人サマリー */}
                  {selectedServer && (() => {
                    const vcsList = Array.isArray(selectedServer.voiceChannels)
                      ? selectedServer.voiceChannels.filter((v: any) => (v.members?.length || 0) > 0)
                      : Array.isArray(selectedServer.vcs)
                        ? selectedServer.vcs.filter((v: any) => (v.members?.length || 0) > 0)
                        : [];
                    const membersList = Array.isArray(selectedServer.members)
                      ? selectedServer.members
                      : Array.isArray(selectedServer.onlineMembers)
                        ? selectedServer.onlineMembers
                        : [];
                    return (
                      <div className="mb-2 p-2 rounded-xl bg-[#12141B] border border-indigo-500/25 text-[11px] space-y-1.5 shrink-0">
                        <div className="flex items-center justify-between text-stone-300">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            <b className="text-emerald-300">{selectedServer.onlineCount || 0}</b> オンライン
                          </span>
                          <span className="text-stone-400">全 <b>{selectedServer.memberCount || 0}</b> 人</span>
                        </div>
                        {vcsList.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-stone-800/80">
                            {vcsList.map((vc: any) => (
                              <div key={vc.id || vc.channelId} className="space-y-0.5">
                                <div className="text-[10px] font-bold text-indigo-300 flex items-center gap-1">
                                  <Volume2 className="w-3 h-3 animate-pulse" /> {vc.name || vc.channelName} ({vc.members?.length || 0})
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {(vc.members || []).map((m: any) => {
                                    const mName = m.displayName || m.name || m.username;
                                    const isMuted = m.selfMute || m.serverMute || m.muted;
                                    return (
                                      <span
                                        key={m.id}
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border ${
                                          m.speaking
                                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 font-bold'
                                            : 'bg-stone-900 border-stone-800 text-stone-300'
                                        }`}
                                        title={`${mName}${m.speaking ? ' (発話中/マイクON)' : isMuted ? ' (ミュート)' : ''}${m.streaming ? ' [画面共有中]' : ''}`}
                                      >
                                        {m.avatarUrl ? (
                                          <img src={toProxiedMediaUrl(m.avatarUrl, token)} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                                        ) : (
                                          <span className={`w-1.5 h-1.5 rounded-full ${m.speaking ? 'bg-emerald-400 animate-ping' : 'bg-stone-500'}`} />
                                        )}
                                        <span className="max-w-[80px] truncate">{mName}</span>
                                        {m.speaking ? <Mic className="w-2.5 h-2.5 text-emerald-400" /> : isMuted ? <MicOff className="w-2.5 h-2.5 text-stone-500" /> : null}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {membersList.length > 0 && (
                          <div className="pt-1 border-t border-stone-800/80">
                            <div className="flex flex-wrap gap-1 max-h-14 overflow-y-auto">
                              {membersList.slice(0, 18).map((m: any) => {
                                const mName = m.displayName || m.name || m.username;
                                return (
                                  <span
                                    key={m.id}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-900/90 border border-stone-800 text-[10px] text-stone-300"
                                    title={`${mName} (${m.status})`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'online' ? 'bg-emerald-400' : m.status === 'idle' ? 'bg-amber-400' : 'bg-red-400'}`} />
                                    <span className="max-w-[72px] truncate">{mName}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* チャンネル一覧: 収まらない時はこの中だけスクロール */}
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-0.5">
                    {channels
                      .filter(ch => {
                        if (ch.type === 'voice') return false;
                        return resolveChannelServerId(ch) === selectedServerId;
                      })
                      .map((ch, idx, textChannels) => {
                      const isActiveCh = activeChannelId === ch.id;
                      const unread = isActiveCh ? 0 : (unreadCounts[ch.id] || 0);
                      const mentions = isActiveCh ? 0 : (mentionCounts[ch.id] || 0);
                      const binding = bindingByAsdfId.get(ch.id);
                      const hasRoleRestriction = (Array.isArray(ch.view_roles) && ch.view_roles.length > 0) || (Array.isArray(ch.write_roles) && ch.write_roles.length > 0);
                      return (
                      <div
                        key={ch.id}
                        className={`group relative flex items-center justify-between pl-2.5 pr-1.5 py-1.5 rounded-lg text-sm transition ${
                          isActiveCh
                            ? 'bg-amber-500/15 text-amber-300 font-bold'
                            : unread > 0
                              ? 'text-white font-bold bg-white/[0.04] hover:bg-stone-800/60'
                              : 'text-stone-400 hover:bg-stone-900/60 hover:text-stone-200'
                        }`}
                      >
                        {/* 左端インジケーター: 選択中=アンバーのバー / 未読=白い点 */}
                        {isActiveCh ? (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-amber-400" />
                        ) : unread > 0 ? (
                          <span className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white anim-badge" />
                        ) : null}
                        <button
                          onClick={() => setActiveChannelId(ch.id)}
                          className="flex items-center gap-1.5 flex-1 text-left min-w-0"
                        >
                          <Hash className={`w-3.5 h-3.5 shrink-0 ${isActiveCh ? 'text-amber-400' : binding ? 'text-indigo-400' : unread > 0 ? 'text-stone-200' : 'text-stone-600'}`} />
                          <span className="truncate flex-1">{ch.name}</span>
                          {binding && (
                            <span
                              className="shrink-0 text-[9px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono"
                              title={`Discord #${binding.discordChannelName} と同期中`}
                            >
                              DC
                            </span>
                          )}
                          {hasRoleRestriction && (
                            <span title="ロール制限チャンネル" className="shrink-0">
                              <Shield className="w-3 h-3 text-amber-400/80" />
                            </span>
                          )}
                        </button>

                        <div className="flex items-center gap-0.5 shrink-0 ml-1">
                          {/* メンションされた時だけ赤い数字 */}
                          {mentions > 0 && (
                            <span className="anim-badge min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center shadow">
                              {mentions > 99 ? '99+' : mentions}
                            </span>
                          )}

                          {/* チャンネル操作: ホバー時のみ表示して通常時はチャンネル名の幅を広く確保 */}
                          <div className="hidden group-hover:flex items-center">
                            {binding && (
                              <button
                                type="button"
                                onClick={() => handleUnbindDiscordChannel({ asdfChannelId: ch.id, discordChannelId: binding.discordChannelId, label: `#${ch.name}` })}
                                className="p-0.5 hover:text-amber-400 text-indigo-400 mr-0.5"
                                title="Discord同期を解除"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                            {currentUser?.role === 'admin' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setChannelPermModal({
                                    ...ch,
                                    view_roles: Array.isArray(ch.view_roles) ? ch.view_roles : [],
                                    write_roles: Array.isArray(ch.write_roles) ? ch.write_roles : [],
                                  })}
                                  className="p-0.5 hover:text-amber-400 text-stone-500 mr-0.5"
                                  title="チャンネルのロール・権限・サーバー設定 (admin専用)"
                                >
                                  <Shield className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingChannel({ id: ch.id, name: ch.name });
                                    setEditChannelNameInput(ch.name);
                                  }}
                                  className="p-0.5 hover:text-amber-400 text-stone-500 mr-0.5"
                                  title="チャンネル名を変更"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            {currentUser?.role === 'admin' && idx > 0 && (
                              <button
                                onClick={e => handleMoveChannel(e, idx, 'up', textChannels)}
                                className="p-0.5 hover:text-amber-400 text-stone-500 text-[10px]"
                                title="上へ移動"
                              >
                                ▲
                              </button>
                            )}
                            {currentUser?.role === 'admin' && idx < textChannels.length - 1 && (
                              <button
                                onClick={e => handleMoveChannel(e, idx, 'down', textChannels)}
                                className="p-0.5 hover:text-amber-400 text-stone-500 text-[10px]"
                                title="下へ移動"
                              >
                                ▼
                              </button>
                            )}
                          </div>

                          {channels.length > 1 && (currentUser?.role === 'admin' || Boolean(binding) || Boolean(ch.server_id)) && (
                            <button
                              onClick={() => handleDeleteChannel(ch.id)}
                              className="hidden group-hover:inline-flex p-0.5 hover:text-red-400 rounded text-stone-500"
                              title="チャンネル削除"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {selectedServer && channels.filter(ch => ch.type !== 'voice' && resolveChannelServerId(ch) === selectedServer.id).length === 0 && (
                      <div className="p-3 text-center text-xs text-stone-500 space-y-2 border border-dashed border-stone-800 rounded-xl mt-2">
                        <div>このサーバーに紐付いたチャンネルがまだありません</div>
                        <button
                          type="button"
                          onClick={() => {
                            setLinkGuildId(selectedServer.id);
                            setShowDiscordServerModal(true);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold hover:bg-indigo-500/30"
                        >
                          + Discordチャンネルを紐付ける
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            )}

            {/* Center: メインチャット */}
            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#090A0C] overflow-hidden">
              <div className="h-12 shrink-0 border-b border-stone-800/80 px-2 sm:px-4 flex items-center justify-between gap-2 bg-[#0C0D10]/50 font-mono text-xs">
                <div className="flex items-center gap-2 font-bold text-white min-w-0">
                  <button
                    onClick={() => setIsChannelsCollapsed(!isChannelsCollapsed)}
                    className="relative p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-stone-600 shrink-0"
                    title={isChannelsCollapsed ? 'チャンネル一覧を表示' : 'チャンネル一覧を隠す'}
                  >
                    {isChannelsCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                    {isChannelsCollapsed && totalMentions > 0 && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[#0C0D10]" />
                    )}
                  </button>
                  <Hash className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm truncate">{activeChannelName}</span>
                  {activeChannelBinding && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-normal shrink-0">
                      <span>Discord #{activeChannelBinding.discordChannelName}</span>
                      <button
                        type="button"
                        onClick={() => handleSyncDiscordHistory({ asdfChannelId: activeChannelId, discordChannelId: activeChannelBinding.discordChannelId })}
                        disabled={isSyncingDiscordHistory}
                        className="hover:text-white ml-0.5"
                        title="Botダウンタイム中の履歴を取得"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSyncingDiscordHistory ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnbindDiscordChannel({ asdfChannelId: activeChannelId, discordChannelId: activeChannelBinding.discordChannelId, label: `#${activeChannelName}` })}
                        className="hover:text-red-300 ml-0.5"
                        title="Discord同期を解除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  <span
                    className={`ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-normal cursor-pointer shrink-0 ${
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
                        ? `接続中${activeTransport && activeTransport !== 'ws' ? ` (${TRANSPORT_LABELS[activeTransport]})` : ''}`
                        : wsStatus === 'offline' ? 'オフライン' : wsStatus === 'connecting' ? '接続中…' : '再接続中…'}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isSearchOpen ? (
                    <div className="flex items-center gap-1.5 bg-[#16181D] border border-stone-800 px-2 py-1 rounded-lg anim-fade">
                      <Search className="w-3.5 h-3.5 text-stone-500" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="検索"
                        value={chatSearchQuery}
                        onChange={e => setChatSearchQuery(e.target.value)}
                        className="bg-transparent text-white focus:outline-none w-24 sm:w-44 text-[11px]"
                      />
                      <button onClick={() => { setIsSearchOpen(false); setChatSearchQuery(''); }} className="text-stone-500 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsSearchOpen(true)}
                      className="p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-stone-600"
                      title="検索"
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => setIsMembersCollapsed(!isMembersCollapsed)}
                    className="p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 hover:text-white hover:border-stone-600"
                    title={isMembersCollapsed ? 'メンバー一覧を表示' : 'メンバー一覧を隠す'}
                  >
                    {isMembersCollapsed ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="relative flex-1 min-h-0 flex flex-col">
              <div ref={chatScrollContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-1.5 sm:px-4 py-3">
                {/* 過去ログ読み込み (上端で自動 / 手動ボタン) */}
                {hasMoreMessages && messages.length > 0 && !chatSearchQuery && (
                  <div className="flex justify-center py-2">
                    <button
                      onClick={handleLoadMoreMessages}
                      disabled={isLoadingMoreMessages}
                      className="px-4 py-1.5 rounded-full bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                    >
                      {isLoadingMoreMessages ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                          <span>読み込み中…</span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="w-3.5 h-3.5 rotate-180 text-amber-400" />
                          <span>過去のメッセージ</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {!hasMoreMessages && messages.length > 0 && !chatSearchQuery && (
                  <div className="text-center text-[11px] text-stone-600 py-3">
                    #{activeChannelName} の最初のメッセージです
                  </div>
                )}

                {messages.filter(m => !chatSearchQuery || (m.content || '').toLowerCase().includes(chatSearchQuery.toLowerCase())).length === 0 ? (
                  channelLoadState !== 'ready' && !chatSearchQuery ? (
                    <div className="h-full flex flex-col items-center justify-center text-stone-500 text-xs space-y-3 anim-fade">
                      {channelLoadState === 'loading' ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                          <p>メッセージを読み込み中…</p>
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-7 h-7 text-red-400" />
                          <p>メッセージを読み込めませんでした。自動で再試行しています</p>
                          <button onClick={() => loadChannelMessages(activeChannelId)} className="px-3 py-1.5 rounded-lg btn-primary font-bold">
                            今すぐ再読み込み
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                  <div className="h-full flex flex-col items-center justify-center text-stone-600 text-xs space-y-2 anim-fade">
                    <MessageSquare className="w-8 h-8 opacity-40 text-amber-400" />
                    <p>{chatSearchQuery ? '見つかりませんでした' : 'まだメッセージはありません'}</p>
                  </div>
                  )
                ) : (
                  messages
                    .filter(m => !chatSearchQuery || (m.content || '').toLowerCase().includes(chatSearchQuery.toLowerCase()))
                    .map((m, mIdx, filteredList) => {
                      const lastReadId = unreadAnchor && unreadAnchor.channelId === activeChannelId ? unreadAnchor.lastReadId : 0;
                      const prevMsg = mIdx > 0 ? filteredList[mIdx - 1] : null;
                      const isMine = m.user_id === currentUser?.id;
                      const isUnread = lastReadId > 0 && m.id > lastReadId && !isMine;
                      const isFirstUnread = isUnread && (!prevMsg || prevMsg.id <= lastReadId || prevMsg.id < 0);
                      const senderName = m.sender_username || m.username || 'unknown';
                      const { name: displayName, fromDiscord } = splitSenderName(senderName);
                      const isGemini = senderName === 'Gemini';
                      const created = new Date(m.created_at);
                      const prevCreated = prevMsg ? new Date(prevMsg.created_at) : null;
                      const isNewDay = !prevCreated || prevCreated.toDateString() !== created.toDateString();
                      const isSamePerson = Boolean(
                        (m.user_id && prevMsg?.user_id && m.user_id === prevMsg.user_id) ||
                        (prevMsg && (prevMsg.sender_username || prevMsg.username) === senderName)
                      );
                      // 同じ人が5分以内に連投した場合はアバター/名前を省略してまとめる
                      const isGrouped = Boolean(
                        prevMsg && !isNewDay && !isFirstUnread && !m.is_pinned && !prevMsg.is_pinned && !m.reply_to &&
                        isSamePerson &&
                        created.getTime() - (prevCreated?.getTime() || 0) < 5 * 60 * 1000
                      );
                      const isMentioningMe = Boolean(
                        currentUser && !isMine && ((m.content || '').includes(`@${currentUser.username}`) || (m.content || '').includes('@everyone') || m.reply_to?.user_id === currentUser.id)
                      );
                      const timeLabel = created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                      return (
                        <React.Fragment key={m.client_nonce || m.id}>
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
                            // スマホ: 長押しで操作メニュー (ホバーのボタンが出ないため)
                            onTouchStart={e => {
                              if (m.id <= 0 || editingMessageId === m.id) return;
                              if ((e.target as HTMLElement).closest('button, a, textarea, input')) return;
                              const t = e.touches[0];
                              clearTimeout(msgLongPressRef.current?.timer);
                              msgLongPressRef.current = {
                                x: t.clientX,
                                y: t.clientY,
                                timer: setTimeout(() => {
                                  msgLongPressRef.current = null;
                                  navigator.vibrate?.(10);
                                  setMsgActionSheet(m);
                                }, 480),
                              };
                            }}
                            onTouchMove={e => {
                              const lp = msgLongPressRef.current;
                              if (!lp) return;
                              const t = e.touches[0];
                              if (Math.abs(t.clientX - lp.x) > 10 || Math.abs(t.clientY - lp.y) > 10) {
                                clearTimeout(lp.timer);
                                msgLongPressRef.current = null;
                              }
                            }}
                            onTouchEnd={() => {
                              clearTimeout(msgLongPressRef.current?.timer);
                              msgLongPressRef.current = null;
                            }}
                            className={`msg-row flex items-start gap-2.5 sm:gap-3 group relative px-2 rounded-lg transition-colors hover:bg-white/[0.03] ${
                              isGrouped ? 'py-0' : 'pt-2 pb-0 mt-1'
                            } ${m.is_pinned ? 'bg-amber-500/5 border-l-2 border-amber-500/60' : ''} ${
                              isMentioningMe ? 'bg-amber-500/10 border-l-2 border-amber-400' : ''
                            } ${m.pending ? 'opacity-60' : ''} ${m.id > lastSeenAtMountRef.current || m.id < 0 ? 'anim-msg' : ''}`}
                          >
                            {isGrouped ? (
                              <div className="w-9 shrink-0 text-[10px] text-stone-600 text-right pt-1 opacity-0 group-hover:opacity-100 select-none">
                                {timeLabel}
                              </div>
                            ) : (
                              <Avatar name={senderName} url={m.user_id ? userById.get(m.user_id)?.avatar_url : m.author_avatar} />
                            )}

                            <div className="flex-1 min-w-0">
                              {!isGrouped && (
                                <div className="flex items-baseline gap-2 mb-0.5">
                                  <span className={`text-sm font-bold ${isGemini ? 'text-amber-400' : isMine ? 'text-amber-200' : fromDiscord ? 'text-indigo-200' : 'text-stone-100'}`}>
                                    {displayName}
                                  </span>
                                  {fromDiscord && <DiscordBadge className="self-center -ml-1" />}
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
                                  onClick={() => openMessageLink(m.reply_to!.id)}
                                  className="flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-stone-300 mb-0.5 max-w-full text-left"
                                >
                                  <CornerReplyIcon />
                                  {m.reply_to.deleted ? (
                                    <span className="italic">削除されたメッセージ</span>
                                  ) : (
                                    <>
                                      <span className="font-bold text-stone-400 shrink-0">@{splitSenderName(m.reply_to.username || '').name}</span>
                                      <span className="truncate">{summarizeContent(m.reply_to.content)}</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {editingMessageId === m.id ? (
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2 mt-1">
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
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleEditMessage(m.id)}
                                      className="px-2.5 py-1 btn-primary font-bold rounded-lg text-xs"
                                    >
                                      保存
                                    </button>
                                    <button
                                      onClick={cancelEditing}
                                      className="px-2.5 py-1 btn-ghost rounded-lg text-xs"
                                      title="Esc"
                                    >
                                      キャンセル
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className={`text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                                  isGemini ? 'text-amber-100' : 'text-stone-200'
                                }`}>
                                  {IMAGE_MESSAGE_RE.test((m.content || '').trim()) ? (
                                    <img
                                      src={toProxiedMediaUrl((m.content || '').trim().match(IMAGE_MESSAGE_RE)?.[1] || '', token)}
                                      alt="attachment"
                                      loading="lazy"
                                      onLoad={() => {
                                        // 画像の読み込みで高さが変わっても最下部追従を維持
                                        if (!hasNewerRef.current && (isNearBottomRef.current || chatAutoScrollModeRef.current === 'always')) {
                                          const el = chatScrollContainerRef.current;
                                          if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 600) scheduleScrollToBottom(false);
                                        }
                                      }}
                                      onClick={() => setLightbox({ src: toProxiedMediaUrl((m.content || '').trim().match(IMAGE_MESSAGE_RE)?.[1] || '', token), zoom: 1 })}
                                      className="max-h-72 max-w-full rounded-lg object-contain my-1 border border-stone-800 cursor-zoom-in hover:opacity-90 transition"
                                    />
                                  ) : m.content === VIDEO_NOTICE ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-stone-400 text-xs">
                                      <Film className="w-3.5 h-3.5" /> 動画 (asdfbase では表示できません)
                                    </span>
                                  ) : (
                                    <div className="markdown-body whitespace-normal text-[14px]">
                                      <SmartMarkdown
                                        content={m.content || ''}
                                        containerRef={chatScrollContainerRef}
                                        opts={{
                                          usernames: knownUsernames,
                                          channels: channelByName,
                                          me: currentUser.username,
                                          onChannelClick: id => setActiveChannelId(id),
                                          onMessageLink: id => openMessageLink(id),
                                          onMemoLink: slot => {
                                            setActiveTab('memo');
                                            setSelectedSlotIndex(slot);
                                          },
                                          token,
                                          customEmojis: customEmojisMap,
                                          discordUsernames,
                                        }}
                                      />
                                    </div>
                                  )}
                                  {m.edited_at && (
                                    <span
                                      className="ml-1 text-[10px] text-stone-500 select-none whitespace-nowrap"
                                      title={`編集: ${new Date(m.edited_at).toLocaleString('ja-JP')}`}
                                    >
                                      (編集済み)
                                    </span>
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
                                  <button onClick={() => handleDiscardFailedMessage(m)} className="underline text-stone-500 hover:text-stone-300">取り消す</button>
                                </div>
                              )}

                              {m.reactions && Object.keys(m.reactions).length > 0 && (
                                <ReactionBar
                                  reactions={m.reactions}
                                  meId={currentUser.id}
                                  nameOf={nameOfUser}
                                  onToggle={emoji => handleToggleReaction(m.id, emoji)}
                                  customEmojis={customEmojisMap}
                                />
                              )}
                            </div>

                            {m.id > 0 && (
                            <div className="hidden [@media(hover:hover)]:flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition absolute right-2 -top-3 bg-[#16181D] border border-stone-800 rounded-lg p-1 items-center gap-0.5 shadow-md z-10">
                              <button onClick={() => startReply(m)} title="返信" className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400">
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleToggleReaction(m.id, '👍')} title="いいね" className="p-1 hover:bg-stone-800 rounded text-xs">
                                👍
                              </button>
                              <button onClick={() => handleToggleReaction(m.id, '❤️')} title="ハート" className="p-1 hover:bg-stone-800 rounded text-xs">
                                ❤️
                              </button>
                              <button onClick={() => handleToggleReaction(m.id, '✅')} title="完了 / OK" className="p-1 hover:bg-stone-800 rounded text-xs">
                                ✅
                              </button>
                              <button onClick={() => handleToggleReaction(m.id, '❌')} title="NG / バツ" className="p-1 hover:bg-stone-800 rounded text-xs">
                                ❌
                              </button>
                              <button onClick={() => handleToggleReaction(m.id, ':swim:')} title="SWIMしよ" className="p-1 hover:bg-stone-800 rounded text-xs flex items-center">
                                {renderReactionEmoji(':swim:', customEmojisMap, 'w-4 h-4')}
                              </button>
                              <button onClick={() => handleTogglePin(m.id)} title={m.is_pinned ? 'ピン留めを外す' : 'ピン留め'} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400">
                                <Pin className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleCopyMessageLink(m.id)} title="リンクをコピー" className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white">
                                {copiedLinkMessageId === m.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              {(m.user_id === currentUser?.id || currentUser?.role === 'admin') && (
                                <>
                                  {m.user_id === currentUser?.id && (
                                    <button onClick={() => { setEditingMessageId(m.id); setEditingContent(m.content); }} title="編集" className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-amber-400">
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button onClick={() => handleDeleteMessage(m.id)} title="削除" className="p-1 hover:bg-red-950/60 rounded text-stone-400 hover:text-red-400">
                                    <Trash2 className="w-3.5 h-3.5" />
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
                {hasNewerMessages && messages.length > 0 && !chatSearchQuery && (
                  <div className="flex justify-center py-3">
                    <button
                      onClick={handleLoadNewerMessages}
                      disabled={isLoadingNewer}
                      className="px-4 py-1.5 rounded-full bg-stone-900 border border-stone-800 hover:border-amber-500/50 text-stone-300 hover:text-amber-400 text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isLoadingNewer ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <ArrowDown className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{isLoadingNewer ? '読み込み中…' : '続きのメッセージ'}</span>
                    </button>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

                {/* 新着ピル / 最下部へ / (過去の位置を見ている時) 最新へ戻る */}
                {hasNewerMessages ? (
                  <button
                    onClick={jumpToLatest}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full btn-primary text-xs font-bold shadow-lg flex items-center gap-1 z-20 anim-pop whitespace-nowrap"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    最新のメッセージへ{newBelowCount > 0 ? ` (新着 ${newBelowCount} 件)` : ''}
                  </button>
                ) : newBelowCount > 0 ? (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full btn-primary text-xs font-bold shadow-lg flex items-center gap-1 z-20 anim-pop"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    新着 {newBelowCount} 件
                  </button>
                ) : (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-3 right-4 p-1.5 rounded-full bg-[#16181D]/90 border border-stone-800 text-stone-400 hover:text-amber-400 hover:border-amber-500/50 shadow-lg z-20"
                    title="最下部へスクロール"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Chat Input */}
              <div className="relative px-2 sm:px-3 pt-1 pb-2 sm:pb-3 border-t border-stone-800/80 bg-[#0C0D10]/95 shrink-0">
                {/* 入力中表示 */}
                <div className="h-5 px-1 text-[11px] text-stone-400 flex items-center gap-1.5">
                  {typingHere.length > 0 && (
                    <span className="flex items-center gap-1.5 anim-fade">
                      <span className="typing-dots"><i /><i /><i /></span>
                      <span className="truncate">
                        <b className="text-stone-200">{typingHere.slice(0, 3).join('、')}</b>
                        {typingHere.length > 3 ? ` ほか${typingHere.length - 3}人` : ''} が入力中…
                      </span>
                    </span>
                  )}
                </div>

                {completion && completionItems.length > 0 && (
                  <div className="absolute bottom-full left-2 sm:left-4 mb-1 w-[calc(100%-1rem)] sm:w-72 bg-[#111214] border border-stone-700/80 rounded-xl shadow-2xl p-1.5 text-xs z-30 anim-pop-down">
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] text-stone-500">
                      <span>{completion.kind === '@' ? 'メンション' : completion.kind === ':' ? '絵文字 (:shortcode:)' : 'チャンネル'}</span>
                      <span><kbd className="kbd">Tab</kbd> 選択 · <kbd className="kbd">Enter</kbd> 決定</span>
                    </div>
                    {completionItems.map((item, i) => (
                      <button
                        key={item.key}
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setCompletion(c => (c ? { ...c, index: i } : c))}
                        onClick={() => applyCompletion(item)}
                        className={`w-full px-2 py-1.5 rounded-lg flex items-center gap-2 text-left ${
                          i === completion.index % completionItems.length ? 'bg-amber-500/15 text-white' : 'text-stone-300'
                        }`}
                      >
                        {completion.kind === '@' ? (
                          item.key.startsWith('u') ? <Avatar name={item.label} url={item.avatar} size="w-5 h-5 text-[10px]" /> : <Bot className="w-4 h-4 text-amber-400" />
                        ) : completion.kind === ':' ? (
                          item.emojiUrl ? (
                            <img src={toProxiedMediaUrl(item.emojiUrl, token)} alt={item.label} className="w-5 h-5 object-contain shrink-0" />
                          ) : (
                            <span className="text-base leading-none shrink-0">{item.sub || '😀'}</span>
                          )
                        ) : (
                          <Hash className="w-4 h-4 text-emerald-400" />
                        )}
                        <span className={completion.kind === '@' ? 'text-sky-300 font-bold' : completion.kind === ':' ? 'text-amber-300 font-mono font-bold' : 'text-emerald-300 font-bold'}>
                          {item.insert}
                        </span>
                        {item.sub && <span className="ml-auto text-[10px] text-stone-500">{item.sub}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {/* スラッシュコマンド補完 */}
                {!completion && slashCandidates.length > 0 && (
                  <div className="absolute bottom-full left-2 sm:left-4 mb-1 w-[calc(100%-1rem)] sm:w-80 bg-[#111214] border border-amber-500/40 rounded-xl shadow-2xl p-1.5 text-xs z-30 anim-pop-down">
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] text-stone-500 border-b border-stone-800/80 mb-1">
                      <span className="font-bold text-amber-400">/ コマンド (時短ショートカット)</span>
                      <span><kbd className="kbd">Tab</kbd> / <kbd className="kbd">Enter</kbd> 決定</span>
                    </div>
                    {slashCandidates.map((item, i) => (
                      <button
                        key={item.cmd}
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setActiveSlashIndex(i)}
                        onClick={() => {
                          setChatInput(`${item.cmd} `);
                          chatInputRef.current?.focus();
                        }}
                        className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between text-left transition ${
                          i === activeSlashIndex % slashCandidates.length ? 'bg-amber-500/15 text-white' : 'text-stone-300 hover:bg-stone-800/50'
                        }`}
                      >
                        <span className="font-mono font-bold text-amber-300">{item.cmd}</span>
                        <span className="text-[10px] text-stone-400">{item.desc}</span>
                      </button>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={handleSendMessage}
                  onDragOver={e => {
                    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
                  }}
                  onDrop={e => {
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length === 0) return;
                    e.preventDefault();
                    addPendingImages(files);
                  }}
                >
                  {pendingImages.length > 0 && (
                    <div className="flex gap-2 px-1 pb-2 overflow-x-auto anim-fade">
                      {pendingImages.map(img => (
                        <div key={img.id} className="relative shrink-0 group anim-pop">
                          <img
                            src={img.url}
                            alt={img.file.name}
                            onClick={() => setLightbox({ src: img.url, zoom: 1 })}
                            className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border border-stone-700 bg-stone-900 cursor-zoom-in"
                          />
                          <button
                            type="button"
                            onClick={() => removePendingImage(img.id)}
                            title="この画像を外す"
                            aria-label="この画像を外す"
                            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-stone-800 border border-stone-600 text-stone-300 hover:bg-red-600 hover:text-white hover:border-red-500 shadow"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {replyToMessage && (
                    <div className="flex items-center gap-2 px-3 py-1.5 mb-1 rounded-lg bg-stone-900/80 border border-stone-800 text-xs text-stone-400 anim-fade">
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
                  <div className="flex items-end gap-2 bg-[#14161C] border border-stone-800 rounded-xl px-2.5 sm:px-3 py-2 focus-within:border-amber-500/60 transition">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="画像を添付 (Ctrl+V で貼り付けも可)"
                      className="p-1 rounded-lg text-stone-400 hover:text-amber-400 hover:bg-stone-800"
                    >
                      {isUploading ? <RefreshCw className="w-4 h-4 animate-spin text-amber-400" /> : <Image className="w-4 h-4" />}
                    </button>

                    {/* 絵文字ピッカー & カスタム絵文字アップロードボタン */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(v => !v)}
                        title="絵文字 (:shortcode:) & カスタム絵文字アップロード"
                        className={`p-1 rounded-lg transition ${showEmojiPicker ? 'text-amber-400 bg-stone-800' : 'text-stone-400 hover:text-amber-400 hover:bg-stone-800'}`}
                      >
                        <Smile className="w-4 h-4" />
                      </button>

                      {showEmojiPicker && (
                        <div
                          onClick={e => e.stopPropagation()}
                          className="absolute bottom-full left-0 mb-2 w-72 sm:w-80 bg-[#111214] border border-stone-700/80 rounded-2xl shadow-2xl p-3 z-40 space-y-3 text-xs anim-pop"
                        >
                          <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                            <span className="font-bold text-white flex items-center gap-1.5">
                              <Smile className="w-4 h-4 text-amber-400" /> 絵文字 & カスタム絵文字
                            </span>
                            <button type="button" onClick={() => setShowEmojiPicker(false)} className="text-stone-500 hover:text-white">
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div>
                            <div className="text-[10px] text-stone-500 font-bold mb-1.5">カスタム絵文字 (:name: で入力可)</div>
                            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                              {customEmojisList.map(ce => (
                                <div key={ce.name} className="group/ce relative inline-flex items-center">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setChatInput(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}:${ce.name}: `);
                                      setShowEmojiPicker(false);
                                      chatInputRef.current?.focus();
                                    }}
                                    title={`:${ce.name}:`}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#16181D] border border-stone-800 hover:border-amber-500/50 text-stone-200"
                                  >
                                    <img src={toProxiedMediaUrl(ce.url, token)} alt={ce.name} className="w-5 h-5 object-contain" />
                                    <span className="font-mono text-[10px] text-stone-400">:{ce.name}:</span>
                                  </button>
                                  {ce.id && (ce.created_by === currentUser.id || currentUser.role === 'admin') && ce.name !== 'swim' && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCustomEmoji(ce.id, ce.name)}
                                      className="hidden group-hover/ce:flex absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 text-white items-center justify-center text-[9px]"
                                      title="削除"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] text-stone-500 font-bold mb-1.5">よく使う絵文字</div>
                            <div className="grid grid-cols-8 gap-1 max-h-28 overflow-y-auto">
                              {Object.entries(BUILTIN_SHORTCODES).map(([code, ch]) => (
                                <button
                                  key={code}
                                  type="button"
                                  onClick={() => {
                                    setChatInput(prev => `${prev}${ch}`);
                                    setShowEmojiPicker(false);
                                    chatInputRef.current?.focus();
                                  }}
                                  title={`:${code}:`}
                                  className="p-1.5 rounded-lg hover:bg-stone-800 text-base text-center"
                                >
                                  {ch}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-stone-800 space-y-2">
                            <div className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                              <Upload className="w-3 h-3" /> 新しい絵文字をアップロード
                            </div>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                placeholder="名前 (例: party)"
                                value={emojiUploadName}
                                onChange={e => setEmojiUploadName(e.target.value)}
                                className="flex-1 min-w-0 bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-amber-500"
                              />
                              <label className="px-2 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[11px] cursor-pointer shrink-0 flex items-center gap-1">
                                <Image className="w-3 h-3" />
                                <span className="max-w-[70px] truncate">{emojiUploadFile ? emojiUploadFile.name : '画像選択'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={e => setEmojiUploadFile(e.target.files?.[0] || null)}
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              disabled={!emojiUploadFile || !emojiUploadName.trim() || isUploadingEmoji}
                              onClick={handleUploadCustomEmoji}
                              className="w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-[11px]"
                            >
                              {isUploadingEmoji ? 'アップロード中…' : '絵文字を登録'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* メンションを色付けするため、同じ位置にハイライトだけの影を重ねる */}
                    <div className="relative flex-1 min-w-0">
                      <div
                        ref={composerBackdropRef}
                        aria-hidden="true"
                        className="composer-text absolute inset-0 text-sm leading-relaxed py-0.5 whitespace-pre-wrap break-words text-transparent overflow-hidden pointer-events-none"
                      >
                        {renderComposerHighlight(chatInput, knownUsernames, channelByName, customEmojisMap)}
                      </div>
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
                          updateCompletion(val, e.target.selectionStart);
                          if (val.trim()) notifyTyping();
                        }}
                        onSelect={e => updateCompletion(e.currentTarget.value, e.currentTarget.selectionStart)}
                        onPaste={handleComposerPaste}
                        onScroll={e => {
                          if (composerBackdropRef.current) composerBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                        }}
                        onBlur={() => setTimeout(() => setCompletion(null), 120)}
                        onKeyDown={e => {
                          // 日本語IMEの変換中は何もしない
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          const open = completion && completionItems.length > 0;
                          if (open && (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                            e.preventDefault();
                            const dir = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
                            const len = completionItems.length;
                            setCompletion(c => (c ? { ...c, index: (((c.index % len) + dir) % len + len) % len } : c));
                            return;
                          }
                          if (open && e.key === 'Enter') {
                            e.preventDefault();
                            applyCompletion(completionItems[completion!.index % completionItems.length]);
                            return;
                          }
                          const slashOpen = !completion && slashCandidates.length > 0;
                          if (slashOpen && (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                            e.preventDefault();
                            const dir = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
                            const len = slashCandidates.length;
                            setActiveSlashIndex(idx => (((idx % len) + dir) % len + len) % len);
                            return;
                          }
                          if (slashOpen && e.key === 'Enter') {
                            const chosen = slashCandidates[activeSlashIndex % slashCandidates.length];
                            if (chosen && chatInput === chosen.cmd) {
                              // そのまま送信・実行へ流す
                            } else if (chosen) {
                              e.preventDefault();
                              setChatInput(`${chosen.cmd} `);
                              return;
                            }
                          }
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            return;
                          }
                          if (e.key === 'Enter' && !e.shiftKey) {
                            // Enter: 送信 / Shift+Enter: 改行
                            e.preventDefault();
                            handleSendMessage(e);
                            (e.target as HTMLTextAreaElement).style.height = 'auto';
                          } else if (e.key === 'ArrowUp' && chatInput === '') {
                            if (startEditLastOwnMessage()) e.preventDefault();
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            if (completion) setCompletion(null);
                            else if (replyToMessage) setReplyToMessage(null);
                            else if (pendingImages.length > 0) removePendingImage(pendingImages[pendingImages.length - 1].id);
                            else if (chatInput) setChatInput('');
                          }
                        }}
                        placeholder={`#${activeChannelName} へメッセージ`}
                        className="composer-text relative block w-full bg-transparent text-sm text-white focus:outline-none placeholder-stone-600 resize-none leading-relaxed max-h-[200px] py-0.5"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!chatInput.trim() && pendingImages.length === 0}
                      className="p-1.5 rounded-lg btn-primary disabled:opacity-40"
                      aria-label="送信"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* Right: Members Sidebar */}
            {!isMembersCollapsed && (
              <aside className="absolute lg:static inset-y-0 right-0 z-40 w-60 lg:w-56 border-l border-stone-800 bg-[#0C0D10] p-3 flex flex-col shrink-0 min-h-0 overflow-y-auto anim-slide-right lg:animate-none shadow-2xl lg:shadow-none">
                {/* Discord VC 参加者 */}
                {discordVcs && discordVcs.length > 0 && (
                  <div className="mb-3 pb-3 border-b border-stone-800/80">
                    <div className="text-[11px] uppercase tracking-wider text-indigo-400 px-2 mb-1.5 font-bold flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-indigo-400 animate-pulse" /> Discord VC
                    </div>
                    <div className="space-y-1.5">
                      {discordVcs.map(vc => (
                        <div key={vc.channelId} className="px-2 py-1.5 rounded-lg bg-[#16181D] border border-stone-800/60">
                          <div className="text-[11px] font-medium text-stone-300 truncate flex items-center gap-1 mb-1">
                            <span className="text-indigo-300 font-semibold">🔊 {vc.channelName}</span>
                            <span className="text-[10px] text-stone-500">({vc.guildName})</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {vc.members.map((m: any) => (
                              <span
                                key={m.id}
                                className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border ${
                                  m.speaking
                                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 font-bold'
                                    : 'bg-stone-800 border-stone-700/60 text-stone-200'
                                }`}
                                title={`${m.name}${m.speaking ? ' (マイクON/発話可)' : ' (ミュート)'}`}
                              >
                                {m.avatarUrl ? (
                                  <img src={toProxiedMediaUrl(m.avatarUrl, token)} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                                ) : (
                                  <span className={`w-1.5 h-1.5 rounded-full ${m.speaking ? 'bg-emerald-400 animate-ping' : 'bg-stone-500'}`} />
                                )}
                                <span className="max-w-[70px] truncate">{m.name}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              const insert = `@${u.username} `;
                              setChatInput(prev => (prev && !prev.endsWith(' ') ? `${prev} ${insert}` : `${prev}${insert}`));
                              if (window.innerWidth < 1024) setIsMembersCollapsed(true);
                              requestAnimationFrame(() => chatInputRef.current?.focus());
                            }}
                            title={`@${u.username} をメンション`}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-stone-800/60 text-sm text-left ${
                              group === 'offline' ? 'text-stone-600' : 'text-stone-200'
                            }`}
                          >
                            <div className="relative shrink-0">
                              <Avatar name={u.username} url={u.avatar_url} size="w-7 h-7 text-xs" dim={group === 'offline'} />
                              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0C0D10] ${
                                group === 'online' ? 'bg-emerald-400' : group === 'away' ? 'bg-amber-400' : 'bg-stone-600'
                              }`} />
                            </div>
                            <span className="truncate">{u.username}</span>
                            {u.id === currentUser.id && <span className="ml-auto text-[10px] text-stone-500">あなた</span>}
                          </button>
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
          <div className="flex-1 min-h-0 flex overflow-hidden relative anim-tab">
            {isMemoListOpen && <div className="absolute inset-0 bg-black/50 z-30 md:hidden anim-fade" onClick={() => setIsMemoListOpen(false)} />}
            <aside className={`${isMemoListOpen ? 'flex anim-slide-left' : 'hidden'} md:flex absolute md:static inset-y-0 left-0 z-40 w-64 border-r border-stone-800/80 bg-[#0C0D10] p-3 flex-col shrink-0 overflow-hidden shadow-2xl md:shadow-none`}>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* スロット1〜10: 共有メモ */}
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold flex items-center justify-between shrink-0">
                  <span>共有メモ</span>
                  <FileText className="w-3.5 h-3.5 text-stone-500" />
                </div>
                <div className="space-y-1 overflow-y-auto max-h-[42%] pr-1 mb-4 shrink-0">
                  {memoSlots.filter(s => s.slot_index <= 10).map(slot => {
                    const isSelected = selectedSlotIndex === slot.slot_index;
                    const cleanTitle = (isSelected ? memoTitle : slot.title || '').replace(/^メモ\s*#?\d+\s*:?\s*/, '');
                    return (
                      <button
                        key={slot.slot_index}
                        onClick={() => selectMemoSlot(slot)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-mono text-left border ${
                          isSelected
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-[#111214] border-stone-800/80 text-stone-400 hover:text-stone-100 hover:border-stone-600 hover:bg-stone-900'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <span className="text-amber-500/80 font-bold shrink-0">#{slot.slot_index}</span>
                          <span className="truncate">{cleanTitle || 'メモ'}</span>
                        </div>
                        <span className="text-[10px] text-stone-600 uppercase shrink-0">
                          {slot.mode === 'plain' ? 'txt' : 'md'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* スロット11以降: メンバー専用Monacoエディタ */}
                <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 px-2 mb-2 font-bold flex items-center justify-between shrink-0 border-t border-stone-800/80 pt-3">
                  <span>専用コードゾーン</span>
                  <Code className="w-3.5 h-3.5 text-stone-500" />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
                  {memoSlots.filter(s => s.slot_index >= 11).map(slot => {
                    const isMySlot = slot.assigned_user_id === currentUser?.id;
                    const assignedName = (slot as any).assigned_username || `ユーザー${slot.assigned_user_id || ''}`;
                    return (
                      <button
                        key={slot.slot_index}
                        onClick={() => selectMemoSlot(slot)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono text-left border ${
                          selectedSlotIndex === slot.slot_index
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm'
                            : 'bg-[#111214] border-stone-800/80 text-stone-400 hover:text-stone-100 hover:border-stone-600 hover:bg-stone-900'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <Avatar name={assignedName} url={slot.assigned_user_id ? userById.get(slot.assigned_user_id)?.avatar_url : null} size="w-5 h-5 text-[10px]" />
                          <span className="truncate font-bold text-white">{assignedName}</span>
                        </div>
                        {isMySlot ? (
                          <span className="text-[9px] bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 px-1.5 rounded shrink-0">あなた</span>
                        ) : (
                          <Lock className="w-3 h-3 text-stone-600 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#090A0C] p-2 sm:p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2 sm:mb-3 border-b border-stone-800/80 pb-2 sm:pb-3">
                <button
                  onClick={() => setIsMemoListOpen(true)}
                  className="md:hidden p-1.5 rounded-lg bg-stone-900 border border-stone-800 text-stone-300 hover:text-white"
                  aria-label="メモ一覧"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <span className="text-amber-500/80 font-bold font-mono text-sm shrink-0">#{selectedSlotIndex}</span>
                <input
                  type="text"
                  disabled={isMonacoLocked}
                  value={memoTitle}
                  onChange={e => handleMemoTitleChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSaveMemo();
                    }
                  }}
                  placeholder="タイトル"
                  className="bg-transparent text-lg sm:text-xl font-bold font-['Space_Grotesk'] text-white focus:outline-none flex-1 min-w-[8rem] disabled:opacity-50 rounded-lg px-1 hover:bg-stone-900/60 focus:bg-stone-900/60"
                />

                <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                  {isMonacoLocked && (
                    <span className="text-red-400 flex items-center gap-1 bg-red-950/40 border border-red-800/60 px-2.5 py-1 rounded-lg">
                      <Lock className="w-3 h-3" /> 閲覧のみ
                    </span>
                  )}

                  {/* 自動保存インジケーター */}
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-stone-900 border border-stone-800 text-[11px]" title={memoAutoSaveInterval === 0 ? '自動保存はオフです (設定で変更できます)' : undefined}>
                    <span className={`w-2 h-2 rounded-full ${autoSaveStatus === 'saving' ? 'bg-amber-400 animate-pulse' : autoSaveStatus === 'dirty' ? 'bg-orange-500' : 'bg-emerald-400'}`} />
                    <span className="text-stone-400">
                      {autoSaveStatus === 'saving' ? '保存中…' : autoSaveStatus === 'dirty' ? '未保存' : '保存済み'}
                    </span>
                  </div>

                  {selectedSlotIndex <= 10 ? (
                    <>
                      <select
                        value={memoMode}
                        disabled={isMonacoLocked}
                        onChange={e => handleMemoModeChange(e.target.value as any)}
                        className="bg-[#14161C] border border-stone-800 text-stone-300 rounded-lg px-2 py-1.5 focus:outline-none disabled:opacity-50 text-xs hover:border-stone-600"
                      >
                        <option value="markdown">Markdown</option>
                        <option value="plain">テキスト</option>
                      </select>

                      {memoMode === 'markdown' && (
                        <div className="flex items-center bg-[#14161C] border border-stone-800 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => setMemoViewMode('split')}
                            className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 ${
                              memoViewMode === 'split' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-stone-400 hover:text-white'
                            }`}
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>編集</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMemoViewMode('view_only')}
                            className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 ${
                              memoViewMode === 'view_only' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-stone-400 hover:text-white'
                            }`}
                          >
                            <Eye className="w-3 h-3" />
                            <span>表示</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1">
                      <Code className="w-3 h-3" /> コード
                    </span>
                  )}

                  {/* Memo AI */}
                  <div className="flex items-center gap-1">
                    {selectedSlotIndex <= 10 ? (
                      <>
                        <button
                          onClick={() => handleMemoAiAssist('summarize')}
                          disabled={isMemoAiLoading || !memoContent.trim()}
                          className="btn-chip text-[11px] disabled:opacity-40"
                        >
                          <Sparkles className="w-3 h-3 text-amber-400" /> {isMemoAiLoading ? '処理中…' : '要約'}
                        </button>
                        <button
                          onClick={() => handleMemoAiAssist('proofread')}
                          disabled={isMemoAiLoading || !memoContent.trim() || isMonacoLocked}
                          className="btn-chip text-[11px] disabled:opacity-40"
                        >
                          <CheckCircle2 className="w-3 h-3 text-amber-400" /> 校正
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleMemoAiAssist('explain_code')}
                        disabled={isMemoAiLoading || !memoContent.trim()}
                        className="btn-chip text-[11px] disabled:opacity-40"
                      >
                        <Bot className="w-3 h-3 text-amber-400" /> {isMemoAiLoading ? '処理中…' : 'コード解説'}
                      </button>
                    )}
                  </div>

                  {memoUndo && memoUndo.slot === selectedSlotIndex && (
                    <button onClick={undoMemoAi} className="btn-chip text-[11px] !border-amber-500/40 !text-amber-300 anim-pop">
                      <Undo2 className="w-3 h-3" /> 校正前に戻す
                    </button>
                  )}

                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/#memo-${selectedSlotIndex}`;
                      navigator.clipboard.writeText(url).then(
                        () => toast(`メモ #${selectedSlotIndex} のリンクをコピーしました`, { kind: 'success' }),
                        () => toast('コピーできませんでした', { kind: 'error' })
                      );
                    }}
                    title="このメモの共有リンクをコピー"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-800 bg-[#16181D] text-stone-300 hover:text-white hover:border-stone-600 text-xs"
                  >
                    <Link className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">リンク</span>
                  </button>

                  <button
                    onClick={() => handleSaveMemo()}
                    disabled={isSavingMemo || isMonacoLocked}
                    className="px-3 py-1.5 btn-primary font-bold rounded-lg disabled:opacity-50"
                  >
                    {isSavingMemo ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 flex overflow-hidden rounded-2xl border border-stone-800/80 bg-[#111214]">
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
                  <div className="flex-1 p-2 sm:p-4 overflow-hidden">
                    <textarea
                      value={memoContent}
                      readOnly={isMonacoLocked}
                      onChange={e => handleMemoContentChange(e.target.value)}
                      onKeyDown={handleMemoTextareaKeyDown}
                      placeholder="テキストを入力"
                      className="w-full h-full bg-[#16181D] border border-stone-800 rounded-xl p-3 sm:p-4 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:border-amber-500/50 resize-none"
                    />
                  </div>
                ) : memoViewMode === 'view_only' ? (
                  <div ref={memoPreviewRef} className="flex-1 p-3 sm:p-6 overflow-y-auto">
                    <div className="max-w-4xl mx-auto markdown-body text-stone-200 text-[15px] anim-fade">
                      {memoContent ? (
                        <SmartMarkdown
                          content={memoContent}
                          containerRef={memoPreviewRef}
                          opts={{
                            usernames: knownUsernames,
                            channels: channelByName,
                            me: currentUser.username,
                            onChannelClick: id => {
                              setActiveTab('chat');
                              setActiveChannelId(id);
                            },
                            onMessageLink: id => openMessageLink(id),
                            onMemoLink: slot => setSelectedSlotIndex(slot),
                            token,
                            customEmojis: customEmojisMap,
                          }}
                        />
                      ) : (
                        <p className="text-stone-600">まだ何も書かれていません</p>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Markdown 編集 + プレビュー (スクロール同期・目次アンカージャンプ対応) */
                  <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 sm:gap-4 p-2 sm:p-4 overflow-hidden">
                    <textarea
                      ref={memoTextareaRef}
                      value={memoContent}
                      readOnly={isMonacoLocked}
                      onChange={e => handleMemoContentChange(e.target.value)}
                      onKeyDown={handleMemoTextareaKeyDown}
                      onScroll={handleMemoEditorScroll}
                      placeholder="Markdown で書けます (# 見出し、[目次](#見出し) のページ内リンク、:swim: 絵文字対応)"
                      className="flex-1 min-h-0 bg-[#16181D] border border-stone-800 rounded-xl p-3 sm:p-3.5 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:border-amber-500/50 resize-none"
                    />
                    <div
                      ref={memoPreviewRef}
                      onScroll={handleMemoPreviewScroll}
                      className="flex-1 min-h-0 bg-[#16181D]/60 border border-stone-800 rounded-xl p-3 sm:p-4 text-stone-300 text-sm overflow-y-auto"
                    >
                      <div className="text-[10px] font-mono text-stone-500 mb-2 pb-1 border-b border-stone-800 flex items-center justify-between">
                        <span>プレビュー (スクロール同期・目次リンク対応)</span>
                      </div>
                      <div className="markdown-body">
                        {memoContent ? (
                          <SmartMarkdown
                            content={memoContent}
                            containerRef={memoPreviewRef}
                            opts={{
                              usernames: knownUsernames,
                              channels: channelByName,
                              me: currentUser.username,
                              onChannelClick: id => {
                                setActiveTab('chat');
                                setActiveChannelId(id);
                              },
                              onMessageLink: id => openMessageLink(id),
                              onMemoLink: slot => setSelectedSlotIndex(slot),
                              token,
                              customEmojis: customEmojisMap,
                            }}
                          />
                        ) : (
                          <p className="text-stone-600">まだ何も書かれていません</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: AI (切り替えても会話・応答待ちが消えないよう常に保持) */}
        <div className={activeTab === 'ai' ? 'flex-1 min-h-0 flex anim-tab' : 'hidden'}>
          <AiTab
            active={activeTab === 'ai'}
            userId={currentUser.id}
            token={token}
            safeFetch={safeFetch}
            buildContext={buildAiContext}
            memo={{ slot: selectedSlotIndex, title: memoTitle, content: memoContent }}
            onAppendToMemo={text => {
              const next = memoContent ? `${memoContent}\n\n---\n${text}` : text;
              handleMemoContentChange(next);
            }}
          />
        </div>

        {/* TAB 4: 提出物 */}
        {activeTab === 'assignments' && (
          <div className="flex-1 p-3 sm:p-6 overflow-y-auto anim-tab">
            <div className="max-w-4xl mx-auto space-y-4 sm:space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl sm:text-2xl font-bold font-['Space_Grotesk'] text-white">提出物</h2>
                <button
                  onClick={() => setIsAssignFormOpen(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold ${isAssignFormOpen ? 'btn-ghost' : 'btn-primary'}`}
                >
                  {isAssignFormOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {isAssignFormOpen ? '閉じる' : '提出物を追加'}
                </button>
              </div>

              {isAssignFormOpen && (
              <form onSubmit={handleCreateAssignment} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 sm:p-5 space-y-3 font-mono text-xs shadow-lg anim-pop">
                <div className="space-y-1.5">
                  <div className="text-[10px] text-stone-400 font-bold">クラス</div>
                  <div className="flex flex-wrap gap-1.5">
                    {([...CLASS_NUMBERS, null] as (number | null)[]).map(n => {
                      const selected = (newAssignClass === 'mine' ? currentUser.class_no ?? null : newAssignClass) === n;
                      return (
                        <button
                          type="button"
                          key={String(n)}
                          onClick={() => setNewAssignClass(n)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] ${
                            selected ? 'bg-amber-500 text-black font-bold border-amber-400' : 'bg-[#16181D] text-stone-300 border-stone-800 hover:border-stone-500 hover:text-white'
                          }`}
                        >
                          {n === null ? '全クラス共通' : `${n}組${n === currentUser.class_no ? ' ★' : ''}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] text-stone-400 font-bold">教科</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...SUBJECTS, 'その他'].map(subj => (
                      <button
                        type="button"
                        key={subj}
                        onClick={() => setNewAssignSubject(subj)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] ${
                          newAssignSubject === subj
                            ? 'bg-amber-500 text-black font-bold border-amber-400 shadow-sm'
                            : 'bg-[#16181D] text-stone-300 border-stone-800 hover:border-stone-500 hover:text-white'
                        }`}
                      >
                        {subj}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'ワーク', prefix: 'ワーク P.' },
                    { label: 'プリント', prefix: 'プリント' },
                    { label: 'レポート', prefix: 'レポート' },
                    { label: 'ノート', prefix: 'ノート提出' },
                    { label: '週末課題', prefix: '週末課題' },
                  ].map(preset => (
                    <button
                      type="button"
                      key={preset.label}
                      onClick={() => setNewAssignTitle(prev => prev ? `${preset.prefix} (${prev})` : preset.prefix)}
                      className="btn-chip text-[10px]"
                    >
                      +{preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="text-[10px] text-stone-400 block mb-1">タイトル *</label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="例: ワーク P.40-45"
                      value={newAssignTitle}
                      onChange={e => setNewAssignTitle(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-400 block mb-1">締切日 *</label>
                    <input
                      type="date"
                      required
                      value={newAssignDeadline}
                      onChange={e => setNewAssignDeadline(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-400 block mb-1">再提出締切日</label>
                    <input
                      type="date"
                      value={newAssignResubmitDeadline}
                      onChange={e => setNewAssignResubmitDeadline(e.target.value)}
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">内容・注意事項</label>
                  <textarea
                    placeholder="問題番号、提出方法など"
                    value={newAssignDesc}
                    onChange={e => setNewAssignDesc(e.target.value)}
                    className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-3 text-white focus:outline-none focus:border-amber-500/60 resize-none h-20 text-xs font-mono"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full sm:w-auto px-6 py-2 btn-primary font-bold rounded-xl"
                >
                  登録
                </button>
              </form>
              )}

              {/* クラス */}
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                <span className="text-stone-500 mr-1">クラス:</span>
                {CLASS_NUMBERS.map(n => (
                  <button
                    key={n}
                    onClick={() => setAssignClassView(n === currentUser.class_no ? 'mine' : n)}
                    className={`px-2.5 py-1 rounded-lg border ${
                      assignViewClass === n
                        ? 'bg-amber-500 text-black font-bold border-amber-400'
                        : 'bg-[#111214] text-stone-400 border-stone-800 hover:border-stone-500 hover:text-white'
                    }`}
                  >
                    {n}組{n === currentUser.class_no ? ' ★' : ''}
                  </button>
                ))}
                <button
                  onClick={() => setAssignClassView('all')}
                  className={`px-2.5 py-1 rounded-lg border ${
                    assignViewClass === null
                      ? 'bg-amber-500 text-black font-bold border-amber-400'
                      : 'bg-[#111214] text-stone-400 border-stone-800 hover:border-stone-500 hover:text-white'
                  }`}
                >
                  すべて
                </button>
                {!currentUser.class_no && (
                  <button onClick={() => { setActiveTab('settings'); setSettingsSection('account'); }} className="ml-1 text-amber-400 hover:underline">
                    自分のクラスを設定
                  </button>
                )}
              </div>

              {/* フィルター */}
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
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
                    className={`px-2.5 py-1 rounded-lg border ${
                      assignmentFilter === f.id
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/40 font-bold'
                        : 'bg-[#111214] text-stone-400 border-stone-800 hover:border-stone-500 hover:text-white'
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
                    提出物はありません
                  </div>
                ) : (
                  filteredAssignments.map((item) => {
                    const membersProg = assignmentMembersProgress[item.id] || [];
                    const submittedOrPassedCount = membersProg.filter(p => p.status === 'submitted' || p.status === 'passed').length;
                    const totalMembers = membersProg.length;

                    return (
                      <div key={item.id} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 interactive-card space-y-3 shadow-lg anim-fade">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                              {item.subject}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-stone-800/80 text-stone-400 border border-stone-700/60">
                              {item.class_no ? `${item.class_no}組` : '全クラス'}
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
                          <div>締切: <span className="text-stone-200 font-bold">{new Date(item.deadline).toLocaleDateString()}</span>
                            {(() => {
                              const days = Math.ceil((new Date(item.deadline).setHours(23, 59, 59) - now.getTime()) / 86400000);
                              if (item.my_status === 'submitted' || item.my_status === 'passed') return null;
                              return (
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${days < 0 ? 'bg-red-500/20 text-red-300' : days <= 1 ? 'bg-amber-500/20 text-amber-300' : 'bg-stone-800 text-stone-400'}`}>
                                  {days < 0 ? '期限切れ' : days === 0 ? '今日まで' : days === 1 ? '明日まで' : `あと${days}日`}
                                </span>
                              );
                            })()}
                          </div>
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
                              className="btn-chip text-xs disabled:opacity-40"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              <span>{isSummarizingAI === item.id ? '要約中…' : 'AIで要約'}</span>
                            </button>
                            {summarizedTexts[item.id] && (
                              <button
                                onClick={() => setFloatingAiSummary({ id: item.id, title: item.title, summary: summarizedTexts[item.id] })}
                                className="text-[11px] font-mono text-stone-400 hover:text-amber-400"
                              >
                                要約を見る
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

        {/* 宿題 (次の授業までの簡単なもの) */}
        {activeTab === 'homework' && (
          <div className="flex-1 min-h-0 flex anim-tab">
            <HomeworkTab
              token={token}
              safeFetch={safeFetch}
              currentUser={currentUser}
              users={onlineUsers}
              homework={homework}
              setHomework={setHomework}
              onOpenSettings={() => {
                setActiveTab('settings');
                setSettingsSection('account');
              }}
            />
          </div>
        )}

        {/* TAB 5: リアルタイム共同作業ボード & クリップボード同期 (Phase 4 Full Feature) */}
        {activeTab === 'board' && (
          <div className="flex-1 flex flex-col p-2 sm:p-4 bg-[#090A0C] overflow-hidden anim-tab">
            {/* Whiteboard Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 bg-[#111214] border border-stone-800/80 rounded-2xl p-2 sm:p-3 mb-2 sm:mb-3 font-mono text-xs">
              <div className="flex flex-wrap items-center gap-2">
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
                  <span>文字</span>
                </button>

                {(boardMode === 'draw' || boardMode === 'eraser') && (
                  <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
                    {boardMode === 'draw' && (
                      <>

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

                    <span className="w-px h-4 bg-stone-800 mx-1" />
                    {boardMode === 'eraser' ? (
                      [16, 32, 64, 120].map(w => (
                        <button
                          key={w}
                          onClick={() => setEraserWidth(w)}
                          title={`消しゴムの太さ: ${w}px`}
                          className={`px-2 py-0.5 rounded border text-xs transition ${
                            eraserWidth === w ? 'border-amber-400 text-amber-400 font-bold bg-amber-500/10' : 'border-stone-800 text-stone-500 hover:text-stone-300'
                          }`}
                        >
                          {w}px
                        </button>
                      ))
                    ) : (
                      [2, 4, 8, 16].map(w => (
                        <button
                          key={w}
                          onClick={() => setBrushWidth(w)}
                          title={`ペンの太さ: ${w}px`}
                          className={`px-2 py-0.5 rounded border transition ${
                            brushWidth === w ? 'border-amber-400 text-amber-400' : 'border-stone-800 text-stone-500'
                          }`}
                        >
                          {w}px
                        </button>
                      ))
                    )}
                  </div>
                )}

                {boardMode === 'text' && (
                  <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
                    <input
                      type="text"
                      placeholder="文字を入力 → ボードをタップ"
                      value={newBoardText}
                      onChange={e => setNewBoardText(e.target.value)}
                      className="bg-[#16181D] border border-stone-800 rounded-xl px-3 py-1 text-white w-48 sm:w-64 focus:outline-none focus:border-amber-500/60"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isTimelapsePlaying ? (
                  <button
                    onClick={stopTimelapse}
                    className="relative overflow-hidden px-3 py-1.5 bg-stone-900 border border-amber-500/40 text-amber-300 rounded-xl flex items-center gap-1.5 transition"
                    title="再生を止める"
                  >
                    <span className="absolute inset-y-0 left-0 bg-amber-500/20" style={{ width: `${Math.round(timelapseProgress * 100)}%` }} />
                    <Square className="relative w-3 h-3 fill-current" />
                    <span className="relative tabular-nums">{Math.round(timelapseProgress * 100)}%</span>
                  </button>
                ) : (
                  (() => {
                    const plan = timelapsePlan(boardStrokes, boardTexts);
                    return (
                      <button
                        onClick={handlePlayTimelapse}
                        disabled={plan.total === 0}
                        title={plan.total === 0 ? 'まだ何も描かれていません' : `約${Math.max(1, Math.round(plan.duration / 1000))}秒で再生${plan.speed > 1.05 ? ` (×${plan.speed.toFixed(1)}倍速)` : ''}`}
                        className="px-3 py-1.5 bg-stone-900 border border-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-amber-400 rounded-xl flex items-center gap-1.5 transition disabled:opacity-40"
                      >
                        <Play className="w-3.5 h-3.5 text-amber-400" />
                        <span className="hidden sm:inline">タイムラプス</span>
                        {plan.speed > 1.05 && <span className="hidden sm:inline text-[10px] text-stone-500">×{plan.speed.toFixed(1)}</span>}
                      </button>
                    );
                  })()
                )}

                <button
                  onClick={handleClearBoard}
                  className="p-1.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-500 hover:text-red-400 hover:border-red-900 transition"
                  title="全員分を消す"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 relative border border-stone-800/80 rounded-2xl bg-[#0C0D10] overflow-hidden flex items-center justify-center cursor-crosshair">
              <canvas
                ref={canvasRef}
                width={BOARD_WIDTH}
                height={BOARD_HEIGHT}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                onClick={handleAddBoardText}
                style={{ touchAction: 'none' }}
                className="w-full h-full object-contain select-none"
              />

              {/* 共有クリップボード (折りたたみ可) */}
              <div className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 w-[calc(100%-1rem)] sm:w-80 bg-[#111214]/90 backdrop-blur-md border border-stone-800/80 rounded-2xl shadow-2xl font-mono text-xs cursor-auto">
                <button
                  onClick={() => setIsClipboardOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-stone-400 hover:text-white"
                >
                  <span className="flex items-center gap-1.5 font-bold text-white">
                    <Clipboard className="w-3.5 h-3.5 text-amber-400" /> 共有クリップボード
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-stone-500">
                    {clipboardUpdatedBy && `by ${clipboardUpdatedBy}`}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isClipboardOpen ? '' : 'rotate-180'}`} />
                  </span>
                </button>
                {isClipboardOpen && (
                  <div className="px-3 pb-3 space-y-2 anim-fade">
                    <textarea
                      value={clipboardText}
                      onChange={e => handleUpdateClipboard(e.target.value)}
                      placeholder="ここに書いた内容は全員と共有されます"
                      className="w-full bg-[#16181D] border border-stone-800 rounded-xl p-2 text-stone-200 focus:outline-none focus:border-amber-500/60 resize-none h-20 text-xs leading-relaxed"
                    />
                    <button
                      onClick={handleCopyClipboardToOS}
                      className="w-full py-1.5 btn-ghost rounded-lg flex items-center justify-center gap-1.5 text-[11px]"
                    >
                      {isCopiedToOS ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopiedToOS ? 'コピーしました' : '端末にコピー'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: その他 (テスト点数) */}
        {activeTab === 'more' && (
          <div className="flex-1 min-h-0 flex anim-tab">
            <TestScoresTab token={token} safeFetch={safeFetch} currentUser={currentUser} users={onlineUsers} />
          </div>
        )}

        {/* TAB 8: ヘルプ */}
        {activeTab === 'help' && (
          <div className="flex-1 min-h-0 flex anim-tab">
            <HelpTab
              onAskAi={q => {
                setActiveTab('ai');
                toast(q || 'AI タブを開きました', { kind: 'success' });
              }}
            />
          </div>
        )}

        {/* TAB 7: 設定 (アカウント・通知・Webhook・監査ログ) */}
        {activeTab === 'settings' && (
          <div className="flex-1 p-3 sm:p-6 overflow-y-auto anim-tab">
            <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-800/80 pb-4">
                <h2 className="text-xl sm:text-2xl font-bold font-['Space_Grotesk'] text-white">設定</h2>
                <div className="flex gap-1 font-mono text-xs bg-[#111214] p-1 rounded-xl border border-stone-800 overflow-x-auto">
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
                      className={`px-3 py-1.5 rounded-lg whitespace-nowrap ${
                        settingsSection === sec.id
                          ? 'bg-amber-500 text-black font-bold'
                          : 'text-stone-400 hover:text-white hover:bg-stone-800/60'
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
                  <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 text-stone-400 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>接続設定（通信方式・ポーリング間隔・プロキシ/直結）は端末ごとのネットワーク環境に合わせてこの端末にのみ保存され、別端末とは同期されません。</span>
                  </div>

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
                    <p className="text-stone-400">つながらない時は自動で切り替わります。うまくいかない時だけ固定してください。</p>
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

              {/* 0. 表示・操作 */}
              {settingsSection === 'appearance' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>設定はすべてアカウントに自動同期され、スマホ・PC・Chromebookなど別端末でもそのまま引き継がれます。</span>
                  </div>
                  {([
                    {
                      title: '画面の大きさ',
                      value: uiScale,
                      options: [75, 85, 100, 110].map(v => ({ v, label: `${v}%` })),
                      onPick: (v: number) => {
                        setUiScale(v);
                        LS.set('asdf_ui_scale', String(v));
                        syncPreferencesToServer({ uiScale: v });
                      },
                    },
                    {
                      title: 'チャットの自動スクロール',
                      value: chatAutoScrollMode,
                      options: [
                        { v: 'always', label: '常に最新へ' },
                        { v: 'unread_anchor', label: '一番下にいる時だけ' },
                        { v: 'off', label: 'しない' },
                      ],
                      onPick: (v: any) => {
                        setChatAutoScrollMode(v);
                        LS.set('asdf_chat_scroll_mode', v);
                        syncPreferencesToServer({ chatAutoScrollMode: v });
                      },
                    },
                    {
                      title: 'メモの自動保存 (入力が止まってから)',
                      value: memoAutoSaveInterval,
                      options: [
                        { v: 1000, label: '1秒' },
                        { v: 2000, label: '2秒' },
                        { v: 5000, label: '5秒' },
                        { v: 0, label: 'オフ' },
                      ],
                      onPick: (v: number) => {
                        setMemoAutoSaveInterval(v);
                        LS.set('asdf_memo_autosave_ms', String(v));
                        syncPreferencesToServer({ memoAutoSaveInterval: v });
                      },
                    },
                  ] as { title: string; value: any; options: { v: any; label: string }[]; onPick: (v: any) => void }[]).map(group => (
                    <div key={group.title} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="text-white font-bold text-sm">{group.title}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {group.options.map(opt => (
                          <button
                            key={String(opt.v)}
                            type="button"
                            onClick={() => group.onPick(opt.v)}
                            className={`p-2.5 rounded-xl border text-center ${
                              group.value === opt.v
                                ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-bold'
                                : 'bg-[#16181D] border-stone-800 text-stone-300 hover:text-white hover:border-stone-500'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 1. アカウント設定 */}
              {settingsSection === 'account' && (
                <div className="space-y-4">
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 sm:p-6 text-xs flex flex-wrap items-center gap-4">
                    <div className="relative group">
                      <Avatar name={currentUser.username} url={currentUser.avatar_url} size="w-20 h-20 text-3xl" />
                      <button
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={isUploadingAvatar}
                        className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white"
                        aria-label="アイコンを変更"
                      >
                        {isUploadingAvatar ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                      </button>
                      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="text-white font-bold text-lg truncate">{currentUser.username}</div>
                      <div className="text-stone-500">{currentUser.role === 'admin' ? '管理者' : 'メンバー'}</div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => avatarInputRef.current?.click()} disabled={isUploadingAvatar} className="px-3 py-1.5 rounded-lg btn-primary font-bold">
                          {isUploadingAvatar ? 'アップロード中…' : 'アイコンを変更'}
                        </button>
                        {currentUser.avatar_url && (
                          <button onClick={handleRemoveAvatar} className="px-3 py-1.5 rounded-lg btn-ghost">削除</button>
                        )}
                      </div>
                    </div>
                    <button onClick={handleLogout} className="sm:hidden ml-auto px-3 py-1.5 rounded-lg btn-ghost flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5" /> ログアウト
                    </button>
                  </div>

                  {/* クラス */}
                  <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 sm:p-6 text-xs space-y-3">
                    <div className="text-white font-bold text-sm flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-amber-400" /> 自分のクラス
                    </div>
                    <p className="text-stone-400">時間割・提出物・宿題は、最初にこのクラスのものが表示されます。ほかのクラスもそれぞれの画面で切り替えて見られます。</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLASS_NUMBERS.map(n => (
                        <button
                          key={n}
                          onClick={() => n !== currentUser.class_no && handleSetMyClass(n)}
                          aria-pressed={currentUser.class_no === n}
                          className={`w-14 py-2 rounded-xl border font-bold transition ${
                            currentUser.class_no === n
                              ? 'bg-amber-500 border-amber-400 text-black shadow-[0_0_0_3px_rgba(245,158,11,0.2)]'
                              : 'bg-[#16181D] border-stone-800 text-stone-300 hover:border-amber-500/50 hover:text-amber-300'
                          }`}
                        >
                          {n}組
                        </button>
                      ))}
                    </div>
                    {!currentUser.class_no && <div className="text-amber-300">まだ設定されていません (時間割は1組が表示されます)</div>}
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
                    <p className="text-stone-400">元に戻せません。</p>
                    <button
                      onClick={handleDeleteAccount}
                      className="px-4 py-2 btn-danger font-bold rounded-xl"
                    >
                      アカウントを削除
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
                    {notifyPermission === 'denied' && (
                      <div className="p-2.5 rounded-xl bg-red-950/30 border border-red-900 text-red-300">
                        ブラウザで通知がブロックされています。アドレスバーのサイト設定から許可してください。
                      </div>
                    )}
                    {notifyPermission === 'default' && (
                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
                        <span>通知がまだ許可されていません</span>
                        <button onClick={requestNotifyPermission} className="px-3 py-1 rounded-lg btn-primary font-bold shrink-0">許可する</button>
                      </div>
                    )}
                    {([
                      { key: 'important', label: '重要な通知', desc: '自分へのメンション・返信、@everyone、新しい提出物' },
                      { key: 'messages', label: 'すべてのメッセージ', desc: '見ていないチャンネルやタブ非表示中の新着メッセージ' },
                      { key: 'sound', label: '通知音', desc: '重要な通知で音を鳴らす' },
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
                        <div className="space-y-3">
                          {discordServers.length === 0 ? (
                            <div className="text-stone-500">参加中の Discord サーバーがありません</div>
                          ) : (
                            discordServers.map((srv: any) => {
                              const srvBindings = (integrations.bot?.bindings || []).filter((b: any) =>
                                b.guildId === srv.id || b.discordGuildName === srv.name
                              );
                              return (
                                <div key={srv.id} className="p-3.5 rounded-xl bg-[#16181D] border border-stone-800 space-y-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800/80 pb-2">
                                    <div className="flex items-center gap-2">
                                      {srv.iconUrl ? (
                                        <img src={toProxiedMediaUrl(srv.iconUrl, token)} alt="" className="w-5 h-5 rounded-lg object-cover" />
                                      ) : (
                                        <Server className="w-4 h-4 text-indigo-400" />
                                      )}
                                      <span className="font-bold text-white text-sm">{srv.name}</span>
                                      <span className="text-[10px] text-stone-400">({srvBindings.length} チャンネル同期中)</span>
                                    </div>
                                    {currentUser?.role === 'admin' && (
                                      <button
                                        onClick={() => handleSyncAllChannels(srv.id, srv.name)}
                                        disabled={isSyncingAllChannels}
                                        className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-bold text-[11px] flex items-center gap-1 disabled:opacity-40"
                                      >
                                        <RefreshCw className={`w-3 h-3 ${isSyncingAllChannels ? 'animate-spin' : ''}`} />
                                        全チャンネルを一括同期
                                      </button>
                                    )}
                                  </div>
                                  <div className="space-y-1.5">
                                    {srvBindings.length === 0 ? (
                                      <div className="text-stone-500 text-[11px] py-1">このサーバーで同期中のチャンネルはありません</div>
                                    ) : (
                                      srvBindings.map((b: any) => (
                                        <div key={b.discordChannelId} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#111214] border border-stone-800">
                                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                            <span className="text-indigo-300 font-bold">#{b.discordChannelName}</span>
                                            <span className="text-stone-600">⇔</span>
                                            <span className="text-amber-300 font-bold">asdfbase #{b.asdfChannelName}</span>
                                          </div>
                                          {currentUser?.role === 'admin' && (
                                            <div className="flex items-center gap-1 shrink-0">
                                              <button
                                                onClick={() => handleUnbindDiscordChannel({ asdfChannelId: b.asdfChannelId, discordChannelId: b.discordChannelId, label: `#${b.asdfChannelName}` })}
                                                className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[10px]"
                                              >
                                                同期解除
                                              </button>
                                              <button
                                                onClick={() => handleUnbindDiscordChannel({ asdfChannelId: b.asdfChannelId, discordChannelId: b.discordChannelId, label: `#${b.asdfChannelName}`, deleteChannel: true })}
                                                className="px-2 py-1 rounded bg-red-950/50 hover:bg-red-900/50 border border-red-900 text-red-300 text-[10px]"
                                              >
                                                チャンネルごと削除
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={loadIntegrations} className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 flex items-center gap-1.5">
                            <RefreshCw className="w-3 h-3" /> 状態を更新
                          </button>
                          <button
                            onClick={() => setShowDiscordServerModal(true)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-bold flex items-center gap-1.5"
                          >
                            <Link className="w-3 h-3" /> 簡単チャンネル紐付け・サーバー管理
                          </button>
                          <button
                            onClick={() => handleSyncDiscordHistory()}
                            disabled={isSyncingDiscordHistory}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSyncingDiscordHistory ? 'animate-spin' : ''}`} />
                            {isSyncingDiscordHistory ? '履歴同期中…' : '未取得の過去履歴を同期 (ダウンタイム補完)'}
                          </button>
                        </div>
                      </div>

                      {/* 古いチャットの自動削除 */}
                      <div className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                        <div className="text-white font-bold text-sm flex items-center gap-1.5">
                          <Trash2 className="w-4 h-4 text-amber-400" /> 古いチャットの自動削除
                          <span className="ml-auto px-2.5 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs">
                            現在: {integrations.chatRetentionDays ? `${integrations.chatRetentionDays}日より前を削除` : '削除しない'}
                          </span>
                        </div>
                        <p className="text-stone-400 leading-relaxed">
                          Discord に転送されているチャンネルだけ、保存期間を過ぎたメッセージと画像をサーバーから削除します (Discord 側には残ります)。ピン留めしたメッセージは消えません。
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {[0, 7, 14, 30, 60, 90].map(d => (
                            <button
                              key={d}
                              disabled={currentUser?.role !== 'admin'}
                              onClick={async () => {
                                if (d === integrations.chatRetentionDays) return;
                                const shorter = d > 0 && (integrations.chatRetentionDays === 0 || d < integrations.chatRetentionDays);
                                if (shorter) {
                                  const ok = await confirmDialog({
                                    title: `${d}日より前のメッセージを削除しますか？`,
                                    message: '対象チャンネルの古いメッセージと画像がサーバーから削除されます。元に戻せません。',
                                    confirmLabel: '削除する',
                                    danger: true,
                                  });
                                  if (!ok) return;
                                }
                                await saveIntegrations({ chatRetentionDays: d });
                                setTimeout(loadIntegrations, 3000);
                              }}
                              aria-pressed={integrations.chatRetentionDays === d}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border font-bold transition ${
                                integrations.chatRetentionDays === d
                                  ? 'bg-amber-500 border-amber-400 text-black shadow-[0_0_0_3px_rgba(245,158,11,0.2)]'
                                  : 'bg-stone-800 border-stone-700 text-stone-400 enabled:hover:border-amber-500/50 enabled:hover:text-amber-300'
                              } disabled:cursor-not-allowed`}
                            >
                              {integrations.chatRetentionDays === d && <Check className="w-3.5 h-3.5" />}
                              {d === 0 ? '削除しない' : `${d}日`}
                            </button>
                          ))}
                        </div>
                        {currentUser?.role !== 'admin' && <div className="text-stone-500">変更できるのは管理者だけです。</div>}
                        <div className="text-stone-500 leading-relaxed">
                          対象: {integrations.retention?.channels?.length
                            ? integrations.retention.channels.map((n: string) => `#${n}`).join(' ')
                            : 'なし (Discord への転送がないので削除されません)'}
                          {integrations.retention?.last && (
                            <div>
                              前回の掃除: {new Date(integrations.retention.last.at).toLocaleString('ja-JP')} · メッセージ {integrations.retention.last.messages}件 / 画像 {integrations.retention.last.files}枚
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Webhooks */}
                      {([
                        { key: 'importantWebhookUrl', kind: 'important', title: '重要通知用 Webhook', desc: '提出物の登録・締切変更、@everyone、ピン留めなど重要な通知だけを送ります。' },
                        { key: 'messageWebhookUrl', kind: 'message', title: 'メッセージ用 Webhook', desc: 'Bot の同期が設定されていないチャンネルのメッセージ・画像をこの Webhook に送ります (任意)。' },
                      ] as const).map(w => (
                        <div key={w.key} className="bg-[#111214] border border-stone-800/80 rounded-2xl p-5 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-white font-bold text-sm">{w.title}</div>
                            {currentUser?.role !== 'admin' && (
                              <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                                管理者専用
                              </span>
                            )}
                          </div>
                          <p className="text-stone-400 leading-relaxed">{w.desc}</p>
                          <input
                            type="url"
                            disabled={currentUser?.role !== 'admin'}
                            placeholder="https://discord.com/api/webhooks/..."
                            value={integrations[w.key] || ''}
                            onChange={e => setIntegrations((prev: any) => ({ ...prev, [w.key]: e.target.value }))}
                            className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
                          />
                          {currentUser?.role === 'admin' ? (
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
                          ) : (
                            <div className="text-[11px] text-stone-500">※ Webhook の登録・変更・テストは管理者のみ可能です。</div>
                          )}
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
                      value={auditUserFilter}
                      onChange={e => {
                        setAuditUserFilter(e.target.value);
                        setAuditSummary(null);
                        loadAuditLogs(auditFilter, e.target.value);
                      }}
                      className="bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1.5 text-stone-200 focus:outline-none max-w-[10rem]"
                      aria-label="ユーザーで絞り込み"
                    >
                      <option value="">全員</option>
                      {[...onlineUsers].sort((a, b) => a.username.localeCompare(b.username)).map(u => (
                        <option key={u.id} value={String(u.id)}>{u.username}</option>
                      ))}
                      <option value="system">システム・Discord</option>
                    </select>
                    <select
                      value={auditFilter}
                      onChange={e => {
                        setAuditFilter(e.target.value);
                        setAuditSummary(null);
                        loadAuditLogs(e.target.value, auditUserFilter);
                      }}
                      className="bg-[#16181D] border border-stone-800 rounded-lg px-2 py-1.5 text-stone-200 focus:outline-none"
                      aria-label="種類で絞り込み"
                    >
                      <option value="">すべて</option>
                      <option value="login">ログイン</option>
                      <option value="message">メッセージ</option>
                      <option value="assignment">提出物</option>
                      <option value="homework">宿題</option>
                      <option value="timetable">時間割</option>
                      <option value="channel">チャンネル</option>
                      <option value="discord">Discord</option>
                      <option value="settings">設定</option>
                    </select>
                    <button onClick={() => loadAuditLogs()} className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300" title="更新">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={summarizeAuditLogs}
                      disabled={isSummarizingAudit || auditLogs.length === 0}
                      className="btn-chip text-xs disabled:opacity-40"
                      title="表示中の条件のログ (最新200件まで) を AI が要約"
                    >
                      <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${isSummarizingAudit ? 'animate-pulse' : ''}`} />
                      {isSummarizingAudit ? '要約中…' : 'AIで要約'}
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
                  {auditSummary && (
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 space-y-2 anim-fade">
                      <div className="flex items-center gap-2 text-amber-300 font-bold">
                        <Sparkles className="w-3.5 h-3.5" /> AI 要約
                        <span className="text-stone-500 font-normal">
                          ({auditUserFilter ? (auditUserFilter === 'system' ? 'システム・Discord' : userById.get(Number(auditUserFilter))?.username || '') : '全員'}
                          {auditFilter ? ` · ${auditFilter}` : ''} · 直近{auditSummary.count}件)
                        </span>
                        <button onClick={() => setAuditSummary(null)} className="ml-auto p-1 rounded text-stone-500 hover:text-white" aria-label="閉じる">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="markdown-body text-stone-200 text-xs">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{auditSummary.text}</ReactMarkdown>
                      </div>
                    </div>
                  )}
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

      {/* スマホ: 下部タブバー (よく使う5つ + メニュー) */}
      <nav className="md:hidden shrink-0 border-t border-stone-800/80 bg-[#0C0D10]/95 backdrop-blur-md pb-safe z-40">
        <div className="flex">
          {[...TABS.filter(t => MOBILE_MAIN_TABS.includes(t.id)), { id: 'menu' as const, label: 'メニュー', icon: Menu }].map(tab => {
            const Icon = tab.icon;
            const inMenu = !MOBILE_MAIN_TABS.includes(activeTab);
            const isActive = tab.id === 'menu' ? inMenu || isMobileMenuOpen : activeTab === tab.id && !isMobileMenuOpen;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'menu') {
                    setIsMobileMenuOpen(v => !v);
                  } else {
                    setIsMobileMenuOpen(false);
                    setActiveTab(tab.id);
                  }
                }}
                className={`relative flex-1 min-w-0 flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] ${isActive ? 'text-amber-400' : 'text-stone-500'}`}
              >
                {isActive && <span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-b bg-amber-400 anim-fade" />}
                <Icon className="w-5 h-5" />
                <span className="truncate max-w-full">{tab.id === 'menu' && inMenu ? TABS.find(t => t.id === activeTab)?.label : tab.label}</span>
                {tab.id === 'chat' && totalMentions > 0 && (
                  <span className="absolute top-0.5 left-1/2 ml-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-4 text-center anim-badge">
                    {totalMentions > 99 ? '99+' : totalMentions}
                  </span>
                )}
                {tab.id === 'chat' && totalMentions === 0 && totalUnread > 0 && !isActive && (
                  <span className="absolute top-1 left-1/2 ml-2 w-2 h-2 rounded-full bg-white" />
                )}
                {tab.id === 'homework' && urgentHomework > 0 && (
                  <span className="absolute top-0.5 left-1/2 ml-1.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold leading-4 text-center">
                    {urgentHomework}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* スマホ: メニュー (下部タブに無いタブ) */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[45] bg-black/50 anim-fade" onClick={() => setIsMobileMenuOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className="absolute left-2 right-2 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] bg-[#111214] border border-stone-800 rounded-2xl p-2 shadow-2xl grid grid-cols-4 gap-1 anim-pop"
          >
            {TABS.filter(t => !MOBILE_MAIN_TABS.includes(t.id)).map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] ${
                    activeTab === tab.id ? 'bg-amber-500/15 text-amber-300' : 'text-stone-300 active:bg-stone-800'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {tab.id === 'more' ? 'テスト点数' : tab.label}
                </button>
              );
            })}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                setShowCamera(v => !v);
              }}
              className="flex flex-col items-center gap-1 py-3 rounded-xl text-[11px] text-stone-300 active:bg-stone-800"
            >
              <Camera className="w-5 h-5" />
              カメラ
            </button>
          </div>
        </div>
      )}

      {/* スマホ: メッセージ長押しの操作メニュー */}
      {msgActionSheet && (() => {
        const m = msgActionSheet;
        const isMine = m.user_id === currentUser.id;
        const isImage = IMAGE_MESSAGE_RE.test((m.content || '').trim());
        const close = () => setMsgActionSheet(null);
        const item = 'w-full flex items-center gap-3 px-4 py-3 text-sm text-left active:bg-stone-800 rounded-xl';
        return (
          <div className="fixed inset-0 z-[80] bg-black/60 flex items-end anim-fade" onClick={close}>
            <div onClick={e => e.stopPropagation()} className="w-full bg-[#111214] border-t border-stone-800 rounded-t-2xl p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] anim-slide-up">
              <div className="px-4 pt-2 pb-3 text-xs text-stone-400 border-b border-stone-800 mb-1">
                <b className="text-stone-200">{splitSenderName(m.sender_username || m.username || '').name}</b>
                <span className="ml-2 line-clamp-2">{summarizeContent(m.content || '')}</span>
              </div>
              <div className="flex justify-around py-2">
                {['👍', '❤️', '✅', '❌', ':swim:', '😂'].map(e => (
                  <button
                    key={e}
                    onClick={() => {
                      handleToggleReaction(m.id, e);
                      close();
                    }}
                    className="w-11 h-11 rounded-full bg-stone-900 border border-stone-800 text-xl active:scale-95 flex items-center justify-center"
                  >
                    {renderReactionEmoji(e, customEmojisMap)}
                  </button>
                ))}
              </div>
              <button className={item} onClick={() => { startReply(m); close(); }}><Reply className="w-4 h-4 text-amber-400" /> 返信</button>
              {!isImage && (
                <button
                  className={item}
                  onClick={() => {
                    navigator.clipboard.writeText(m.content).then(() => toast('テキストをコピーしました', { kind: 'success' }), () => {});
                    close();
                  }}
                >
                  <Copy className="w-4 h-4 text-stone-400" /> テキストをコピー
                </button>
              )}
              <button className={item} onClick={() => { handleCopyMessageLink(m.id); close(); }}><Link className="w-4 h-4 text-stone-400" /> リンクをコピー</button>
              <button className={item} onClick={() => { handleTogglePin(m.id); close(); }}><Pin className="w-4 h-4 text-stone-400" /> {m.is_pinned ? 'ピン留めを外す' : 'ピン留め'}</button>
              {isMine && !isImage && (
                <button className={item} onClick={() => { setEditingMessageId(m.id); setEditingContent(m.content); close(); }}>
                  <Edit3 className="w-4 h-4 text-stone-400" /> 編集
                </button>
              )}
              {(isMine || currentUser.role === 'admin') && (
                <button className={`${item} text-red-400`} onClick={() => { close(); handleDeleteMessage(m.id); }}>
                  <Trash2 className="w-4 h-4" /> 削除
                </button>
              )}
            </div>
          </div>
        );
      })()}

      <UiHost />

      {showWeather && (
        <Modal onClose={() => setShowWeather(false)} className="max-w-2xl">
          <WeatherDetail weather={weather} onClose={() => setShowWeather(false)} onRefresh={() => refetchWeatherRef.current()} />
        </Modal>
      )}

      {showCalendar && (
        <Modal onClose={() => setShowCalendar(false)} className="max-w-5xl">
          <CalendarPanel
            token={token}
            safeFetch={safeFetch}
            currentUser={currentUser}
            events={calendarEvents}
            loadRange={loadCalendarRange}
            upsert={ev => setCalendarEvents(prev => [...prev.filter(e => e.id !== ev.id), ev])}
            removeLocal={id => setCalendarEvents(prev => prev.filter(e => e.id !== id))}
            onClose={() => setShowCalendar(false)}
          />
        </Modal>
      )}

      {/* 画像ビューア: クリックで拡大・ホイール/ボタンでズーム・ダウンロード */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex flex-col anim-fade"
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
        <div className="fixed bottom-20 md:bottom-4 right-4 w-64 sm:w-72 bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden z-50 anim-pop">
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade">
          <div className="w-full max-w-sm bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl font-mono text-xs space-y-4 anim-pop">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm">新規チャンネル作成</span>
              <button onClick={() => setIsNewChannelModalOpen(false)} className="text-stone-500 hover:text-white">&times;</button>
            </div>
            <form onSubmit={handleCreateChannel} className="space-y-3">
              <div>
                <label className="block text-stone-400 mb-1">所属サーバー</label>
                <select
                  value={newChannelServerId || (selectedServerId !== 'all' ? selectedServerId : (discordServers[0]?.id || '1524703392927191100'))}
                  onChange={e => setNewChannelServerId(e.target.value)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  {discordServers.map(srv => (
                    <option key={srv.id} value={srv.id}>{srv.name}</option>
                  ))}
                </select>
              </div>
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

      {/* チャンネル名変更モーダル */}
      {editingChannel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade">
          <div className="w-full max-w-sm bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl font-mono text-xs space-y-4 anim-pop">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm">チャンネル名を変更</span>
              <button onClick={() => setEditingChannel(null)} className="text-stone-500 hover:text-white">&times;</button>
            </div>
            <form onSubmit={handleEditChannelName} className="space-y-3">
              <div>
                <label className="block text-stone-400 mb-1">新しいチャンネル名</label>
                <input
                  type="text"
                  required
                  value={editChannelNameInput}
                  onChange={e => setEditChannelNameInput(e.target.value)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition"
              >
                変更を保存
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Discord サーバー & 簡単チャンネル紐付けモーダル */}
      {showDiscordServerModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade" onClick={() => setShowDiscordServerModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl text-xs space-y-5 anim-pop">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <div>
                  <div className="font-bold text-white text-sm">Discord サーバー & 簡単チャンネル連携</div>
                  <div className="text-[11px] text-stone-400">サーバー情報の表示・簡単チャンネル紐付け (rds9 承認制)・ダウンタイム履歴補完</div>
                </div>
              </div>
              <button onClick={() => setShowDiscordServerModal(false)} className="p-1 text-stone-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 承認待ちリクエスト (管理者 または 申請者向け) */}
            {discordLinkRequests.filter(r => r.status === 'pending').length > 0 && (
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-800/60 space-y-2">
                <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <Shield className="w-4 h-4" /> 承認待ちの Discord 連携リクエスト ({discordLinkRequests.filter(r => r.status === 'pending').length}件)
                </div>
                <div className="space-y-1.5">
                  {discordLinkRequests.filter(r => r.status === 'pending').map(req => (
                    <div key={req.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#16181D] border border-stone-800">
                      <div className="min-w-0">
                        <div className="text-stone-200 font-bold truncate">
                          {req.guild_name} #{req.discord_channel_name} ⇔ asdfbase #{req.asdf_channel_name}
                        </div>
                        <div className="text-[10px] text-stone-400">申請者: @{req.requested_by_username}</div>
                      </div>
                      {currentUser.role === 'admin' ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleApproveDiscordRequest(req.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold"
                          >
                            許可して紐付け
                          </button>
                          <button
                            onClick={() => handleRejectDiscordRequest(req.id)}
                            className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-red-950/60 text-stone-300 hover:text-red-300"
                          >
                            却下
                          </button>
                        </div>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] shrink-0">
                          rds9 (管理者) の承認待ち
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 簡単チャンネル紐付けフォーム */}
            <form
              onSubmit={e => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const rawTarget = String(fd.get('discordTarget') || '');
                if (!rawTarget) {
                  toast('Discord 側のチャンネルを選択してください', { kind: 'error' });
                  return;
                }
                const [guildId, guildName, discordChannelId, discordChannelName] = rawTarget.split('|');
                const asdfChannelRaw = String(fd.get('asdfChannelId') || '');
                const customName = String(fd.get('customChannelName') || '').trim();
                const existingCh = asdfChannelRaw ? channels.find(c => String(c.id) === asdfChannelRaw) : undefined;
                handleRequestOrCreateDiscordBinding({
                  guildId,
                  guildName,
                  discordChannelId,
                  discordChannelName,
                  asdfChannelId: existingCh ? existingCh.id : null,
                  asdfChannelName: existingCh ? existingCh.name : (customName || discordChannelName),
                });
              }}
              className="p-4 rounded-xl bg-[#16181D] border border-stone-800 space-y-3"
            >
              <div className="font-bold text-white flex items-center gap-1.5">
                <Link className="w-4 h-4 text-amber-400" /> ワンクリック簡単チャンネル紐付け
                {currentUser.role !== 'admin' && (
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                    ※ 申請すると rds9 (管理者) に通知され、許可後に同期開始されます
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">1. Discord のテキストチャンネル</label>
                  <select
                    name="discordTarget"
                    required
                    className="w-full bg-[#111214] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">チャンネルを選択…</option>
                    {discordServers.map(srv => {
                      const gid = srv.id || srv.guildId;
                      return (
                        <optgroup key={gid} label={`${srv.name} (${srv.onlineCount}/${srv.memberCount}人)`}>
                          {(srv.textChannels || []).map((tc: any) => (
                            <option
                              key={tc.id}
                              value={`${gid}|${srv.name}|${tc.id}|${tc.name}`}
                              disabled={Boolean(tc.boundChannelId)}
                            >
                              #{tc.name} {tc.boundChannelId ? '(連携済み)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">2. 紐付ける asdfbase チャンネル</label>
                  <select
                    name="asdfChannelId"
                    className="w-full bg-[#111214] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">＋ 新規チャンネルを自動作成して紐付け</option>
                    {channels.map(c => (
                      <option key={c.id} value={String(c.id)}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  name="customChannelName"
                  placeholder="新規作成時のチャンネル名 (空欄ならDiscordと同じ名前)"
                  className="flex-1 min-w-[200px] bg-[#111214] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold transition shrink-0"
                >
                  {currentUser.role === 'admin' ? '今すぐ紐付け' : '紐付けをリクエスト (rds9承認)'}
                </button>
              </div>
            </form>

            {/* 接続中の Discord サーバー一覧 & ステータス */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-stone-300">Bot が参加している Discord サーバー ({discordServers.length})</span>
                <button
                  onClick={() => handleSyncDiscordHistory()}
                  disabled={isSyncingDiscordHistory}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingDiscordHistory ? 'animate-spin' : ''}`} />
                  {isSyncingDiscordHistory ? '過去履歴を取得中…' : 'Botダウンタイム中の未取得履歴を一括取得'}
                </button>
              </div>
              {discordServers.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#16181D] border border-stone-800 text-stone-500 text-center">
                  接続されている Discord サーバーがありません。
                </div>
              ) : (
                discordServers.map(srv => {
                  const gid = srv.id || srv.guildId;
                  return (
                  <div key={gid} className="p-3.5 rounded-xl bg-[#16181D] border border-stone-800 space-y-2.5">
                    <div className="flex items-center gap-3">
                      {srv.iconUrl ? (
                        <img src={srv.iconUrl} alt={srv.name} className="w-10 h-10 rounded-xl object-cover shrink-0 border border-stone-700" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center font-bold text-sm text-stone-300 shrink-0">
                          {srv.name.slice(0, 2)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-white text-sm truncate flex items-center gap-2">
                          <span>{srv.name}</span>
                          {srv.approved && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                              公認サーバー
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-stone-400 flex items-center gap-3 mt-0.5">
                          <span className="text-emerald-400 font-bold">● オンライン {srv.onlineCount}人</span>
                          <span>総メンバー {srv.memberCount}人</span>
                          <span>VC接続 {(srv.voiceChannels || []).reduce((acc: number, vc: any) => acc + vc.members.length, 0)}人</span>
                        </div>
                      </div>
                      {currentUser.role === 'admin' && (
                        <button
                          onClick={() => handleToggleApproveGuild(gid, !srv.approved)}
                          className={`px-3 py-1.5 rounded-xl border font-bold text-[11px] transition shrink-0 ${
                            srv.approved
                              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300 hover:bg-stone-800'
                              : 'bg-stone-800 border-stone-700 text-stone-300 hover:border-amber-500/50'
                          }`}
                        >
                          {srv.approved ? '承認済み (解除)' : 'サーバーを承認'}
                        </button>
                      )}
                    </div>

                    {/* VC 状況 */}
                    {(srv.voiceChannels || []).length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-stone-800/80">
                        <div className="text-[10px] text-stone-400 font-bold">ボイスチャンネル状況</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {srv.voiceChannels.map((vc: any) => (
                            <div key={vc.id} className="p-2 rounded-lg bg-[#111214] border border-stone-800/80">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-stone-300 font-bold flex items-center gap-1">
                                  <Volume2 className="w-3 h-3 text-emerald-400" /> {vc.name}
                                </span>
                                <span className="text-[10px] text-stone-500">{vc.members.length}人</span>
                              </div>
                              {vc.members.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {vc.members.map((m: any) => (
                                    <span
                                      key={m.id}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                                        m.speaking
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                                          : 'bg-stone-900 text-stone-300 border border-stone-800'
                                      }`}
                                    >
                                      {m.avatarUrl && <img src={m.avatarUrl} alt="" className="w-3.5 h-3.5 rounded-full" />}
                                      <span className="truncate max-w-[90px]">{m.displayName}</span>
                                      {m.speaking && <Mic className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />}
                                      {(m.selfMute || m.serverMute) && <MicOff className="w-2.5 h-2.5 text-red-400" />}
                                      {m.streaming && <span className="px-1 rounded bg-red-500 text-white text-[8px] font-bold">LIVE</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>

            {/* サーバーごとのチャンネル同期管理 & 一括同期 */}
            <div className="space-y-3 border-t border-stone-800 pt-3">
              <div className="font-bold text-stone-300">サーバーごとのチャンネル同期状況</div>
              {discordServers.length === 0 ? (
                <div className="text-stone-500 text-xs">接続中のサーバーがありません</div>
              ) : (
                discordServers.map((srv: any) => {
                  const srvBindings = discordBindings.filter((b: any) =>
                    b.guildId === srv.id || b.discordGuildName === srv.name
                  );
                  return (
                    <div key={srv.id} className="p-3.5 rounded-xl bg-[#16181D] border border-stone-800 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800/80 pb-2">
                        <div className="flex items-center gap-2">
                          {srv.iconUrl ? (
                            <img src={toProxiedMediaUrl(srv.iconUrl, token)} alt="" className="w-5 h-5 rounded-lg object-cover" />
                          ) : (
                            <Server className="w-4 h-4 text-indigo-400" />
                          )}
                          <span className="font-bold text-white text-sm">{srv.name}</span>
                          <span className="text-[10px] text-stone-400">({srvBindings.length} / {(srv.textChannels || []).length} チャンネル同期中)</span>
                        </div>
                        {currentUser?.role === 'admin' && (
                          <button
                            onClick={() => handleSyncAllChannels(srv.id, srv.name)}
                            disabled={isSyncingAllChannels}
                            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-bold text-[11px] flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSyncingAllChannels ? 'animate-spin' : ''}`} />
                            このサーバーの全チャンネルを一括同期
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {srvBindings.length === 0 ? (
                          <div className="text-stone-500 text-[11px] py-1">同期中のチャンネルはありません。「全チャンネルを一括同期」または上の簡単紐付けから追加できます。</div>
                        ) : (
                          srvBindings.map((b: any) => (
                            <div key={b.discordChannelId} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#111214] border border-stone-800">
                              <div className="min-w-0 flex items-center gap-2 flex-wrap text-xs">
                                <span className="text-indigo-300 font-bold">#{b.discordChannelName}</span>
                                <span className="text-stone-600">⇔</span>
                                <span className="text-amber-300 font-bold">asdfbase #{b.asdfChannelName}</span>
                              </div>
                              {currentUser?.role === 'admin' && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() => handleUnbindDiscordChannel({ asdfChannelId: b.asdfChannelId, discordChannelId: b.discordChannelId, label: `#${b.asdfChannelName}` })}
                                    className="px-2 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-[10px]"
                                  >
                                    同期解除
                                  </button>
                                  <button
                                    onClick={() => handleUnbindDiscordChannel({ asdfChannelId: b.asdfChannelId, discordChannelId: b.discordChannelId, label: `#${b.asdfChannelName}`, deleteChannel: true })}
                                    className="px-2 py-1 rounded-lg bg-red-950/50 hover:bg-red-900/60 border border-red-900 text-red-300 text-[10px]"
                                  >
                                    削除
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* チャンネルごとのロール権限 & サーバー紐付け設定モーダル (admin限定) */}
      {channelPermModal && currentUser.role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade" onClick={() => setChannelPermModal(null)}>
          <form onSubmit={handleSaveChannelPermissions} onClick={e => e.stopPropagation()} className="w-full max-w-md bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl text-xs space-y-4 anim-pop">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
              <div className="font-bold text-white text-sm flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" /> #{channelPermModal.name} の権限・サーバー設定
              </div>
              <button type="button" onClick={() => setChannelPermModal(null)} className="text-stone-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-stone-400 font-bold mb-1">所属サーバー (左のサーバー欄での分類)</label>
                <select
                  value={channelPermModal.server_id || ''}
                  onChange={e => setChannelPermModal(prev => prev ? { ...prev, server_id: e.target.value || null } : prev)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">指定なし (すべてに表示)</option>
                  {discordServers.map(srv => {
                    const gid = srv.id || srv.guildId;
                    return <option key={gid} value={gid}>{srv.name}</option>;
                  })}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-stone-400 font-bold">閲覧できるロール (未選択なら全員閲覧可能)</label>
                  <button
                    type="button"
                    onClick={() => setChannelPermModal(prev => prev ? { ...prev, view_roles: [] } : prev)}
                    className="text-[10px] text-amber-400 hover:underline"
                  >
                    全員に開放
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-[#16181D] border border-stone-800">
                  {roleDefs.map(r => {
                    const currentView = channelPermModal.view_roles || [];
                    const active = currentView.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setChannelPermModal(prev => {
                            if (!prev) return prev;
                            const cur = prev.view_roles || [];
                            const next = active ? cur.filter((x: string) => x !== r.id) : [...cur, r.id];
                            return { ...prev, view_roles: next };
                          });
                        }}
                        className={`px-2.5 py-1 rounded-lg border font-bold transition flex items-center gap-1.5 ${
                          active
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                            : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                        <span>{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-stone-400 font-bold">書き込みできるロール (未選択なら全員送信可能)</label>
                  <button
                    type="button"
                    onClick={() => setChannelPermModal(prev => prev ? { ...prev, write_roles: [] } : prev)}
                    className="text-[10px] text-amber-400 hover:underline"
                  >
                    全員に開放
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-[#16181D] border border-stone-800">
                  {roleDefs.map(r => {
                    const currentWrite = channelPermModal.write_roles || [];
                    const active = currentWrite.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setChannelPermModal(prev => {
                            if (!prev) return prev;
                            const cur = prev.write_roles || [];
                            const next = active ? cur.filter((x: string) => x !== r.id) : [...cur, r.id];
                            return { ...prev, write_roles: next };
                          });
                        }}
                        className={`px-2.5 py-1 rounded-lg border font-bold transition flex items-center gap-1.5 ${
                          active
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                            : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                        <span>{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setChannelPermModal(null);
                  setShowRoleManagerModal(true);
                }}
                className="text-amber-400 hover:underline text-[11px]"
              >
                ロールの作成・メンバー割り当てを開く →
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold transition"
              >
                権限を保存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ロール管理・メンバー割り当てモーダル (admin限定) */}
      {showRoleManagerModal && currentUser.role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade" onClick={() => setShowRoleManagerModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl text-xs space-y-4 anim-pop">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
              <div className="font-bold text-white text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" /> ロール管理・権限割り当て (管理者専用)
              </div>
              <button onClick={() => setShowRoleManagerModal(false)} className="text-stone-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddRoleDef} className="p-3.5 rounded-xl bg-[#16181D] border border-stone-800 space-y-2.5">
              <div className="font-bold text-stone-200">新しいロールを追加</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="ロール名 (例: 生徒会 / 放送委員)"
                  required
                  value={newRoleNameInput}
                  onChange={e => setNewRoleNameInput(e.target.value)}
                  className="flex-1 min-w-[140px] bg-[#111214] border border-stone-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  placeholder="ID (任意: council)"
                  value={newRoleIdInput}
                  onChange={e => setNewRoleIdInput(e.target.value)}
                  className="w-28 bg-[#111214] border border-stone-800 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500"
                />
                <input
                  type="color"
                  value={newRoleColorInput}
                  onChange={e => setNewRoleColorInput(e.target.value)}
                  className="w-9 h-8 rounded-lg bg-transparent border border-stone-700 cursor-pointer"
                  title="ロールの色"
                />
                <button type="submit" className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold">
                  追加
                </button>
              </div>
            </form>

            <div className="space-y-1.5">
              <div className="font-bold text-stone-300">登録済みロール一覧</div>
              {roleDefs.length === 0 ? (
                <div className="text-stone-500 py-2">カスタムロールはまだありません</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {roleDefs.map(r => (
                    <div key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#16181D] border border-stone-800">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                      <span className="text-white font-bold">{r.name}</span>
                      <span className="text-[10px] text-stone-500">({r.id})</span>
                      {!r.system && (
                        <button
                          onClick={() => handleDeleteRoleDef(r.id)}
                          className="text-stone-500 hover:text-red-400 ml-1"
                          title="ロールを削除"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-stone-800 pt-3">
              <div className="font-bold text-stone-300">メンバーへのロール割り当て (クリックでON/OFF)</div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {onlineUsers.map(u => {
                  const uRoles = Array.isArray(u.custom_roles) ? u.custom_roles : [];
                  return (
                    <div key={u.id} className="p-2.5 rounded-xl bg-[#16181D] border border-stone-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={u.username} url={u.avatar_url} size="w-6 h-6 text-[10px]" />
                        <span className="text-white font-bold truncate">{u.username}</span>
                        {u.role === 'admin' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">ADMIN</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {roleDefs.filter(r => !r.system).map(r => {
                          const has = uRoles.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => handleToggleUserCustomRole(u, r.id)}
                              className={`px-2 py-0.5 rounded-md border text-[10px] font-bold transition flex items-center gap-1 ${
                                has
                                  ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                                  : 'bg-stone-900 border-stone-800 text-stone-500 hover:text-stone-300'
                              }`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                              {r.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* お知らせ作成モーダル (admin限定) */}
      {isNewAnnouncementModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade">
          <div className="w-full max-w-md bg-[#111214] border border-stone-800 rounded-2xl p-5 shadow-2xl text-xs space-y-4 anim-pop">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" /> 全体へのお知らせを作成
              </span>
              <button onClick={() => setIsNewAnnouncementModalOpen(false)} className="text-stone-500 hover:text-white">&times;</button>
            </div>
            <form onSubmit={handleCreateAnnouncement} className="space-y-3">
              <div>
                <label className="block text-stone-400 mb-1 font-bold">タイトル</label>
                <input
                  type="text"
                  required
                  placeholder="例: 今週末のサーバーメンテナンスについて"
                  value={newAnnouncementTitle}
                  onChange={e => setNewAnnouncementTitle(e.target.value)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-stone-400 mb-1 font-bold">内容</label>
                <textarea
                  rows={4}
                  placeholder="お知らせの本文を入力してください"
                  value={newAnnouncementContent}
                  onChange={e => setNewAnnouncementContent(e.target.value)}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500 resize-none leading-relaxed"
                />
              </div>
              <label className="flex items-center gap-2 text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAnnouncementDiscord}
                  onChange={e => setNewAnnouncementDiscord(e.target.checked)}
                  className="rounded border-stone-700 bg-stone-900 text-amber-500"
                />
                <span>Discord の重要通知 Webhook にも同時に送信する</span>
              </label>
              <button
                type="submit"
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition shadow-lg text-sm"
              >
                お知らせを配信
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Ctrl+K コマンドパレット (Spotlight風モーダル) */}
      {isPaletteOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-16 sm:pt-24 p-4 anim-fade" onClick={() => setIsPaletteOpen(false)}>
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-xl bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden anim-pop font-mono text-xs"
          >
            <div className="p-3 border-b border-stone-800 flex items-center gap-2">
              <Command className="w-4 h-4 text-amber-400" />
              <input
                autoFocus
                type="text"
                placeholder="タブ名や計算式 (例: 12 * 85)"
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
              <div className="text-[10px] uppercase text-stone-500 px-2 py-1 font-bold">移動</div>
              {[
                { id: 'chat', label: 'チャットへ移動', desc: '/chat' },
                { id: 'memo', label: 'リアルタイムメモへ移動', desc: '/memo' },
                { id: 'assignments', label: '提出物・時間割へ移動', desc: '/assignments' },
                { id: 'board', label: 'ホワイトボードへ移動', desc: '/board' },
                { id: 'ai', label: 'AIへ移動', desc: '/ai' },
                { id: 'more', label: 'テスト点数へ移動', desc: '/more' },
                { id: 'settings', label: '設定へ移動', desc: '/settings' },
                { id: 'help', label: 'ヘルプへ移動', desc: '/help' },
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

      {/* 時間割モーダル: 週間グリッド (朝の会〜帰りの会) と各コマの編集 */}
      {isTimetableModalOpen && (() => {
        const editDef = ttConfig.schedules[scheduleType] || DEFAULT_CONFIG.schedules.normal;
        const timeInput = 'bg-[#111214] border border-stone-800 rounded px-1.5 py-1 text-white w-[5.5rem]';
        const draftRow = (label: string, value: { start: string; end: string }, onChange: (v: { start: string; end: string }) => void) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-14 text-amber-400 font-bold shrink-0">{label}</span>
            <input type="time" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })} className={timeInput} />
            <span className="text-stone-500">〜</span>
            <input type="time" value={value.end} onChange={e => onChange({ ...value, end: e.target.value })} className={timeInput} />
          </div>
        );
        const fixedRow = (label: string, render: (day: number) => React.ReactNode, time?: string) => (
          <tr className="border-b border-stone-800/80 bg-stone-950/30">
            <td className="py-1.5 px-2 border-r border-stone-800">
              <div className="font-bold text-stone-300">{label}</div>
              {time && <div className="text-[10px] text-stone-500 tabular-nums">{time}</div>}
            </td>
            {[1, 2, 3, 4, 5].map(day => (
              <td key={day} className="p-1 border-r border-stone-800 last:border-r-0 text-[10px] text-stone-500">{render(day)}</td>
            ))}
          </tr>
        );
        return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-stretch sm:items-center justify-center sm:p-4 anim-fade" onClick={() => setIsTimetableModalOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-5xl bg-[#111214] sm:border border-amber-500/30 sm:rounded-2xl shadow-2xl overflow-hidden text-xs max-h-[100dvh] sm:max-h-[94dvh] flex flex-col anim-pop"
          >
            <div className="p-3 sm:p-4 border-b border-stone-800 flex flex-wrap items-center gap-2 bg-stone-900/60">
              <BookOpen className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-white text-sm">時間割</span>
              <span className="text-amber-300 font-bold hidden sm:inline">
                {schoolStatus.label}{schoolStatus.sub ? ` (${schoolStatus.sub})` : ''}
              </span>
              <button onClick={() => setIsTimetableModalOpen(false)} className="ml-auto p-1 rounded-lg text-stone-500 hover:text-white hover:bg-stone-800" title="閉じる (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 今日の時程: 全員共通・今日だけ有効 */}
            <div className="px-3 sm:px-4 py-2.5 border-b border-stone-800 flex flex-wrap items-center gap-2 bg-amber-500/5">
              <span className="text-stone-300 font-bold">今日の時程</span>
              <span className="text-stone-500 text-[10px]">(全員共通・明日には通常に戻ります)</span>
              <div className="flex gap-1 ml-auto">
                {(Object.keys(SCHEDULE_LABELS) as ScheduleType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => handleSetTodaySchedule(t)}
                    className={`px-2.5 py-1 rounded-lg border ${
                      todaySchedule === t ? 'bg-amber-500 text-black font-bold border-amber-500' : 'border-stone-700 text-stone-300 hover:text-white hover:border-stone-500'
                    }`}
                  >
                    {SCHEDULE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
              {/* 左: 週間グリッド */}
              <div className="flex-1 min-w-0 min-h-0 overflow-auto p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-stone-400 mr-1">クラス:</span>
                  {CLASS_NUMBERS.map(n => (
                    <button
                      key={n}
                      onClick={() => {
                        setTtClassNo(n);
                        setSelectedTtCell(null);
                        setTtSaveStatus('');
                      }}
                      className={`px-2.5 py-1 rounded-lg border ${
                        ttClassNo === n ? 'bg-amber-500 text-black font-bold border-amber-500' : 'border-stone-800 text-stone-400 hover:text-white hover:border-stone-600'
                      }`}
                    >
                      {n}組{n === currentUser.class_no ? ' ★' : ''}
                    </button>
                  ))}
                  {!currentUser.class_no && (
                    <button
                      onClick={() => handleSetMyClass(ttClassNo)}
                      className="ml-1 px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                    >
                      {ttClassNo}組を自分のクラスにする
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-stone-400" title="短縮・S短でも教科は同じで、時刻だけが変わります">時刻を表示する時程:</span>
                  {(Object.keys(SCHEDULE_LABELS) as ScheduleType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => {
                        setScheduleType(t);
                        setIsEditingPeriods(false);
                      }}
                      className={`px-2.5 py-1 rounded-lg border ${
                        scheduleType === t ? 'bg-stone-200 text-black font-bold border-stone-200' : 'border-stone-800 text-stone-400 hover:text-white hover:border-stone-600'
                      }`}
                    >
                      {SCHEDULE_LABELS[t]}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setPeriodDraft(JSON.parse(JSON.stringify(editDef)));
                      setIsEditingPeriods(v => !v);
                    }}
                    className="ml-auto px-2.5 py-1 rounded-lg border border-stone-800 text-stone-300 hover:border-amber-500/50 hover:text-amber-300 flex items-center gap-1"
                  >
                    <CalendarClock className="w-3.5 h-3.5" /> {isEditingPeriods ? '閉じる' : '時刻を編集'}
                  </button>
                </div>

                {isEditingPeriods && periodDraft && (
                  <div className="p-3 rounded-xl bg-[#16181D] border border-stone-800 space-y-2 anim-fade">
                    <div className="text-stone-300 font-bold">{SCHEDULE_LABELS[scheduleType]} の時刻</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {draftRow('朝の会', periodDraft.morning, v => setPeriodDraft(d => (d ? { ...d, morning: v } : d)))}
                      {periodDraft.periods.map((p, i) =>
                        draftRow(`${i + 1}限`, p, v => setPeriodDraft(d => (d ? { ...d, periods: d.periods.map((x, j) => (j === i ? v : x)) } : d)))
                      )}
                      {draftRow('帰りの会', periodDraft.closing, v => setPeriodDraft(d => (d ? { ...d, closing: v } : d)))}
                    </div>
                    <div className="text-[10px] text-stone-500">5限の日は、帰りの会が5限のすぐ後になります。時程は全クラス共通で、時間割 (教科) は時程を変えても同じです。</div>
                    <button onClick={handleSavePeriodTimes} className="px-4 py-1.5 btn-primary font-bold rounded-lg">
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
                            className={`py-1.5 px-2 border-r border-stone-800 last:border-r-0 font-bold ${
                              nowForStatus.getDay() === day ? 'text-amber-300 bg-amber-500/10' : 'text-white'
                            }`}
                          >
                            <div>{DAY_LABELS[day]}</div>
                            <button
                              onClick={() => handleToggleDayPeriods(day)}
                              title="5限 / 6限 を切り替え"
                              className={`mt-0.5 px-1.5 rounded text-[10px] font-bold border ${
                                periodCountFor(ttConfig, day) === 5 ? 'bg-sky-500/15 border-sky-500/40 text-sky-300' : 'border-stone-700 text-stone-400 hover:text-white'
                              }`}
                            >
                              {periodCountFor(ttConfig, day)}限まで
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fixedRow('朝の会', () => '', `${editDef.morning.start}〜${editDef.morning.end}`)}
                      {Array.from({ length: MAX_PERIODS }, (_, i) => i + 1).map(period => {
                        const pt = editDef.periods[period - 1];
                        return (
                          <tr key={period} className="border-b border-stone-800/80">
                            <td className="py-1.5 px-2 border-r border-stone-800 bg-stone-950/40">
                              <div className="font-bold text-amber-500/90">{period}限</div>
                              {pt && <div className="text-[10px] text-stone-500 tabular-nums">{pt.start}〜{pt.end}</div>}
                            </td>
                            {[1, 2, 3, 4, 5].map(day => {
                              const off = period > periodCountFor(ttConfig, day);
                              const existing = timetables.find(tt => tt.day_of_week === day && tt.period === period);
                              const isSelected = selectedTtCell?.day === day && selectedTtCell?.period === period;
                              if (off) {
                                return (
                                  <td key={day} className="p-1 border-r border-stone-800 last:border-r-0 bg-stone-950/60">
                                    <div className="min-h-[40px] flex items-center justify-center text-stone-700 text-[10px]">授業なし</div>
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={day}
                                  onClick={() => selectTtCell(day, period)}
                                  className={`p-1 border-r border-stone-800 last:border-r-0 cursor-pointer transition align-top ${
                                    isSelected ? 'bg-amber-500/20 ring-1 ring-inset ring-amber-500' : 'hover:bg-stone-800/60'
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
                      {fixedRow('帰りの会', day => {
                        const c = closingFor(editDef, periodCountFor(ttConfig, day));
                        return <span className="tabular-nums">{c.start}〜{c.end}</span>;
                      })}
                    </tbody>
                  </table>
                </div>
                {ttSaveStatus && <div className="text-emerald-400 anim-fade">{ttSaveStatus}</div>}
              </div>

              {/* 右: 選択中のコマ (教科ボタンは押した瞬間に保存) */}
              <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-stone-800 p-3 sm:p-4 space-y-3 overflow-y-auto max-h-[45dvh] lg:max-h-none">
                {!selectedTtCell ? (
                  <div className="text-stone-500 leading-relaxed">
                    マスを選ぶと教科・持ち物・メモを入力できます。教科ボタンは押すとすぐ保存され、次のコマへ進みます。
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-white font-bold text-sm">
                        {DAY_LABELS[selectedTtCell.day]}曜 {selectedTtCell.period}限
                        <span className="text-stone-500 font-normal ml-1">({ttClassNo}組)</span>
                      </span>
                      <button onClick={() => setSelectedTtCell(null)} className="text-stone-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {SUBJECTS.map(subj => (
                        <button
                          type="button"
                          key={subj}
                          onClick={() => handlePresetSubject(subj)}
                          className={`px-2 py-1 rounded border ${
                            ttDetailDraft.subject === subj
                              ? 'bg-amber-500 text-black font-bold border-amber-400'
                              : 'bg-[#16181D] border-stone-800 text-stone-300 hover:text-white hover:border-stone-500'
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
                          placeholder="例: 数学"
                          className="mt-1 w-full bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60"
                        />
                      </label>
                      <label className="block">
                        <span className="text-stone-400 flex items-center gap-1"><Backpack className="w-3 h-3" /> 持ち物</span>
                        <textarea
                          value={ttDetailDraft.items}
                          onChange={e => setTtDetailDraft(d => ({ ...d, items: e.target.value }))}
                          rows={2}
                          placeholder="例: 教科書、ワーク、コンパス"
                          className="mt-1 w-full bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60 resize-none"
                        />
                      </label>
                      <label className="block">
                        <span className="text-stone-400">メモ</span>
                        <textarea
                          value={ttDetailDraft.note}
                          onChange={e => setTtDetailDraft(d => ({ ...d, note: e.target.value }))}
                          rows={3}
                          placeholder="例: 理科室へ移動、小テスト"
                          className="mt-1 w-full bg-[#16181D] border border-stone-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-500/60 resize-none"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveTtDetail}
                        disabled={!ttDetailDraft.subject.trim()}
                        className="flex-1 py-2 btn-primary disabled:opacity-40 font-bold rounded-lg"
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

                {/* 今日の持ち物 */}
                <div className="pt-3 border-t border-stone-800 space-y-1.5">
                  <div className="text-stone-300 font-bold flex items-center gap-1"><Backpack className="w-3.5 h-3.5 text-amber-400" /> 今日の持ち物・メモ</div>
                  {todayRows.filter(t => (t.items && t.items.trim()) || (t.note && t.note.trim())).length === 0 ? (
                    <div className="text-stone-500">{nowForStatus.getDay() === 0 || nowForStatus.getDay() === 6 ? '今日は休みです' : 'なし'}</div>
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
        );
      })()}

      {/* 提出物編集モーダル */}
      {editingAssignment && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-lg bg-[#111214] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden anim-pop font-mono text-xs flex flex-col max-h-[85dvh]"
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
                    {Array.from(new Set([...SUBJECTS, 'その他', editingAssignment.subject])).map(s => (
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
                <label className="text-[10px] text-stone-400 block mb-1">クラス</label>
                <select
                  value={editingAssignment.class_no == null ? '' : String(editingAssignment.class_no)}
                  onChange={e => setEditingAssignment({ ...editingAssignment, class_no: e.target.value ? Number(e.target.value) : null })}
                  className="w-full bg-[#16181D] border border-stone-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                >
                  <option value="">全クラス共通</option>
                  {CLASS_NUMBERS.map(n => <option key={n} value={n}>{n}組</option>)}
                </select>
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-lg bg-[#111214] border border-stone-800 rounded-2xl shadow-2xl overflow-hidden anim-pop font-mono text-xs flex flex-col max-h-[85dvh]"
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 anim-fade">
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-xl bg-[#111214] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden anim-pop font-mono text-xs flex flex-col max-h-[85dvh]"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-2 text-amber-300 font-bold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>AI 要約: {floatingAiSummary.title}</span>
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
                  <div className="markdown-body text-stone-200 text-sm">
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
                  toast('コピーしました', { kind: 'success' });
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

      {/* メモAI結果: 反映できるのは校正だけ (確認あり・元に戻せる) */}
      {memoAiResultModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 anim-fade" onClick={() => setMemoAiResultModal(null)}>
          <div 
            onClick={e => e.stopPropagation()} 
            className="w-full max-w-2xl bg-[#111214] border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden anim-pop text-xs flex flex-col max-h-[85dvh]"
          >
            <div className="p-4 border-b border-stone-800 flex items-center justify-between bg-amber-500/10">
              <div className="flex items-center gap-2 text-amber-300 font-bold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>{memoAiResultModal.type === 'summarize' ? 'AI 要約' : memoAiResultModal.type === 'proofread' ? 'AI 校正' : 'コード解説'}</span>
              </div>
              <button onClick={() => setMemoAiResultModal(null)} className="text-stone-500 hover:text-white" aria-label="閉じる">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-stone-200 text-sm select-text">
              {memoAiResultModal.type === 'proofread' ? (
                <div className="whitespace-pre-wrap leading-relaxed">{memoAiResultModal.result}</div>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{memoAiResultModal.result}</ReactMarkdown>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-stone-800 flex flex-wrap items-center justify-end gap-2 bg-[#16181D]">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(memoAiResultModal.result);
                  toast('コピーしました', { kind: 'success' });
                }}
                className="px-3 py-1.5 btn-ghost rounded-lg flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>コピー</span>
              </button>
              {memoAiResultModal.type === 'proofread' && !isMonacoLocked && (
                <button
                  type="button"
                  onClick={() => applyProofread(memoAiResultModal.result)}
                  className="px-3.5 py-1.5 btn-primary font-bold rounded-lg flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>メモに反映</span>
                </button>
              )}
              <button type="button" onClick={() => setMemoAiResultModal(null)} className="px-3.5 py-1.5 btn-ghost rounded-lg">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
