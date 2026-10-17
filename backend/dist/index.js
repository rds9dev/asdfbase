"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const db_js_1 = require("./db.js");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
const PORT = process.env.PORT || 8091;
const JWT_SECRET = process.env.JWT_SECRET || 'asdfbase_jwt_super_secret_key_2026_x89q';
const INVITE_CODE = process.env.INVITE_CODE || 'ASDF';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const UPLOAD_DIR = path_1.default.resolve('uploads');
if (!fs_1.default.existsSync(UPLOAD_DIR)) {
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use((0, cors_1.default)({ origin: '*' }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use('/uploads', express_1.default.static(UPLOAD_DIR));
// Multer in-memory storage for sharp compression
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit before compression
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
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'asdfbase-api', timestamp: new Date().toISOString() });
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
            return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        }
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
        const result = await db_js_1.pool.query(`SELECT id, username, role, status, custom_status, created_at FROM users WHERE id = $1`, [req.user.id]);
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
        // 最大幅1600px、品質80%のWebPに自動圧縮
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
        const result = await db_js_1.pool.query(`SELECT * FROM channels ORDER BY id ASC`);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'チャンネル取得エラー' });
    }
});
// Messages API
app.get('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId, 10);
        const limit = parseInt(req.query.limit, 10) || 50;
        const result = await db_js_1.pool.query(`SELECT m.*, u.username as sender_username 
       FROM messages m 
       LEFT JOIN users u ON m.user_id = u.id 
       WHERE m.channel_id = $1 
       ORDER BY m.id DESC LIMIT $2`, [channelId, limit]);
        res.json(result.rows.reverse());
    }
    catch (err) {
        res.status(500).json({ error: 'メッセージ取得エラー' });
    }
});
// Post Message (REST fallback)
app.post('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId, 10);
        const { content, attachments, replyToId } = req.body;
        const userId = req.user.id;
        const username = req.user.username;
        const result = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [channelId, userId, username, content, JSON.stringify(attachments || []), replyToId || null]);
        const savedMessage = { ...result.rows[0], sender_username: username };
        // WebSocketブロードキャスト
        broadcast({
            type: 'NEW_MESSAGE',
            payload: savedMessage,
        });
        // Discord Webhook 中継（設定されている場合）
        if (DISCORD_WEBHOOK_URL) {
            fetch(DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: `[asdfbase] ${username}`,
                    content: content,
                }),
            }).catch(err => console.error('Discord webhook relay error:', err));
        }
        res.json(savedMessage);
    }
    catch (err) {
        console.error('Post message error:', err);
        res.status(500).json({ error: 'メッセージ投稿エラー' });
    }
});
// Reaction on Message
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
// Pin Message
app.post('/api/messages/:messageId/pin', authMiddleware, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId, 10);
        const updated = await db_js_1.pool.query(`UPDATE messages SET is_pinned = NOT is_pinned WHERE id = $1 RETURNING *`, [messageId]);
        broadcast({
            type: 'MESSAGE_PIN_UPDATED',
            payload: updated.rows[0],
        });
        res.json(updated.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: 'ピン留め更新エラー' });
    }
});
// Notes (Slots 1-10) API
app.get('/api/notes', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT * FROM notes ORDER BY slot_index ASC`);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'メモ取得エラー' });
    }
});
app.put('/api/notes/:slotIndex', authMiddleware, async (req, res) => {
    try {
        const slotIndex = parseInt(req.params.slotIndex, 10);
        const { title, content, mode, assigned_user_id } = req.body;
        const userId = req.user.id;
        const username = req.user.username;
        const currentNoteRes = await db_js_1.pool.query(`SELECT * FROM notes WHERE slot_index = $1`, [slotIndex]);
        const currentNote = currentNoteRes.rows[0];
        // Monaco editor モードかつ専用ゾーン指定がある場合のロックチェック
        if (currentNote &&
            currentNote.mode === 'monaco' &&
            currentNote.assigned_user_id &&
            currentNote.assigned_user_id !== userId) {
            return res.status(403).json({ error: 'このメモは他ユーザーの専用ゾーンです（閲覧専用）' });
        }
        // 履歴保存
        if (currentNote && currentNote.content !== content) {
            await db_js_1.pool.query(`INSERT INTO note_history (slot_index, content, updated_by_id) VALUES ($1, $2, $3)`, [slotIndex, currentNote.content, userId]);
        }
        const updated = await db_js_1.pool.query(`UPDATE notes 
       SET title = COALESCE($1, title), 
           content = COALESCE($2, content), 
           mode = COALESCE($3, mode), 
           assigned_user_id = COALESCE($4, assigned_user_id),
           version = version + 1, 
           updated_at = NOW() 
       WHERE slot_index = $5 RETURNING *`, [title, content, mode, assigned_user_id !== undefined ? assigned_user_id : null, slotIndex]);
        broadcast({
            type: 'NOTE_UPDATED',
            payload: updated.rows[0],
            sender: username,
        });
        res.json(updated.rows[0]);
    }
    catch (err) {
        console.error('Note update error:', err);
        res.status(500).json({ error: 'メモ更新エラー' });
    }
});
// Audit Logs
app.get('/api/audit-logs', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50`);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: '監査ログ取得エラー' });
    }
});
// Users List
app.get('/api/users', authMiddleware, async (req, res) => {
    try {
        const result = await db_js_1.pool.query(`SELECT id, username, role, status, custom_status, last_active_at FROM users ORDER BY username ASC`);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'ユーザー一覧取得エラー' });
    }
});
const clients = new Map();
function broadcast(message, excludeWs) {
    const data = JSON.stringify(message);
    for (const [ws] of clients.entries()) {
        if (ws !== excludeWs && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(data);
        }
    }
}
wss.on('connection', (ws) => {
    clients.set(ws, { ws });
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'AUTH') {
                const decoded = jsonwebtoken_1.default.verify(msg.token, JWT_SECRET);
                clients.set(ws, { ws, userId: decoded.id, username: decoded.username });
                await db_js_1.pool.query(`UPDATE users SET status = 'online', last_active_at = NOW() WHERE id = $1`, [decoded.id]);
                broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId: decoded.id, status: 'online' } });
                return;
            }
            const clientInfo = clients.get(ws);
            if (!clientInfo || !clientInfo.userId)
                return;
            if (msg.type === 'SEND_MESSAGE') {
                const { channelId, content, attachments, replyToId } = msg;
                const result = await db_js_1.pool.query(`INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [channelId, clientInfo.userId, clientInfo.username, content, JSON.stringify(attachments || []), replyToId || null]);
                const savedMessage = { ...result.rows[0], sender_username: clientInfo.username };
                broadcast({
                    type: 'NEW_MESSAGE',
                    payload: savedMessage,
                });
                if (DISCORD_WEBHOOK_URL) {
                    fetch(DISCORD_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: `[asdfbase] ${clientInfo.username}`,
                            content: content,
                        }),
                    }).catch(err => console.error('Discord webhook relay error:', err));
                }
            }
            if (msg.type === 'NOTE_SYNC') {
                // メモのリアルタイムキーストローク共有
                broadcast({
                    type: 'NOTE_SYNC',
                    payload: msg.payload, // { slotIndex, content, version }
                    sender: clientInfo.username,
                }, ws);
            }
            if (msg.type === 'SET_STATUS') {
                const { status } = msg;
                await db_js_1.pool.query(`UPDATE users SET status = $1, last_active_at = NOW() WHERE id = $2`, [status, clientInfo.userId]);
                broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId: clientInfo.userId, status } });
            }
        }
        catch (err) {
            console.error('WS Message error:', err);
        }
    });
    ws.on('close', async () => {
        const info = clients.get(ws);
        if (info && info.userId) {
            await db_js_1.pool.query(`UPDATE users SET status = 'offline', last_active_at = NOW() WHERE id = $1`, [info.userId]);
            broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId: info.userId, status: 'offline' } });
        }
        clients.delete(ws);
    });
});
server.listen(PORT, async () => {
    console.log(`[asdfbase-backend] Server listening on http://127.0.0.1:${PORT}`);
    try {
        await (0, db_js_1.initDb)();
    }
    catch (err) {
        console.error('DB Init failed:', err);
    }
});
