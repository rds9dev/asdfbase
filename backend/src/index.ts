import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { pool, initDb } from './db.js';
import { askGemini, getAvailableKeyCount, runGeminiAgent, getAiUsageStats, type ModelMode } from './gemini.js';
import { aiToolDeclarations, createAiToolRunner } from './aiTools.js';
import type { Content } from '@google/genai';
import {
  startDiscordBot, relayToDiscordBot, editRelayedOnDiscord, getDiscordStatus, getDiscordGuildStatus, refreshDiscordCommands, getBoundAsdfChannelIds,
  relayReactionToDiscord, relayPinToDiscord,
  getDiscordServers, addDiscordBinding, removeDiscordBinding, syncDiscordHistory, approveDiscordGuild, removeApprovedDiscordGuild,
} from './discord.js';
import {
  DEFAULT_SCHEDULES, DEFAULT_DAY_PERIOD_COUNTS, SCHEDULE_TYPES, isValidSchedule, nowInTokyo, nextLessonDate, nextWeekday,
  type ScheduleDef, type ScheduleType, type TimetableConfig,
} from './schedule.js';

dotenv.config();

// VPS は IPv6 の外向き通信が通らないため IPv4 を優先 (天気API等の ETIMEDOUT 対策)
dns.setDefaultResultOrder('ipv4first');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8091;
const JWT_SECRET = process.env.JWT_SECRET || 'asdfbase_jwt_super_secret_key_2026_x89q';
const INVITE_CODE = process.env.INVITE_CODE || 'ASDF';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

// ---------------- System settings helpers ----------------
export async function getSetting(key: string, fallback = ''): Promise<string> {
  try {
    const res = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
    if (res.rows.length > 0 && res.rows[0].value !== null) return res.rows[0].value;
  } catch (_) {}
  return fallback;
}

export async function setSetting(key: string, value: string) {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

// 重要通知用 Webhook (従来の discord_webhook_url をそのまま重要通知専用として使う)
export async function getDiscordWebhookUrl(): Promise<string> {
  return getSetting('discord_webhook_url', DISCORD_WEBHOOK_URL);
}

async function postWebhook(url: string, body: object, files: string[] = []) {
  if (files.length === 0) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
    return;
  }
  const form = new FormData();
  form.append('payload_json', JSON.stringify(body));
  files.forEach((f, i) => form.append(`files[${i}]`, new Blob([fs.readFileSync(f)]), path.basename(f)));
  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
}

// 重要な通知 (提出物・@everyone・ピン留め等) → 重要通知 Webhook (5秒以内の同一通知は重複防止)
const recentImportantCache = new Map<string, number>();
export async function notifyImportant(title: string, description: string, color = 0xf59e0b) {
  try {
    const dedupeKey = `${title}::${description}`;
    const now = Date.now();
    const prev = recentImportantCache.get(dedupeKey);
    if (prev && now - prev < 5000) return;
    recentImportantCache.set(dedupeKey, now);
    if (recentImportantCache.size > 200) {
      for (const [k, t] of recentImportantCache.entries()) {
        if (now - t > 10000) recentImportantCache.delete(k);
      }
    }

    if ((await getSetting('notify_important_enabled', 'on')) !== 'on') return;
    const url = await getDiscordWebhookUrl();
    if (!url) return;
    await postWebhook(url, {
      username: 'asdfbase 重要通知',
      embeds: [{ title: title.slice(0, 256), description: description.slice(0, 4000), color, timestamp: new Date().toISOString() }],
      allowed_mentions: { parse: [] },
    });
  } catch (err: any) {
    console.error('notifyImportant error:', err.message);
  }
}

// 通常メッセージの Discord 転送: Bot 連携があれば Bot、なければメッセージ用 Webhook
export async function relayMessage(msg: { id?: number; channel_id: number; username?: string; sender_username?: string; content: string; reply_to_id?: number | null }): Promise<boolean> {
  try {
    const username = msg.sender_username || msg.username || 'unknown';
    if (username.startsWith('[Discord]')) return false; // Discord から来たものは戻さない
    if ((await getSetting('notify_messages_enabled', 'on')) !== 'on') return false;

    let targetDiscordMsgId: string | null = null;
    if (msg.reply_to_id) {
      const linkRes = await pool.query(
        `SELECT discord_message_id FROM discord_message_links WHERE asdf_message_id = $1 LIMIT 1`,
        [msg.reply_to_id]
      );
      if (linkRes.rows.length > 0) {
        targetDiscordMsgId = linkRes.rows[0].discord_message_id;
      }
    }

    const sent = await relayToDiscordBot(msg.channel_id, username, msg.content, targetDiscordMsgId);
    if (sent.length > 0) {
      // あとで編集を Discord 側にも反映できるよう、送ったメッセージを覚えておく
      if (msg.id) {
        for (const r of sent) {
          await pool.query(
            `INSERT INTO discord_message_links (asdf_message_id, discord_channel_id, discord_message_id, direction)
             VALUES ($1, $2, $3, 'out') ON CONFLICT DO NOTHING`,
            [msg.id, r.discordChannelId, r.discordMessageId]
          );
        }
      }
      return true;
    }

    const url = await getSetting('discord_message_webhook_url', '');
    if (!url) return false;
    const files: string[] = [];
    const text = msg.content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, (_m, p: string) => {
      const f = path.join(UPLOAD_DIR, path.basename(p));
      if (fs.existsSync(f)) files.push(f);
      return '';
    }).trim();
    await postWebhook(url, { username: `[asdfbase] ${username}`, content: text || undefined, allowed_mentions: { parse: [] } }, files);
    return true;
  } catch (err: any) {
    console.error('relayMessage error:', err.message);
    return false;
  }
}

// 編集の Discord 反映: Bot で送ったものはそのメッセージを編集。Webhook は編集できないので「(編集済み)」付きで送り直す
async function relayEdit(msg: { id: number; channel_id: number; content: string }, username: string) {
  try {
    if ((await getSetting('notify_messages_enabled', 'on')) !== 'on') return;
    const links = (await pool.query(
      `SELECT discord_channel_id, discord_message_id FROM discord_message_links WHERE asdf_message_id = $1 AND direction = 'out'`,
      [msg.id]
    )).rows.map(r => ({ discordChannelId: r.discord_channel_id, discordMessageId: r.discord_message_id }));
    if (links.length > 0) {
      await editRelayedOnDiscord(links, username, msg.content);
      return;
    }
    // Bot で同期しているチャンネルなのにリンクが無い (古いメッセージ等) なら何もしない
    if ((await getBoundAsdfChannelIds()).includes(msg.channel_id)) return;
    const url = await getSetting('discord_message_webhook_url', '');
    if (!url) return;
    const text = msg.content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, '').trim();
    if (!text) return;
    await postWebhook(url, { username: `[asdfbase] ${username}`, content: `${text} (編集済み)`.slice(0, 2000), allowed_mentions: { parse: [] } });
  } catch (err: any) {
    console.error('relayEdit error:', err.message);
  }
}

// ---------------- Audit log ----------------
function requestMeta(req: Request) {
  const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    ip: fwd || req.socket.remoteAddress || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  };
}

export function logAudit(
  user: { id?: number | null; username?: string | null } | null,
  action: string,
  targetType: string,
  targetId: number | null,
  details: Record<string, any>,
  canRestore = false
) {
  pool.query(
    `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details, can_restore)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [user?.id || null, user?.username || 'system', action, targetType, targetId, JSON.stringify(details), canRestore]
  ).catch(err => console.error('Audit log error:', err.message));
}

const UPLOAD_DIR = path.resolve('uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export interface AuthRequest extends Request {
  user?: { id: number; username: string; role: string };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: '認証トークンがありません' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string; role: string };
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '無効または期限切れのトークンです' });
  }
}

export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'この操作には管理者権限が必要です' });
  }
  next();
}

// 自分のクラス (1〜6組)。時間割・提出物・宿題の既定の表示に使う
export const CLASS_NUMBERS = [1, 2, 3, 4, 5, 6];
const parseClassNo = (v: any): number | null => (CLASS_NUMBERS.includes(Number(v)) ? Number(v) : null);

async function classOf(userId: number): Promise<number | null> {
  const r = await pool.query(`SELECT class_no FROM users WHERE id = $1`, [userId]);
  return parseClassNo(r.rows[0]?.class_no);
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'asdfbase-api', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'asdfbase-api', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'asdfbase-api', timestamp: new Date().toISOString() });
});

// Weather Cache & API (高松市)
interface WeatherDay {
  date: string;
  weatherCode: number;
  desc: string;
  tempMax: number | null;
  tempMin: number | null;
  precipProb: number | null;
}
interface WeatherHour {
  time: string;
  temp: number;
  weatherCode: number;
  precipProb: number | null;
}
interface WeatherInfo {
  temp: number;
  desc: string;
  weatherCode: number;
  tempMax: number | null;
  tempMin: number | null;
  precipProb: number | null;
  humidity?: number | null;
  feelsLike?: number | null;
  windSpeed?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
  daily: WeatherDay[];
  hourly: WeatherHour[];
  source: 'open-meteo' | 'jma' | 'fallback';
  updatedAt: number;
}
let weatherCache: WeatherInfo | null = null;

function getWeatherDescription(code: number): string {
  if (code === 0) return '快晴';
  if (code === 1) return '晴れ';
  if (code === 2) return '一部曇';
  if (code === 3) return '曇り';
  if (code === 45 || code === 48) return '霧';
  if (code >= 51 && code <= 57) return '霧雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return 'にわか雨';
  if (code >= 85 && code <= 86) return '雪';
  if (code >= 95) return '雷雨';
  return '晴れ';
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const roundOrNull = (v: any) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

async function fetchWeatherOpenMeteo(): Promise<WeatherInfo> {
  const data = await fetchJson(
    'https://api.open-meteo.com/v1/forecast?latitude=34.34&longitude=134.04' +
    '&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&forecast_days=7&timezone=Asia%2FTokyo&wind_speed_unit=ms'
  );
  if (!data?.current || !Number.isFinite(Number(data.current.temperature_2m))) throw new Error('open-meteo: 現在の気温がありません');
  const code = Number(data.current.weather_code);
  const d = data.daily || {};
  const daily: WeatherDay[] = (d.time || []).map((date: string, i: number) => ({
    date,
    weatherCode: Number(d.weather_code?.[i] ?? -1),
    desc: getWeatherDescription(Number(d.weather_code?.[i] ?? 1)),
    tempMax: roundOrNull(d.temperature_2m_max?.[i]),
    tempMin: roundOrNull(d.temperature_2m_min?.[i]),
    precipProb: d.precipitation_probability_max?.[i] ?? null,
  }));
  // 現在時刻から24時間分
  const h = data.hourly || {};
  const nowKey = String(data.current.time || '').slice(0, 13);
  const startIdx = Math.max(0, (h.time || []).findIndex((t: string) => t.slice(0, 13) === nowKey));
  const hourly: WeatherHour[] = (h.time || []).slice(startIdx, startIdx + 24).map((time: string, i: number) => ({
    time: time.slice(11, 16),
    temp: Math.round(h.temperature_2m[startIdx + i]),
    weatherCode: Number(h.weather_code[startIdx + i]),
    precipProb: h.precipitation_probability?.[startIdx + i] ?? null,
  }));
  return {
    temp: Math.round(data.current.temperature_2m),
    desc: getWeatherDescription(code),
    weatherCode: code,
    tempMax: daily[0]?.tempMax ?? null,
    tempMin: daily[0]?.tempMin ?? null,
    precipProb: daily[0]?.precipProb ?? null,
    humidity: roundOrNull(data.current.relative_humidity_2m),
    feelsLike: roundOrNull(data.current.apparent_temperature),
    windSpeed: data.current.wind_speed_10m != null ? Math.round(Number(data.current.wind_speed_10m) * 10) / 10 : null,
    sunrise: d.sunrise?.[0] ? String(d.sunrise[0]).slice(11, 16) : null,
    sunset: d.sunset?.[0] ? String(d.sunset[0]).slice(11, 16) : null,
    daily,
    hourly,
    source: 'open-meteo',
    updatedAt: Date.now(),
  };
}

const jmaDesc = (text: string) => text.includes('雪') ? '雪' : text.includes('雷') ? '雷雨' : text.startsWith('雨') ? '雨'
  : text.startsWith('くもり') ? '曇り' : text.startsWith('晴') ? '晴れ' : (text.split(/\s/)[0] || '不明');
const jmaCode = (desc: string) => desc === '晴れ' ? 1 : desc === '曇り' ? 3 : desc === '雨' ? 61 : desc === '雪' ? 71 : desc === '雷雨' ? 95 : 2;

// 気象庁 (香川県) — open-meteo が落ちている時の予備
async function fetchWeatherJma(): Promise<WeatherInfo> {
  const data = await fetchJson('https://www.jma.go.jp/bosai/forecast/data/forecast/370000.json');
  const series = data[0].timeSeries;
  const weatherText: string = series[0].areas[0].weathers?.[0] || '';
  const pops: string[] = series[1]?.areas?.[0]?.pops || [];
  const temps: string[] = series[2]?.areas?.[0]?.temps || [];
  const desc = jmaDesc(weatherText);
  const nums = temps.map(Number).filter(n => Number.isFinite(n));
  const popNums = pops.map(Number).filter(n => Number.isFinite(n));
  // 週間予報
  const daily: WeatherDay[] = [];
  const week = data[1]?.timeSeries;
  if (week) {
    const times: string[] = week[0]?.timeDefines || [];
    const codes: string[] = week[0]?.areas?.[0]?.weatherCodes || [];
    const wpops: string[] = week[0]?.areas?.[0]?.pops || [];
    const tmax: string[] = week[1]?.areas?.[0]?.tempsMax || [];
    const tmin: string[] = week[1]?.areas?.[0]?.tempsMin || [];
    times.forEach((t, i) => {
      const c = Number(codes[i]);
      const d = c >= 400 ? '雪' : c >= 300 ? '雨' : c >= 200 ? '曇り' : '晴れ';
      daily.push({
        date: t.slice(0, 10),
        weatherCode: jmaCode(d),
        desc: d,
        tempMax: tmax[i] ? Number(tmax[i]) : null,
        tempMin: tmin[i] ? Number(tmin[i]) : null,
        precipProb: wpops[i] ? Number(wpops[i]) : null,
      });
    });
  }
  return {
    temp: nums.length > 0 ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : (weatherCache?.temp ?? 20),
    desc,
    weatherCode: jmaCode(desc),
    tempMax: nums.length > 0 ? Math.max(...nums) : null,
    tempMin: nums.length > 1 ? Math.min(...nums) : null,
    precipProb: popNums.length > 0 ? Math.max(...popNums) : null,
    daily,
    hourly: [],
    source: 'jma',
    updatedAt: Date.now(),
  };
}

// 正常: 10分キャッシュ / 気象庁の予備データ: 3分で open-meteo を再挑戦 / 全滅: 次のリクエストで再取得
const WEATHER_TTL_MS = 10 * 60 * 1000;
const WEATHER_FALLBACK_TTL_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let weatherInFlight: Promise<WeatherInfo> | null = null;
async function getWeather(): Promise<WeatherInfo> {
  const ttl = weatherCache?.source === 'jma' ? WEATHER_FALLBACK_TTL_MS : WEATHER_TTL_MS;
  if (weatherCache && Date.now() - weatherCache.updatedAt < ttl) return weatherCache;
  if (weatherInFlight) return weatherInFlight;
  weatherInFlight = (async () => {
    try {
      try {
        weatherCache = await fetchWeatherOpenMeteo();
      } catch (first: any) {
        // 一時的なタイムアウトが多いので少し待って1回だけやり直す
        console.warn('open-meteo failed, retrying:', first.message);
        await sleep(1500);
        weatherCache = await fetchWeatherOpenMeteo();
      }
    } catch (err: any) {
      console.warn('open-meteo failed, falling back to JMA:', err.message);
      try {
        weatherCache = await fetchWeatherJma();
      } catch (err2: any) {
        console.warn('JMA weather failed:', err2.message);
        if (!weatherCache) {
          return { temp: 20, desc: '取得失敗', weatherCode: -1, tempMax: null, tempMin: null, precipProb: null, daily: [], hourly: [], source: 'fallback' as const, updatedAt: 0 };
        }
      }
    }
    return weatherCache!;
  })().finally(() => {
    weatherInFlight = null;
  });
  return weatherInFlight;
}

app.get('/api/weather', async (req, res) => {
  res.json(await getWeather());
});

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, inviteCode } = req.body;
    if (!username || !password || !inviteCode) {
      return res.status(400).json({ error: 'すべての項目を入力してください' });
    }

    if (inviteCode !== INVITE_CODE) {
      return res.status(403).json({ error: '招待コードが無効です' });
    }

    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: 'ユーザー名は2〜30文字で指定してください' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role, status`,
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: '30d',
    });

    await pool.query(
      `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details) 
       VALUES ($1, $2, 'register', 'user', $3, $4)`,
      [user.id, user.username, user.id, JSON.stringify({ message: '新規ユーザー登録' })]
    );
    ensureNoteSlots().catch(err => console.error('Note slot ensure error:', err.message));

    res.json({ token, user });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'そのユーザー名は既に使用されています' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'ユーザー登録に失敗しました' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
    }

    const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      logAudit({ id: user.id, username: user.username }, 'login_failed', 'user', user.id, {
        message: 'ログイン失敗 (パスワード不一致)',
        ...requestMeta(req),
      });
      return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
    }
    logAudit({ id: user.id, username: user.username }, 'login', 'user', user.id, { message: 'ログイン', ...requestMeta(req) });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: '30d',
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        custom_roles: user.custom_roles || [],
        preferences: user.preferences || {},
        status: user.status,
        custom_status: user.custom_status,
        avatar_url: user.avatar_url,
        class_no: user.class_no,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

// Current User Profile
app.get('/api/auth/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, custom_roles, preferences, status, custom_status, avatar_url, class_no, created_at FROM users WHERE id = $1`,
      [req.user!.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'プロフィール取得エラー' });
  }
});

