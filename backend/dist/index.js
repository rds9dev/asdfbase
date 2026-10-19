"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.getDiscordWebhookUrl = getDiscordWebhookUrl;
exports.notifyImportant = notifyImportant;
exports.relayMessage = relayMessage;
exports.logAudit = logAudit;
exports.authMiddleware = authMiddleware;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dns_1 = __importDefault(require("dns"));
const db_js_1 = require("./db.js");
const gemini_js_1 = require("./gemini.js");
const discord_js_1 = require("./discord.js");
const schedule_js_1 = require("./schedule.js");
dotenv_1.default.config();
// VPS は IPv6 の外向き通信が通らないため IPv4 を優先 (天気API等の ETIMEDOUT 対策)
dns_1.default.setDefaultResultOrder('ipv4first');
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
const PORT = process.env.PORT || 8091;
const JWT_SECRET = process.env.JWT_SECRET || 'asdfbase_jwt_super_secret_key_2026_x89q';
const INVITE_CODE = process.env.INVITE_CODE || 'ASDF';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
// ---------------- System settings helpers ----------------
async function getSetting(key, fallback = '') {
    try {
        const res = await db_js_1.pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
        if (res.rows.length > 0 && res.rows[0].value !== null)
            return res.rows[0].value;
    }
    catch (_) { }
    return fallback;
}
async function setSetting(key, value) {
    await db_js_1.pool.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, value]);
}
// 重要通知用 Webhook (従来の discord_webhook_url をそのまま重要通知専用として使う)
async function getDiscordWebhookUrl() {
    return getSetting('discord_webhook_url', DISCORD_WEBHOOK_URL);
}
async function postWebhook(url, body, files = []) {
    if (files.length === 0) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            throw new Error(`Discord webhook HTTP ${res.status}`);
        return;
    }
    const form = new FormData();
    form.append('payload_json', JSON.stringify(body));
    files.forEach((f, i) => form.append(`files[${i}]`, new Blob([fs_1.default.readFileSync(f)]), path_1.default.basename(f)));
    const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    if (!res.ok)
        throw new Error(`Discord webhook HTTP ${res.status}`);
}
// 重要な通知 (提出物・@everyone・ピン留め等) → 重要通知 Webhook
async function notifyImportant(title, description, color = 0xf59e0b) {
    try {
        if ((await getSetting('notify_important_enabled', 'on')) !== 'on')
            return;
        const url = await getDiscordWebhookUrl();
        if (!url)
            return;
        await postWebhook(url, {
            username: 'asdfbase 重要通知',
            embeds: [{ title: title.slice(0, 256), description: description.slice(0, 4000), color, timestamp: new Date().toISOString() }],
            allowed_mentions: { parse: [] },
        });
    }
    catch (err) {
        console.error('notifyImportant error:', err.message);
    }
}
// 通常メッセージの Discord 転送: Bot 連携があれば Bot、なければメッセージ用 Webhook
async function relayMessage(msg) {
    try {
        const username = msg.sender_username || msg.username || 'unknown';
        if (username.startsWith('[Discord]'))
            return; // Discord から来たものは戻さない
        if ((await getSetting('notify_messages_enabled', 'on')) !== 'on')
            return;
        if (await (0, discord_js_1.relayToDiscordBot)(msg.channel_id, username, msg.content))
            return;
        const url = await getSetting('discord_message_webhook_url', '');
        if (!url)
            return;
        const files = [];
        const text = msg.content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, (_m, p) => {
            const f = path_1.default.join(UPLOAD_DIR, path_1.default.basename(p));
            if (fs_1.default.existsSync(f))
                files.push(f);
            return '';
        }).trim();
        await postWebhook(url, { username: `[asdfbase] ${username}`, content: text || undefined, allowed_mentions: { parse: [] } }, files);
    }
    catch (err) {
        console.error('relayMessage error:', err.message);
    }
}
// ---------------- Audit log ----------------
function requestMeta(req) {
    const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return {
        ip: fwd || req.socket.remoteAddress || '',
        userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    };
}
function logAudit(user, action, targetType, targetId, details, canRestore = false) {
    db_js_1.pool.query(`INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details, can_restore)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`, [user?.id || null, user?.username || 'system', action, targetType, targetId, JSON.stringify(details), canRestore]).catch(err => console.error('Audit log error:', err.message));
}
const UPLOAD_DIR = path_1.default.resolve('uploads');
if (!fs_1.default.existsSync(UPLOAD_DIR)) {
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use((0, cors_1.default)({ origin: '*' }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use('/uploads', express_1.default.static(UPLOAD_DIR));
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
});
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '認証トークンがありません' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (err) {
        return res.status(401).json({ error: '無効または期限切れのトークンです' });
    }
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
let weatherCache = null;
function getWeatherDescription(code) {
    if (code === 0)
        return '快晴';
    if (code === 1)
        return '晴れ';
    if (code === 2)
        return '一部曇';
    if (code === 3)
        return '曇り';
    if (code === 45 || code === 48)
        return '霧';
    if (code >= 51 && code <= 57)
        return '霧雨';
    if (code >= 61 && code <= 67)
        return '雨';
    if (code >= 71 && code <= 77)
        return '雪';
    if (code >= 80 && code <= 82)
        return 'にわか雨';
    if (code >= 85 && code <= 86)
        return '雪';
    if (code >= 95)
        return '雷雨';
    return '晴れ';
}
async function fetchJson(url, timeoutMs = 6000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return res.json();
}
const roundOrNull = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
async function fetchWeatherOpenMeteo() {
    const data = await fetchJson('https://api.open-meteo.com/v1/forecast?latitude=34.34&longitude=134.04' +
        '&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature,wind_speed_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
        '&hourly=temperature_2m,weather_code,precipitation_probability' +
        '&forecast_days=7&timezone=Asia%2FTokyo&wind_speed_unit=ms');
    const code = Number(data.current.weather_code);
    const d = data.daily || {};
    const daily = (d.time || []).map((date, i) => ({
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
    const startIdx = Math.max(0, (h.time || []).findIndex((t) => t.slice(0, 13) === nowKey));
    const hourly = (h.time || []).slice(startIdx, startIdx + 24).map((time, i) => ({
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
const jmaDesc = (text) => text.includes('雪') ? '雪' : text.includes('雷') ? '雷雨' : text.startsWith('雨') ? '雨'
    : text.startsWith('くもり') ? '曇り' : text.startsWith('晴') ? '晴れ' : (text.split(/\s/)[0] || '不明');
const jmaCode = (desc) => desc === '晴れ' ? 1 : desc === '曇り' ? 3 : desc === '雨' ? 61 : desc === '雪' ? 71 : desc === '雷雨' ? 95 : 2;
// 気象庁 (香川県) — open-meteo が落ちている時の予備
async function fetchWeatherJma() {
    const data = await fetchJson('https://www.jma.go.jp/bosai/forecast/data/forecast/370000.json');
    const series = data[0].timeSeries;
    const weatherText = series[0].areas[0].weathers?.[0] || '';
    const pops = series[1]?.areas?.[0]?.pops || [];
    const temps = series[2]?.areas?.[0]?.temps || [];
    const desc = jmaDesc(weatherText);
    const nums = temps.map(Number).filter(n => Number.isFinite(n));
    const popNums = pops.map(Number).filter(n => Number.isFinite(n));
    // 週間予報
    const daily = [];
    const week = data[1]?.timeSeries;
    if (week) {
        const times = week[0]?.timeDefines || [];
        const codes = week[0]?.areas?.[0]?.weatherCodes || [];
        const wpops = week[0]?.areas?.[0]?.pops || [];
        const tmax = week[1]?.areas?.[0]?.tempsMax || [];
        const tmin = week[1]?.areas?.[0]?.tempsMin || [];
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
let weatherInFlight = null;
async function getWeather() {
    if (weatherCache && Date.now() - weatherCache.updatedAt < 10 * 60 * 1000)
        return weatherCache;
    if (weatherInFlight)
        return weatherInFlight;
    weatherInFlight = (async () => {
        try {
            weatherCache = await fetchWeatherOpenMeteo();
        }
        catch (err) {
            console.warn('open-meteo failed, falling back to JMA:', err.message);
            try {
                weatherCache = await fetchWeatherJma();
            }
            catch (err2) {
                console.warn('JMA weather failed:', err2.message);
                if (!weatherCache) {
                    return { temp: 20, desc: '取得失敗', weatherCode: -1, tempMax: null, tempMin: null, precipProb: null, daily: [], hourly: [], source: 'fallback', updatedAt: 0 };
                }
            }
        }
        return weatherCache;
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
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const result = await db_js_1.pool.query(`INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role, status`, [username, passwordHash]);
        const user = result.rows[0];
        const token = jsonwebtoken_1.default.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
            expiresIn: '30d',
        });
        await db_js_1.pool.query(`INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details) 
       VALUES ($1, $2, 'register', 'user', $3, $4)`, [user.id, user.username, user.id, JSON.stringify({ message: '新規ユーザー登録' })]);
        ensureNoteSlots().catch(err => console.error('Note slot ensure error:', err.message));
        res.json({ token, user });
    }
    catch (err) {
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
        const result = await db_js_1.pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        }
        const user = result.rows[0];
        const isMatch = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!isMatch) {
            logAudit({ id: user.id, username: user.username }, 'login_failed', 'user', user.id, {
                message: 'ログイン失敗 (パスワード不一致)',
                ...requestMeta(req),
            });
            return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        }
        logAudit({ id: user.id, username: user.username }, 'login', 'user', user.id, { message: 'ログイン', ...requestMeta(req) });
        const token = jsonwebtoken_1.default.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
            expiresIn: '30d',
        });
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                status: user.status,
                custom_status: user.custom_status,
                avatar_url: user.avatar_url,
            },
        });
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'ログインに失敗しました' });
    }
});
// Current User Profile
app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT id, username, role, status, custom_status, avatar_url, created_at FROM users WHERE id = $1`, [req.user.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: 'プロフィール取得エラー' });
    }
});
// Image Upload with Auto-WebP Compression
app.post('/api/upload', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '画像ファイルが見つかりません' });
        }
        const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.webp`;
        const outputPath = path_1.default.join(UPLOAD_DIR, filename);
        await (0, sharp_1.default)(req.file.buffer)
            .resize({ width: 1600, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(outputPath);
        const imageUrl = `/uploads/${filename}`;
        res.json({ url: imageUrl, filename });
    }
    catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: '画像の圧縮保存に失敗しました' });
    }
});
// Channels API
app.get('/api/channels', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT * FROM channels ORDER BY position ASC, id ASC`);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'チャンネル取得エラー' });
    }
});
app.post('/api/channels', authMiddleware, async (req, res) => {
    try {
        const { name, type } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'チャンネル名を入力してください' });
        }
        const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
        const chType = type === 'voice' ? 'voice' : 'text';
        const maxPosRes = await db_js_1.pool.query(`SELECT COALESCE(MAX(position), 0) as max_pos FROM channels`);
        const nextPos = parseInt(maxPosRes.rows[0].max_pos, 10) + 1;
        const result = await db_js_1.pool.query(`INSERT INTO channels (name, type, position) VALUES ($1, $2, $3) RETURNING *`, [cleanName, chType, nextPos]);
        const newChannel = result.rows[0];
        broadcast({ type: 'CHANNEL_CREATED', payload: newChannel });
        logAudit(req.user, 'channel_create', 'channel', newChannel.id, { message: `チャンネル #${newChannel.name} を作成` });
        (0, discord_js_1.refreshDiscordCommands)();
        res.json(newChannel);
    }
    catch (err) {
        console.error('Channel create error:', err);
        res.status(500).json({ error: 'チャンネル作成に失敗しました' });
    }
});
app.put('/api/channels/reorder', authMiddleware, async (req, res) => {
    try {
        const { channelIds } = req.body;
        if (!Array.isArray(channelIds)) {
            return res.status(400).json({ error: 'channelIds配列が必要です' });
        }
        for (let i = 0; i < channelIds.length; i++) {
            await db_js_1.pool.query(`UPDATE channels SET position = $1 WHERE id = $2`, [i, channelIds[i]]);
        }
        const updated = await db_js_1.pool.query(`SELECT * FROM channels ORDER BY position ASC, id ASC`);
        broadcast({ type: 'CHANNELS_REORDERED', payload: updated.rows });
        res.json(updated.rows);
    }
    catch (err) {
        console.error('Channel reorder error:', err);
        res.status(500).json({ error: 'チャンネル順序の変更に失敗しました' });
    }
});
app.delete('/api/channels/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const countRes = await db_js_1.pool.query(`SELECT COUNT(*) FROM channels`);
        if (parseInt(countRes.rows[0].count, 10) <= 1) {
            return res.status(400).json({ error: '最後のチャンネルは削除できません' });
        }
        const delRes = await db_js_1.pool.query(`DELETE FROM channels WHERE id = $1 RETURNING name`, [id]);
        broadcast({ type: 'CHANNEL_DELETED', payload: { id } });
        logAudit(req.user, 'channel_delete', 'channel', id, { message: `チャンネル #${delRes.rows[0]?.name || id} を削除` });
        (0, discord_js_1.refreshDiscordCommands)();
        res.json({ success: true, id });
    }
    catch (err) {
        console.error('Channel delete error:', err);
        res.status(500).json({ error: 'チャンネル削除に失敗しました' });
    }
});
// 返信先メッセージの概要を付与
async function attachReplies(rows) {
    const ids = Array.from(new Set(rows.map(r => r.reply_to_id).filter((v) => typeof v === 'number')));
    if (ids.length === 0)
        return rows;
    const res = await db_js_1.pool.query(`SELECT m.id, m.content, m.user_id, COALESCE(u.username, m.username) AS username
     FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ANY($1::int[])`, [ids]);
    const map = new Map(res.rows.map(r => [r.id, { id: r.id, username: r.username, user_id: r.user_id, content: String(r.content || '').slice(0, 200) }]));
    return rows.map(r => (r.reply_to_id ? { ...r, reply_to: map.get(r.reply_to_id) || { id: r.reply_to_id, deleted: true } } : r));
}
// Messages API (supports pagination: limit & beforeId)
app.get('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId, 10);
        const limit = parseInt(req.query.limit, 10) || 50;
        const beforeId = req.query.beforeId ? parseInt(req.query.beforeId, 10) : null;
        let query = `
      SELECT m.*, u.username as sender_username 
      FROM messages m 
      LEFT JOIN users u ON m.user_id = u.id 
      WHERE m.channel_id = $1 
    `;
        const params = [channelId];
        const afterId = req.query.afterId ? parseInt(req.query.afterId, 10) : null;
        if (afterId) {
            // Catch-up fetch (reconnect / polling fallback): ascending order
            query += ` AND m.id > $2 ORDER BY m.id ASC LIMIT $3`;
            params.push(afterId, Math.min(limit, 200));
            const result = await db_js_1.pool.query(query, params);
            return res.json(await attachReplies(result.rows));
        }
        else if (beforeId) {
            query += ` AND m.id < $2 ORDER BY m.id DESC LIMIT $3`;
            params.push(beforeId, limit);
        }
        else {
            query += ` ORDER BY m.id DESC LIMIT $2`;
            params.push(limit);
        }
        const result = await db_js_1.pool.query(query, params);
        res.json(await attachReplies(result.rows.reverse()));
    }
    catch (err) {
        res.status(500).json({ error: 'メッセージ取得エラー' });
    }
});
// Cross-channel catch-up: messages newer than afterId (used by WS reconnect & polling fallback)
app.get('/api/messages/since', authMiddleware, async (req, res) => {
    try {
        const afterId = parseInt(req.query.afterId, 10) || 0;
        const result = await db_js_1.pool.query(`SELECT m.*, u.username as sender_username
       FROM messages m
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.id > $1
       ORDER BY m.id ASC
       LIMIT 200`, [afterId]);
        res.json(await attachReplies(result.rows));
    }
    catch (err) {
        res.status(500).json({ error: 'メッセージ同期エラー' });
    }
});
// Unread counts per channel based on client's last-read message ids
app.post('/api/channels/unread-counts', authMiddleware, async (req, res) => {
    try {
        const lastRead = req.body?.lastRead || {};
        const channelIds = [];
        const lastReadIds = [];
        for (const [ch, id] of Object.entries(lastRead)) {
            const chNum = parseInt(ch, 10);
            const idNum = Number(id);
            if (Number.isFinite(chNum) && Number.isFinite(idNum)) {
                channelIds.push(chNum);
                lastReadIds.push(idNum);
            }
        }
        // unread: 自分以外の未読 / mentions: そのうち自分宛て (@名前・@everyone・自分への返信)
        const result = await db_js_1.pool.query(`SELECT m.channel_id,
              MAX(m.id) AS last_message_id,
              COUNT(*) FILTER (WHERE r.last_read IS NOT NULL AND m.id > r.last_read AND m.user_id IS DISTINCT FROM $3) AS unread,
              COUNT(*) FILTER (WHERE r.last_read IS NOT NULL AND m.id > r.last_read AND m.user_id IS DISTINCT FROM $3
                AND (POSITION($4 IN m.content) > 0 OR POSITION('@everyone' IN m.content) > 0 OR p.user_id = $3)) AS mentions
       FROM messages m
       LEFT JOIN (SELECT unnest($1::int[]) AS ch, unnest($2::int[]) AS last_read) r ON r.ch = m.channel_id
       LEFT JOIN messages p ON p.id = m.reply_to_id
       GROUP BY m.channel_id`, [channelIds, lastReadIds, req.user.id, `@${req.user.username}`]);
        res.json(result.rows.map(r => ({
            channelId: r.channel_id,
            lastMessageId: Number(r.last_message_id),
            unread: Number(r.unread),
            mentions: Number(r.mentions),
        })));
    }
    catch (err) {
        console.error('Unread counts error:', err);
        res.status(500).json({ error: '未読数取得エラー' });
    }
});
app.delete('/api/messages/:messageId', authMiddleware, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId, 10);
        const userId = req.user.id;
        const userRole = req.user.role;
        const msgRes = await db_js_1.pool.query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
        if (msgRes.rows.length === 0) {
            return res.status(404).json({ error: 'メッセージが見つかりません' });
        }
        const msg = msgRes.rows[0];
        if (userRole !== 'admin' && msg.user_id !== userId) {
            return res.status(403).json({ error: '削除権限がありません' });
        }
        await db_js_1.pool.query(`DELETE FROM messages WHERE id = $1`, [messageId]);
        broadcast({ type: 'MESSAGE_DELETED', payload: { messageId, channelId: msg.channel_id } });
        logAudit(req.user, 'message_delete', 'message', messageId, {
            message: `メッセージ削除 (${msg.username} の投稿)`,
            channel_id: msg.channel_id,
            author: msg.username,
            author_id: msg.user_id,
            content: msg.content,
            created_at: msg.created_at,
        }, true);
        res.json({ success: true, messageId });
    }
    catch (err) {
        console.error('Message delete error:', err);
        res.status(500).json({ error: 'メッセージ削除エラー' });
    }
});
app.put('/api/messages/:messageId', authMiddleware, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId, 10);
        const { content } = req.body;
        const userId = req.user.id;
        const msgRes = await db_js_1.pool.query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
        if (msgRes.rows.length === 0) {
            return res.status(404).json({ error: 'メッセージが見つかりません' });
        }
        const msg = msgRes.rows[0];
        if (msg.user_id !== userId) {
            return res.status(403).json({ error: '編集権限がありません' });
        }
        const updated = await db_js_1.pool.query(`UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [content, messageId]);
        const [updatedMessage] = await attachReplies([{ ...updated.rows[0], sender_username: req.user.username }]);
        broadcast({ type: 'MESSAGE_UPDATED', payload: updatedMessage });
        logAudit(req.user, 'message_edit', 'message', messageId, {
            message: 'メッセージ編集',
            channel_id: msg.channel_id,
            before: msg.content,
            after: content,
        });
        res.json(updatedMessage);
    }
    catch (err) {
        console.error('Message update error:', err);
        res.status(500).json({ error: 'メッセージ編集エラー' });
    }
});
// @gemini: チャンネルの直近の会話を履歴として渡して返信する
const IMAGE_MD_RE = /!\[[^\]]*\]\([^)\s]+\)/g;
async function replyAsGemini(channelId, trigger) {
    if (!/@gemini\b/i.test(String(trigger.content || '')))
        return;
    try {
        const hist = await db_js_1.pool.query(`SELECT m.id, m.content, m.user_id, COALESCE(u.username, m.username) AS username, m.created_at
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = $1 AND m.id <= $2 ORDER BY m.id DESC LIMIT 30`, [channelId, trigger.id]);
        const history = hist.rows.reverse().map(r => {
            const text = String(r.content || '').replace(IMAGE_MD_RE, '[画像]').slice(0, 2000);
            return r.username === 'Gemini'
                ? { role: 'model', content: text }
                : { role: 'user', content: `${r.username}: ${text}` };
        });
        const channel = (await db_js_1.pool.query(`SELECT name FROM channels WHERE id = $1`, [channelId])).rows[0];
        const asker = trigger.sender_username || trigger.username || '';
        const reply = await (0, gemini_js_1.chatWithGemini)(history, {
            channel: channel?.name,
            asked_by: asker,
            now: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        }, `あなたはチャット「asdfbase」の参加者 Gemini です。会話の流れを踏まえ、最後に @gemini で呼びかけた ${asker} に答えてください。前置きは省き、チャットらしく簡潔に日本語で答えてください。`);
        const botResult = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, reply_to_id)
       VALUES ($1, NULL, 'Gemini', $2, $3) RETURNING *`, [channelId, reply, trigger.id]);
        const [aiMessage] = await attachReplies([{ ...botResult.rows[0], sender_username: 'Gemini' }]);
        broadcast({ type: 'NEW_MESSAGE', payload: aiMessage });
        relayMessage(aiMessage);
    }
    catch (err) {
        console.error('Gemini mention error:', err.message);
    }
}
// Post Message with AI @gemini mention support (commands like /ai removed)
app.post('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId, 10);
        const { content, attachments, replyToId, clientNonce } = req.body;
        const userId = req.user.id;
        const username = req.user.username;
        const result = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [channelId, userId, username, content, JSON.stringify(attachments || []), replyToId || null]);
        const [savedMessage] = await attachReplies([{ ...result.rows[0], sender_username: username, client_nonce: clientNonce || null }]);
        broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });
        relayMessage(savedMessage);
        if (String(content).includes('@everyone')) {
            notifyImportant(`📢 ${username} から全員への連絡`, String(content));
        }
        replyAsGemini(channelId, savedMessage);
        res.json(savedMessage);
    }
    catch (err) {
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
        const result = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, attachments) 
       VALUES ($1, NULL, $2, $3, $4) RETURNING *`, [targetChannelId, senderName, content || '', JSON.stringify(attachments || [])]);
        const savedMessage = { ...result.rows[0], sender_username: senderName };
        broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });
        res.json({ success: true, message: savedMessage });
    }
    catch (err) {
        console.error('Discord inbound sync error:', err);
        res.status(500).json({ error: 'Discord同期エラー' });
    }
});
// Reactions & Pin
app.post('/api/messages/:messageId/reactions', authMiddleware, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId, 10);
        const { emoji } = req.body;
        const userId = req.user.id;
        const msgRes = await db_js_1.pool.query(`SELECT reactions FROM messages WHERE id = $1`, [messageId]);
        if (msgRes.rows.length === 0)
            return res.status(404).json({ error: 'メッセージがありません' });
        const reactions = msgRes.rows[0].reactions || {};
        const users = reactions[emoji] || [];
        if (users.includes(userId)) {
            reactions[emoji] = users.filter((id) => id !== userId);
            if (reactions[emoji].length === 0)
                delete reactions[emoji];
        }
        else {
            reactions[emoji] = [...users, userId];
        }
        const updated = await db_js_1.pool.query(`UPDATE messages SET reactions = $1 WHERE id = $2 RETURNING *`, [JSON.stringify(reactions), messageId]);
        broadcast({
            type: 'MESSAGE_REACTION_UPDATED',
            payload: { messageId, reactions: updated.rows[0].reactions },
        });
        res.json(updated.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: 'リアクション更新エラー' });
    }
});
app.post('/api/messages/:messageId/pin', authMiddleware, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId, 10);
        const updated = await db_js_1.pool.query(`UPDATE messages SET is_pinned = NOT is_pinned WHERE id = $1 RETURNING *`, [messageId]);
        if (updated.rows.length === 0)
            return res.status(404).json({ error: 'メッセージがありません' });
        const [pinned] = await attachReplies([updated.rows[0]]);
        broadcast({
            type: 'MESSAGE_PIN_UPDATED',
            payload: pinned,
        });
        logAudit(req.user, pinned.is_pinned ? 'message_pin' : 'message_unpin', 'message', messageId, {
            message: pinned.is_pinned ? 'メッセージをピン留め' : 'ピン留めを解除',
            content: pinned.content,
        });
        if (pinned.is_pinned) {
            notifyImportant(`📌 ${req.user.username} がメッセージをピン留め`, `**${pinned.username}**: ${pinned.content}`);
        }
        res.json(updated.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: 'ピン留め更新エラー' });
    }
});
// Assignments API
app.get('/api/assignments', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await db_js_1.pool.query(`SELECT a.*, COALESCE(p.status, 'unstarted') as my_status 
       FROM assignments a 
       LEFT JOIN assignment_progress p ON a.id = p.assignment_id AND p.user_id = $1 
       ORDER BY a.deadline ASC`, [userId]);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: '提出物一覧取得エラー' });
    }
});
app.post('/api/assignments', authMiddleware, async (req, res) => {
    try {
        const { title, subject, description, deadline, resubmitDeadline } = req.body;
        const result = await db_js_1.pool.query(`INSERT INTO assignments (title, subject, description, deadline, resubmit_deadline) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`, [title, subject, description, deadline, resubmitDeadline || null]);
        const created = { ...result.rows[0], my_status: 'unstarted' };
        broadcast({ type: 'ASSIGNMENT_CREATED', payload: created });
        logAudit(req.user, 'assignment_create', 'assignment', created.id, { message: `提出物「${title}」を登録`, subject, deadline });
        notifyImportant(`📝 新しい提出物: ${title}`, `教科: ${subject || '-'}\n締切: ${deadline ? new Date(deadline).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-'}` +
            `${resubmitDeadline ? `\n再提出締切: ${new Date(resubmitDeadline).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : ''}` +
            `${description ? `\n\n${description}` : ''}\n(登録: ${req.user.username})`);
        res.json(created);
    }
    catch (err) {
        res.status(500).json({ error: '提出物作成エラー' });
    }
});
app.put('/api/assignments/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { title, subject, description, deadline, resubmitDeadline } = req.body;
        const before = (await db_js_1.pool.query(`SELECT * FROM assignments WHERE id = $1`, [id])).rows[0];
        const result = await db_js_1.pool.query(`UPDATE assignments 
       SET title = $1, subject = $2, description = $3, deadline = $4, resubmit_deadline = $5 
       WHERE id = $6 RETURNING *`, [title, subject, description, deadline, resubmitDeadline || null, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '提出物が見つかりません' });
        }
        const updated = result.rows[0];
        broadcast({ type: 'ASSIGNMENT_UPDATED', payload: updated });
        logAudit(req.user, 'assignment_update', 'assignment', id, {
            message: `提出物「${title}」を編集`,
            before: before ? { title: before.title, subject: before.subject, deadline: before.deadline, resubmit_deadline: before.resubmit_deadline } : null,
            after: { title, subject, deadline, resubmit_deadline: resubmitDeadline || null },
        });
        if (before && String(before.deadline) !== String(updated.deadline)) {
            notifyImportant(`⏰ 締切変更: ${title}`, `新しい締切: ${new Date(updated.deadline).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} (変更: ${req.user.username})`);
        }
        res.json(updated);
    }
    catch (err) {
        console.error('Assignment update error:', err);
        res.status(500).json({ error: '提出物更新エラー' });
    }
});
app.delete('/api/assignments/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const delRes = await db_js_1.pool.query(`DELETE FROM assignments WHERE id = $1 RETURNING *`, [id]);
        broadcast({ type: 'ASSIGNMENT_DELETED', payload: { id } });
        const d = delRes.rows[0];
        if (d) {
            logAudit(req.user, 'assignment_delete', 'assignment', id, {
                message: `提出物「${d.title}」を削除`,
                title: d.title, subject: d.subject, description: d.description, deadline: d.deadline, resubmit_deadline: d.resubmit_deadline,
            }, true);
        }
        res.json({ success: true, id });
    }
    catch (err) {
        console.error('Assignment delete error:', err);
        res.status(500).json({ error: '提出物削除エラー' });
    }
});
// Get all members progress for assignments
app.get('/api/assignments/progress/all', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`
      SELECT p.assignment_id, p.user_id, p.status, u.username
      FROM assignment_progress p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.assignment_id ASC, u.username ASC
    `);
        res.json(result.rows);
    }
    catch (err) {
        console.error('Progress all fetch error:', err);
        res.status(500).json({ error: 'メンバー進捗取得エラー' });
    }
});
// Update Assignment Progress (未着手/進行中/提出済み/再提出/合格)
app.put('/api/assignments/:id/progress', authMiddleware, async (req, res) => {
    try {
        const assignmentId = parseInt(req.params.id, 10);
        const { status } = req.body;
        const userId = req.user.id;
        const username = req.user.username;
        await db_js_1.pool.query(`INSERT INTO assignment_progress (assignment_id, user_id, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (assignment_id, user_id) 
       DO UPDATE SET status = EXCLUDED.status`, [assignmentId, userId, status]);
        // 全員合格チェック
        const usersCountRes = await db_js_1.pool.query(`SELECT COUNT(*) FROM users`);
        const passedCountRes = await db_js_1.pool.query(`SELECT COUNT(*) FROM assignment_progress WHERE assignment_id = $1 AND status = 'passed'`, [assignmentId]);
        const totalUsers = parseInt(usersCountRes.rows[0].count, 10);
        const passedUsers = parseInt(passedCountRes.rows[0].count, 10);
        let isArchived = false;
        if (totalUsers > 0 && passedUsers >= totalUsers) {
            await db_js_1.pool.query(`UPDATE assignments SET is_archived = TRUE WHERE id = $1`, [assignmentId]);
            isArchived = true;
        }
        broadcast({
            type: 'ASSIGNMENT_PROGRESS_UPDATED',
            payload: { assignmentId, userId, username, status, isArchived }
        });
        res.json({ success: true, status, isArchived });
    }
    catch (err) {
        res.status(500).json({ error: '進捗更新エラー' });
    }
});
// Gemini Summarize Assignment
app.post('/api/assignments/summarize', authMiddleware, async (req, res) => {
    try {
        const { description } = req.body;
        if (!description)
            return res.status(400).json({ error: '内容が空です' });
        const prompt = `以下の学校の課題・提出物指示文を読み、重要なポイント、締め切り、持ち物、注意点をJSON形式で要約してください。\n\n【指示文】:\n${description}`;
        const summary = await (0, gemini_js_1.askGemini)(prompt, '必ず有効なJSONまたは箇条書きの分かりやすい形式で回答してください。');
        res.json({ summary });
    }
    catch (err) {
        res.status(500).json({ error: 'AI要約エラー' });
    }
});
// Test Scores (中間 / 期末 / 学年末 / 診断テスト) & AI Advice
const EXAM_TYPES = { midterm: '中間テスト', final: '期末テスト', yearend: '学年末テスト', diagnostic: '診断テスト' };
app.get('/api/test-scores', authMiddleware, async (req, res) => {
    try {
        const requestedUserId = parseInt(req.query.userId, 10);
        const userId = Number.isFinite(requestedUserId) ? requestedUserId : req.user.id;
        const result = await db_js_1.pool.query(`SELECT t.*, u.username FROM test_scores t LEFT JOIN users u ON t.user_id = u.id
       WHERE t.user_id = $1 ORDER BY t.created_at ASC, t.id ASC`, [userId]);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'テスト点数取得エラー' });
    }
});
// 1回分のテスト (種別 + 回の名前) の点数をまとめて登録。同じ教科は上書き
app.post('/api/test-scores', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const examType = EXAM_TYPES[req.body.examType] ? req.body.examType : 'midterm';
        const examLabel = String(req.body.examLabel || '').trim().slice(0, 100);
        const entries = Array.isArray(req.body.entries)
            ? req.body.entries
            : [{ subject: req.body.subject, score: req.body.score, maxScore: req.body.maxScore }];
        if (!examLabel)
            return res.status(400).json({ error: '何回目のテストか (例: 1学期) を入力してください' });
        const rows = [];
        for (const e of entries) {
            const subject = String(e.subject || '').trim();
            const score = Number(e.score);
            const maxScore = Number(e.maxScore) || 100;
            if (!subject || !Number.isFinite(score))
                continue;
            if (score < 0 || score > maxScore)
                return res.status(400).json({ error: `${subject} の点数が 0〜${maxScore} の範囲外です` });
            const existing = await db_js_1.pool.query(`SELECT id FROM test_scores WHERE user_id = $1 AND exam_type = $2 AND exam_label = $3 AND subject = $4`, [userId, examType, examLabel, subject]);
            const r = existing.rows.length > 0
                ? await db_js_1.pool.query(`UPDATE test_scores SET score = $1, max_score = $2 WHERE id = $3 RETURNING *`, [score, maxScore, existing.rows[0].id])
                : await db_js_1.pool.query(`INSERT INTO test_scores (user_id, exam_type, exam_label, exam_name, subject, score, max_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [userId, examType, examLabel, `${EXAM_TYPES[examType]} ${examLabel}`, subject, score, maxScore]);
            rows.push({ ...r.rows[0], username: req.user.username });
        }
        if (rows.length === 0)
            return res.status(400).json({ error: '点数を1つ以上入力してください' });
        res.json(rows);
    }
    catch (err) {
        console.error('Test score save error:', err);
        res.status(500).json({ error: 'テスト点数登録エラー' });
    }
});
app.delete('/api/test-scores/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const userId = req.user.id;
        const userRole = req.user.role;
        const scoreRes = await db_js_1.pool.query(`SELECT * FROM test_scores WHERE id = $1`, [id]);
        if (scoreRes.rows.length === 0) {
            return res.status(404).json({ error: 'テスト点数が見つかりません' });
        }
        if (userRole !== 'admin' && scoreRes.rows[0].user_id !== userId) {
            return res.status(403).json({ error: '削除権限がありません' });
        }
        await db_js_1.pool.query(`DELETE FROM test_scores WHERE id = $1`, [id]);
        const sc = scoreRes.rows[0];
        logAudit(req.user, 'test_score_delete', 'test_score', id, { message: `テスト点数を削除 (${sc.exam_name || ''} ${sc.subject}: ${sc.score}/${sc.max_score})` });
        res.json({ success: true, id });
    }
    catch (err) {
        console.error('Test score delete error:', err);
        res.status(500).json({ error: 'テスト点数削除エラー' });
    }
});
// 種別ごとに、回を追った推移から学習アドバイス
app.post('/api/test-scores/advice', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const examType = EXAM_TYPES[req.body?.examType] ? req.body.examType : 'midterm';
        const scores = await db_js_1.pool.query(`SELECT exam_label, subject, score, max_score FROM test_scores WHERE user_id = $1 AND exam_type = $2 ORDER BY created_at ASC, id ASC`, [userId, examType]);
        if (scores.rows.length === 0) {
            return res.status(400).json({ error: `${EXAM_TYPES[examType]} の点数がまだ記録されていません` });
        }
        const byLabel = new Map();
        for (const s of scores.rows) {
            const list = byLabel.get(s.exam_label || '(回の指定なし)') || [];
            list.push(`${s.subject} ${Number(s.score)}/${Number(s.max_score)}`);
            byLabel.set(s.exam_label || '(回の指定なし)', list);
        }
        const summary = Array.from(byLabel.entries()).map(([label, list]) => `【${label}】${list.join(', ')}`).join('\n');
        const prompt = `中学生の${EXAM_TYPES[examType]}の結果です (古い順):\n${summary}\n\n教科ごとの得点傾向と推移を分析し、次のテストに向けた具体的な勉強方法を教えてください。`;
        const advice = await (0, gemini_js_1.askGemini)(prompt, '中学生向けの学習アドバイザーです。前置きや挨拶は省き、Markdown の見出しと箇条書きで簡潔に答えてください。');
        res.json({ advice });
    }
    catch (err) {
        console.error('Advice error:', err);
        res.status(500).json({ error: 'アドバイス生成エラー' });
    }
});
// AI Chat Endpoint (for AI Tab) with Smart # and @ contextual resolver
app.post('/api/ai/chat', authMiddleware, async (req, res) => {
    try {
        const { messages, contextData, systemInstruction } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: '会話履歴（messages）が必要です' });
        }
        // Inspect last user message for #name or @username
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const dynamicReferences = {};
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
                        const noteRes = await db_js_1.pool.query(`SELECT slot_index, title, content, mode, updated_at FROM notes WHERE slot_index = $1`, [slotNum]);
                        if (noteRes.rows.length > 0) {
                            dynamicReferences[`note_slot_${slotNum}`] = noteRes.rows[0];
                            continue;
                        }
                    }
                    // Check if note title match
                    const noteByTitle = await db_js_1.pool.query(`SELECT slot_index, title, content, mode, updated_at FROM notes WHERE title ILIKE $1 LIMIT 1`, [`%${tag}%`]);
                    if (noteByTitle.rows.length > 0) {
                        dynamicReferences[`note_${tag}`] = noteByTitle.rows[0];
                        continue;
                    }
                    // Check if channel name match -> fetch latest 25 messages
                    const chRes = await db_js_1.pool.query(`SELECT id, name, type FROM channels WHERE name ILIKE $1 LIMIT 1`, [`%${tag}%`]);
                    if (chRes.rows.length > 0) {
                        const ch = chRes.rows[0];
                        const msgsRes = await db_js_1.pool.query(`SELECT m.id, m.content, m.created_at, COALESCE(u.username, m.username) as sender 
               FROM messages m 
               LEFT JOIN users u ON m.user_id = u.id 
               WHERE m.channel_id = $1 
               ORDER BY m.id DESC LIMIT 25`, [ch.id]);
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
                    if (targetName.toLowerCase() === 'gemini')
                        continue;
                    const uRes = await db_js_1.pool.query(`SELECT id, username, role, status, custom_status, last_active_at FROM users WHERE username ILIKE $1 LIMIT 1`, [`%${targetName}%`]);
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
        const reply = await (0, gemini_js_1.chatWithGemini)(messages, mergedContext, systemInstruction);
        res.json({ reply, keyCount: (0, gemini_js_1.getAvailableKeyCount)(), resolvedReferences: Object.keys(dynamicReferences) });
    }
    catch (err) {
        console.error('AI chat error:', err);
        res.status(500).json({ error: 'AI応答エラー' });
    }
});
// Memo AI Assistant (Summarize, Proofread, Explain Code)
app.post('/api/ai/memo-assist', authMiddleware, async (req, res) => {
    try {
        const { content, type, customPrompt } = req.body;
        if (!content && !customPrompt) {
            return res.status(400).json({ error: '対象のテキストがありません' });
        }
        let prompt = '';
        let instruction = 'あなたは的確で簡潔なアシスタントです。余計な前置きを省いて結果のみを返してください。';
        if (type === 'summarize') {
            prompt = `以下のメモ内容を3行以内の重要ポイントに箇条書きで要約してください:\n\n${content}`;
        }
        else if (type === 'proofread') {
            prompt = `以下の文章の誤字脱字・表現の不自然さを直した「校正後の全文」だけを出力してください。説明・前置き・コードブロックの囲みは不要です。Markdown の書式はそのまま残してください:\n\n${content}`;
        }
        else if (type === 'explain_code') {
            prompt = `以下のプログラムコードの処理内容、引数、戻り値、改善点を分かりやすく解説してください:\n\n${content}`;
            instruction = 'プログラミング講師として簡潔かつ明快に解説してください。';
        }
        else if (type === 'continue') {
            prompt = `以下のメモの文脈に続けて、自然な続きの文章や実装を生成してください:\n\n${content}`;
        }
        else {
            prompt = `${customPrompt || '以下のテキストを改善してください'}:\n\n${content}`;
        }
        const result = await (0, gemini_js_1.askGemini)(prompt, instruction);
        res.json({ result });
    }
    catch (err) {
        console.error('Memo assist error:', err);
        res.status(500).json({ error: 'メモAIアシストエラー' });
    }
});
// Timetables API
app.get('/api/timetables', authMiddleware, async (req, res) => {
    try {
        const scheduleType = req.query.scheduleType || 'normal';
        const result = await db_js_1.pool.query(`SELECT * FROM timetables WHERE schedule_type = $1 ORDER BY day_of_week ASC, period ASC`, [scheduleType]);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: '時間割取得エラー' });
    }
});
async function getTimetableConfig() {
    let schedules = { ...schedule_js_1.DEFAULT_SCHEDULES };
    let dayPeriodCounts = { ...schedule_js_1.DEFAULT_DAY_PERIOD_COUNTS };
    try {
        const saved = JSON.parse(await getSetting('timetable_config_v2', '{}'));
        for (const t of schedule_js_1.SCHEDULE_TYPES) {
            if ((0, schedule_js_1.isValidSchedule)(saved.schedules?.[t]))
                schedules[t] = saved.schedules[t];
        }
        if (saved.dayPeriodCounts)
            dayPeriodCounts = { ...dayPeriodCounts, ...saved.dayPeriodCounts };
    }
    catch (_) { }
    // 「今日の時程」は設定した日だけ有効。日付が変わったら通常時程へ戻る
    const active = await getSetting('timetable_active_schedule', 'normal');
    const activeDate = await getSetting('timetable_active_date', '');
    const today = (0, schedule_js_1.nowInTokyo)().date;
    const activeScheduleType = schedule_js_1.SCHEDULE_TYPES.includes(active) && activeDate === today ? active : 'normal';
    return { activeScheduleType, activeDate: today, schedules, dayPeriodCounts };
}
// 時程(朝の会・各時限・帰りの会)と「今日の時程」: 全員で共有
app.get('/api/timetables/config', authMiddleware, async (req, res) => {
    try {
        res.json(await getTimetableConfig());
    }
    catch (err) {
        res.status(500).json({ error: '時程設定取得エラー' });
    }
});
app.put('/api/timetables/config', authMiddleware, async (req, res) => {
    try {
        const { activeScheduleType, schedules, dayPeriodCounts } = req.body || {};
        const changes = [];
        if (activeScheduleType !== undefined) {
            if (!schedule_js_1.SCHEDULE_TYPES.includes(activeScheduleType))
                return res.status(400).json({ error: '時程の種類が不正です' });
            await setSetting('timetable_active_schedule', activeScheduleType);
            await setSetting('timetable_active_date', (0, schedule_js_1.nowInTokyo)().date);
            changes.push(`今日の時程を ${activeScheduleType === 'normal' ? '通常' : activeScheduleType === 'short' ? '短縮' : 'S短'} に変更`);
        }
        if (schedules !== undefined || dayPeriodCounts !== undefined) {
            const current = await getTimetableConfig();
            const nextSchedules = { ...current.schedules };
            if (schedules !== undefined) {
                for (const key of Object.keys(schedules)) {
                    if (!schedule_js_1.SCHEDULE_TYPES.includes(key) || !(0, schedule_js_1.isValidSchedule)(schedules[key])) {
                        return res.status(400).json({ error: '時刻の形式が正しくありません (HH:MM)' });
                    }
                    nextSchedules[key] = schedules[key];
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
        logAudit(req.user, 'timetable_config', 'timetable', null, { message: changes.join(' / ') });
        res.json(config);
    }
    catch (err) {
        res.status(500).json({ error: '時程設定保存エラー' });
    }
});
// コマの登録/変更: 同じ曜日・時限は上書き (持ち物・メモは保持)
app.post('/api/timetables', authMiddleware, async (req, res) => {
    try {
        const { dayOfWeek, period, subject, scheduleType, items, note } = req.body;
        if (dayOfWeek === undefined || !period || !subject) {
            return res.status(400).json({ error: '曜日、時限、教科名は必須です' });
        }
        const type = scheduleType || 'normal';
        const existing = await db_js_1.pool.query(`SELECT * FROM timetables WHERE day_of_week = $1 AND period = $2 AND schedule_type = $3 ORDER BY id ASC`, [dayOfWeek, period, type]);
        let row;
        if (existing.rows.length > 0) {
            const keep = existing.rows[0];
            // 過去の重複行は掃除
            if (existing.rows.length > 1) {
                await db_js_1.pool.query(`DELETE FROM timetables WHERE id = ANY($1::int[])`, [existing.rows.slice(1).map(r => r.id)]);
            }
            row = (await db_js_1.pool.query(`UPDATE timetables SET subject = $1, items = COALESCE($2, items), note = COALESCE($3, note) WHERE id = $4 RETURNING *`, [subject, items ?? null, note ?? null, keep.id])).rows[0];
        }
        else {
            row = (await db_js_1.pool.query(`INSERT INTO timetables (day_of_week, period, subject, schedule_type, items, note)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [dayOfWeek, period, subject, type, items || '', note || ''])).rows[0];
        }
        broadcast({ type: 'TIMETABLE_UPDATED', payload: { scheduleType: type } });
        logAudit(req.user, 'timetable_set', 'timetable', row.id, {
            message: `時間割 ${['', '月', '火', '水', '木', '金', '土'][dayOfWeek] || dayOfWeek}曜${period}限 を「${subject}」に設定`,
            scheduleType: type,
            before: existing.rows[0]?.subject || null,
        });
        res.json(row);
    }
    catch (err) {
        res.status(500).json({ error: '時間割登録エラー' });
    }
});
// コマの詳細 (教科・持ち物・メモ) を更新
app.put('/api/timetables/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { subject, items, note } = req.body || {};
        const result = await db_js_1.pool.query(`UPDATE timetables SET subject = COALESCE($1, subject), items = COALESCE($2, items), note = COALESCE($3, note)
       WHERE id = $4 RETURNING *`, [subject ?? null, items ?? null, note ?? null, id]);
        if (result.rows.length === 0)
            return res.status(404).json({ error: 'コマが見つかりません' });
        const row = result.rows[0];
        broadcast({ type: 'TIMETABLE_UPDATED', payload: { scheduleType: row.schedule_type } });
        logAudit(req.user, 'timetable_detail', 'timetable', id, {
            message: `時間割 ${['', '月', '火', '水', '木', '金', '土'][row.day_of_week] || row.day_of_week}曜${row.period}限 (${row.subject}) の詳細を更新`,
            items: row.items,
            note: row.note,
        });
        res.json(row);
    }
    catch (err) {
        res.status(500).json({ error: '時間割更新エラー' });
    }
});
app.delete('/api/timetables/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const deleted = await db_js_1.pool.query(`DELETE FROM timetables WHERE id = $1 RETURNING *`, [id]);
        const d = deleted.rows[0];
        broadcast({ type: 'TIMETABLE_UPDATED', payload: { scheduleType: d?.schedule_type || 'normal' } });
        if (d) {
            logAudit(req.user, 'timetable_delete', 'timetable', id, {
                message: `時間割 ${['', '月', '火', '水', '木', '金', '土'][d.day_of_week] || d.day_of_week}曜${d.period}限 (${d.subject}) を削除`,
            });
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: '時間割削除エラー' });
    }
});
// Board API
app.get('/api/board', authMiddleware, async (req, res) => {
    try {
        const strokes = await db_js_1.pool.query(`SELECT * FROM board_strokes ORDER BY id ASC`);
        const texts = await db_js_1.pool.query(`SELECT * FROM board_texts ORDER BY id ASC`);
        res.json({ strokes: strokes.rows, texts: texts.rows });
    }
    catch (err) {
        res.status(500).json({ error: 'ボードデータ取得エラー' });
    }
});
app.post('/api/board/stroke', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const username = req.user.username;
        const { color, width, points } = req.body;
        const result = await db_js_1.pool.query(`INSERT INTO board_strokes (user_id, username, color, width, points) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`, [userId, username, color || '#f59e0b', width || 3, JSON.stringify(points)]);
        const stroke = result.rows[0];
        broadcast({ type: 'BOARD_NEW_STROKE', payload: stroke });
        res.json(stroke);
    }
    catch (err) {
        res.status(500).json({ error: 'ストローク保存エラー' });
    }
});
app.post('/api/board/text', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const username = req.user.username;
        const { x, y, text } = req.body;
        const result = await db_js_1.pool.query(`INSERT INTO board_texts (user_id, username, x, y, text) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`, [userId, username, x, y, text]);
        const textItem = result.rows[0];
        broadcast({ type: 'BOARD_NEW_TEXT', payload: textItem });
        res.json(textItem);
    }
    catch (err) {
        res.status(500).json({ error: 'テキスト付箋保存エラー' });
    }
});
app.delete('/api/board/clear', authMiddleware, async (req, res) => {
    try {
        const cnt = await db_js_1.pool.query(`SELECT (SELECT COUNT(*) FROM board_strokes) AS s, (SELECT COUNT(*) FROM board_texts) AS t`);
        await db_js_1.pool.query(`DELETE FROM board_strokes`);
        await db_js_1.pool.query(`DELETE FROM board_texts`);
        broadcast({ type: 'BOARD_CLEARED' });
        logAudit(req.user, 'board_clear', 'board', null, { message: `ボードを全消去 (線 ${cnt.rows[0].s} 本 / 付箋 ${cnt.rows[0].t} 件)` });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'ボードクリアエラー' });
    }
});
// Shared Clipboard API
app.get('/api/clipboard', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT * FROM shared_clipboard WHERE id = 1`);
        if (result.rows.length === 0) {
            await db_js_1.pool.query(`INSERT INTO shared_clipboard (id, content) VALUES (1, '') ON CONFLICT DO NOTHING`);
            return res.json({ content: '', updated_by: 'system', updated_at: new Date().toISOString() });
        }
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: 'クリップボード取得エラー' });
    }
});
app.put('/api/clipboard', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;
        const username = req.user.username;
        const result = await db_js_1.pool.query(`INSERT INTO shared_clipboard (id, content, updated_by, updated_at) 
       VALUES (1, $1, $2, NOW()) 
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW() 
       RETURNING *`, [content, username]);
        const updated = result.rows[0];
        broadcast({ type: 'CLIPBOARD_UPDATED', payload: updated });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: 'クリップボード同期エラー' });
    }
});
// Notes (Slots 1-10 Common + Slots 11+ Dedicated Monaco) API
// メモスロットの確保・整理 (起動時とユーザー登録時だけ実行。GET のたびに走らせると重い)
async function ensureNoteSlots() {
    // 1. スロット1〜10の確保
    for (let i = 1; i <= 10; i++) {
        await db_js_1.pool.query(`
      INSERT INTO notes (slot_index, title, content, mode) 
      VALUES ($1, $2, '', 'markdown') 
      ON CONFLICT (slot_index) DO NOTHING
    `, [i, `メモ ${i}`]);
    }
    // 2. 既存スロット1〜10の「メモ #1」などの重複タイトルをクリーンアップ
    await db_js_1.pool.query(`
    UPDATE notes 
    SET title = REGEXP_REPLACE(title, '^メモ\\s*#([0-9]+)', 'メモ \\1') 
    WHERE slot_index <= 10 AND title LIKE '%#%'
  `).catch(() => { });
    // 3. 全利用メンバーの専用Monacoエディタスロット（スロット11以降: 10 + user.id 固定）を自動確保
    const usersRes = await db_js_1.pool.query(`SELECT id, username FROM users ORDER BY id ASC`);
    for (const u of usersRes.rows) {
        const slotIndex = 10 + u.id; // ユーザーID固定スロット
        await db_js_1.pool.query(`
      INSERT INTO notes (slot_index, title, content, mode, assigned_user_id)
      VALUES ($1, $2, '', 'monaco', $3)
      ON CONFLICT (slot_index) DO UPDATE 
      SET assigned_user_id = EXCLUDED.assigned_user_id,
          title = CASE WHEN notes.title LIKE '%の専用エディタ' THEN EXCLUDED.title ELSE notes.title END
    `, [slotIndex, `${u.username}の専用エディタ`, u.id]);
    }
    // 4. 旧方式(11 + 並び順)で作られた重複専用スロットを正規スロット(10 + user.id)へ統合して削除
    const strayRes = await db_js_1.pool.query(`
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
                await db_js_1.pool.query(`UPDATE notes SET content = $1, updated_at = NOW() WHERE slot_index = $2 AND (content IS NULL OR content = '')`, [stray.content, canonical]);
            }
            await db_js_1.pool.query(`UPDATE note_history SET slot_index = $1 WHERE slot_index = $2`, [canonical, stray.slot_index]);
            await db_js_1.pool.query(`DELETE FROM notes WHERE slot_index = $1`, [stray.slot_index]);
        }
        else if (!stray.content) {
            // 削除済みユーザーの空スロット
            await db_js_1.pool.query(`DELETE FROM notes WHERE slot_index = $1`, [stray.slot_index]);
        }
    }
}
app.get('/api/notes', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`
      SELECT n.*, u.username as assigned_username 
      FROM notes n 
      LEFT JOIN users u ON n.assigned_user_id = u.id 
      ORDER BY n.slot_index ASC
    `);
        res.json(result.rows);
    }
    catch (err) {
        console.error('Notes fetch error:', err);
        res.status(500).json({ error: 'メモ取得エラー' });
    }
});
app.put('/api/notes/:slotIndex', authMiddleware, async (req, res) => {
    try {
        const slotIndex = parseInt(req.params.slotIndex, 10);
        const { title, content, mode } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;
        const username = req.user.username;
        const currentNoteRes = await db_js_1.pool.query(`SELECT * FROM notes WHERE slot_index = $1`, [slotIndex]);
        const currentNote = currentNoteRes.rows[0];
        // スロット11以降、または担当ユーザーが設定されている場合は本人のみ編集可能
        if (currentNote &&
            currentNote.assigned_user_id &&
            currentNote.assigned_user_id !== userId &&
            userRole !== 'admin') {
            return res.status(403).json({ error: 'このメモは他ユーザーの専用ゾーンです（閲覧専用）' });
        }
        if (currentNote && currentNote.content !== content) {
            await db_js_1.pool.query(`INSERT INTO note_history (slot_index, content, updated_by_id) VALUES ($1, $2, $3)`, [slotIndex, currentNote.content, userId]);
        }
        const effectiveMode = slotIndex >= 11 ? 'monaco' : (mode || currentNote?.mode || 'markdown');
        const updated = await db_js_1.pool.query(`UPDATE notes 
       SET title = COALESCE($1, title), 
           content = COALESCE($2, content), 
           mode = $3, 
           version = version + 1, 
           updated_at = NOW() 
       WHERE slot_index = $4 RETURNING *`, [title, content, effectiveMode, slotIndex]);
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
    }
    catch (err) {
        console.error('Note update error:', err);
        res.status(500).json({ error: 'メモ更新エラー' });
    }
});
// Audit Logs & Users List
app.get('/api/audit-logs', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const beforeId = parseInt(req.query.beforeId, 10) || 0;
        const action = req.query.action || '';
        const params = [];
        const where = [];
        if (beforeId) {
            params.push(beforeId);
            where.push(`id < $${params.length}`);
        }
        if (action) {
            params.push(`${action}%`);
            where.push(`action LIKE $${params.length}`);
        }
        params.push(limit);
        const result = await db_js_1.pool.query(`SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${params.length}`, params);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: '監査ログ取得エラー' });
    }
});
// このログだけ削除 (管理者)
app.delete('/api/audit-logs/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin')
        return res.status(403).json({ error: '管理者のみ削除できます' });
    try {
        const id = parseInt(req.params.id, 10);
        await db_js_1.pool.query(`DELETE FROM audit_logs WHERE id = $1`, [id]);
        res.json({ success: true, id });
    }
    catch (err) {
        res.status(500).json({ error: '監査ログ削除エラー' });
    }
});
// 履歴全削除 (管理者)。削除した事実だけは記録を残す
app.delete('/api/audit-logs', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin')
        return res.status(403).json({ error: '管理者のみ削除できます' });
    try {
        const del = await db_js_1.pool.query(`DELETE FROM audit_logs`);
        logAudit(req.user, 'audit_clear', 'audit', null, { message: `監査ログを全削除 (${del.rowCount} 件)`, ...requestMeta(req) });
        res.json({ success: true, deleted: del.rowCount });
    }
    catch (err) {
        res.status(500).json({ error: '監査ログ全削除エラー' });
    }
});
app.post('/api/audit-logs/:id/restore', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const logRes = await db_js_1.pool.query(`SELECT * FROM audit_logs WHERE id = $1`, [id]);
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
                await db_js_1.pool.query(`UPDATE notes SET title = $1, content = $2, updated_at = NOW() WHERE slot_index = $3`, [details.title || '復元メモ', details.content || '', details.slot_index]);
            }
        }
        else if (log.target_type === 'assignment' && log.details) {
            const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            const r = await db_js_1.pool.query(`INSERT INTO assignments (title, subject, description, deadline, resubmit_deadline) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [details.title, details.subject, details.description, details.deadline || new Date(), details.resubmit_deadline || null]);
            broadcast({ type: 'ASSIGNMENT_CREATED', payload: { ...r.rows[0], my_status: 'unstarted' } });
        }
        else if (log.target_type === 'message' && log.details) {
            const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            const r = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, created_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW())) RETURNING *`, [details.channel_id, details.author_id || null, details.author || 'unknown', details.content || '', details.created_at || null]);
            broadcast({ type: 'NEW_MESSAGE', payload: { ...r.rows[0], sender_username: details.author } });
        }
        logAudit(req.user, 'restore', log.target_type, log.target_id, { message: `ログ #${id} (${log.action}) から復元` });
        await db_js_1.pool.query(`UPDATE audit_logs SET restored = TRUE WHERE id = $1`, [id]);
        res.json({ success: true, id });
    }
    catch (err) {
        console.error('Restore error:', err);
        res.status(500).json({ error: '復元に失敗しました' });
    }
});
// Discord Webhook Settings & Test
app.get('/api/settings/webhook', authMiddleware, async (req, res) => {
    try {
        const webhookUrl = await getDiscordWebhookUrl();
        res.json({ webhookUrl });
    }
    catch (err) {
        res.status(500).json({ error: 'Webhook設定取得エラー' });
    }
});
app.post('/api/settings/webhook', authMiddleware, async (req, res) => {
    try {
        const { webhookUrl } = req.body;
        await db_js_1.pool.query(`INSERT INTO system_settings (key, value, updated_at) 
       VALUES ('discord_webhook_url', $1, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [webhookUrl || '']);
        res.json({ success: true, webhookUrl: webhookUrl || '' });
    }
    catch (err) {
        res.status(500).json({ error: 'Webhook設定保存エラー' });
    }
});
app.post('/api/webhook/test', authMiddleware, async (req, res) => {
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
                content: `【asdfbase 通知テスト】ユーザー: ${req.user.username} より通知テストが送信されました。`,
            }),
        });
        if (!response.ok) {
            return res.status(400).json({ error: 'Discordへの送信に失敗しました' });
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message || '送信エラー' });
    }
});
// Discord / 通知連携設定 (重要通知 Webhook・メッセージ Webhook・ON/OFF・Bot状態)
app.get('/api/settings/integrations', authMiddleware, async (req, res) => {
    try {
        res.json({
            importantWebhookUrl: await getDiscordWebhookUrl(),
            messageWebhookUrl: await getSetting('discord_message_webhook_url', ''),
            importantEnabled: (await getSetting('notify_important_enabled', 'on')) === 'on',
            messagesEnabled: (await getSetting('notify_messages_enabled', 'on')) === 'on',
            bot: await (0, discord_js_1.getDiscordStatus)(),
        });
    }
    catch (err) {
        res.status(500).json({ error: '連携設定取得エラー' });
    }
});
app.post('/api/settings/integrations', authMiddleware, async (req, res) => {
    try {
        const { importantWebhookUrl, messageWebhookUrl, importantEnabled, messagesEnabled } = req.body || {};
        const isWebhook = (u) => typeof u === 'string' && (u === '' || /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u));
        if (importantWebhookUrl !== undefined) {
            if (!isWebhook(importantWebhookUrl))
                return res.status(400).json({ error: '重要通知 Webhook URL の形式が正しくありません' });
            await setSetting('discord_webhook_url', importantWebhookUrl);
        }
        if (messageWebhookUrl !== undefined) {
            if (!isWebhook(messageWebhookUrl))
                return res.status(400).json({ error: 'メッセージ Webhook URL の形式が正しくありません' });
            await setSetting('discord_message_webhook_url', messageWebhookUrl);
        }
        if (importantEnabled !== undefined)
            await setSetting('notify_important_enabled', importantEnabled ? 'on' : 'off');
        if (messagesEnabled !== undefined)
            await setSetting('notify_messages_enabled', messagesEnabled ? 'on' : 'off');
        logAudit(req.user, 'settings_update', 'settings', null, {
            message: '通知・Discord連携設定を変更',
            changed: Object.keys(req.body || {}),
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: '連携設定保存エラー' });
    }
});
app.post('/api/settings/integrations/test', authMiddleware, async (req, res) => {
    try {
        const { kind } = req.body || {};
        const url = kind === 'message' ? await getSetting('discord_message_webhook_url', '') : await getDiscordWebhookUrl();
        if (!url)
            return res.status(400).json({ error: 'Webhook URL が設定されていません' });
        await postWebhook(url, {
            username: kind === 'message' ? '[asdfbase] テスト' : 'asdfbase 重要通知',
            content: `【asdfbase ${kind === 'message' ? 'メッセージ転送' : '重要通知'}テスト】${req.user.username} から送信`,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: `送信に失敗しました: ${err.message}` });
    }
});
// Change Password
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;
        const userRes = await db_js_1.pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0)
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        const isMatch = await bcryptjs_1.default.compare(currentPassword, userRes.rows[0].password_hash);
        if (!isMatch)
            return res.status(400).json({ error: '現在のパスワードが正しくありません' });
        const newHash = await bcryptjs_1.default.hash(newPassword, 10);
        await db_js_1.pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);
        logAudit(req.user, 'password_change', 'user', userId, { message: 'パスワードを変更', ...requestMeta(req) });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'パスワード変更エラー' });
    }
});
app.get('/api/users', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT id, username, role, status, custom_status, avatar_url, last_active_at FROM users ORDER BY username ASC`);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'ユーザー一覧取得エラー' });
    }
});
// アイコン画像 (正方形 256px の WebP に変換)
app.post('/api/users/me/avatar', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: '画像ファイルが見つかりません' });
        const filename = `avatar-${req.user.id}-${Date.now()}.webp`;
        await (0, sharp_1.default)(req.file.buffer, { animated: false })
            .resize({ width: 256, height: 256, fit: 'cover' })
            .webp({ quality: 82 })
            .toFile(path_1.default.join(UPLOAD_DIR, filename));
        const avatarUrl = `/uploads/${filename}`;
        const prev = (await db_js_1.pool.query(`SELECT avatar_url FROM users WHERE id = $1`, [req.user.id])).rows[0]?.avatar_url;
        await db_js_1.pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [avatarUrl, req.user.id]);
        if (prev && String(prev).startsWith('/uploads/avatar-')) {
            fs_1.default.promises.unlink(path_1.default.join(UPLOAD_DIR, path_1.default.basename(prev))).catch(() => { });
        }
        broadcast({ type: 'USER_UPDATED', payload: { id: req.user.id, avatar_url: avatarUrl } });
        res.json({ avatar_url: avatarUrl });
    }
    catch (err) {
        console.error('Avatar upload error:', err);
        res.status(500).json({ error: 'アイコンの保存に失敗しました' });
    }
});
app.delete('/api/users/me/avatar', authMiddleware, async (req, res) => {
    try {
        const prev = (await db_js_1.pool.query(`SELECT avatar_url FROM users WHERE id = $1`, [req.user.id])).rows[0]?.avatar_url;
        await db_js_1.pool.query(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [req.user.id]);
        if (prev && String(prev).startsWith('/uploads/avatar-')) {
            fs_1.default.promises.unlink(path_1.default.join(UPLOAD_DIR, path_1.default.basename(prev))).catch(() => { });
        }
        broadcast({ type: 'USER_UPDATED', payload: { id: req.user.id, avatar_url: null } });
        res.json({ avatar_url: null });
    }
    catch (err) {
        res.status(500).json({ error: 'アイコンの削除に失敗しました' });
    }
});
// カレンダー: 各自が予定を書き込み、全員で見られる
const formatEvent = (r) => ({
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
        const result = await db_js_1.pool.query(`SELECT e.*, u.avatar_url FROM calendar_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.event_date BETWEEN $1::date AND $2::date ORDER BY e.event_date ASC, e.event_time ASC, e.id ASC`, [from, to]);
        res.json(result.rows.map(formatEvent));
    }
    catch (err) {
        res.status(500).json({ error: '予定の取得に失敗しました' });
    }
});
function parseEventBody(body) {
    const date = String(body?.date || '');
    const time = String(body?.time || '');
    const title = String(body?.title || '').trim().slice(0, 100);
    const note = String(body?.note || '').slice(0, 2000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return { error: '日付が正しくありません' };
    if (time && !/^\d{2}:\d{2}$/.test(time))
        return { error: '時刻が正しくありません' };
    if (!title)
        return { error: '予定の名前を入力してください' };
    return { date, time, title, note };
}
app.post('/api/calendar', authMiddleware, async (req, res) => {
    try {
        const ev = parseEventBody(req.body);
        if ('error' in ev)
            return res.status(400).json({ error: ev.error });
        const result = await db_js_1.pool.query(`INSERT INTO calendar_events (user_id, username, event_date, event_time, title, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [req.user.id, req.user.username, ev.date, ev.time, ev.title, ev.note]);
        const created = formatEvent(result.rows[0]);
        broadcast({ type: 'CALENDAR_UPDATED', payload: created });
        res.json(created);
    }
    catch (err) {
        res.status(500).json({ error: '予定の保存に失敗しました' });
    }
});
app.put('/api/calendar/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const current = (await db_js_1.pool.query(`SELECT * FROM calendar_events WHERE id = $1`, [id])).rows[0];
        if (!current)
            return res.status(404).json({ error: '予定が見つかりません' });
        if (current.user_id !== req.user.id && req.user.role !== 'admin')
            return res.status(403).json({ error: '他の人の予定は編集できません' });
        const ev = parseEventBody(req.body);
        if ('error' in ev)
            return res.status(400).json({ error: ev.error });
        const result = await db_js_1.pool.query(`UPDATE calendar_events SET event_date = $1, event_time = $2, title = $3, note = $4 WHERE id = $5 RETURNING *`, [ev.date, ev.time, ev.title, ev.note, id]);
        const updated = formatEvent(result.rows[0]);
        broadcast({ type: 'CALENDAR_UPDATED', payload: updated });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: '予定の保存に失敗しました' });
    }
});
app.delete('/api/calendar/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const current = (await db_js_1.pool.query(`SELECT * FROM calendar_events WHERE id = $1`, [id])).rows[0];
        if (!current)
            return res.status(404).json({ error: '予定が見つかりません' });
        if (current.user_id !== req.user.id && req.user.role !== 'admin')
            return res.status(403).json({ error: '他の人の予定は削除できません' });
        await db_js_1.pool.query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
        broadcast({ type: 'CALENDAR_DELETED', payload: { id } });
        logAudit(req.user, 'calendar_delete', 'calendar', id, { message: `予定「${current.title}」を削除`, date: formatEvent(current).event_date });
        res.json({ success: true, id });
    }
    catch (err) {
        res.status(500).json({ error: '予定の削除に失敗しました' });
    }
});
// Delete user account (self or admin)
app.delete('/api/users/:userId', authMiddleware, async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId, 10);
        const requesterId = req.user.id;
        const requesterRole = req.user.role;
        if (requesterRole !== 'admin' && requesterId !== targetUserId) {
            return res.status(403).json({ error: 'アカウント削除の権限がありません' });
        }
        // Check if target is admin
        const targetUser = await db_js_1.pool.query(`SELECT id, username, role FROM users WHERE id = $1`, [targetUserId]);
        if (targetUser.rows.length === 0) {
            return res.status(404).json({ error: 'ユーザーが見つかりません' });
        }
        if (targetUser.rows[0].role === 'admin') {
            const adminCount = await db_js_1.pool.query(`SELECT COUNT(*) FROM users WHERE role = 'admin'`);
            if (parseInt(adminCount.rows[0].count, 10) <= 1) {
                return res.status(400).json({ error: '最後の管理者は削除できません' });
            }
        }
        await db_js_1.pool.query(`DELETE FROM users WHERE id = $1`, [targetUserId]);
        broadcast({ type: 'USER_DELETED', payload: { userId: targetUserId } });
        logAudit(req.user, 'user_delete', 'user', targetUserId, { message: `アカウント ${targetUser.rows[0].username} を削除` });
        res.json({ success: true, userId: targetUserId });
    }
    catch (err) {
        console.error('User delete error:', err);
        res.status(500).json({ error: 'アカウント削除に失敗しました' });
    }
});
const BOOT_ID = Math.random().toString(36).slice(2, 10);
const EVENT_LOG_MAX = 3000;
const eventLog = [];
let eventSeq = 0;
const clients = new Map();
const aliveSockets = new WeakMap();
const sseClients = new Set();
const waiters = new Set();
function eventVisibleTo(ev, userId, connId) {
    if (ev.targetUserId !== undefined && ev.targetUserId !== userId)
        return false;
    if (ev.excludeConnId && ev.excludeConnId === connId)
        return false;
    return true;
}
function publish(message, opts = {}) {
    const seq = ++eventSeq;
    const ev = { seq, data: JSON.stringify({ ...message, seq }), ...opts };
    eventLog.push(ev);
    if (eventLog.length > EVENT_LOG_MAX)
        eventLog.splice(0, eventLog.length - EVENT_LOG_MAX);
    for (const [ws, info] of clients.entries()) {
        if (!info.userId || ws.readyState !== ws_1.WebSocket.OPEN)
            continue;
        if (!eventVisibleTo(ev, info.userId, info.connId || ''))
            continue;
        try {
            ws.send(ev.data);
        }
        catch (err) {
            console.error('WS send error:', err);
        }
    }
    for (const c of sseClients) {
        if (!eventVisibleTo(ev, c.userId, c.connId))
            continue;
        try {
            c.res.write(`id: ${seq}\ndata: ${ev.data}\n\n`);
        }
        catch (_) { }
    }
    for (const w of waiters) {
        if (eventVisibleTo(ev, w.userId, w.connId))
            w.finish();
    }
}
function broadcast(message, excludeConnId) {
    publish(message, { excludeConnId });
}
// after 以降で自分宛てのイベント。バッファ切れ/サーバー再起動なら reset=true
function eventsSince(after, boot, userId, connId) {
    const oldest = eventLog.length > 0 ? eventLog[0].seq : eventSeq + 1;
    const reset = (boot !== undefined && boot !== '' && boot !== BOOT_ID) || after > eventSeq || (after > 0 && after < oldest - 1);
    if (reset)
        return { reset: true, events: [] };
    const events = [];
    for (const ev of eventLog) {
        if (ev.seq > after && eventVisibleTo(ev, userId, connId))
            events.push(ev.data);
    }
    return { reset: false, events };
}
const presence = new Map();
const PRESENCE_TIMEOUT_MS = 35000;
async function setUserStatus(userId, status) {
    const p = presence.get(userId) || { connections: 0, lastHttp: 0, status: 'offline' };
    if (p.status === status)
        return;
    p.status = status;
    presence.set(userId, p);
    try {
        await db_js_1.pool.query(`UPDATE users SET status = $1, last_active_at = NOW() WHERE id = $2`, [status, userId]);
    }
    catch (_) { }
    broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId, status } });
}
function touchPresence(userId) {
    const p = presence.get(userId) || { connections: 0, lastHttp: 0, status: 'offline' };
    p.lastHttp = Date.now();
    presence.set(userId, p);
    if (p.status === 'offline')
        setUserStatus(userId, 'online');
}
function addConnection(userId) {
    const p = presence.get(userId) || { connections: 0, lastHttp: 0, status: 'offline' };
    p.connections++;
    p.lastHttp = Date.now();
    presence.set(userId, p);
    if (p.status === 'offline')
        setUserStatus(userId, 'online');
}
function removeConnection(userId) {
    const p = presence.get(userId);
    if (!p)
        return;
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
async function handleClientMessage(user, connId, msg) {
    if (msg.type === 'SEND_MESSAGE') {
        const { channelId, content, attachments, replyToId, clientNonce } = msg;
        const result = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [channelId, user.id, user.username, content, JSON.stringify(attachments || []), replyToId || null]);
        const [savedMessage] = await attachReplies([{ ...result.rows[0], sender_username: user.username, client_nonce: clientNonce || null }]);
        broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });
        if (String(content).includes('@everyone')) {
            notifyImportant(`📢 ${user.username} から全員への連絡`, String(content));
        }
        relayMessage(savedMessage);
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
function verifyToken(token) {
    if (!token)
        return null;
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (_) {
        return null;
    }
}
function getConnId(req) {
    return String(req.query.connId || req.headers['x-conn-id'] || '').slice(0, 64);
}
// 疎通確認・トランスポート情報
app.get('/api/rt/info', authMiddleware, (req, res) => {
    touchPresence(req.user.id);
    res.json({ boot: BOOT_ID, seq: eventSeq });
});
// Polling / Long-polling: GET /api/rt/poll?after=&boot=&wait=秒
app.get('/api/rt/poll', authMiddleware, (req, res) => {
    const user = req.user;
    const connId = getConnId(req);
    const after = parseInt(req.query.after, 10) || 0;
    const boot = req.query.boot;
    const wait = Math.min(Math.max(parseInt(req.query.wait, 10) || 0, 0), 25);
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
    const waiter = {
        userId: user.id,
        connId,
        after,
        finish: () => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            waiters.delete(waiter);
            // 同時に発生したイベントをまとめて返すため少しだけ待つ
            setTimeout(() => {
                if (!res.writableEnded)
                    reply();
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
    const user = verifyToken(req.query.token || (req.headers.authorization || '').replace('Bearer ', ''));
    if (!user)
        return res.status(401).json({ error: '無効または期限切れのトークンです' });
    const connId = getConnId(req);
    const after = parseInt(req.query.after || req.headers['last-event-id'], 10) || 0;
    const boot = req.query.boot;
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
    }
    else {
        for (const e of r.events)
            res.write(`data: ${e}\n\n`);
    }
    const client = { res, userId: user.id, connId };
    sseClients.add(client);
    addConnection(user.id);
    const ping = setInterval(() => {
        try {
            res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        }
        catch (_) { }
    }, 15000);
    req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(client);
        removeConnection(user.id);
    });
});
// HTTP経由でのクライアントメッセージ送信 (WS不通時)
app.post('/api/rt/send', authMiddleware, async (req, res) => {
    try {
        touchPresence(req.user.id);
        await handleClientMessage(req.user, getConnId(req), req.body || {});
        res.json({ ok: true });
    }
    catch (err) {
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
        }
        catch (_) { }
    }
}, 25000);
wss.on('close', () => clearInterval(wsHeartbeat));
wss.on('connection', (ws) => {
    clients.set(ws, { ws });
    aliveSockets.set(ws, true);
    ws.on('pong', () => aliveSockets.set(ws, true));
    ws.on('error', (err) => console.error('WS socket error:', err.message));
    ws.on('message', async (data) => {
        aliveSockets.set(ws, true);
        try {
            const msg = JSON.parse(data.toString());
            // Application-level heartbeat (keeps proxies from idling out & lets client detect dead links)
            if (msg.type === 'PING') {
                if (ws.readyState === ws_1.WebSocket.OPEN)
                    ws.send(JSON.stringify({ type: 'PONG', t: msg.t || Date.now() }));
                return;
            }
            if (msg.type === 'AUTH') {
                const decoded = verifyToken(msg.token);
                if (!decoded) {
                    if (ws.readyState === ws_1.WebSocket.OPEN)
                        ws.send(JSON.stringify({ type: 'AUTH_ERROR' }));
                    return;
                }
                const prev = clients.get(ws);
                if (prev?.userId)
                    removeConnection(prev.userId);
                const connId = String(msg.connId || '').slice(0, 64);
                clients.set(ws, { ws, connId, userId: decoded.id, username: decoded.username });
                addConnection(decoded.id);
                // 取りこぼし分を返してから AUTH_OK
                const after = Number(msg.after) || 0;
                const r = eventsSince(after, msg.boot, decoded.id, connId);
                if (ws.readyState === ws_1.WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'AUTH_OK', payload: { userId: decoded.id, boot: BOOT_ID, seq: eventSeq, reset: r.reset } }));
                    if (!r.reset)
                        for (const e of r.events)
                            ws.send(e);
                }
                return;
            }
            const clientInfo = clients.get(ws);
            if (!clientInfo || !clientInfo.userId)
                return;
            await handleClientMessage({ id: clientInfo.userId, username: clientInfo.username || '' }, clientInfo.connId || '', msg);
        }
        catch (err) {
            console.error('WS Message error:', err);
        }
    });
    ws.on('close', () => {
        const info = clients.get(ws);
        clients.delete(ws);
        if (info && info.userId)
            removeConnection(info.userId);
    });
});
server.listen(PORT, async () => {
    console.log(`[asdfbase-backend] Server listening on http://127.0.0.1:${PORT}`);
    try {
        await (0, db_js_1.initDb)();
        // 再起動直後は全員オフライン扱いにし、接続/アクセスで復帰させる
        await db_js_1.pool.query(`UPDATE users SET status = 'offline'`);
        await db_js_1.pool.query(`
      ALTER TABLE timetables ADD COLUMN IF NOT EXISTS items TEXT DEFAULT '';
      ALTER TABLE timetables ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
    `).catch(err => console.warn('Timetable migration warning:', err.message));
        await ensureNoteSlots();
    }
    catch (err) {
        console.error('DB Init failed:', err);
    }
    try {
        await (0, discord_js_1.startDiscordBot)({
            getSetting,
            setSetting,
            listAsdfChannels: async () => (await db_js_1.pool.query(`SELECT id, name, type FROM channels ORDER BY position ASC, id ASC`)).rows,
            ingest: async (asdfChannelId, username, content) => {
                const result = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content) VALUES ($1, NULL, $2, $3) RETURNING *`, [asdfChannelId, username, content]);
                broadcast({ type: 'NEW_MESSAGE', payload: { ...result.rows[0], sender_username: username } });
            },
            saveImage: async (buf) => {
                const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.webp`;
                await (0, sharp_1.default)(buf, { animated: false }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path_1.default.join(UPLOAD_DIR, filename));
                return `/uploads/${filename}`;
            },
            uploadDir: UPLOAD_DIR,
            audit: (action, details) => logAudit(null, action, 'discord', null, details),
        });
    }
    catch (err) {
        console.error('Discord bot start failed:', err);
    }
});