// Image Upload with Auto-WebP Compression
app.post('/api/upload', authMiddleware, upload.single('image'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '画像ファイルが見つかりません' });
    }

    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.webp`;
    const outputPath = path.join(UPLOAD_DIR, filename);

    await sharp(req.file.buffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(outputPath);

    const imageUrl = `/uploads/${filename}`;
    res.json({ url: imageUrl, filename });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: '画像の圧縮保存に失敗しました' });
  }
});

// ロール権限判定ヘルパー
async function getUserAllRoles(userId: number, fallbackRole = 'member'): Promise<{ isAdmin: boolean; roles: string[] }> {
  try {
    const r = await pool.query(`SELECT role, custom_roles FROM users WHERE id = $1`, [userId]);
    if (r.rows.length === 0) return { isAdmin: fallbackRole === 'admin', roles: [fallbackRole] };
    const row = r.rows[0];
    const custom = Array.isArray(row.custom_roles) ? row.custom_roles.map(String) : [];
    const base = row.role || fallbackRole;
    return {
      isAdmin: base === 'admin',
      roles: Array.from(new Set([base, ...custom])),
    };
  } catch {
    return { isAdmin: fallbackRole === 'admin', roles: [fallbackRole] };
  }
}

function checkChannelViewPermission(isAdmin: boolean, userRoles: string[], channel: any): boolean {
  if (isAdmin) return true;
  const viewRoles: string[] = Array.isArray(channel?.view_roles) ? channel.view_roles : [];
  if (viewRoles.length === 0) return true;
  return viewRoles.some(r => userRoles.includes(r));
}

function checkChannelWritePermission(isAdmin: boolean, userRoles: string[], channel: any): boolean {
  if (isAdmin) return true;
  if (!checkChannelViewPermission(isAdmin, userRoles, channel)) return false;
  const writeRoles: string[] = Array.isArray(channel?.write_roles) ? channel.write_roles : [];
  if (writeRoles.length === 0) return true;
  return writeRoles.some(r => userRoles.includes(r));
}

// Channels API
app.get('/api/channels', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { isAdmin, roles } = await getUserAllRoles(req.user!.id, req.user!.role);
    const result = await pool.query(`SELECT * FROM channels ORDER BY position ASC, id ASC`);
    const visible = result.rows.filter(ch => checkChannelViewPermission(isAdmin, roles, ch));
    res.json(visible);
  } catch (err) {
    res.status(500).json({ error: 'チャンネル取得エラー' });
  }
});

app.post('/api/channels', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { name, type, server_id, view_roles, write_roles } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'チャンネル名を入力してください' });
    }
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    const existing = await pool.query(`SELECT id FROM channels WHERE name = $1`, [cleanName]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '同じ名前のチャンネルが既に存在します' });
    }
    const chType = type === 'voice' ? 'voice' : 'text';
    const cleanServerId = server_id ? String(server_id).trim() : null;
    const cleanViewRoles = Array.isArray(view_roles) ? view_roles.map(String) : [];
    const cleanWriteRoles = Array.isArray(write_roles) ? write_roles.map(String) : [];

    const maxPosRes = await pool.query(`SELECT COALESCE(MAX(position), 0) as max_pos FROM channels`);
    const nextPos = parseInt(maxPosRes.rows[0].max_pos, 10) + 1;

    const result = await pool.query(
      `INSERT INTO channels (name, type, position, server_id, view_roles, write_roles) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [cleanName, chType, nextPos, cleanServerId, JSON.stringify(cleanViewRoles), JSON.stringify(cleanWriteRoles)]
    );
    const newChannel = result.rows[0];
    broadcast({ type: 'CHANNEL_CREATED', payload: newChannel });
    logAudit(req.user!, 'channel_create', 'channel', newChannel.id, { message: `チャンネル #${newChannel.name} を作成` });
    refreshDiscordCommands();
    res.json(newChannel);
  } catch (err) {
    console.error('Channel create error:', err);
    res.status(500).json({ error: 'チャンネル作成に失敗しました' });
  }
});

app.put('/api/channels/:id', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, server_id, view_roles, write_roles } = req.body;
    const curRes = await pool.query(`SELECT * FROM channels WHERE id = $1`, [id]);
    if (curRes.rows.length === 0) {
      return res.status(404).json({ error: 'チャンネルが見つかりません' });
    }
    const cur = curRes.rows[0];
    const cleanName = name && name.trim() ? name.trim().toLowerCase().replace(/\s+/g, '-') : cur.name;
    if (cleanName !== cur.name) {
      const existing = await pool.query(`SELECT id FROM channels WHERE name = $1 AND id != $2`, [cleanName, id]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: '同じ名前のチャンネルが既に存在します' });
      }
    }

    const nextServerId = server_id !== undefined ? (server_id ? String(server_id).trim() : null) : cur.server_id;
    const nextViewRoles = Array.isArray(view_roles) ? view_roles.map(String) : (cur.view_roles || []);
    const nextWriteRoles = Array.isArray(write_roles) ? write_roles.map(String) : (cur.write_roles || []);

    const result = await pool.query(
      `UPDATE channels SET name = $1, server_id = $2, view_roles = $3, write_roles = $4 WHERE id = $5 RETURNING *`,
      [cleanName, nextServerId, JSON.stringify(nextViewRoles), JSON.stringify(nextWriteRoles), id]
    );
    const updatedChannel = result.rows[0];
    broadcast({ type: 'CHANNEL_UPDATED', payload: updatedChannel });
    logAudit(req.user!, 'channel_update', 'channel', id, { message: `チャンネル #${cleanName} の設定を更新` });
    refreshDiscordCommands();
    res.json(updatedChannel);
  } catch (err) {
    console.error('Channel update error:', err);
    res.status(500).json({ error: 'チャンネル更新に失敗しました' });
  }
});

app.put('/api/channels/reorder', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds)) {
      return res.status(400).json({ error: 'channelIds配列が必要です' });
    }

    for (let i = 0; i < channelIds.length; i++) {
      await pool.query(`UPDATE channels SET position = $1 WHERE id = $2`, [i, channelIds[i]]);
    }

    const updated = await pool.query(`SELECT * FROM channels ORDER BY position ASC, id ASC`);
    broadcast({ type: 'CHANNELS_REORDERED', payload: updated.rows });
    res.json(updated.rows);
  } catch (err) {
    console.error('Channel reorder error:', err);
    res.status(500).json({ error: 'チャンネル順序の変更に失敗しました' });
  }
});

app.delete('/api/channels/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const chRes = await pool.query(`SELECT * FROM channels WHERE id = $1`, [id]);
    if (chRes.rows.length === 0) {
      return res.status(404).json({ error: 'チャンネルが見つかりません' });
    }
    const boundIds = await getBoundAsdfChannelIds();
    const isSyncedChannel = Boolean(chRes.rows[0].server_id) || boundIds.includes(id);
    if (req.user!.role !== 'admin' && !isSyncedChannel) {
      return res.status(403).json({ error: '通常チャンネルの削除は管理者のみ可能です' });
    }
    const countRes = await pool.query(`SELECT COUNT(*) FROM channels`);
    if (parseInt(countRes.rows[0].count, 10) <= 1) {
      return res.status(400).json({ error: '最後のチャンネルは削除できません' });
    }

    await removeDiscordBinding({ asdfChannelId: id }).catch(() => {});
    const delRes = await pool.query(`DELETE FROM channels WHERE id = $1 RETURNING name`, [id]);
    broadcast({ type: 'CHANNEL_DELETED', payload: { id } });
    broadcast({ type: 'DISCORD_BINDINGS_UPDATED', payload: await getDiscordStatus() });
    logAudit(req.user!, 'channel_delete', 'channel', id, { message: `チャンネル #${delRes.rows[0]?.name || id} を削除` });
    refreshDiscordCommands();
    res.json({ success: true, id });
  } catch (err) {
    console.error('Channel delete error:', err);
    res.status(500).json({ error: 'チャンネル削除に失敗しました' });
  }
});

// 返信先メッセージの概要を付与
async function attachReplies<T extends { reply_to_id?: number | null }>(rows: T[]): Promise<(T & { reply_to?: any })[]> {
  const ids = Array.from(new Set(rows.map(r => r.reply_to_id).filter((v): v is number => typeof v === 'number')));
  if (ids.length === 0) return rows;
  const res = await pool.query(
    `SELECT m.id, m.content, m.user_id, COALESCE(u.username, m.username) AS username
     FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ANY($1::int[])`,
    [ids]
  );
  const map = new Map(res.rows.map(r => [r.id, { id: r.id, username: r.username, user_id: r.user_id, content: String(r.content || '').slice(0, 200) }]));
  return rows.map(r => (r.reply_to_id ? { ...r, reply_to: map.get(r.reply_to_id) || { id: r.reply_to_id, deleted: true } } : r));
}

// Messages API (supports pagination: limit & beforeId)
app.get('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
  try {
    const channelId = parseInt(req.params.channelId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string, 10) : null;

    let query = `
      SELECT m.*, u.username as sender_username 
      FROM messages m 
      LEFT JOIN users u ON m.user_id = u.id 
      WHERE m.channel_id = $1 
    `;
    const params: any[] = [channelId];

    const afterId = req.query.afterId ? parseInt(req.query.afterId as string, 10) : null;

    if (afterId) {
      // Catch-up fetch (reconnect / polling fallback): ascending order
      query += ` AND m.id > $2 ORDER BY m.id ASC LIMIT $3`;
      params.push(afterId, Math.min(limit, 200));
      const result = await pool.query(query, params);
      return res.json(await attachReplies(result.rows));
    } else if (beforeId) {
      query += ` AND m.id < $2 ORDER BY m.id DESC LIMIT $3`;
      params.push(beforeId, Math.min(limit, 200));
    } else {
      query += ` ORDER BY m.id DESC LIMIT $2`;
      params.push(Math.min(limit, 200));
    }

    const result = await pool.query(query, params);
    res.json(await attachReplies(result.rows.reverse()));
  } catch (err) {
    res.status(500).json({ error: 'メッセージ取得エラー' });
  }
});

// Cross-channel catch-up: messages newer than afterId (used by WS reconnect & polling fallback)
app.get('/api/messages/since', authMiddleware, async (req, res) => {
  try {
    const afterId = parseInt(req.query.afterId as string, 10) || 0;
    const result = await pool.query(
      `SELECT m.*, u.username as sender_username
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.id > $1
       ORDER BY m.id ASC
       LIMIT 200`,
      [afterId]
    );
    res.json(await attachReplies(result.rows));
  } catch (err) {
    res.status(500).json({ error: 'メッセージ同期エラー' });
  }
});

// 未読数: 既読位置はサーバー (全端末共通) と端末の記録の新しい方を使う
app.post('/api/channels/unread-counts', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const lastRead: Record<string, number> = req.body?.lastRead || {};
    const channelIds: number[] = [];
    const lastReadIds: number[] = [];
    for (const [ch, id] of Object.entries(lastRead)) {
      const chNum = parseInt(ch, 10);
      const idNum = Number(id);
      if (Number.isFinite(chNum) && Number.isFinite(idNum)) {
        channelIds.push(chNum);
        lastReadIds.push(idNum);
      }
    }
    // unread: 自分以外の未読 / mentions: そのうち自分宛て (@名前・@everyone・自分への返信)
    const result = await pool.query(
      `WITH r AS (
         SELECT ch, MAX(lr) AS last_read FROM (
           SELECT unnest($1::int[]) AS ch, unnest($2::int[]) AS lr
           UNION ALL
           SELECT channel_id, last_read_id FROM channel_reads WHERE user_id = $3
         ) x GROUP BY ch
       )
       SELECT m.channel_id,
              MAX(m.id) AS last_message_id,
              MAX(r.last_read) AS last_read,
              COUNT(*) FILTER (WHERE r.last_read IS NOT NULL AND m.id > r.last_read AND m.user_id IS DISTINCT FROM $3) AS unread,
              COUNT(*) FILTER (WHERE r.last_read IS NOT NULL AND m.id > r.last_read AND m.user_id IS DISTINCT FROM $3
                AND (POSITION($4 IN m.content) > 0 OR POSITION('@everyone' IN m.content) > 0 OR p.user_id = $3)) AS mentions
       FROM messages m
       LEFT JOIN r ON r.ch = m.channel_id
       LEFT JOIN messages p ON p.id = m.reply_to_id
       GROUP BY m.channel_id`,
      [channelIds, lastReadIds, req.user!.id, `@${req.user!.username}`]
    );
    res.json(result.rows.map(r => ({
      channelId: r.channel_id,
      lastMessageId: Number(r.last_message_id),
      lastReadId: r.last_read == null ? null : Number(r.last_read),
      unread: Number(r.unread),
      mentions: Number(r.mentions),
    })));
  } catch (err) {
    console.error('Unread counts error:', err);
    res.status(500).json({ error: '未読数取得エラー' });
  }
});

// 既読位置を保存し、同じユーザーの他の端末にも知らせる (戻ることはない)
app.post('/api/channels/:channelId/read', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const channelId = parseInt(req.params.channelId, 10);
    const messageId = Number(req.body?.messageId);
    if (!Number.isFinite(channelId) || !Number.isFinite(messageId) || messageId <= 0) {
      return res.status(400).json({ error: '既読位置が正しくありません' });
    }
    const r = await pool.query(
      `INSERT INTO channel_reads (user_id, channel_id, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = GREATEST(channel_reads.last_read_id, EXCLUDED.last_read_id)
       RETURNING last_read_id`,
      [req.user!.id, channelId, messageId]
    );
    const lastReadId = Number(r.rows[0].last_read_id);
    publish({ type: 'READ_STATE_UPDATED', payload: { channelId, lastReadId } }, { targetUserId: req.user!.id, excludeConnId: getConnId(req) || undefined });
    res.json({ channelId, lastReadId });
  } catch (err: any) {
    if (err.code === '23503') return res.status(404).json({ error: 'チャンネルがありません' });
    res.status(500).json({ error: '既読の保存に失敗しました' });
  }
});

// メッセージリンク用: 指定メッセージの前後をまとめて返す
app.get('/api/messages/:messageId/context', authMiddleware, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    const half = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 25, 5), 100);
    const target = (await pool.query(`SELECT id, channel_id FROM messages WHERE id = $1`, [messageId])).rows[0];
    if (!target) return res.status(404).json({ error: 'メッセージが見つかりません (削除された可能性があります)' });
    const base = `SELECT m.*, u.username as sender_username FROM messages m LEFT JOIN users u ON m.user_id = u.id WHERE m.channel_id = $1`;
    const before = (await pool.query(`${base} AND m.id < $2 ORDER BY m.id DESC LIMIT $3`, [target.channel_id, messageId, half + 1])).rows;
    const after = (await pool.query(`${base} AND m.id >= $2 ORDER BY m.id ASC LIMIT $3`, [target.channel_id, messageId, half + 2])).rows;
    const hasOlder = before.length > half;
    const hasNewer = after.length > half + 1;
    const rows = [...before.slice(0, half).reverse(), ...after.slice(0, half + 1)];
    res.json({ channelId: target.channel_id, messageId, hasOlder, hasNewer, messages: await attachReplies(rows) });
  } catch (err) {
    res.status(500).json({ error: 'メッセージ取得エラー' });
  }
});

app.delete('/api/messages/:messageId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const msgRes = await pool.query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const msg = msgRes.rows[0];
    if (userRole !== 'admin' && msg.user_id !== userId) {
      return res.status(403).json({ error: '削除権限がありません' });
    }

    await pool.query(`DELETE FROM messages WHERE id = $1`, [messageId]);
    broadcast({ type: 'MESSAGE_DELETED', payload: { messageId, channelId: msg.channel_id } });
    logAudit(req.user!, 'message_delete', 'message', messageId, {
      message: `メッセージ削除 (${msg.username} の投稿)`,
      channel_id: msg.channel_id,
      author: msg.username,
      author_id: msg.user_id,
      content: msg.content,
      created_at: msg.created_at,
    }, true);
    res.json({ success: true, messageId });
  } catch (err) {
    console.error('Message delete error:', err);
    res.status(500).json({ error: 'メッセージ削除エラー' });
  }
});

app.put('/api/messages/:messageId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    const { content } = req.body;
    const userId = req.user!.id;

    const msgRes = await pool.query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const msg = msgRes.rows[0];
    if (msg.user_id !== userId) {
      return res.status(403).json({ error: '編集権限がありません' });
    }

    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: '本文が空です' });
    }
    if (content === msg.content) {
      const [same] = await attachReplies([{ ...msg, sender_username: req.user!.username }]);
      return res.json(same);
    }

    const updated = await pool.query(
      `UPDATE messages SET content = $1, updated_at = NOW(), edited_at = NOW() WHERE id = $2 RETURNING *`,
      [content, messageId]
    );

    const [updatedMessage] = await attachReplies([{ ...updated.rows[0], sender_username: req.user!.username }]);
    broadcast({ type: 'MESSAGE_UPDATED', payload: updatedMessage });
    relayEdit(updatedMessage, req.user!.username);
    logAudit(req.user!, 'message_edit', 'message', messageId, {
      message: 'メッセージ編集',
      channel_id: msg.channel_id,
      before: msg.content,
      after: content,
    });
    res.json(updatedMessage);
  } catch (err) {
    console.error('Message update error:', err);
    res.status(500).json({ error: 'メッセージ編集エラー' });
  }
});

// @gemini: チャンネルの直近の会話を履歴として渡して返信する
const IMAGE_MD_RE = /!\[[^\]]*\]\([^)\s]+\)/g;
async function replyAsGemini(channelId: number, trigger: { id: number; content: string; user_id?: number | null; username?: string; sender_username?: string }) {
  if (!/@gemini\b/i.test(String(trigger.content || ''))) return;
  try {
    const hist = await pool.query(
      `SELECT m.id, m.content, m.user_id, COALESCE(u.username, m.username) AS username, m.created_at
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND m.id <= $2 ORDER BY m.id DESC LIMIT 30`,
      [channelId, trigger.id]
    );
    const rows = hist.rows.reverse();
    // 直近の画像 (最大3枚) は中身も見せる
    const recentImageIds = new Set(
      rows.slice(-8).filter(r => /^!\[[^\]]*\]\(\/uploads\/[^)\s]+\)$/.test(String(r.content).trim())).slice(-3).map(r => r.id)
    );
    const history: Content[] = [];
    for (const r of rows) {
      const isGemini = r.username === 'Gemini';
      const parts: NonNullable<Content['parts']> = [];
      const imgMatch = recentImageIds.has(r.id) ? String(r.content).match(/\/uploads\/([^)\s]+)/) : null;
      if (imgMatch) {
        try {
          const data = await fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(imgMatch[1])));
          parts.push({ text: `${r.username}: [画像]` }, { inlineData: { mimeType: 'image/webp', data: data.toString('base64') } });
        } catch (_) {
          parts.push({ text: `${r.username}: [画像]` });
        }
      } else {
        const text = String(r.content || '').replace(IMAGE_MD_RE, '[画像]').slice(0, 2000);
        parts.push({ text: isGemini ? text : `${r.username}: ${text}` });
      }
      history.push({ role: isGemini ? 'model' : 'user', parts });
    }
    const channel = (await pool.query(`SELECT name FROM channels WHERE id = $1`, [channelId])).rows[0];
    const asker = trigger.sender_username || trigger.username || '';

    // 呼びかけた本人の権限でサイト内の情報を読めるようにする (チャットからは閲覧のみ)
    const askerRow = trigger.user_id
      ? (await pool.query(`SELECT id, username, role FROM users WHERE id = $1`, [trigger.user_id])).rows[0]
      : null;
    const authHeader = askerRow
      ? `Bearer ${jwt.sign({ id: askerRow.id, username: askerRow.username, role: askerRow.role }, JWT_SECRET, { expiresIn: '5m' })}`
      : '';
    const { text: reply } = await runGeminiAgent({
      history,
      tools: askerRow ? aiToolDeclarations(false) : [],
      runTool: createAiToolRunner({
        pool, baseUrl: `http://127.0.0.1:${PORT}`, authHeader,
        userId: askerRow?.id || 0, username: asker, allowWrite: false,
      }),
      systemInstruction: [
        `あなたはチャット「asdfbase」の #${channel?.name || ''} に参加している Gemini です。現在は ${jstNowLabel()} (日本時間) です。`,
        `会話の流れを踏まえ、最後に @gemini で呼びかけた ${asker} に答えてください。`,
        '時間割・提出物・宿題・予定・メモ・過去のチャット・天気などが関係する質問では、推測せずツールで確認してから答えてください。',
        'サイトの外の知識や最新の情報は web_search で調べ、参考にした URL を添えてください。検索結果が外国語でも、答えは必ず日本語にしてください。',
        '前置きは省き、チャットらしく簡潔に日本語で答えてください。',
      ].join('\n'),
    });
    const botResult = await pool.query(
      `INSERT INTO messages (channel_id, user_id, username, content, reply_to_id)
       VALUES ($1, NULL, 'Gemini', $2, $3) RETURNING *`,
      [channelId, reply, trigger.id]
    );
    const [aiMessage] = await attachReplies([{ ...botResult.rows[0], sender_username: 'Gemini' }]);
    broadcast({ type: 'NEW_MESSAGE', payload: aiMessage });
    relayMessage(aiMessage);
  } catch (err: any) {
    console.error('Gemini mention error:', err.message);
  }
}

// Post Message with AI @gemini mention support (commands like /ai removed)
app.post('/api/channels/:channelId/messages', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const channelId = parseInt(req.params.channelId, 10);
    const { content, attachments, replyToId, clientNonce } = req.body;
    const userId = req.user!.id;
    const username = req.user!.username;

    const chRes = await pool.query(`SELECT * FROM channels WHERE id = $1`, [channelId]);
    if (chRes.rows.length > 0) {
      const { isAdmin, roles } = await getUserAllRoles(userId, req.user!.role);
      if (!checkChannelWritePermission(isAdmin, roles, chRes.rows[0])) {
        return res.status(403).json({ error: 'このチャンネルへの発言権限がありません' });
      }
    }

    const result = await pool.query(
      `INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [channelId, userId, username, content, JSON.stringify(attachments || []), replyToId || null]
    );

    const [savedMessage] = await attachReplies([{ ...result.rows[0], sender_username: username, client_nonce: clientNonce || null }]);
    broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });

    const relayed = await relayMessage(savedMessage);
    if (String(content).includes('@everyone') && !relayed) {
      notifyImportant(`📢 ${username} から全員への連絡`, String(content));
    }

    replyAsGemini(channelId, savedMessage);

    res.json(savedMessage);
  } catch (err) {
    console.error('Post message error:', err);
    res.status(500).json({ error: 'メッセージ投稿エラー' });
  }
});

// Discord Inbound Sync Endpoint (Discord Bot -> asdfbase)
app.post('/api/discord/webhook', async (req, res) => {
  try {
    const { username, content, channelId, attachments } = req.body;
    if (!content && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'content is required' });
    }

    const targetChannelId = parseInt(channelId, 10) || 1;
    const senderName = username ? `[Discord] ${username}` : '[Discord]';

    const result = await pool.query(
      `INSERT INTO messages (channel_id, user_id, username, content, attachments) 
       VALUES ($1, NULL, $2, $3, $4) RETURNING *`,
      [targetChannelId, senderName, content || '', JSON.stringify(attachments || [])]
    );

    const savedMessage = { ...result.rows[0], sender_username: senderName };
    broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });

    res.json({ success: true, message: savedMessage });
  } catch (err) {
    console.error('Discord inbound sync error:', err);
    res.status(500).json({ error: 'Discord同期エラー' });
  }
});

// Reactions & Pin
app.post('/api/messages/:messageId/reactions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    const { emoji } = req.body;
    const userId = req.user!.id;

    const msgRes = await pool.query(`SELECT reactions FROM messages WHERE id = $1`, [messageId]);
    if (msgRes.rows.length === 0) return res.status(404).json({ error: 'メッセージがありません' });

    const reactions = msgRes.rows[0].reactions || {};
    const users = reactions[emoji] || [];

    if (users.includes(userId)) {
      reactions[emoji] = users.filter((id: number) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...users, userId];
    }

    const updated = await pool.query(
      `UPDATE messages SET reactions = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify(reactions), messageId]
    );

    broadcast({
      type: 'MESSAGE_REACTION_UPDATED',
      payload: { messageId, reactions: updated.rows[0].reactions },
    });

    // Discord 側にもリアクションを反映 (非同期)
    (async () => {
      try {
        const links = (await pool.query(
          `SELECT discord_channel_id, discord_message_id FROM discord_message_links WHERE asdf_message_id = $1`,
          [messageId]
        )).rows;
        const isRemove = !reactions[emoji] || !reactions[emoji].includes(userId);
        for (const l of links) {
          await relayReactionToDiscord(l.discord_channel_id, l.discord_message_id, emoji, isRemove);
        }
      } catch (err: any) {
        console.warn('Discord reaction relay error:', err.message);
      }
    })();

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'リアクション更新エラー' });
  }
});

app.post('/api/messages/:messageId/pin', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    const updated = await pool.query(
      `UPDATE messages SET is_pinned = NOT is_pinned WHERE id = $1 RETURNING *`,
      [messageId]
    );
    if (updated.rows.length === 0) return res.status(404).json({ error: 'メッセージがありません' });
    const [pinned] = await attachReplies([updated.rows[0]]);
    broadcast({
      type: 'MESSAGE_PIN_UPDATED',
      payload: pinned,
    });
    logAudit(req.user!, pinned.is_pinned ? 'message_pin' : 'message_unpin', 'message', messageId, {
      message: pinned.is_pinned ? 'メッセージをピン留め' : 'ピン留めを解除',
      content: pinned.content,
    });
    if (pinned.is_pinned) {
      notifyImportant(`📌 ${req.user!.username} がメッセージをピン留め`, `**${pinned.username}**: ${pinned.content}`);
    }

    // Discord 側にもピン留めを反映 (非同期)
    (async () => {
      try {
        const links = (await pool.query(
          `SELECT discord_channel_id, discord_message_id FROM discord_message_links WHERE asdf_message_id = $1`,
          [messageId]
        )).rows;
        for (const l of links) {
          await relayPinToDiscord(l.discord_channel_id, l.discord_message_id, pinned.is_pinned);
        }
      } catch (err: any) {
        console.warn('Discord pin relay error:', err.message);
      }
    })();

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'ピン留め更新エラー' });
  }
});

// Assignments API
app.get('/api/assignments', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT a.*, COALESCE(p.status, 'unstarted') as my_status 
       FROM assignments a 
       LEFT JOIN assignment_progress p ON a.id = p.assignment_id AND p.user_id = $1 
       ORDER BY a.deadline ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '提出物一覧取得エラー' });
  }
});

app.post('/api/assignments', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { title, subject, description, deadline, resubmitDeadline } = req.body;
    // classNo: null = 全クラス共通、省略 = 登録した人のクラス
    const classNo = req.body.classNo === null ? null : parseClassNo(req.body.classNo) ?? (await classOf(req.user!.id));
    const result = await pool.query(
      `INSERT INTO assignments (title, subject, description, deadline, resubmit_deadline, class_no) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, subject, description, deadline, resubmitDeadline || null, classNo]
    );
    const created = { ...result.rows[0], my_status: 'unstarted' };
    broadcast({ type: 'ASSIGNMENT_CREATED', payload: created });
    logAudit(req.user!, 'assignment_create', 'assignment', created.id, { message: `提出物「${title}」を登録`, subject, deadline, class_no: classNo });
    notifyImportant(
      `📝 新しい提出物${classNo ? ` (${classNo}組)` : ''}: ${title}`,
      `教科: ${subject || '-'}\n締切: ${deadline ? new Date(deadline).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-'}` +
      `${resubmitDeadline ? `\n再提出締切: ${new Date(resubmitDeadline).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : ''}` +
      `${description ? `\n\n${description}` : ''}\n(登録: ${req.user!.username})`
    );
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: '提出物作成エラー' });
  }
});

app.put('/api/assignments/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title, subject, description, deadline, resubmitDeadline } = req.body;
    const before = (await pool.query(`SELECT * FROM assignments WHERE id = $1`, [id])).rows[0];
    const classNo = req.body.classNo === undefined ? before?.class_no ?? null : req.body.classNo === null ? null : parseClassNo(req.body.classNo);
    const result = await pool.query(
      `UPDATE assignments 
       SET title = $1, subject = $2, description = $3, deadline = $4, resubmit_deadline = $5, class_no = $6
       WHERE id = $7 RETURNING *`,
      [title, subject, description, deadline, resubmitDeadline || null, classNo, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '提出物が見つかりません' });
    }
    const updated = result.rows[0];
    broadcast({ type: 'ASSIGNMENT_UPDATED', payload: updated });
    logAudit(req.user!, 'assignment_update', 'assignment', id, {
      message: `提出物「${title}」を編集`,
      before: before ? { title: before.title, subject: before.subject, deadline: before.deadline, resubmit_deadline: before.resubmit_deadline } : null,
      after: { title, subject, deadline, resubmit_deadline: resubmitDeadline || null },
    });
    if (before && String(before.deadline) !== String(updated.deadline)) {
      notifyImportant(`⏰ 締切変更: ${title}`, `新しい締切: ${new Date(updated.deadline).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} (変更: ${req.user!.username})`);
    }
    res.json(updated);
  } catch (err) {
    console.error('Assignment update error:', err);
    res.status(500).json({ error: '提出物更新エラー' });
  }
});

app.delete('/api/assignments/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const delRes = await pool.query(`DELETE FROM assignments WHERE id = $1 RETURNING *`, [id]);
    broadcast({ type: 'ASSIGNMENT_DELETED', payload: { id } });
    const d = delRes.rows[0];
    if (d) {
      logAudit(req.user!, 'assignment_delete', 'assignment', id, {
        message: `提出物「${d.title}」を削除`,
        title: d.title, subject: d.subject, description: d.description, deadline: d.deadline, resubmit_deadline: d.resubmit_deadline,
        class_no: d.class_no,
      }, true);
    }
    res.json({ success: true, id });
  } catch (err) {
    console.error('Assignment delete error:', err);
    res.status(500).json({ error: '提出物削除エラー' });
  }
});

// Get all members progress for assignments
app.get('/api/assignments/progress/all', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT p.assignment_id, p.user_id, p.status, u.username
      FROM assignment_progress p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.assignment_id ASC, u.username ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Progress all fetch error:', err);
    res.status(500).json({ error: 'メンバー進捗取得エラー' });
  }
});

// Update Assignment Progress (未着手/進行中/提出済み/再提出/合格)
app.put('/api/assignments/:id/progress', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const assignmentId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const userId = req.user!.id;
    const username = req.user!.username;

    await pool.query(
      `INSERT INTO assignment_progress (assignment_id, user_id, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (assignment_id, user_id) 
       DO UPDATE SET status = EXCLUDED.status`,
      [assignmentId, userId, status]
    );

    // 全員合格チェック (クラス指定の提出物はそのクラスの人数。そのクラスに誰も設定していなければ全員)
    const target = (await pool.query(`SELECT class_no FROM assignments WHERE id = $1`, [assignmentId])).rows[0];
    const classUsers = target?.class_no
      ? parseInt((await pool.query(`SELECT COUNT(*) FROM users WHERE class_no = $1`, [target.class_no])).rows[0].count, 10)
      : 0;
    const byClass = classUsers > 0;
    const totalUsers = byClass ? classUsers : parseInt((await pool.query(`SELECT COUNT(*) FROM users`)).rows[0].count, 10);
    const passedUsers = parseInt((await pool.query(
      `SELECT COUNT(*) FROM assignment_progress p JOIN users u ON u.id = p.user_id
       WHERE p.assignment_id = $1 AND p.status = 'passed' AND ($2::int IS NULL OR u.class_no = $2)`,
      [assignmentId, byClass ? target.class_no : null]
    )).rows[0].count, 10);

    let isArchived = false;
    if (totalUsers > 0 && passedUsers >= totalUsers) {
      await pool.query(`UPDATE assignments SET is_archived = TRUE WHERE id = $1`, [assignmentId]);
      isArchived = true;
    }

    broadcast({
      type: 'ASSIGNMENT_PROGRESS_UPDATED',
      payload: { assignmentId, userId, username, status, isArchived }
    });

    res.json({ success: true, status, isArchived });
  } catch (err) {
    res.status(500).json({ error: '進捗更新エラー' });
  }
});

// ---------------- 宿題 (次の授業までにやってくる簡単なもの) ----------------
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatHomework(r: any) {
  return {
    ...r,
    due_date: r.due_date instanceof Date
      ? `${r.due_date.getFullYear()}-${String(r.due_date.getMonth() + 1).padStart(2, '0')}-${String(r.due_date.getDate()).padStart(2, '0')}`
      : String(r.due_date).slice(0, 10),
    done_count: Number(r.done_count || 0),
    my_done: Boolean(r.my_done),
  };
}

// 指定クラスでその教科の次の授業日。時間割に無ければ次の平日
async function homeworkDueDate(classNo: number | null, subject: string) {
  const today = nowInTokyo().date;
  const rows = (await pool.query(
    `SELECT day_of_week, period, subject FROM timetables WHERE schedule_type = 'normal' AND class_no = $1`,
    [classNo ?? 1]
  )).rows;
  const config = await getTimetableConfig();
  const next = nextLessonDate(rows, subject, today, config.dayPeriodCounts);
  return { date: next || nextWeekday(today), fromTimetable: Boolean(next) };
}

app.get('/api/homework/next-lesson', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const classNo = parseClassNo(req.query.classNo) ?? (await classOf(req.user!.id));
    res.json(await homeworkDueDate(classNo, String(req.query.subject || '')));
  } catch (err) {
    res.status(500).json({ error: '次の授業日の取得に失敗しました' });
  }
});

// 期限が30日以上前のものは返さない (古いものは定期的に削除)
app.get('/api/homework', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*, (SELECT COUNT(*) FROM homework_done d WHERE d.homework_id = h.id) AS done_count,
              EXISTS (SELECT 1 FROM homework_done d WHERE d.homework_id = h.id AND d.user_id = $1) AS my_done
       FROM homework h WHERE h.due_date >= (NOW() AT TIME ZONE 'Asia/Tokyo')::date - 30
       ORDER BY h.due_date ASC, h.id ASC`,
      [req.user!.id]
    );
    res.json(result.rows.map(formatHomework));
  } catch (err) {
    res.status(500).json({ error: '宿題の取得に失敗しました' });
  }
});

function parseHomeworkBody(body: any) {
  const subject = String(body?.subject || '').trim().slice(0, 50);
  const content = String(body?.content || '').trim().slice(0, 2000);
  if (!subject) return { error: '教科を選んでください' };
  if (!content) return { error: '内容を入力してください' };
  if (body?.dueDate && !YMD_RE.test(String(body.dueDate))) return { error: '期限の日付が正しくありません' };
  return { subject, content, dueDate: body?.dueDate ? String(body.dueDate) : null };
}

app.post('/api/homework', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const hw = parseHomeworkBody(req.body);
    if ('error' in hw) return res.status(400).json({ error: hw.error });
    const classNo = req.body.classNo === null ? null : parseClassNo(req.body.classNo) ?? (await classOf(req.user!.id));
    const due = hw.dueDate || (await homeworkDueDate(classNo, hw.subject)).date;
    const r = await pool.query(
      `INSERT INTO homework (class_no, subject, content, due_date, user_id, username) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [classNo, hw.subject, hw.content, due, req.user!.id, req.user!.username]
    );
    const created = formatHomework({ ...r.rows[0], done_count: 0, my_done: false });
    broadcast({ type: 'HOMEWORK_CREATED', payload: { ...created, my_done: false } });
    logAudit(req.user!, 'homework_create', 'homework', created.id, {
      message: `宿題「${hw.subject}: ${hw.content.slice(0, 40)}」を登録 (${created.due_date}まで)`, class_no: classNo,
    });
    res.json(created);
  } catch (err) {
    console.error('Homework create error:', err);
    res.status(500).json({ error: '宿題の登録に失敗しました' });
  }
});

app.put('/api/homework/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const hw = parseHomeworkBody(req.body);
    if ('error' in hw) return res.status(400).json({ error: hw.error });
    const before = (await pool.query(`SELECT * FROM homework WHERE id = $1`, [id])).rows[0];
    if (!before) return res.status(404).json({ error: '宿題が見つかりません' });
    const classNo = req.body.classNo === undefined ? before.class_no : req.body.classNo === null ? null : parseClassNo(req.body.classNo);
    const r = await pool.query(
      `UPDATE homework SET subject = $1, content = $2, due_date = COALESCE($3::date, due_date), class_no = $4 WHERE id = $5 RETURNING *,
         (SELECT COUNT(*) FROM homework_done d WHERE d.homework_id = homework.id) AS done_count`,
      [hw.subject, hw.content, hw.dueDate, classNo, id]
    );
    const updated = formatHomework(r.rows[0]);
    // my_done は人によって違うので配信には含めない
    const { my_done: _ignored, ...shared } = updated;
    broadcast({ type: 'HOMEWORK_UPDATED', payload: shared });
    logAudit(req.user!, 'homework_update', 'homework', id, { message: `宿題「${hw.subject}: ${hw.content.slice(0, 40)}」を編集` });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '宿題の更新に失敗しました' });
  }
});

app.delete('/api/homework/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const d = (await pool.query(`DELETE FROM homework WHERE id = $1 RETURNING *`, [id])).rows[0];
    broadcast({ type: 'HOMEWORK_DELETED', payload: { id } });
    if (d) {
      const f = formatHomework(d);
      logAudit(req.user!, 'homework_delete', 'homework', id, {
        message: `宿題「${f.subject}: ${String(f.content).slice(0, 40)}」を削除`,
        class_no: f.class_no, subject: f.subject, content: f.content, due_date: f.due_date, user_id: f.user_id, username: f.username,
      }, true);
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: '宿題の削除に失敗しました' });
  }
});

// 自分の「やった」チェック
app.put('/api/homework/:id/done', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const done = Boolean(req.body?.done);
    if (done) {
      await pool.query(`INSERT INTO homework_done (homework_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, req.user!.id]);
    } else {
      await pool.query(`DELETE FROM homework_done WHERE homework_id = $1 AND user_id = $2`, [id, req.user!.id]);
    }
    const doneCount = parseInt((await pool.query(`SELECT COUNT(*) FROM homework_done WHERE homework_id = $1`, [id])).rows[0].count, 10);
    broadcast({ type: 'HOMEWORK_PROGRESS', payload: { id, userId: req.user!.id, done, doneCount } });
    res.json({ id, done, doneCount });
  } catch (err: any) {
    if (err.code === '23503') return res.status(404).json({ error: '宿題が見つかりません' });
    res.status(500).json({ error: '保存に失敗しました' });
  }
});

// Gemini Summarize Assignment
app.post('/api/assignments/summarize', authMiddleware, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: '内容が空です' });

    const prompt = `以下の学校の課題・提出物指示文を読み、重要なポイント、締め切り、持ち物、注意点をJSON形式で要約してください。\n\n【指示文】:\n${description}`;
    const summary = await askGemini(prompt, '必ず有効なJSONまたは箇条書きの分かりやすい形式で回答してください。');
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: 'AI要約エラー' });
  }
});

// Test Scores (中間 / 期末 / 学年末 / 診断テスト) & AI Advice
const EXAM_TYPES: Record<string, string> = { midterm: '中間テスト', final: '期末テスト', yearend: '学年末テスト', diagnostic: '診断テスト' };

app.get('/api/test-scores', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const requestedUserId = parseInt(req.query.userId as string, 10);
    const userId = Number.isFinite(requestedUserId) ? requestedUserId : req.user!.id;
    const result = await pool.query(
      `SELECT t.*, u.username FROM test_scores t LEFT JOIN users u ON t.user_id = u.id
       WHERE t.user_id = $1 ORDER BY t.created_at ASC, t.id ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テスト点数取得エラー' });
  }
});

// 1回分のテスト (種別 + 回の名前) の点数をまとめて登録。同じ教科は上書き
app.post('/api/test-scores', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const examType = EXAM_TYPES[req.body.examType] ? req.body.examType : 'midterm';
    const examLabel = String(req.body.examLabel || '').trim().slice(0, 100);
    const entries: { subject: string; score: number; maxScore?: number }[] = Array.isArray(req.body.entries)
      ? req.body.entries
      : [{ subject: req.body.subject, score: req.body.score, maxScore: req.body.maxScore }];
    if (!examLabel) return res.status(400).json({ error: '何回目のテストか (例: 1学期) を入力してください' });
    const rows = [];
    for (const e of entries) {
      const subject = String(e.subject || '').trim();
      const score = Number(e.score);
      const maxScore = Number(e.maxScore) || 100;
      if (!subject || !Number.isFinite(score)) continue;
      if (score < 0 || score > maxScore) return res.status(400).json({ error: `${subject} の点数が 0〜${maxScore} の範囲外です` });
      const existing = await pool.query(
        `SELECT id FROM test_scores WHERE user_id = $1 AND exam_type = $2 AND exam_label = $3 AND subject = $4`,
        [userId, examType, examLabel, subject]
      );
      const r = existing.rows.length > 0
        ? await pool.query(`UPDATE test_scores SET score = $1, max_score = $2 WHERE id = $3 RETURNING *`, [score, maxScore, existing.rows[0].id])
        : await pool.query(
          `INSERT INTO test_scores (user_id, exam_type, exam_label, exam_name, subject, score, max_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [userId, examType, examLabel, `${EXAM_TYPES[examType]} ${examLabel}`, subject, score, maxScore]
        );
      rows.push({ ...r.rows[0], username: req.user!.username });
    }
    if (rows.length === 0) return res.status(400).json({ error: '点数を1つ以上入力してください' });
    res.json(rows);
  } catch (err) {
    console.error('Test score save error:', err);
    res.status(500).json({ error: 'テスト点数登録エラー' });
  }
});

app.delete('/api/test-scores/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const scoreRes = await pool.query(`SELECT * FROM test_scores WHERE id = $1`, [id]);
    if (scoreRes.rows.length === 0) {
      return res.status(404).json({ error: 'テスト点数が見つかりません' });
    }

    if (userRole !== 'admin' && scoreRes.rows[0].user_id !== userId) {
      return res.status(403).json({ error: '削除権限がありません' });
    }

    await pool.query(`DELETE FROM test_scores WHERE id = $1`, [id]);
    const sc = scoreRes.rows[0];
    logAudit(req.user!, 'test_score_delete', 'test_score', id, { message: `テスト点数を削除 (${sc.exam_name || ''} ${sc.subject}: ${sc.score}/${sc.max_score})` });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Test score delete error:', err);
    res.status(500).json({ error: 'テスト点数削除エラー' });
  }
});

// 種別ごとに、回を追った推移から学習アドバイス
app.post('/api/test-scores/advice', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const examType = EXAM_TYPES[req.body?.examType] ? req.body.examType : 'midterm';
    const scores = await pool.query(
      `SELECT exam_label, subject, score, max_score FROM test_scores WHERE user_id = $1 AND exam_type = $2 ORDER BY created_at ASC, id ASC`,
      [userId, examType]
    );
    if (scores.rows.length === 0) {
      return res.status(400).json({ error: `${EXAM_TYPES[examType]} の点数がまだ記録されていません` });
    }

    const byLabel = new Map<string, string[]>();
    for (const s of scores.rows) {
      const list = byLabel.get(s.exam_label || '(回の指定なし)') || [];
      list.push(`${s.subject} ${Number(s.score)}/${Number(s.max_score)}`);
      byLabel.set(s.exam_label || '(回の指定なし)', list);
    }
    const summary = Array.from(byLabel.entries()).map(([label, list]) => `【${label}】${list.join(', ')}`).join('\n');
    const prompt = `中学生の${EXAM_TYPES[examType]}の結果です (古い順):\n${summary}\n\n教科ごとの得点傾向と推移を分析し、次のテストに向けた具体的な勉強方法を教えてください。`;

    const advice = await askGemini(prompt, '中学生向けの学習アドバイザーです。前置きや挨拶は省き、Markdown の見出しと箇条書きで簡潔に答えてください。');
    res.json({ advice });
  } catch (err) {
    console.error('Advice error:', err);
    res.status(500).json({ error: 'アドバイス生成エラー' });
  }
});

// AI Chat Endpoint (for AI Tab) with Smart # and @ contextual resolver
app.post('/api/ai/chat', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { messages, contextData, systemInstruction } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: '会話履歴（messages）が必要です' });
    }

    // Inspect last user message for #name or @username
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const dynamicReferences: Record<string, any> = {};

    if (lastUserMsg && typeof lastUserMsg.content === 'string') {
      const text = lastUserMsg.content;
      // Match #tag (#1, #メモ1, #general, etc)
      const hashMatches = text.match(/#([a-zA-Z0-9_\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\-]+)/g);
      if (hashMatches) {
        for (const rawTag of hashMatches) {
          const tag = rawTag.substring(1).trim();
          // Check if slot index number (e.g. #1 or #12)
          const slotNum = parseInt(tag, 10);
          if (!isNaN(slotNum)) {
            const noteRes = await pool.query(`SELECT slot_index, title, content, mode, updated_at FROM notes WHERE slot_index = $1`, [slotNum]);
            if (noteRes.rows.length > 0) {
              dynamicReferences[`note_slot_${slotNum}`] = noteRes.rows[0];
              continue;
            }
          }
          // Check if note title match
          const noteByTitle = await pool.query(
            `SELECT slot_index, title, content, mode, updated_at FROM notes WHERE title ILIKE $1 LIMIT 1`,
            [`%${tag}%`]
          );
          if (noteByTitle.rows.length > 0) {
            dynamicReferences[`note_${tag}`] = noteByTitle.rows[0];
            continue;
          }
          // Check if channel name match -> fetch latest 25 messages
          const chRes = await pool.query(
            `SELECT id, name, type FROM channels WHERE name ILIKE $1 LIMIT 1`,
            [`%${tag}%`]
          );
          if (chRes.rows.length > 0) {
            const ch = chRes.rows[0];
            const msgsRes = await pool.query(
              `SELECT m.id, m.content, m.created_at, COALESCE(u.username, m.username) as sender 
               FROM messages m 
               LEFT JOIN users u ON m.user_id = u.id 
               WHERE m.channel_id = $1 
               ORDER BY m.id DESC LIMIT 25`,
              [ch.id]
            );
            dynamicReferences[`channel_${ch.name}_latest25`] = {
              channel: ch,
              messages: msgsRes.rows.reverse()
            };
          }
        }
      }

      // Match @username
      const atMatches = text.match(/@([a-zA-Z0-9_\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\-]+)/g);
      if (atMatches) {
        for (const rawAt of atMatches) {
          const targetName = rawAt.substring(1).trim();
          if (targetName.toLowerCase() === 'gemini') continue;
          const uRes = await pool.query(
            `SELECT id, username, role, status, custom_status, last_active_at FROM users WHERE username ILIKE $1 LIMIT 1`,
            [`%${targetName}%`]
          );
          if (uRes.rows.length > 0) {
            dynamicReferences[`user_${targetName}`] = uRes.rows[0];
          }
        }
      }
    }

    const mergedContext = {
      ...(contextData || {}),
      ...(Object.keys(dynamicReferences).length > 0 ? { dynamic_fetched_references: dynamicReferences } : {})
    };

    // 最後の質問に付いた画像 (Ctrl+V などで添付)
    const images: { mimeType: string; data: string }[] = (Array.isArray(req.body.images) ? req.body.images : [])
      .filter((im: any) => typeof im?.data === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(im?.mimeType) && im.data.length < 7_000_000)
      .slice(0, 4);
    const history: Content[] = messages.slice(-30).map((m: any, i: number, arr: any[]) => {
      const parts: NonNullable<Content['parts']> = [{ text: String(m.content || '').slice(0, 20000) || '(画像)' }];
      if (i === arr.length - 1 && m.role === 'user') {
        for (const im of images) parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } });
      }
      return { role: m.role === 'model' ? 'model' : 'user', parts };
    });

    const allowWrite = req.body.allowActions !== false;
    const modelMode: ModelMode = req.body.modelMode === 'thinking' ? 'thinking' : 'fast';
    const persona: string = typeof req.body.persona === 'string' ? req.body.persona : 'standard';
    const customPersona: string = typeof req.body.customPersona === 'string' ? req.body.customPersona : '';
    // 「Web検索」ボタン: 最初に必ず検索させる (押していない時は AI が必要に応じて判断)
    const forceWebSearch = req.body.webSearch === true;
    const runTool = createAiToolRunner({
      pool, baseUrl: `http://127.0.0.1:${PORT}`, authHeader: String(req.headers.authorization),
      userId: req.user!.id, username: req.user!.username, allowWrite,
    });
    const { text, steps, modelUsed } = await runGeminiAgent({
      history,
      mode: modelMode,
      tools: aiToolDeclarations(allowWrite),
      runTool,
      forceFirstTool: forceWebSearch ? 'web_search' : undefined,
      systemInstruction: systemInstruction || aiSystemInstruction(req.user!.username, mergedContext, allowWrite, persona, customPersona),
    });
    if (steps.some(st => st.write && st.ok)) {
      logAudit(req.user!, 'ai_action', 'ai', null, { message: `AI が操作を実行: ${steps.filter(st => st.write && st.ok).map(st => st.label).join(' / ')}` });
    }
    res.json({ reply: text, steps, modelUsed, keyCount: getAvailableKeyCount(), resolvedReferences: Object.keys(dynamicReferences) });
  } catch (err: any) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: `AI応答エラー: ${err.message || '不明なエラー'}` });
  }
});

// AI利用枠・統計取得 (5枠ローテーション & PTリセット)
app.get('/api/ai/usage', authMiddleware, (_req, res) => {
  res.json(getAiUsageStats());
});

// Discord GIF・画像プロキシ (Chromebook i-FILTER 回避)
app.get('/api/proxy/media', async (req, res) => {
  try {
    const token = (req.query.token as string) || (req.headers.authorization || '').replace('Bearer ', '');
    if (!verifyToken(token)) {
      return res.status(401).json({ error: '認証が必要です' });
    }

    const rawUrl = req.query.url as string;
    if (!rawUrl) return res.status(400).json({ error: 'url パラメータが必要です' });

    let targetUrl: URL;
    try {
      targetUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: '無効なURL形式です' });
    }

    const allowedHosts = [
      'cdn.discordapp.com',
      'media.discordapp.net',
      'images-ext-1.discordapp.net',
      'images-ext-2.discordapp.net',
      'tenor.com',
      'c.tenor.com',
      'media.tenor.com',
      'giphy.com',
      'media.giphy.com',
      'i.giphy.com',
    ];

    const host = targetUrl.hostname.toLowerCase();
    const isAllowed = allowedHosts.some(h => host === h || host.endsWith('.' + h));
    if (!isAllowed) {
      return res.status(403).json({ error: '許可されていないホストです' });
    }

    const fetchRes = await fetch(targetUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `メディア取得エラー: ${fetchRes.status}` });
    }

    const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    const arrayBuffer = await fetchRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.error('Media proxy error:', err.message);
    res.status(502).json({ error: `プロキシ通信エラー: ${err.message}` });
  }
});

// お知らせ API (admin限定作成・全ユーザー取得)
app.get('/api/announcements', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM announcements ORDER BY id DESC LIMIT 50`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'お知らせ取得エラー' });
  }
});

app.post('/api/announcements', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { title, content, notifyDiscord = true } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'タイトルを入力してください' });
    }
    const cleanTitle = title.trim().slice(0, 200);
    const cleanContent = String(content || '').trim().slice(0, 5000);

    const result = await pool.query(
      `INSERT INTO announcements (user_id, username, title, content) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user!.id, req.user!.username, cleanTitle, cleanContent]
    );
    const saved = result.rows[0];

    broadcast({ type: 'ANNOUNCEMENT_CREATED', payload: saved });
    logAudit(req.user!, 'announcement_create', 'announcement', saved.id, { message: `お知らせ「${cleanTitle}」を作成` });

    if (notifyDiscord) {
      notifyImportant(`📢 【お知らせ】${cleanTitle}`, `${cleanContent}\n\n*(投稿者: ${req.user!.username})*`, 0x3b82f6);
    }

    res.json(saved);
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'お知らせ作成に失敗しました' });
  }
});

app.delete('/api/announcements/:id', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM announcements WHERE id = $1`, [id]);
    broadcast({ type: 'ANNOUNCEMENT_DELETED', payload: { id } });
    logAudit(req.user!, 'announcement_delete', 'announcement', id, { message: `お知らせ ID ${id} を削除` });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'お知らせ削除に失敗しました' });
  }
});

// Discord サーバー状態 & プレゼンス取得
app.get('/api/discord/guild-status', authMiddleware, async (_req, res) => {
  try {
    const status = await getDiscordGuildStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Discord状態取得エラー' });
  }
});

// 複数サーバー一覧・オンラインメンバー・VC・連携リクエスト取得
app.get('/api/discord/servers', authMiddleware, async (_req, res) => {
  try {
    const servers = await getDiscordServers(true);
    const status = await getDiscordStatus();
    const reqRes = await pool.query(`SELECT * FROM discord_link_requests ORDER BY id DESC LIMIT 50`);
    res.json({ servers, status, linkRequests: reqRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Discordサーバー一覧取得エラー' });
  }
});

// サーバー承認 (admin / rds9 専用)
app.post('/api/discord/guilds/:guildId/approve', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const guildId = String(req.params.guildId || '').trim();
    if (!guildId) return res.status(400).json({ error: 'guildIdが必要です' });
    await approveDiscordGuild(guildId);
    logAudit(req.user!, 'discord_guild_approve', 'discord', null, { message: `Discordサーバー (${guildId}) を承認` });
    const servers = await getDiscordServers(true);
    const status = await getDiscordStatus();
    broadcast({ type: 'DISCORD_BINDINGS_UPDATED', payload: status });
    res.json({ servers, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'サーバー承認エラー' });
  }
});

app.delete('/api/discord/guilds/:guildId/approve', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const guildId = String(req.params.guildId || '').trim();
    await removeApprovedDiscordGuild(guildId);
    const servers = await getDiscordServers(true);
    const status = await getDiscordStatus();
    broadcast({ type: 'DISCORD_BINDINGS_UPDATED', payload: status });
    res.json({ servers, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'サーバー承認解除エラー' });
  }
});

// 簡単チャンネル紐付け (admin / rds9 は即時適用、一般メンバーは承認リクエストを作成)
app.post('/api/discord/bindings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const {
      guildId = '',
      guildName = '',
      discordChannelId = '',
      discordChannelName = '',
      asdfChannelId,
      newChannelName = '',
    } = req.body || {};

    const cleanDiscordChId = String(discordChannelId).trim();
    const cleanGuildId = String(guildId).trim();
    if (!cleanDiscordChId) {
      return res.status(400).json({ error: 'Discord チャンネルを選択または入力してください' });
    }

    const isAdmin = req.user!.role === 'admin' || req.user!.username === 'rds9';

    if (!isAdmin) {
      // 一般ユーザーは rds9 (admin) の承認待ちリクエストとして登録
      const ins = await pool.query(
        `INSERT INTO discord_link_requests (requester_id, requester_username, guild_id, guild_name, discord_channel_id, discord_channel_name, asdf_channel_id, new_channel_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
        [
          req.user!.id,
          req.user!.username,
          cleanGuildId,
          String(guildName || '').slice(0, 200),
          cleanDiscordChId,
          String(discordChannelName || cleanDiscordChId).slice(0, 200),
          asdfChannelId ? Number(asdfChannelId) : null,
          String(newChannelName || '').trim().slice(0, 100),
        ]
      );
      const requestRow = ins.rows[0];
      broadcast({ type: 'DISCORD_LINK_REQUEST_UPDATED', payload: requestRow });
      logAudit(req.user!, 'discord_link_request', 'discord', requestRow.id, {
        message: `Discord #${discordChannelName || cleanDiscordChId} の同期申請を作成 (管理者承認待ち)`,
      });
      return res.json({ pendingApproval: true, request: requestRow });
    }

    // admin / rds9 は即時連携
    if (cleanGuildId) {
      await approveDiscordGuild(cleanGuildId);
    }

    let targetAsdfChId = asdfChannelId ? Number(asdfChannelId) : 0;
    if (!targetAsdfChId && newChannelName && String(newChannelName).trim()) {
      const cleanName = String(newChannelName).trim().toLowerCase().replace(/\s+/g, '-');
      const existing = await pool.query(`SELECT * FROM channels WHERE name = $1`, [cleanName]);
      if (existing.rows.length > 0) {
        targetAsdfChId = existing.rows[0].id;
        if (cleanGuildId) {
          const upd = await pool.query(`UPDATE channels SET server_id = $1 WHERE id = $2 RETURNING *`, [cleanGuildId, targetAsdfChId]);
          broadcast({ type: 'CHANNEL_UPDATED', payload: upd.rows[0] });
        }
      } else {
        const maxPosRes = await pool.query(`SELECT COALESCE(MAX(position), 0) as max_pos FROM channels`);
        const nextPos = parseInt(maxPosRes.rows[0].max_pos, 10) + 1;
        const created = await pool.query(
          `INSERT INTO channels (name, type, position, server_id) VALUES ($1, 'text', $2, $3) RETURNING *`,
          [cleanName, nextPos, cleanGuildId || null]
        );
        targetAsdfChId = created.rows[0].id;
        broadcast({ type: 'CHANNEL_CREATED', payload: created.rows[0] });
      }
    } else if (targetAsdfChId && cleanGuildId) {
      const upd = await pool.query(`UPDATE channels SET server_id = COALESCE(server_id, $1) WHERE id = $2 RETURNING *`, [cleanGuildId, targetAsdfChId]);
      if (upd.rows[0]) broadcast({ type: 'CHANNEL_UPDATED', payload: upd.rows[0] });
    }

    if (!targetAsdfChId) {
      return res.status(400).json({ error: '連携先の asdfbase チャンネルを指定してください' });
    }

    await addDiscordBinding(cleanDiscordChId, targetAsdfChId, cleanGuildId || undefined);
    refreshDiscordCommands();
    const status = await getDiscordStatus();
    broadcast({ type: 'DISCORD_BINDINGS_UPDATED', payload: status });
    logAudit(req.user!, 'discord_setup_web', 'discord', targetAsdfChId, {
      message: `Discord #${discordChannelName || cleanDiscordChId} ⇔ asdfbase #${targetAsdfChId} を連携`,
    });

    // 初回連携時に直近履歴もバックグラウンドで取得
    syncDiscordHistory({ discordChannelId: cleanDiscordChId, limit: 50 }).catch(() => {});

    res.json({ pendingApproval: false, status, asdfChannelId: targetAsdfChId });
  } catch (err: any) {
    console.error('Discord binding error:', err);
    res.status(500).json({ error: err.message || 'Discord連携の設定に失敗しました' });
  }
});

// 連携リクエストの承認・却下 (admin / rds9 限定)
app.post('/api/discord/link-requests/:id/approve', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const reqRes = await pool.query(`SELECT * FROM discord_link_requests WHERE id = $1`, [id]);
    if (reqRes.rows.length === 0) return res.status(404).json({ error: '申請が見つかりません' });
    const linkReq = reqRes.rows[0];
    if (linkReq.status !== 'pending') return res.status(400).json({ error: '既に処理済みの申請です' });

    if (linkReq.guild_id) {
      await approveDiscordGuild(linkReq.guild_id);
    }

    let targetAsdfChId = linkReq.asdf_channel_id ? Number(linkReq.asdf_channel_id) : 0;
    if (!targetAsdfChId && linkReq.new_channel_name) {
      const cleanName = String(linkReq.new_channel_name).trim().toLowerCase().replace(/\s+/g, '-');
      const existing = await pool.query(`SELECT * FROM channels WHERE name = $1`, [cleanName]);
      if (existing.rows.length > 0) {
        targetAsdfChId = existing.rows[0].id;
      } else {
        const maxPosRes = await pool.query(`SELECT COALESCE(MAX(position), 0) as max_pos FROM channels`);
        const nextPos = parseInt(maxPosRes.rows[0].max_pos, 10) + 1;
        const created = await pool.query(
          `INSERT INTO channels (name, type, position, server_id) VALUES ($1, 'text', $2, $3) RETURNING *`,
          [cleanName, nextPos, linkReq.guild_id || null]
        );
        targetAsdfChId = created.rows[0].id;
        broadcast({ type: 'CHANNEL_CREATED', payload: created.rows[0] });
      }
    }
    if (targetAsdfChId && linkReq.guild_id) {
      const upd = await pool.query(`UPDATE channels SET server_id = COALESCE(server_id, $1) WHERE id = $2 RETURNING *`, [linkReq.guild_id, targetAsdfChId]);
      if (upd.rows[0]) broadcast({ type: 'CHANNEL_UPDATED', payload: upd.rows[0] });
    }

    if (!targetAsdfChId) return res.status(400).json({ error: '連携先チャンネルが決定できませんでした' });

    await addDiscordBinding(linkReq.discord_channel_id, targetAsdfChId, linkReq.guild_id || undefined);
    const updReq = await pool.query(
      `UPDATE discord_link_requests SET status = 'approved', asdf_channel_id = $1, reviewed_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [targetAsdfChId, req.user!.username, id]
    );
    const status = await getDiscordStatus();
    broadcast({ type: 'DISCORD_LINK_REQUEST_UPDATED', payload: updReq.rows[0] });
    broadcast({ type: 'DISCORD_BINDINGS_UPDATED', payload: status });
    logAudit(req.user!, 'discord_link_approve', 'discord', id, {
      message: `${linkReq.requester_username} の Discord 連携申請 (#${linkReq.discord_channel_name}) を承認`,
    });
    syncDiscordHistory({ discordChannelId: linkReq.discord_channel_id, limit: 50 }).catch(() => {});
    res.json({ request: updReq.rows[0], status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '承認処理に失敗しました' });
  }
});

app.post('/api/discord/link-requests/:id/reject', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updReq = await pool.query(
      `UPDATE discord_link_requests SET status = 'rejected', reviewed_by = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [req.user!.username, id]
    );
    if (updReq.rows.length === 0) return res.status(404).json({ error: '申請が見つかりません' });
    broadcast({ type: 'DISCORD_LINK_REQUEST_UPDATED', payload: updReq.rows[0] });
    res.json({ request: updReq.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '却下処理に失敗しました' });
  }
});

// 同期チャンネルの解除 (削除)
app.delete('/api/discord/bindings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { discordChannelId, asdfChannelId } = req.body || {};
    const qDiscordId = (req.query.discordChannelId as string) || discordChannelId;
    const qAsdfId = req.query.asdfChannelId ? Number(req.query.asdfChannelId) : (asdfChannelId ? Number(asdfChannelId) : undefined);
    if (!qDiscordId && !qAsdfId) {
      return res.status(400).json({ error: '解除するチャンネルを指定してください' });
    }
    const removed = await removeDiscordBinding({
      discordChannelId: qDiscordId ? String(qDiscordId) : undefined,
      asdfChannelId: qAsdfId,
    });
    const status = await getDiscordStatus();
    broadcast({ type: 'DISCORD_BINDINGS_UPDATED', payload: status });
    logAudit(req.user!, 'discord_unsetup_web', 'discord', qAsdfId || null, {
      message: `Discord チャンネル同期を解除 (${qDiscordId || qAsdfId})`,
      removed,
    });
    res.json({ removed, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '同期解除に失敗しました' });
  }
});

// Bot ダウンタイム後の未取得メッセージ履歴の手動・自動同期
app.post('/api/discord/sync-history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { asdfChannelId, discordChannelId, guildId, limit } = req.body || {};
    const result = await syncDiscordHistory({
      asdfChannelId: asdfChannelId ? Number(asdfChannelId) : undefined,
      discordChannelId: discordChannelId ? String(discordChannelId) : undefined,
      guildId: guildId ? String(guildId) : undefined,
      limit: limit ? Number(limit) : 50,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || '履歴同期に失敗しました' });
  }
});

function jstNowLabel() {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' });
}

const PERSONA_PROMPTS: Record<string, string> = {
  standard: '前置きや締めの挨拶は省き、要点だけを日本語で簡潔に答えてください。',
  teacher: 'あなたは優しくて頼れる中学校の先生です。中学生にも直感的にわかるよう、具体例を交えて丁寧に噛み砕いて教えてください。',
  friend: 'あなたは親しい同級生の友達です。タメ口でフランクに、親しみやすくカジュアルな口調で話してください。',
  logical: 'あなたは論理的で無駄を嫌うエキスパートです。結論ファーストで、根拠と構造を明確にして無駄なく回答してください。',
  enthusiastic: 'あなたはポジティブで明るい応援サポーターです。相手を褒めつつテンション高めに楽しく回答してください。',
};

function aiSystemInstruction(username: string, context: object, allowWrite: boolean, persona = 'standard', customPersona = '') {
  const personaInstruction = persona === 'custom' && customPersona.trim()
    ? `【性格・口調の指定】以下のキャラクター・口調・ルールになりきって回答してください:\n${customPersona.trim().slice(0, 1000)}`
    : (PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.standard);
  return [
    'あなたは中学生向けワークスペース「asdfbase」のAIアシスタントです。',
    `現在は ${jstNowLabel()} (日本時間)、話している相手は ${username} です。「明日」「来週の金曜」などはこの日時を基準に YYYY-MM-DD に直してください。`,
    '時間割・提出物・予定・メモ・チャット・テストの点数・天気などサイト内の情報が関係する質問では、推測せず必ずツールで最新の情報を確認してから答えてください。必要なら複数のツールを組み合わせてください。',
    '「#3」「メモ3」はメモ番号、「#general」はチャンネル名を指します。',
    'サイトの外の知識・ニュース・最新の情報は web_search で調べ (必要なら read_webpage で本文も読み)、答えの最後に参考にしたページの URL を挙げてください。日本に関する話題は日本語の検索語で調べてください。',
    '検索結果やページが英語など外国語でも、答えは必ず自然な日本語にしてください (固有名詞・URL はそのままで構いません)。',
    allowWrite
      ? '提出物・宿題の登録、提出物の進捗変更、予定の追加、メモへの追記は、ユーザーがはっきり頼んだときだけ実行してください。内容が曖昧なら実行せずに確認してください。削除や上書きはできません。実行したら何をしたかを一言で伝えてください。'
      : 'この会話では情報の確認だけができ、登録や変更はできません。',
    personaInstruction,
    '表や箇条書き (Markdown) を使ってかまいません。',
    `補助情報 (画面の状態, JSON): ${JSON.stringify(context).slice(0, 8000)}`,
  ].join('\n');
}

// Memo AI Assistant (Summarize, Proofread, Explain Code)
app.post('/api/ai/memo-assist', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { content, type, customPrompt } = req.body;
    if (!content && !customPrompt) {
      return res.status(400).json({ error: '対象のテキストがありません' });
    }

    let prompt = '';
    let instruction = 'あなたは的確で簡潔なアシスタントです。余計な前置きを省いて結果のみを返してください。';

    if (type === 'summarize') {
      prompt = `以下のメモ内容を3行以内の重要ポイントに箇条書きで要約してください:\n\n${content}`;
    } else if (type === 'proofread') {
      prompt = `以下の文章の誤字脱字・表現の不自然さを直した「校正後の全文」だけを出力してください。説明・前置き・コードブロックの囲みは不要です。Markdown の書式はそのまま残してください:\n\n${content}`;
    } else if (type === 'explain_code') {
      prompt = `以下のプログラムコードの処理内容、引数、戻り値、改善点を分かりやすく解説してください:\n\n${content}`;
      instruction = 'プログラミング講師として簡潔かつ明快に解説してください。';
    } else if (type === 'continue') {
      prompt = `以下のメモの文脈に続けて、自然な続きの文章や実装を生成してください:\n\n${content}`;
    } else {
      prompt = `${customPrompt || '以下のテキストを改善してください'}:\n\n${content}`;
    }

    const result = await askGemini(prompt, instruction);
    res.json({ result });
  } catch (err) {
    console.error('Memo assist error:', err);
    res.status(500).json({ error: 'メモAIアシストエラー' });
  }
});

// Timetables API
// 教科はクラスごとに1つ。短縮・S短は時刻が変わるだけで教科は同じ (schedule_type は常に normal)
app.get('/api/timetables', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const classNo = parseClassNo(req.query.classNo) ?? (await classOf(req.user!.id)) ?? 1;
    const result = await pool.query(
      `SELECT * FROM timetables WHERE schedule_type = 'normal' AND class_no = $1 ORDER BY day_of_week ASC, period ASC`,
      [classNo]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '時間割取得エラー' });
  }
});

async function getTimetableConfig(): Promise<TimetableConfig & { activeDate: string }> {
  let schedules: Record<ScheduleType, ScheduleDef> = { ...DEFAULT_SCHEDULES };
  let dayPeriodCounts = { ...DEFAULT_DAY_PERIOD_COUNTS };
  try {
    const saved = JSON.parse(await getSetting('timetable_config_v2', '{}'));
    for (const t of SCHEDULE_TYPES) {
      if (isValidSchedule(saved.schedules?.[t])) schedules[t] = saved.schedules[t];
    }
    if (saved.dayPeriodCounts) dayPeriodCounts = { ...dayPeriodCounts, ...saved.dayPeriodCounts };
  } catch (_) {}
  // 「今日の時程」は設定した日だけ有効。日付が変わったら通常時程へ戻る
  const active = await getSetting('timetable_active_schedule', 'normal');
  const activeDate = await getSetting('timetable_active_date', '');
  const today = nowInTokyo().date;
  const activeScheduleType = (SCHEDULE_TYPES as readonly string[]).includes(active) && activeDate === today ? active as ScheduleType : 'normal';
  return { activeScheduleType, activeDate: today, schedules, dayPeriodCounts };
}

// 時程(朝の会・各時限・帰りの会)と「今日の時程」: 全員で共有
app.get('/api/timetables/config', authMiddleware, async (req, res) => {
  try {
    res.json(await getTimetableConfig());
  } catch (err) {
    res.status(500).json({ error: '時程設定取得エラー' });
  }
});

app.put('/api/timetables/config', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { activeScheduleType, schedules, dayPeriodCounts } = req.body || {};
    const changes: string[] = [];
    if (activeScheduleType !== undefined) {
      if (!(SCHEDULE_TYPES as readonly string[]).includes(activeScheduleType)) return res.status(400).json({ error: '時程の種類が不正です' });
      await setSetting('timetable_active_schedule', activeScheduleType);
      await setSetting('timetable_active_date', nowInTokyo().date);
      changes.push(`今日の時程を ${activeScheduleType === 'normal' ? '通常' : activeScheduleType === 'short' ? '短縮' : 'S短'} に変更`);
    }
    if (schedules !== undefined || dayPeriodCounts !== undefined) {
      const current = await getTimetableConfig();
      const nextSchedules = { ...current.schedules };
      if (schedules !== undefined) {
        for (const key of Object.keys(schedules)) {
          if (!(SCHEDULE_TYPES as readonly string[]).includes(key) || !isValidSchedule(schedules[key])) {
            return res.status(400).json({ error: '時刻の形式が正しくありません (HH:MM)' });
          }
          nextSchedules[key as ScheduleType] = schedules[key];
        }
        changes.push('時程の時刻を変更');
      }
      const nextCounts = { ...current.dayPeriodCounts };
      if (dayPeriodCounts !== undefined) {
        for (const [day, count] of Object.entries(dayPeriodCounts)) {
          if (!['1', '2', '3', '4', '5'].includes(day) || ![5, 6].includes(Number(count))) {
            return res.status(400).json({ error: '授業数は 5 か 6 を指定してください' });
          }
          nextCounts[day] = Number(count);
        }
        changes.push('曜日ごとの授業数を変更');
      }
      await setSetting('timetable_config_v2', JSON.stringify({ schedules: nextSchedules, dayPeriodCounts: nextCounts }));
    }
    const config = await getTimetableConfig();
    broadcast({ type: 'TIMETABLE_CONFIG_UPDATED', payload: config });
    logAudit(req.user!, 'timetable_config', 'timetable', null, { message: changes.join(' / ') });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: '時程設定保存エラー' });
  }
});

// コマの登録/変更: 同じ曜日・時限は上書き (持ち物・メモは保持)
app.post('/api/timetables', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { dayOfWeek, period, subject, items, note } = req.body;
    if (dayOfWeek === undefined || !period || !subject) {
      return res.status(400).json({ error: '曜日、時限、教科名は必須です' });
    }

    const type = 'normal';
    const classNo = parseClassNo(req.body.classNo) ?? (await classOf(req.user!.id)) ?? 1;
    const existing = await pool.query(
      `SELECT * FROM timetables WHERE day_of_week = $1 AND period = $2 AND schedule_type = $3 AND class_no = $4 ORDER BY id ASC`,
      [dayOfWeek, period, type, classNo]
    );
    let row;
    if (existing.rows.length > 0) {
      const keep = existing.rows[0];
      // 過去の重複行は掃除
      if (existing.rows.length > 1) {
        await pool.query(`DELETE FROM timetables WHERE id = ANY($1::int[])`, [existing.rows.slice(1).map(r => r.id)]);
      }
      row = (await pool.query(
        `UPDATE timetables SET subject = $1, items = COALESCE($2, items), note = COALESCE($3, note) WHERE id = $4 RETURNING *`,
        [subject, items ?? null, note ?? null, keep.id]
      )).rows[0];
    } else {
      row = (await pool.query(
        `INSERT INTO timetables (day_of_week, period, subject, schedule_type, items, note, class_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [dayOfWeek, period, subject, type, items || '', note || '', classNo]
      )).rows[0];
    }
    broadcast({ type: 'TIMETABLE_UPDATED', payload: { classNo } });
    logAudit(req.user!, 'timetable_set', 'timetable', row.id, {
      message: `${classNo}組の時間割 ${['', '月', '火', '水', '木', '金', '土'][dayOfWeek] || dayOfWeek}曜${period}限 を「${subject}」に設定`,
      before: existing.rows[0]?.subject || null,
    });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: '時間割登録エラー' });
  }
});

// コマの詳細 (教科・持ち物・メモ) を更新
app.put('/api/timetables/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { subject, items, note } = req.body || {};
    const result = await pool.query(
      `UPDATE timetables SET subject = COALESCE($1, subject), items = COALESCE($2, items), note = COALESCE($3, note)
       WHERE id = $4 RETURNING *`,
      [subject ?? null, items ?? null, note ?? null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'コマが見つかりません' });
    const row = result.rows[0];
    broadcast({ type: 'TIMETABLE_UPDATED', payload: { classNo: row.class_no } });
    logAudit(req.user!, 'timetable_detail', 'timetable', id, {
      message: `${row.class_no}組の時間割 ${['', '月', '火', '水', '木', '金', '土'][row.day_of_week] || row.day_of_week}曜${row.period}限 (${row.subject}) の詳細を更新`,
      items: row.items,
      note: row.note,
    });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: '時間割更新エラー' });
  }
});

app.delete('/api/timetables/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await pool.query(`DELETE FROM timetables WHERE id = $1 RETURNING *`, [id]);
    const d = deleted.rows[0];
    broadcast({ type: 'TIMETABLE_UPDATED', payload: { classNo: d?.class_no ?? null } });
    if (d) {
      logAudit(req.user!, 'timetable_delete', 'timetable', id, {
        message: `${d.class_no}組の時間割 ${['', '月', '火', '水', '木', '金', '土'][d.day_of_week] || d.day_of_week}曜${d.period}限 (${d.subject}) を削除`,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '時間割削除エラー' });
  }
});

// Board API
app.get('/api/board', authMiddleware, async (req, res) => {
  try {
    const strokes = await pool.query(`SELECT * FROM board_strokes ORDER BY id ASC`);
    const texts = await pool.query(`SELECT * FROM board_texts ORDER BY id ASC`);
    res.json({ strokes: strokes.rows, texts: texts.rows });
  } catch (err) {
    res.status(500).json({ error: 'ボードデータ取得エラー' });
  }
});

app.post('/api/board/stroke', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const username = req.user!.username;
    const { color, width, points } = req.body;

    const result = await pool.query(
      `INSERT INTO board_strokes (user_id, username, color, width, points) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, username, color || '#f59e0b', width || 3, JSON.stringify(points)]
    );
    const stroke = result.rows[0];
    broadcast({ type: 'BOARD_NEW_STROKE', payload: stroke });
    res.json(stroke);
  } catch (err) {
    res.status(500).json({ error: 'ストローク保存エラー' });
  }
});

app.post('/api/board/text', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const username = req.user!.username;
    const { x, y, text } = req.body;

    const result = await pool.query(
      `INSERT INTO board_texts (user_id, username, x, y, text) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, username, x, y, text]
    );
    const textItem = result.rows[0];
    broadcast({ type: 'BOARD_NEW_TEXT', payload: textItem });
    res.json(textItem);
  } catch (err) {
    res.status(500).json({ error: 'テキスト付箋保存エラー' });
  }
});

app.delete('/api/board/clear', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const cnt = await pool.query(`SELECT (SELECT COUNT(*) FROM board_strokes) AS s, (SELECT COUNT(*) FROM board_texts) AS t`);
    await pool.query(`DELETE FROM board_strokes`);
    await pool.query(`DELETE FROM board_texts`);
    broadcast({ type: 'BOARD_CLEARED' });
    logAudit(req.user!, 'board_clear', 'board', null, { message: `ボードを全消去 (線 ${cnt.rows[0].s} 本 / 付箋 ${cnt.rows[0].t} 件)` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ボードクリアエラー' });
  }
});

// Shared Clipboard API
app.get('/api/clipboard', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM shared_clipboard WHERE id = 1`);
    if (result.rows.length === 0) {
      await pool.query(`INSERT INTO shared_clipboard (id, content) VALUES (1, '') ON CONFLICT DO NOTHING`);
      return res.json({ content: '', updated_by: 'system', updated_at: new Date().toISOString() });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'クリップボード取得エラー' });
  }
});

app.put('/api/clipboard', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { content } = req.body;
    const username = req.user!.username;

    const result = await pool.query(
      `INSERT INTO shared_clipboard (id, content, updated_by, updated_at) 
       VALUES (1, $1, $2, NOW()) 
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW() 
       RETURNING *`,
      [content, username]
    );
    const updated = result.rows[0];
    broadcast({ type: 'CLIPBOARD_UPDATED', payload: updated });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'クリップボード同期エラー' });
  }
});

// Notes (Slots 1-10 Common + Slots 11+ Dedicated Monaco) API
// メモスロットの確保・整理 (起動時とユーザー登録時だけ実行。GET のたびに走らせると重い)
async function ensureNoteSlots() {
  // 1. スロット1〜10の確保
  for (let i = 1; i <= 10; i++) {
    await pool.query(`
      INSERT INTO notes (slot_index, title, content, mode) 
      VALUES ($1, $2, '', 'markdown') 
      ON CONFLICT (slot_index) DO NOTHING
    `, [i, `メモ ${i}`]);
  }

  // 2. 既存スロット1〜10の「メモ #1」などの重複タイトルをクリーンアップ
  await pool.query(`
    UPDATE notes 
    SET title = REGEXP_REPLACE(title, '^メモ\\s*#([0-9]+)', 'メモ \\1') 
    WHERE slot_index <= 10 AND title LIKE '%#%'
  `).catch(() => {});

  // 3. 全利用メンバーの専用Monacoエディタスロット（スロット11以降: 10 + user.id 固定）を自動確保
  const usersRes = await pool.query(`SELECT id, username FROM users ORDER BY id ASC`);
  for (const u of usersRes.rows) {
    const slotIndex = 10 + u.id; // ユーザーID固定スロット
    await pool.query(`
      INSERT INTO notes (slot_index, title, content, mode, assigned_user_id)
      VALUES ($1, $2, '', 'monaco', $3)
      ON CONFLICT (slot_index) DO UPDATE 
      SET assigned_user_id = EXCLUDED.assigned_user_id,
          title = CASE WHEN notes.title LIKE '%の専用エディタ' THEN EXCLUDED.title ELSE notes.title END
    `, [slotIndex, `${u.username}の専用エディタ`, u.id]);
  }

  // 4. 旧方式(11 + 並び順)で作られた重複専用スロットを正規スロット(10 + user.id)へ統合して削除
  const strayRes = await pool.query(`
    SELECT n.slot_index, n.content, n.assigned_user_id
    FROM notes n
    WHERE n.slot_index > 10
      AND (n.assigned_user_id IS NULL
           OR n.slot_index <> 10 + n.assigned_user_id
           OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.assigned_user_id))
  `);
  for (const stray of strayRes.rows) {
    const owner = usersRes.rows.find(u => u.id === stray.assigned_user_id);
    if (owner) {
      const canonical = 10 + owner.id;
      // 正規スロットが空なら内容を引き継ぐ
      if (stray.content) {
        await pool.query(
          `UPDATE notes SET content = $1, updated_at = NOW() WHERE slot_index = $2 AND (content IS NULL OR content = '')`,
          [stray.content, canonical]
        );
      }
      await pool.query(`UPDATE note_history SET slot_index = $1 WHERE slot_index = $2`, [canonical, stray.slot_index]);
      await pool.query(`DELETE FROM notes WHERE slot_index = $1`, [stray.slot_index]);
    } else if (!stray.content) {
      // 削除済みユーザーの空スロット
      await pool.query(`DELETE FROM notes WHERE slot_index = $1`, [stray.slot_index]);
    }
  }
}

app.get('/api/notes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, u.username as assigned_username 
      FROM notes n 
      LEFT JOIN users u ON n.assigned_user_id = u.id 
      ORDER BY n.slot_index ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Notes fetch error:', err);
    res.status(500).json({ error: 'メモ取得エラー' });
  }
});

app.put('/api/notes/:slotIndex', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const slotIndex = parseInt(req.params.slotIndex, 10);
    const { title, content, mode } = req.body;
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const username = req.user!.username;

    const currentNoteRes = await pool.query(`SELECT * FROM notes WHERE slot_index = $1`, [slotIndex]);
    const currentNote = currentNoteRes.rows[0];

    // スロット11以降、または担当ユーザーが設定されている場合は本人のみ編集可能
    if (
      currentNote && 
      currentNote.assigned_user_id && 
      currentNote.assigned_user_id !== userId &&
      userRole !== 'admin'
    ) {
      return res.status(403).json({ error: 'このメモは他ユーザーの専用ゾーンです（閲覧専用）' });
    }

    if (currentNote && currentNote.content !== content) {
      await pool.query(
        `INSERT INTO note_history (slot_index, content, updated_by_id) VALUES ($1, $2, $3)`,
        [slotIndex, currentNote.content, userId]
      );
    }

    const effectiveMode = slotIndex >= 11 ? 'monaco' : (mode || currentNote?.mode || 'markdown');

    const updated = await pool.query(
      `UPDATE notes 
       SET title = COALESCE($1, title), 
           content = COALESCE($2, content), 
           mode = $3, 
           version = version + 1, 
           updated_at = NOW() 
       WHERE slot_index = $4 RETURNING *`,
      [title, content, effectiveMode, slotIndex]
    );

    const updatedNote = {
      ...updated.rows[0],
      assigned_username: currentNote?.assigned_user_id ? username : null
    };

    broadcast({
      type: 'NOTE_UPDATED',
      payload: updatedNote,
      sender: username,
    });

    res.json(updatedNote);
  } catch (err) {
    console.error('Note update error:', err);
    res.status(500).json({ error: 'メモ更新エラー' });
  }
});

// Audit Logs & Users List
// action: 種類の前方一致 / user: ユーザーID または 'system' (操作者なし)
function auditWhere(query: { action?: any; user?: any; beforeId?: any }) {
  const params: any[] = [];
  const where: string[] = [];
  const beforeId = parseInt(String(query.beforeId || ''), 10) || 0;
  if (beforeId) {
    params.push(beforeId);
    where.push(`id < $${params.length}`);
  }
  if (query.action) {
    params.push(`${String(query.action)}%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (query.user === 'system') {
    where.push('user_id IS NULL');
  } else if (query.user && Number.isFinite(Number(query.user))) {
    params.push(Number(query.user));
    where.push(`user_id = $${params.length}`);
  }
  return { params, sql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

app.get('/api/audit-logs', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    const { params, sql } = auditWhere(req.query);
    params.push(limit);
    const result = await pool.query(`SELECT * FROM audit_logs ${sql} ORDER BY id DESC LIMIT $${params.length}`, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '監査ログ取得エラー' });
  }
});

// 表示中の条件 (種類・ユーザー) の直近のログを AI が要約
app.post('/api/audit-logs/summarize', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { params, sql } = auditWhere({ action: req.body?.action, user: req.body?.user });
    params.push(200);
    const rows = (await pool.query(`SELECT * FROM audit_logs ${sql} ORDER BY id DESC LIMIT $${params.length}`, params)).rows;
    if (rows.length === 0) return res.status(400).json({ error: '要約するログがありません' });
    const lines = rows.reverse().map(r => {
      const d = typeof r.details === 'string' ? (() => { try { return JSON.parse(r.details); } catch { return {}; } })() : (r.details || {});
      const at = new Date(r.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `${at} ${r.username || 'system'}: ${String(d.message || `${r.action} (${r.target_type})`).slice(0, 160)}${r.restored ? ' [復元済み]' : ''}`;
    });
    const summary = await askGemini(
      `asdfbase の監査ログ (古い順, ${rows.length}件) です。\n${lines.join('\n')}\n\n` +
      '誰がいつ何をしたかの傾向、目立つ操作 (削除・設定変更・ログイン失敗など)、注意した方がよい点を日本語でまとめてください。',
      '前置きは省き、Markdown の見出しと箇条書きで簡潔に答えてください。推測で事実を作らないでください。'
    );
    res.json({ summary, count: rows.length });
  } catch (err) {
    console.error('Audit summarize error:', err);
    res.status(500).json({ error: '監査ログの要約に失敗しました' });
  }
});

// このログだけ削除 (管理者)
app.delete('/api/audit-logs/:id', authMiddleware, async (req: AuthRequest, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: '管理者のみ削除できます' });
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [id]);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: '監査ログ削除エラー' });
  }
});

// 履歴全削除 (管理者)。削除した事実だけは記録を残す
app.delete('/api/audit-logs', authMiddleware, async (req: AuthRequest, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: '管理者のみ削除できます' });
  try {
    const del = await pool.query(`DELETE FROM audit_logs`);
    logAudit(req.user!, 'audit_clear', 'audit', null, { message: `監査ログを全削除 (${del.rowCount} 件)`, ...requestMeta(req) });
    res.json({ success: true, deleted: del.rowCount });
  } catch (err) {
    res.status(500).json({ error: '監査ログ全削除エラー' });
  }
});

app.post('/api/audit-logs/:id/restore', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const logRes = await pool.query(`SELECT * FROM audit_logs WHERE id = $1`, [id]);
    if (logRes.rows.length === 0) {
      return res.status(404).json({ error: 'ログが見つかりません' });
    }

    const log = logRes.rows[0];
    if (!log.can_restore || log.restored) {
      return res.status(400).json({ error: '復元できないか、すでに復元済みです' });
    }

    if (log.target_type === 'note' && log.details) {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      if (details.slot_index) {
        await pool.query(
          `UPDATE notes SET title = $1, content = $2, updated_at = NOW() WHERE slot_index = $3`,
          [details.title || '復元メモ', details.content || '', details.slot_index]
        );
      }
    } else if (log.target_type === 'assignment' && log.details) {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      const r = await pool.query(
        `INSERT INTO assignments (title, subject, description, deadline, resubmit_deadline, class_no) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [details.title, details.subject, details.description, details.deadline || new Date(), details.resubmit_deadline || null, details.class_no ?? null]
      );
      broadcast({ type: 'ASSIGNMENT_CREATED', payload: { ...r.rows[0], my_status: 'unstarted' } });
    } else if (log.target_type === 'homework' && log.details) {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      const r = await pool.query(
        `INSERT INTO homework (class_no, subject, content, due_date, user_id, username) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [details.class_no ?? null, details.subject, details.content, details.due_date, details.user_id ?? null, details.username ?? null]
      );
      broadcast({ type: 'HOMEWORK_CREATED', payload: formatHomework({ ...r.rows[0], done_count: 0, my_done: false }) });
    } else if (log.target_type === 'message' && log.details) {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      const r = await pool.query(
        `INSERT INTO messages (channel_id, user_id, username, content, created_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW())) RETURNING *`,
        [details.channel_id, details.author_id || null, details.author || 'unknown', details.content || '', details.created_at || null]
      );
      broadcast({ type: 'NEW_MESSAGE', payload: { ...r.rows[0], sender_username: details.author } });
    }
    logAudit(req.user!, 'restore', log.target_type, log.target_id, { message: `ログ #${id} (${log.action}) から復元` });

    await pool.query(`UPDATE audit_logs SET restored = TRUE WHERE id = $1`, [id]);
    res.json({ success: true, id });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: '復元に失敗しました' });
  }
});

// Discord Webhook Settings & Test
app.get('/api/settings/webhook', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const webhookUrl = await getDiscordWebhookUrl();
    res.json({ webhookUrl });
  } catch (err) {
    res.status(500).json({ error: 'Webhook設定取得エラー' });
  }
});

app.post('/api/settings/webhook', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { webhookUrl } = req.body;
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) 
       VALUES ('discord_webhook_url', $1, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [webhookUrl || '']
    );
    res.json({ success: true, webhookUrl: webhookUrl || '' });
  } catch (err) {
    res.status(500).json({ error: 'Webhook設定保存エラー' });
  }
});

let lastDiscordVoiceStatus: any[] = [];

app.get('/api/discord/voice-status', authMiddleware, (_req, res) => {
  res.json({ vcs: lastDiscordVoiceStatus });
});

app.post('/api/webhook/test', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { webhookUrl } = req.body;
    const targetUrl = webhookUrl || await getDiscordWebhookUrl();
    if (!targetUrl) {
      return res.status(400).json({ error: 'Discord Webhook URLが設定されていません' });
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'asdfbase Notification',
        content: `【asdfbase 通知テスト】ユーザー: ${req.user!.username} より通知テストが送信されました。`,
      }),
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'Discordへの送信に失敗しました' });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '送信エラー' });
  }
});

// Discord / 通知連携設定 (重要通知 Webhook・メッセージ Webhook・ON/OFF・Bot状態)
app.get('/api/settings/integrations', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json({
      importantWebhookUrl: await getDiscordWebhookUrl(),
      messageWebhookUrl: await getSetting('discord_message_webhook_url', ''),
      importantEnabled: (await getSetting('notify_important_enabled', 'on')) === 'on',
      messagesEnabled: (await getSetting('notify_messages_enabled', 'on')) === 'on',
      bot: await getDiscordStatus(),
      chatRetentionDays: Number(await getSetting('chat_retention_days', String(DEFAULT_RETENTION_DAYS))),
      retention: await retentionSummary(),
    });
  } catch (err) {
    res.status(500).json({ error: '連携設定取得エラー' });
  }
});

app.post('/api/settings/integrations', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { importantWebhookUrl, messageWebhookUrl, importantEnabled, messagesEnabled, chatRetentionDays } = req.body || {};
    const isWebhook = (u: any) => typeof u === 'string' && (u === '' || /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u));
    if (importantWebhookUrl !== undefined) {
      if (!isWebhook(importantWebhookUrl)) return res.status(400).json({ error: '重要通知 Webhook URL の形式が正しくありません' });
      await setSetting('discord_webhook_url', importantWebhookUrl);
    }
    if (messageWebhookUrl !== undefined) {
      if (!isWebhook(messageWebhookUrl)) return res.status(400).json({ error: 'メッセージ Webhook URL の形式が正しくありません' });
      await setSetting('discord_message_webhook_url', messageWebhookUrl);
    }
    if (importantEnabled !== undefined) await setSetting('notify_important_enabled', importantEnabled ? 'on' : 'off');
    if (messagesEnabled !== undefined) await setSetting('notify_messages_enabled', messagesEnabled ? 'on' : 'off');
    if (chatRetentionDays !== undefined) {
      const days = Number(chatRetentionDays);
      if (!RETENTION_CHOICES.includes(days)) return res.status(400).json({ error: '保存期間の値が正しくありません' });
      await setSetting('chat_retention_days', String(days));
      runRetention().catch(err => console.error('Retention error:', err.message));
    }
    logAudit(req.user!, 'settings_update', 'settings', null, {
      message: '通知・Discord連携設定を変更',
      changed: Object.keys(req.body || {}),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '連携設定保存エラー' });
  }
});

app.post('/api/settings/integrations/test', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const { kind } = req.body || {};
    const url = kind === 'message' ? await getSetting('discord_message_webhook_url', '') : await getDiscordWebhookUrl();
    if (!url) return res.status(400).json({ error: 'Webhook URL が設定されていません' });
    await postWebhook(url, {
      username: kind === 'message' ? '[asdfbase] テスト' : 'asdfbase 重要通知',
      content: `【asdfbase ${kind === 'message' ? 'メッセージ転送' : '重要通知'}テスト】${req.user!.username} から送信`,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: `送信に失敗しました: ${err.message}` });
  }
});

// Change Password
app.post('/api/auth/change-password', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.id;

    const userRes = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    const isMatch = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
    if (!isMatch) return res.status(400).json({ error: '現在のパスワードが正しくありません' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);
    logAudit(req.user!, 'password_change', 'user', userId, { message: 'パスワードを変更', ...requestMeta(req) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'パスワード変更エラー' });
  }
});

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, status, custom_status, avatar_url, class_no, custom_roles, last_active_at FROM users ORDER BY username ASC`
    );
    res.json(result.rows.map(r => ({
      ...r,
      custom_roles: Array.isArray(r.custom_roles) ? r.custom_roles : [],
    })));
  } catch (err) {
    res.status(500).json({ error: 'ユーザー一覧取得エラー' });
  }
});

app.put('/api/users/me/settings', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const updates: Record<string, any> = {};
    if (req.body?.classNo !== undefined) {
      const classNo = req.body.classNo === null ? null : parseClassNo(req.body.classNo);
      if (req.body.classNo !== null && classNo === null) return res.status(400).json({ error: 'クラスは 1〜6 組から選んでください' });
      await pool.query(`UPDATE users SET class_no = $1 WHERE id = $2`, [classNo, req.user!.id]);
      broadcast({ type: 'USER_UPDATED', payload: { id: req.user!.id, class_no: classNo } });
      updates.class_no = classNo;
    }
    if (req.body?.preferences && typeof req.body.preferences === 'object') {
      const cur = (await pool.query(`SELECT preferences FROM users WHERE id = $1`, [req.user!.id])).rows[0]?.preferences || {};
      const nextPrefs = { ...cur, ...req.body.preferences };
      await pool.query(`UPDATE users SET preferences = $1 WHERE id = $2`, [JSON.stringify(nextPrefs), req.user!.id]);
      publish({ type: 'USER_PREFERENCES_UPDATED', payload: nextPrefs }, { targetUserId: req.user!.id });
      updates.preferences = nextPrefs;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: '変更する項目がありません' });
    res.json(updates);
  } catch (err) {
    res.status(500).json({ error: '設定の保存に失敗しました' });
  }
});

// アカウント同期設定 (異端末同期用)
app.get('/api/users/me/preferences', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const row = (await pool.query(`SELECT preferences FROM users WHERE id = $1`, [req.user!.id])).rows[0];
    res.json({ preferences: row?.preferences || {} });
  } catch (err) {
    res.status(500).json({ error: '設定の取得に失敗しました' });
  }
});

app.put('/api/users/me/preferences', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const patch = req.body?.preferences !== undefined ? req.body.preferences : req.body;
    if (!patch || typeof patch !== 'object') return res.status(400).json({ error: '設定データが不正です' });
    const cur = (await pool.query(`SELECT preferences FROM users WHERE id = $1`, [req.user!.id])).rows[0]?.preferences || {};
    const nextPrefs = { ...cur, ...patch };
    await pool.query(`UPDATE users SET preferences = $1 WHERE id = $2`, [JSON.stringify(nextPrefs), req.user!.id]);
    publish({ type: 'USER_PREFERENCES_UPDATED', payload: nextPrefs }, { targetUserId: req.user!.id, excludeConnId: getConnId(req) });
    res.json({ preferences: nextPrefs });
  } catch (err) {
    res.status(500).json({ error: '設定の保存に失敗しました' });
  }
});

// ロール管理 (adminのみ編集可能)
const DEFAULT_ROLE_DEFINITIONS = [
  { id: 'admin', name: '管理者', color: '#f43f5e', system: true },
  { id: 'member', name: 'メンバー', color: '#64748b', system: true },
  { id: 'leader', name: 'リーダー', color: '#f59e0b', system: false },
  { id: 'study', name: '学習班', color: '#10b981', system: false },
  { id: 'game', name: 'ゲーム部', color: '#6366f1', system: false },
];

async function getRoleDefinitions() {
  const raw = await getSetting('custom_role_definitions', '');
  if (!raw) return DEFAULT_ROLE_DEFINITIONS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (_) {}
  return DEFAULT_ROLE_DEFINITIONS;
}

app.get('/api/roles', authMiddleware, async (req, res) => {
  try {
    res.json({ roles: await getRoleDefinitions() });
  } catch (err) {
    res.status(500).json({ error: 'ロール定義の取得に失敗しました' });
  }
});

app.put('/api/roles', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    const cleaned = roles
      .map((r: any) => ({
        id: String(r.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, ''),
        name: String(r.name || '').trim().slice(0, 32),
        color: /^#[0-9a-fA-F]{6}$/.test(String(r.color || '')) ? String(r.color) : '#6366f1',
        system: r.id === 'admin' || r.id === 'member',
      }))
      .filter((r: any) => r.id && r.name);
    for (const def of DEFAULT_ROLE_DEFINITIONS.filter(d => d.system)) {
      if (!cleaned.some((c: any) => c.id === def.id)) cleaned.unshift(def);
    }
    await setSetting('custom_role_definitions', JSON.stringify(cleaned));
    broadcast({ type: 'ROLES_UPDATED', payload: cleaned });
    res.json({ roles: cleaned });
  } catch (err) {
    res.status(500).json({ error: 'ロール定義の保存に失敗しました' });
  }
});

app.put('/api/users/:id/roles', authMiddleware, adminOnly, async (req: AuthRequest, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const customRoles = Array.isArray(req.body?.custom_roles)
      ? req.body.custom_roles.map((r: any) => String(r).trim()).filter(Boolean)
      : [];
    const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'member' ? 'member' : undefined;
    if (role !== undefined) {
      if (role !== 'admin') {
        const cur = (await pool.query(`SELECT role FROM users WHERE id = $1`, [targetId])).rows[0];
        if (cur?.role === 'admin') {
          const adminCount = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'admin'`);
          if (parseInt(adminCount.rows[0].count, 10) <= 1) {
            return res.status(400).json({ error: '最後の管理者は降格できません' });
          }
        }
      }
      await pool.query(`UPDATE users SET role = $1, custom_roles = $2 WHERE id = $3`, [role, JSON.stringify(customRoles), targetId]);
    } else {
      await pool.query(`UPDATE users SET custom_roles = $1 WHERE id = $2`, [JSON.stringify(customRoles), targetId]);
    }
    const updated = (await pool.query(`SELECT id, username, role, custom_roles FROM users WHERE id = $1`, [targetId])).rows[0];
    broadcast({ type: 'USER_UPDATED', payload: { id: targetId, role: updated.role, custom_roles: updated.custom_roles } });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'ロール更新に失敗しました' });
  }
});

// カスタム絵文字 (:example: 形式 & アップロード)
async function ensureDefaultCustomEmojis() {
  try {
    const swimFile = path.join(UPLOAD_DIR, 'emoji-swim.svg');
    if (!fs.existsSync(swimFile)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="26" fill="url(#g)"/>
  <path d="M12 92 Q38 78 64 92 T116 92" fill="none" stroke="#bae6fd" stroke-width="8" stroke-linecap="round"/>
  <path d="M12 108 Q38 94 64 108 T116 108" fill="none" stroke="#e0f2fe" stroke-width="7" stroke-linecap="round"/>
  <text x="64" y="48" font-family="sans-serif" font-weight="900" font-size="34" text-anchor="middle" fill="#ffffff">SWIM</text>
  <text x="64" y="78" font-family="sans-serif" font-weight="900" font-size="27" text-anchor="middle" fill="#fef08a">しよ🏊</text>
</svg>`;
      fs.writeFileSync(swimFile, svg, 'utf8');
    }
    await pool.query(
      `INSERT INTO custom_emojis (name, url, created_by) VALUES ('swim', '/uploads/emoji-swim.svg', NULL) ON CONFLICT (name) DO NOTHING`
    );
  } catch (err) {
    console.error('Default emoji init error:', err);
  }
}

app.get('/api/emojis', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, url, created_by, created_at FROM custom_emojis ORDER BY name ASC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '絵文字一覧の取得に失敗しました' });
  }
});

app.post('/api/emojis', authMiddleware, upload.single('image'), async (req: AuthRequest, res) => {
  try {
    const rawName = String(req.body?.name || '').trim().toLowerCase().replace(/^:+|:+$/g, '');
    if (!/^[a-z0-9_-]{2,32}$/.test(rawName)) {
      return res.status(400).json({ error: '絵文字名は半角英数字・ハイフン・アンダースコア (2〜32文字) で指定してください' });
    }
    if (!req.file) return res.status(400).json({ error: '画像ファイルを選択してください' });
    const filename = `emoji-${rawName}-${Date.now()}.webp`;
    await sharp(req.file.buffer, { animated: true })
      .resize({ width: 128, height: 128, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85 })
      .toFile(path.join(UPLOAD_DIR, filename));
    const url = `/uploads/${filename}`;
    const result = await pool.query(
      `INSERT INTO custom_emojis (name, url, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET url = EXCLUDED.url, created_by = EXCLUDED.created_by
       RETURNING *`,
      [rawName, url, req.user!.id]
    );
    const saved = result.rows[0];
    broadcast({ type: 'EMOJI_UPDATED', payload: saved });
    res.json(saved);
  } catch (err: any) {
    console.error('Emoji upload error:', err);
    res.status(500).json({ error: '絵文字のアップロードに失敗しました' });
  }
});

app.delete('/api/emojis/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = (await pool.query(`SELECT * FROM custom_emojis WHERE id = $1`, [id])).rows[0];
    if (!cur) return res.status(404).json({ error: '絵文字が見つかりません' });
    if (cur.created_by !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'この絵文字を削除する権限がありません' });
    }
    await pool.query(`DELETE FROM custom_emojis WHERE id = $1`, [id]);
    broadcast({ type: 'EMOJI_DELETED', payload: { id, name: cur.name } });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: '絵文字の削除に失敗しました' });
  }
});

// AI会話スレッド履歴 (アカウント同期)
app.get('/api/ai/threads', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, title, persona, custom_persona, messages, updated_at, created_at
       FROM ai_threads WHERE user_id = $1 ORDER BY updated_at DESC, id DESC`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'AI履歴の取得に失敗しました' });
  }
});

app.post('/api/ai/threads', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const title = String(req.body?.title || '新しい会話').trim().slice(0, 120) || '新しい会話';
    const persona = String(req.body?.persona || 'default').trim().slice(0, 64);
    const customPersona = String(req.body?.custom_persona || '').trim().slice(0, 1000);
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const result = await pool.query(
      `INSERT INTO ai_threads (user_id, title, persona, custom_persona, messages)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user!.id, title, persona, customPersona, JSON.stringify(messages)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'AIスレッドの作成に失敗しました' });
  }
});

app.put('/api/ai/threads/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = (await pool.query(`SELECT * FROM ai_threads WHERE id = $1 AND user_id = $2`, [id, req.user!.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'AIスレッドが見つかりません' });
    const title = req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 120) || '新しい会話' : cur.title;
    const persona = req.body?.persona !== undefined ? String(req.body.persona).trim().slice(0, 64) : cur.persona;
    const customPersona = req.body?.custom_persona !== undefined ? String(req.body.custom_persona).trim().slice(0, 1000) : cur.custom_persona;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : cur.messages;
    const result = await pool.query(
      `UPDATE ai_threads SET title = $1, persona = $2, custom_persona = $3, messages = $4, updated_at = NOW()
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [title, persona, customPersona, JSON.stringify(messages), id, req.user!.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'AIスレッドの更新に失敗しました' });
  }
});

app.delete('/api/ai/threads/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM ai_threads WHERE id = $1 AND user_id = $2`, [id, req.user!.id]);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'AIスレッドの削除に失敗しました' });
  }
});

// アイコン画像 (正方形 256px の WebP に変換)
app.post('/api/users/me/avatar', authMiddleware, upload.single('image'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '画像ファイルが見つかりません' });
    const filename = `avatar-${req.user!.id}-${Date.now()}.webp`;
    await sharp(req.file.buffer, { animated: false })
      .resize({ width: 256, height: 256, fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(path.join(UPLOAD_DIR, filename));
    const avatarUrl = `/uploads/${filename}`;
    const prev = (await pool.query(`SELECT avatar_url FROM users WHERE id = $1`, [req.user!.id])).rows[0]?.avatar_url;
    await pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [avatarUrl, req.user!.id]);
    if (prev && String(prev).startsWith('/uploads/avatar-')) {
      fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(prev))).catch(() => {});
    }
    broadcast({ type: 'USER_UPDATED', payload: { id: req.user!.id, avatar_url: avatarUrl } });
    res.json({ avatar_url: avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'アイコンの保存に失敗しました' });
  }
});

app.delete('/api/users/me/avatar', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const prev = (await pool.query(`SELECT avatar_url FROM users WHERE id = $1`, [req.user!.id])).rows[0]?.avatar_url;
    await pool.query(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [req.user!.id]);
    if (prev && String(prev).startsWith('/uploads/avatar-')) {
      fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(prev))).catch(() => {});
    }
    broadcast({ type: 'USER_UPDATED', payload: { id: req.user!.id, avatar_url: null } });
    res.json({ avatar_url: null });
  } catch (err) {
    res.status(500).json({ error: 'アイコンの削除に失敗しました' });
  }
});

// カレンダー: 各自が予定を書き込み、全員で見られる
const formatEvent = (r: any) => ({
  ...r,
  event_date: r.event_date instanceof Date
    ? `${r.event_date.getFullYear()}-${String(r.event_date.getMonth() + 1).padStart(2, '0')}-${String(r.event_date.getDate()).padStart(2, '0')}`
    : String(r.event_date).slice(0, 10),
});

app.get('/api/calendar', authMiddleware, async (req, res) => {
  try {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: '期間 (from, to) を YYYY-MM-DD で指定してください' });
    }
    const result = await pool.query(
      `SELECT e.*, u.avatar_url FROM calendar_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.event_date BETWEEN $1::date AND $2::date ORDER BY e.event_date ASC, e.event_time ASC, e.id ASC`,
      [from, to]
    );
    res.json(result.rows.map(formatEvent));
  } catch (err) {
    res.status(500).json({ error: '予定の取得に失敗しました' });
  }
});

function parseEventBody(body: any) {
  const date = String(body?.date || '');
  const time = String(body?.time || '');
  const title = String(body?.title || '').trim().slice(0, 100);
  const note = String(body?.note || '').slice(0, 2000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '日付が正しくありません' };
  if (time && !/^\d{2}:\d{2}$/.test(time)) return { error: '時刻が正しくありません' };
  if (!title) return { error: '予定の名前を入力してください' };
  return { date, time, title, note };
}

app.post('/api/calendar', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ev = parseEventBody(req.body);
    if ('error' in ev) return res.status(400).json({ error: ev.error });
    const result = await pool.query(
      `INSERT INTO calendar_events (user_id, username, event_date, event_time, title, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user!.id, req.user!.username, ev.date, ev.time, ev.title, ev.note]
    );
    const created = formatEvent(result.rows[0]);
    broadcast({ type: 'CALENDAR_UPDATED', payload: created });
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: '予定の保存に失敗しました' });
  }
});

app.put('/api/calendar/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const current = (await pool.query(`SELECT * FROM calendar_events WHERE id = $1`, [id])).rows[0];
    if (!current) return res.status(404).json({ error: '予定が見つかりません' });
    if (current.user_id !== req.user!.id && req.user!.role !== 'admin') return res.status(403).json({ error: '他の人の予定は編集できません' });
    const ev = parseEventBody(req.body);
    if ('error' in ev) return res.status(400).json({ error: ev.error });
    const result = await pool.query(
      `UPDATE calendar_events SET event_date = $1, event_time = $2, title = $3, note = $4 WHERE id = $5 RETURNING *`,
      [ev.date, ev.time, ev.title, ev.note, id]
    );
    const updated = formatEvent(result.rows[0]);
    broadcast({ type: 'CALENDAR_UPDATED', payload: updated });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '予定の保存に失敗しました' });
  }
});

app.delete('/api/calendar/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const current = (await pool.query(`SELECT * FROM calendar_events WHERE id = $1`, [id])).rows[0];
    if (!current) return res.status(404).json({ error: '予定が見つかりません' });
    if (current.user_id !== req.user!.id && req.user!.role !== 'admin') return res.status(403).json({ error: '他の人の予定は削除できません' });
    await pool.query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
    broadcast({ type: 'CALENDAR_DELETED', payload: { id } });
    logAudit(req.user!, 'calendar_delete', 'calendar', id, { message: `予定「${current.title}」を削除`, date: formatEvent(current).event_date });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: '予定の削除に失敗しました' });
  }
});

// Delete user account (self or admin)
app.delete('/api/users/:userId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const targetUserId = parseInt(req.params.userId, 10);
    const requesterId = req.user!.id;
    const requesterRole = req.user!.role;

    if (requesterRole !== 'admin' && requesterId !== targetUserId) {
      return res.status(403).json({ error: 'アカウント削除の権限がありません' });
    }

    // Check if target is admin
    const targetUser = await pool.query(`SELECT id, username, role FROM users WHERE id = $1`, [targetUserId]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    if (targetUser.rows[0].role === 'admin') {
      const adminCount = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'admin'`);
      if (parseInt(adminCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: '最後の管理者は削除できません' });
      }
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [targetUserId]);
    broadcast({ type: 'USER_DELETED', payload: { userId: targetUserId } });
    logAudit(req.user!, 'user_delete', 'user', targetUserId, { message: `アカウント ${targetUser.rows[0].username} を削除` });
    res.json({ success: true, userId: targetUserId });
  } catch (err) {
    console.error('User delete error:', err);
    res.status(500).json({ error: 'アカウント削除に失敗しました' });
  }
});

// ==========================================================================
// Realtime Bus: WebSocket / SSE / Long-poll / Polling 共通のイベント配信
// - 全イベントに連番(seq)を振ってリングバッファに保持
// - どのトランスポートでも ?after=seq で取りこぼしなく追いつける
// - i-FILTER 等で WebSocket が通らない環境でも HTTP だけでリアルタイム動作
// ==========================================================================
interface RtEvent {
  seq: number;
  data: string; // JSON (seq込み)
  targetUserId?: number;
  excludeConnId?: string;
}

interface ClientInfo {
  ws: WebSocket;
  connId?: string;
  userId?: number;
  username?: string;
}

interface SseClient {
  res: Response;
  userId: number;
  connId: string;
}

interface Waiter {
  userId: number;
  connId: string;
  after: number;
  finish: () => void;
}

const BOOT_ID = Math.random().toString(36).slice(2, 10);
const EVENT_LOG_MAX = 3000;
const eventLog: RtEvent[] = [];
let eventSeq = 0;

const clients = new Map<WebSocket, ClientInfo>();
const aliveSockets = new WeakMap<WebSocket, boolean>();
const sseClients = new Set<SseClient>();
const waiters = new Set<Waiter>();

function eventVisibleTo(ev: RtEvent, userId: number, connId: string) {
  if (ev.targetUserId !== undefined && ev.targetUserId !== userId) return false;
  if (ev.excludeConnId && ev.excludeConnId === connId) return false;
  return true;
}

function publish(message: object, opts: { targetUserId?: number; excludeConnId?: string } = {}) {
  const seq = ++eventSeq;
  const ev: RtEvent = { seq, data: JSON.stringify({ ...message, seq }), ...opts };
  eventLog.push(ev);
  if (eventLog.length > EVENT_LOG_MAX) eventLog.splice(0, eventLog.length - EVENT_LOG_MAX);

  for (const [ws, info] of clients.entries()) {
    if (!info.userId || ws.readyState !== WebSocket.OPEN) continue;
    if (!eventVisibleTo(ev, info.userId, info.connId || '')) continue;
    try {
      ws.send(ev.data);
    } catch (err) {
      console.error('WS send error:', err);
    }
  }
  for (const c of sseClients) {
    if (!eventVisibleTo(ev, c.userId, c.connId)) continue;
    try {
      c.res.write(`id: ${seq}\ndata: ${ev.data}\n\n`);
    } catch (_) {}
  }
  for (const w of waiters) {
    if (eventVisibleTo(ev, w.userId, w.connId)) w.finish();
  }
}

function broadcast(message: object, excludeConnId?: string) {
  publish(message, { excludeConnId });
}

// after 以降で自分宛てのイベント。バッファ切れ/サーバー再起動なら reset=true
function eventsSince(after: number, boot: string | undefined, userId: number, connId: string) {
  const oldest = eventLog.length > 0 ? eventLog[0].seq : eventSeq + 1;
  const reset = (boot !== undefined && boot !== '' && boot !== BOOT_ID) || after > eventSeq || (after > 0 && after < oldest - 1);
  if (reset) return { reset: true, events: [] as string[] };
  const events: string[] = [];
  for (const ev of eventLog) {
    if (ev.seq > after && eventVisibleTo(ev, userId, connId)) events.push(ev.data);
  }
  return { reset: false, events };
}

// ---------------- Presence (WS/SSE接続数 + HTTPアクセス時刻) ----------------
interface Presence {
  connections: number;
  lastHttp: number;
  status: 'online' | 'away' | 'offline';
}
const presence = new Map<number, Presence>();
const PRESENCE_TIMEOUT_MS = 35000;

async function setUserStatus(userId: number, status: 'online' | 'away' | 'offline') {
  const p = presence.get(userId) || { connections: 0, lastHttp: 0, status: 'offline' as const };
  if (p.status === status) return;
  p.status = status;
  presence.set(userId, p);
  try {
    await pool.query(`UPDATE users SET status = $1, last_active_at = NOW() WHERE id = $2`, [status, userId]);
  } catch (_) {}
  broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId, status } });
}

function touchPresence(userId: number) {
  const p = presence.get(userId) || { connections: 0, lastHttp: 0, status: 'offline' as const };
  p.lastHttp = Date.now();
  presence.set(userId, p);
  if (p.status === 'offline') setUserStatus(userId, 'online');
}

function addConnection(userId: number) {
  const p = presence.get(userId) || { connections: 0, lastHttp: 0, status: 'offline' as const };
  p.connections++;
  p.lastHttp = Date.now();
  presence.set(userId, p);
  if (p.status === 'offline') setUserStatus(userId, 'online');
}

function removeConnection(userId: number) {
  const p = presence.get(userId);
  if (!p) return;
  p.connections = Math.max(0, p.connections - 1);
  // 即オフラインにせず、HTTP系トランスポートへの切替猶予を残す
  p.lastHttp = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, p] of presence.entries()) {
    if (p.status !== 'offline' && p.connections === 0 && now - p.lastHttp > PRESENCE_TIMEOUT_MS) {
      setUserStatus(userId, 'offline');
    }
  }
}, 10000);

// ---------------- クライアント→サーバー メッセージ (WS / HTTP 共通) ----------------
async function handleClientMessage(user: { id: number; username: string }, connId: string, msg: any) {
  if (msg.type === 'SEND_MESSAGE') {
    const { channelId, content, attachments, replyToId, clientNonce } = msg;
    const chRes = await pool.query(`SELECT * FROM channels WHERE id = $1`, [channelId]);
    if (chRes.rows.length > 0) {
      const uRes = await pool.query(`SELECT role, custom_roles FROM users WHERE id = $1`, [user.id]);
      const role = uRes.rows[0]?.role || 'member';
      const customRoles = Array.isArray(uRes.rows[0]?.custom_roles) ? uRes.rows[0].custom_roles : [];
      const userRoles = [role, ...customRoles];
      if (!checkChannelWritePermission(role === 'admin', userRoles, chRes.rows[0])) {
        return;
      }
    }
    const result = await pool.query(
      `INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [channelId, user.id, user.username, content, JSON.stringify(attachments || []), replyToId || null]
    );
    const [savedMessage] = await attachReplies([{ ...result.rows[0], sender_username: user.username, client_nonce: clientNonce || null }]);
    broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });
    const relayed = await relayMessage(savedMessage);
    if (String(content).includes('@everyone') && !relayed) {
      notifyImportant(`📢 ${user.username} から全員への連絡`, String(content));
    }

    replyAsGemini(channelId, savedMessage);
    return;
  }

  // Realtime text/markdown note sync (送信元タブ以外へ)
  if (msg.type === 'NOTE_CONTENT_SYNC') {
    const { slotIndex, content, title } = msg;
    broadcast({
      type: 'NOTE_CONTENT_SYNC',
      payload: { slotIndex, content, title, senderId: user.id, senderUsername: user.username },
    }, connId);
    return;
  }

  // WebRTC Signaling for Voice Chat & Screen Share (宛先ユーザーのみ)
  if (msg.type === 'WEBRTC_SIGNAL') {
    const { targetUserId, signal, channelId } = msg;
    publish({
      type: 'WEBRTC_SIGNAL',
      payload: { fromUserId: user.id, fromUsername: user.username, signal, channelId },
    }, { targetUserId: Number(targetUserId) });
    return;
  }

  if (msg.type === 'VC_JOIN' || msg.type === 'VC_LEAVE') {
    broadcast({
      type: msg.type === 'VC_JOIN' ? 'VC_USER_JOINED' : 'VC_USER_LEFT',
      payload: { userId: user.id, username: user.username, channelId: msg.channelId },
    });
    return;
  }

  if (msg.type === 'VC_STATE_CHANGE') {
    const { channelId, isMuted, isDeafened, isScreenSharing } = msg;
    broadcast({
      type: 'VC_STATE_CHANGED',
      payload: { userId: user.id, username: user.username, channelId, isMuted, isDeafened, isScreenSharing },
    });
    return;
  }

  // 入力中表示 (送信元タブ以外へ。古いものはクライアント側で捨てる)
  if (msg.type === 'TYPING') {
    publish({
      type: 'USER_TYPING',
      payload: { userId: user.id, username: user.username, channelId: Number(msg.channelId), t: Date.now() },
    }, { excludeConnId: connId });
    return;
  }

  if (msg.type === 'SET_STATUS') {
    const validStatus = msg.status === 'away' ? 'away' : 'online';
    touchPresence(user.id);
    await setUserStatus(user.id, validStatus);
  }
}

function verifyToken(token: string | undefined) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; username: string; role: string };
  } catch (_) {
    return null;
  }
}

function getConnId(req: Request) {
  return String(req.query.connId || req.headers['x-conn-id'] || '').slice(0, 64);
}

// 疎通確認・トランスポート情報
app.get('/api/rt/info', authMiddleware, (req: AuthRequest, res) => {
  touchPresence(req.user!.id);
  res.json({ boot: BOOT_ID, seq: eventSeq });
});

// Polling / Long-polling: GET /api/rt/poll?after=&boot=&wait=秒
app.get('/api/rt/poll', authMiddleware, (req: AuthRequest, res) => {
  const user = req.user!;
  const connId = getConnId(req);
  const after = parseInt(req.query.after as string, 10) || 0;
  const boot = req.query.boot as string | undefined;
  const wait = Math.min(Math.max(parseInt(req.query.wait as string, 10) || 0, 0), 25);
  touchPresence(user.id);
  res.setHeader('Cache-Control', 'no-store, no-transform');

  const reply = () => {
    const r = eventsSince(after, boot, user.id, connId);
    res.json({ boot: BOOT_ID, seq: eventSeq, reset: r.reset, events: r.events.map(e => JSON.parse(e)) });
  };

  const initial = eventsSince(after, boot, user.id, connId);
  if (wait === 0 || initial.reset || initial.events.length > 0) {
    reply();
    return;
  }

  let done = false;
  const waiter: Waiter = {
    userId: user.id,
    connId,
    after,
    finish: () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      waiters.delete(waiter);
      // 同時に発生したイベントをまとめて返すため少しだけ待つ
      setTimeout(() => {
        if (!res.writableEnded) reply();
      }, 15);
    },
  };
  const timer = setTimeout(() => waiter.finish(), wait * 1000);
  waiters.add(waiter);
  req.on('close', () => {
    if (!done) {
      done = true;
      clearTimeout(timer);
      waiters.delete(waiter);
    }
  });
});

// Server-Sent Events: GET /api/rt/stream?token=&after=&boot=&connId=
app.get('/api/rt/stream', (req, res) => {
  const user = verifyToken((req.query.token as string) || (req.headers.authorization || '').replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: '無効または期限切れのトークンです' });
  const connId = getConnId(req);
  const after = parseInt((req.query.after as string) || (req.headers['last-event-id'] as string), 10) || 0;
  const boot = req.query.boot as string | undefined;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);

  // 中間プロキシのバッファリング対策のパディング
  res.write(`:${' '.repeat(2048)}\n\n`);
  res.write(`retry: 2000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ boot: BOOT_ID, seq: eventSeq })}\n\n`);

  const r = eventsSince(after, boot, user.id, connId);
  if (r.reset) {
    res.write(`event: reset\ndata: ${JSON.stringify({ boot: BOOT_ID, seq: eventSeq })}\n\n`);
  } else {
    for (const e of r.events) res.write(`data: ${e}\n\n`);
  }

  const client: SseClient = { res, userId: user.id, connId };
  sseClients.add(client);
  addConnection(user.id);

  const ping = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(client);
    removeConnection(user.id);
  });
});

// HTTP経由でのクライアントメッセージ送信 (WS不通時)
app.post('/api/rt/send', authMiddleware, async (req: AuthRequest, res) => {
  try {
    touchPresence(req.user!.id);
    await handleClientMessage(req.user!, getConnId(req), req.body || {});
    res.json({ ok: true });
  } catch (err) {
    console.error('RT send error:', err);
    res.status(500).json({ error: '送信エラー' });
  }
});

// ---------------- WebSocket ----------------
// Server-side heartbeat: detect half-open connections dropped by proxies/tunnels
const wsHeartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (aliveSockets.get(ws) === false) {
      ws.terminate();
      continue;
    }
    aliveSockets.set(ws, false);
    try {
      ws.ping();
    } catch (_) {}
  }
}, 25000);
wss.on('close', () => clearInterval(wsHeartbeat));

wss.on('connection', (ws: WebSocket) => {
  clients.set(ws, { ws });
  aliveSockets.set(ws, true);
  ws.on('pong', () => aliveSockets.set(ws, true));
  ws.on('error', (err) => console.error('WS socket error:', err.message));

  ws.on('message', async (data: string) => {
    aliveSockets.set(ws, true);
    try {
      const msg = JSON.parse(data.toString());

      // Application-level heartbeat (keeps proxies from idling out & lets client detect dead links)
      if (msg.type === 'PING') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PONG', t: msg.t || Date.now() }));
        return;
      }

      if (msg.type === 'AUTH') {
        const decoded = verifyToken(msg.token);
        if (!decoded) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'AUTH_ERROR' }));
          return;
        }
        const prev = clients.get(ws);
        if (prev?.userId) removeConnection(prev.userId);
        const connId = String(msg.connId || '').slice(0, 64);
        clients.set(ws, { ws, connId, userId: decoded.id, username: decoded.username });
        addConnection(decoded.id);

        // 取りこぼし分を返してから AUTH_OK
        const after = Number(msg.after) || 0;
        const r = eventsSince(after, msg.boot, decoded.id, connId);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'AUTH_OK', payload: { userId: decoded.id, boot: BOOT_ID, seq: eventSeq, reset: r.reset } }));
          if (!r.reset) for (const e of r.events) ws.send(e);
        }
        return;
      }

      const clientInfo = clients.get(ws);
      if (!clientInfo || !clientInfo.userId) return;
      await handleClientMessage({ id: clientInfo.userId, username: clientInfo.username || '' }, clientInfo.connId || '', msg);
    } catch (err) {
      console.error('WS Message error:', err);
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    clients.delete(ws);
    if (info && info.userId) removeConnection(info.userId);
  });
});

// ---------------- 容量の掃除 ----------------
// Discord に転送されているチャンネルのメッセージだけ、保存期間を過ぎたら削除する (ピン留めは残す)
const DEFAULT_RETENTION_DAYS = 30;
const RETENTION_CHOICES = [0, 7, 14, 30, 60, 90];
const NOTE_HISTORY_KEEP = 30;
const AUDIT_LOG_DAYS = 180;
const HOMEWORK_KEEP_DAYS = 60;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

// メッセージが Discord に残る (Bot同期 or メッセージ Webhook) チャンネル
async function discordMirroredChannelIds(): Promise<number[]> {
  if ((await getSetting('notify_messages_enabled', 'on')) !== 'on') return [];
  if (await getSetting('discord_message_webhook_url', '')) {
    return (await pool.query(`SELECT id FROM channels`)).rows.map(r => r.id);
  }
  return getBoundAsdfChannelIds();
}

async function retentionSummary() {
  let last = null;
  try { last = JSON.parse(await getSetting('chat_retention_last', 'null')); } catch (_) {}
  const ids = await discordMirroredChannelIds();
  const names = ids.length
    ? (await pool.query(`SELECT name FROM channels WHERE id = ANY($1::int[]) ORDER BY position ASC, id ASC`, [ids])).rows.map(r => r.name)
    : [];
  return { channels: names, last };
}

// 削除したメッセージが使っていた画像のうち、どこからも参照されなくなったものを消す
async function removeUnreferencedUploads(contents: string[]) {
  const names = new Set<string>();
  for (const c of contents) {
    for (const m of c.matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)) {
      if (!m[1].startsWith('avatar-')) names.add(m[1]);
    }
  }
  let removed = 0;
  for (const name of names) {
    const ref = `%/uploads/${name}%`;
    const used = await pool.query(
      `SELECT 1 FROM messages WHERE content LIKE $1
       UNION ALL SELECT 1 FROM notes WHERE content LIKE $1
       UNION ALL SELECT 1 FROM users WHERE avatar_url LIKE $1 LIMIT 1`,
      [ref]
    );
    if (used.rows.length > 0) continue;
    try {
      await fs.promises.unlink(path.join(UPLOAD_DIR, name));
      removed++;
    } catch (_) {}
  }
  return removed;
}

let retentionRunning = false;
async function runRetention() {
  if (retentionRunning) return;
  retentionRunning = true;
  try {
    const days = Number(await getSetting('chat_retention_days', String(DEFAULT_RETENTION_DAYS)));
    let deletedMessages = 0;
    let deletedFiles = 0;
    if (days > 0) {
      const channelIds = await discordMirroredChannelIds();
      if (channelIds.length > 0) {
        // 一度に消しすぎて DB を止めないよう 500 件ずつ
        for (;;) {
          const del = await pool.query(
            `DELETE FROM messages WHERE id IN (
               SELECT id FROM messages
               WHERE channel_id = ANY($1::int[]) AND is_pinned = FALSE AND created_at < NOW() - make_interval(days => $2)
               ORDER BY id LIMIT 500
             ) RETURNING content`,
            [channelIds, days]
          );
          if (del.rows.length === 0) break;
          deletedMessages += del.rows.length;
          deletedFiles += await removeUnreferencedUploads(del.rows.map(r => r.content));
        }
      }
    }
    // メモの変更履歴は読まれていないので、各メモ直近だけ残す
    await pool.query(
      `DELETE FROM note_history WHERE id IN (
         SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY slot_index ORDER BY id DESC) AS rn FROM note_history) t
         WHERE rn > $1
       )`,
      [NOTE_HISTORY_KEEP]
    );
    await pool.query(`DELETE FROM audit_logs WHERE created_at < NOW() - make_interval(days => $1)`, [AUDIT_LOG_DAYS]);
    await pool.query(`DELETE FROM homework WHERE due_date < (NOW() AT TIME ZONE 'Asia/Tokyo')::date - $1::int`, [HOMEWORK_KEEP_DAYS]);
    await setSetting('chat_retention_last', JSON.stringify({ at: new Date().toISOString(), messages: deletedMessages, files: deletedFiles }));
    if (deletedMessages > 0) console.log(`[retention] deleted ${deletedMessages} messages, ${deletedFiles} files`);
  } finally {
    retentionRunning = false;
  }
}

setTimeout(() => {
  runRetention().catch(err => console.error('Retention error:', err.message));
  setInterval(() => runRetention().catch(err => console.error('Retention error:', err.message)), RETENTION_INTERVAL_MS);
}, 2 * 60 * 1000);

server.listen(PORT, async () => {
  console.log(`[asdfbase-backend] Server listening on http://127.0.0.1:${PORT}`);
  try {
    await initDb();
    // 再起動直後は全員オフライン扱いにし、接続/アクセスで復帰させる
    await pool.query(`UPDATE users SET status = 'offline'`);
    await ensureNoteSlots();
    await ensureDefaultCustomEmojis();
  } catch (err) {
    console.error('DB Init failed:', err);
  }
  try {
    await startDiscordBot({
      getSetting,
      setSetting,
      listAsdfChannels: async () => (await pool.query(`SELECT id, name, type, server_id FROM channels ORDER BY position ASC, id ASC`)).rows,
      isDiscordMessageSynced: async (discordMessageId) => {
        const res = await pool.query(`SELECT 1 FROM discord_message_links WHERE discord_message_id = $1 LIMIT 1`, [discordMessageId]);
        return res.rows.length > 0;
      },
      ingest: async (asdfChannelId, username, content, meta) => {
        if (meta.discordMessageId) {
          const existing = await pool.query(
            `SELECT 1 FROM discord_message_links WHERE discord_message_id = $1 LIMIT 1`,
            [meta.discordMessageId]
          );
          if (existing.rows.length > 0) return;
        }
        let replyToId: number | null = null;
        if (meta.replyToDiscordMsgId) {
          const link = await pool.query(
            `SELECT asdf_message_id FROM discord_message_links WHERE discord_message_id = $1 LIMIT 1`,
            [meta.replyToDiscordMsgId]
          );
          if (link.rows.length > 0) {
            replyToId = link.rows[0].asdf_message_id;
          }
        }
        const result = meta.createdAt
          ? await pool.query(
              `INSERT INTO messages (channel_id, user_id, username, content, author_avatar, reply_to_id, created_at) VALUES ($1, NULL, $2, $3, $4, $5, $6) RETURNING *`,
              [asdfChannelId, username, content, meta.avatarUrl, replyToId, meta.createdAt]
            )
          : await pool.query(
              `INSERT INTO messages (channel_id, user_id, username, content, author_avatar, reply_to_id) VALUES ($1, NULL, $2, $3, $4, $5) RETURNING *`,
              [asdfChannelId, username, content, meta.avatarUrl, replyToId]
            );
        const saved = result.rows[0];
        if (meta.discordMessageId) {
          await pool.query(
            `INSERT INTO discord_message_links (asdf_message_id, discord_channel_id, discord_message_id, direction)
             VALUES ($1, $2, $3, 'in') ON CONFLICT DO NOTHING`,
            [saved.id, meta.discordChannelId, meta.discordMessageId]
          );
        }
        const [attached] = await attachReplies([{ ...saved, sender_username: username }]);
        broadcast({ type: 'NEW_MESSAGE', payload: attached });
      },
      ingestEdit: async (discordMessageId, content) => {
        const rows = (await pool.query(
          `UPDATE messages m SET content = $1, updated_at = NOW(), edited_at = NOW()
           FROM discord_message_links l
           WHERE l.discord_message_id = $2 AND l.direction = 'in' AND l.asdf_message_id = m.id AND m.content IS DISTINCT FROM $1
           RETURNING m.*`,
          [content, discordMessageId]
        )).rows;
        for (const r of rows) {
          const [updated] = await attachReplies([{ ...r, sender_username: r.username }]);
          broadcast({ type: 'MESSAGE_UPDATED', payload: updated });
        }
      },
      ingestDelete: async (discordMessageId) => {
        const links = (await pool.query(
          `SELECT asdf_message_id FROM discord_message_links WHERE discord_message_id = $1`,
          [discordMessageId]
        )).rows;
        for (const l of links) {
          const cur = await pool.query(`SELECT id, content FROM messages WHERE id = $1`, [l.asdf_message_id]);
          if (cur.rows.length === 0) continue;
          const originalContent = cur.rows[0].content;
          if (originalContent.includes('*(Discordで削除されました)*')) continue;
          const newContent = `~~${originalContent}~~ *(Discordで削除されました)*`;
          const updated = (await pool.query(
            `UPDATE messages SET content = $1, updated_at = NOW(), edited_at = NOW() WHERE id = $2 RETURNING *`,
            [newContent, l.asdf_message_id]
          )).rows;
          for (const r of updated) {
            const [attached] = await attachReplies([{ ...r, sender_username: r.username }]);
            broadcast({ type: 'MESSAGE_UPDATED', payload: attached });
          }
        }
      },
      ingestReaction: async (discordMessageId, emoji, discordUserId, action) => {
        const links = (await pool.query(
          `SELECT asdf_message_id FROM discord_message_links WHERE discord_message_id = $1`,
          [discordMessageId]
        )).rows;
        // 負の整数IDを生成して既存ユーザーと衝突防止
        const pseudoUserId = -Math.abs(Array.from(discordUserId).reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0));
        for (const l of links) {
          const msgRes = await pool.query(`SELECT reactions FROM messages WHERE id = $1`, [l.asdf_message_id]);
          if (msgRes.rows.length === 0) continue;
          const reactions = msgRes.rows[0].reactions || {};
          const users = reactions[emoji] || [];
          if (action === 'add') {
            if (!users.includes(pseudoUserId)) {
              reactions[emoji] = [...users, pseudoUserId];
            }
          } else {
            reactions[emoji] = users.filter((u: number) => u !== pseudoUserId);
            if (reactions[emoji].length === 0) delete reactions[emoji];
          }
          const updated = await pool.query(
            `UPDATE messages SET reactions = $1 WHERE id = $2 RETURNING *`,
            [JSON.stringify(reactions), l.asdf_message_id]
          );
          broadcast({
            type: 'MESSAGE_REACTION_UPDATED',
            payload: { messageId: l.asdf_message_id, reactions: updated.rows[0].reactions },
          });
        }
      },
      syncPinsForChannel: async (discordChannelId, pinnedDiscordMsgIds) => {
        const links = (await pool.query(
          `SELECT asdf_message_id, discord_message_id FROM discord_message_links WHERE discord_channel_id = $1`,
          [discordChannelId]
        )).rows;
        for (const l of links) {
          const shouldBePinned = pinnedDiscordMsgIds.includes(l.discord_message_id);
          const updated = (await pool.query(
            `UPDATE messages SET is_pinned = $1 WHERE id = $2 AND is_pinned IS DISTINCT FROM $1 RETURNING *`,
            [shouldBePinned, l.asdf_message_id]
          )).rows;
          for (const r of updated) {
            const [pinned] = await attachReplies([r]);
            broadcast({ type: 'MESSAGE_PIN_UPDATED', payload: pinned });
          }
        }
      },
      onVoiceStatusUpdate: (vcs) => {
        lastDiscordVoiceStatus = vcs;
        broadcast({ type: 'DISCORD_VOICE_STATUS', payload: vcs });
      },
      notifyImportant: (title, body) => {
        notifyImportant(title, body);
      },
      onTyping: (asdfChannelId, discordUserId, username) => {
        broadcast({
          type: 'USER_TYPING',
          payload: {
            userId: `discord-${discordUserId}`,
            username,
            channelId: asdfChannelId,
            t: Date.now(),
          },
        });
      },
      saveImage: async (buf) => {
        const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.webp`;
        await sharp(buf, { animated: false }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(UPLOAD_DIR, filename));
        return `/uploads/${filename}`;
      },
      saveFile: async (buf, originalName) => {
        const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}-${safeName}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
        return `/uploads/${filename}`;
      },
      saveAvatar: async (key, url) => {
        // ブラウザから Discord の CDN を直接読まないよう、サーバーに保存してから使う
        const filename = `discord-avatar-${key.replace(/[^A-Za-z0-9_-]/g, '')}.webp`;
        const file = path.join(UPLOAD_DIR, filename);
        if (!fs.existsSync(file)) {
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          await sharp(buf, { animated: false }).resize({ width: 96, height: 96, fit: 'cover' }).webp({ quality: 80 }).toFile(file);
        }
        return `/uploads/${filename}`;
      },
      uploadDir: UPLOAD_DIR,
      audit: (action, details) => logAudit(null, action, 'discord', null, details),
    });
  } catch (err) {
    console.error('Discord bot start failed:', err);
  }
});
