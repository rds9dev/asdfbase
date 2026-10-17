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
import { pool, initDb } from './db.js';
import { askGemini, chatWithGemini, getAvailableKeyCount } from './gemini.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8091;
const JWT_SECRET = process.env.JWT_SECRET || 'asdfbase_jwt_super_secret_key_2026_x89q';
const INVITE_CODE = process.env.INVITE_CODE || 'ASDF';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証トークンがありません' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string; role: string };
    req.user = decoded;
    next();
  } catch (err) {
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

// Weather Cache & API (高松市)
let weatherCache: { temp: number; desc: string; weatherCode: number; updatedAt: number } | null = null;

function getWeatherDescription(code: number): string {
  if (code === 0) return '快晴';
  if (code === 1) return '晴れ';
  if (code === 2) return '一部曇';
  if (code === 3) return '曇り';
  if (code === 45 || code === 48) return '霧';
  if (code >= 51 && code <= 55) return '霧雨';
  if (code >= 61 && code <= 65) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return 'にわか雨';
  if (code >= 85 && code <= 86) return '雪';
  if (code >= 95) return '雷雨';
  return '晴れ';
}

app.get('/api/weather', async (req, res) => {
  const now = Date.now();
  if (weatherCache && (now - weatherCache.updatedAt) < 10 * 60 * 1000) {
    return res.json(weatherCache);
  }

  try {
    const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=34.34&longitude=134.04&current_weather=true&timezone=Asia%2FTokyo');
    if (response.ok) {
      const data = await response.json() as any;
      if (data && data.current_weather) {
        const weatherCode = Number(data.current_weather.weathercode);
        const temp = Math.round(data.current_weather.temperature);
        const desc = getWeatherDescription(weatherCode);
        weatherCache = { temp, desc, weatherCode, updatedAt: now };
        return res.json(weatherCache);
      }
    }
  } catch (err) {
    console.error('Failed to fetch weather in backend:', err);
  }

  const fallback = weatherCache || { temp: 21, desc: '晴れ', weatherCode: 1, updatedAt: now };
  res.json(fallback);
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
      return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

// Current User Profile
app.get('/api/auth/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, status, custom_status, created_at FROM users WHERE id = $1`,
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

// Channels API
app.get('/api/channels', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM channels ORDER BY id ASC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'チャンネル取得エラー' });
  }
});

app.post('/api/channels', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, type } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'チャンネル名を入力してください' });
    }
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');
    const chType = type === 'voice' ? 'voice' : 'text';

    const result = await pool.query(
      `INSERT INTO channels (name, type) VALUES ($1, $2) RETURNING *`,
      [cleanName, chType]
    );
    const newChannel = result.rows[0];
    broadcast({ type: 'CHANNEL_CREATED', payload: newChannel });
    res.json(newChannel);
  } catch (err) {
    console.error('Channel create error:', err);
    res.status(500).json({ error: 'チャンネル作成に失敗しました' });
  }
});

app.delete('/api/channels/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Don't allow deleting id 1 or last channel
    const countRes = await pool.query(`SELECT COUNT(*) FROM channels`);
    if (parseInt(countRes.rows[0].count, 10) <= 1) {
      return res.status(400).json({ error: '最後のチャンネルは削除できません' });
    }

    await pool.query(`DELETE FROM channels WHERE id = $1`, [id]);
    broadcast({ type: 'CHANNEL_DELETED', payload: { id } });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Channel delete error:', err);
    res.status(500).json({ error: 'チャンネル削除に失敗しました' });
  }
});

// Messages API
app.get('/api/channels/:channelId/messages', authMiddleware, async (req, res) => {
  try {
    const channelId = parseInt(req.params.channelId, 10);
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const result = await pool.query(
      `SELECT m.*, u.username as sender_username 
       FROM messages m 
       LEFT JOIN users u ON m.user_id = u.id 
       WHERE m.channel_id = $1 
       ORDER BY m.id DESC LIMIT $2`,
      [channelId, limit]
    );
    res.json(result.rows.reverse());
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

    const updated = await pool.query(
      `UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [content, messageId]
    );

    const updatedMessage = { ...updated.rows[0], sender_username: req.user!.username };
    broadcast({ type: 'MESSAGE_UPDATED', payload: updatedMessage });
    res.json(updatedMessage);
  } catch (err) {
    console.error('Message update error:', err);
    res.status(500).json({ error: 'メッセージ編集エラー' });
  }
});

// Post Message with AI @gemini mention support (commands like /ai removed)
app.post('/api/channels/:channelId/messages', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const channelId = parseInt(req.params.channelId, 10);
    const { content, attachments, replyToId } = req.body;
    const userId = req.user!.id;
    const username = req.user!.username;

    const result = await pool.query(
      `INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [channelId, userId, username, content, JSON.stringify(attachments || []), replyToId || null]
    );

    const savedMessage = { ...result.rows[0], sender_username: username };
    broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });

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

    // Check for @gemini mention trigger
    const trimmed = content.trim();
    if (trimmed.includes('@gemini')) {
      const prompt = trimmed.replace(/@gemini/g, '').trim();
      if (prompt) {
        setTimeout(async () => {
          const aiResponse = await askGemini(prompt, '簡潔に答えてください。');
          const botResult = await pool.query(
            `INSERT INTO messages (channel_id, user_id, username, content, reply_to_id) 
             VALUES ($1, NULL, 'Gemini', $2, $3) RETURNING *`,
            [channelId, aiResponse, savedMessage.id]
          );
          const aiMessage = { ...botResult.rows[0], sender_username: 'Gemini' };
          broadcast({ type: 'NEW_MESSAGE', payload: aiMessage });
        }, 100);
      }
    }

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

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'リアクション更新エラー' });
  }
});

app.post('/api/messages/:messageId/pin', authMiddleware, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId, 10);
    const updated = await pool.query(
      `UPDATE messages SET is_pinned = NOT is_pinned WHERE id = $1 RETURNING *`,
      [messageId]
    );
    broadcast({
      type: 'MESSAGE_PIN_UPDATED',
      payload: updated.rows[0],
    });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'ピン留め更新エラー' });
  }
});

// Timetables API
app.get('/api/timetables', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM timetables ORDER BY day_of_week ASC, period ASC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '時間割取得エラー' });
  }
});

app.post('/api/timetables', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { dayOfWeek, period, subject, scheduleType } = req.body;
    const result = await pool.query(
      `INSERT INTO timetables (day_of_week, period, subject, schedule_type) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [dayOfWeek, period, subject, scheduleType || 'normal']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '時間割登録エラー' });
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
    const result = await pool.query(
      `INSERT INTO assignments (title, subject, description, deadline, resubmit_deadline) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, subject, description, deadline, resubmitDeadline || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '提出物作成エラー' });
  }
});

// Update Assignment Progress (未着手/進行中/提出済み/再提出/合格)
app.put('/api/assignments/:id/progress', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const assignmentId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const userId = req.user!.id;

    await pool.query(
      `INSERT INTO assignment_progress (assignment_id, user_id, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (assignment_id, user_id) 
       DO UPDATE SET status = EXCLUDED.status`,
      [assignmentId, userId, status]
    );

    // 全員合格チェック
    const usersCountRes = await pool.query(`SELECT COUNT(*) FROM users`);
    const passedCountRes = await pool.query(
      `SELECT COUNT(*) FROM assignment_progress WHERE assignment_id = $1 AND status = 'passed'`,
      [assignmentId]
    );

    const totalUsers = parseInt(usersCountRes.rows[0].count, 10);
    const passedUsers = parseInt(passedCountRes.rows[0].count, 10);

    if (totalUsers > 0 && passedUsers >= totalUsers) {
      await pool.query(`UPDATE assignments SET is_archived = TRUE WHERE id = $1`, [assignmentId]);
    }

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: '進捗更新エラー' });
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

// Test Scores & AI Advice
app.get('/api/test-scores', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      `SELECT * FROM test_scores WHERE user_id = $1 ORDER BY exam_name ASC, subject ASC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'テスト点数取得エラー' });
  }
});

app.post('/api/test-scores', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { examName, subject, score, maxScore } = req.body;

    const result = await pool.query(
      `INSERT INTO test_scores (user_id, exam_name, subject, score, max_score) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, examName, subject, score, maxScore || 100]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'テスト点数登録エラー' });
  }
});

app.post('/api/test-scores/advice', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const scores = await pool.query(`SELECT subject, score, max_score FROM test_scores WHERE user_id = $1`, [userId]);
    if (scores.rows.length === 0) {
      return res.status(400).json({ error: 'テスト点数が記録されていません' });
    }

    const scoreSummary = scores.rows.map(s => `${s.subject}: ${s.score}/${s.max_score}点`).join(', ');
    const prompt = `私のテスト結果は以下の通りです:\n${scoreSummary}\n合計点や得点傾向を分析し、今後の勉強方針や苦手克服のための具体的なアドバイスを教えてください。`;

    const advice = await askGemini(prompt, '高校生・学生向けの親身で具体的な学習アドバイザーとして回答してください。');
    res.json({ advice });
  } catch (err) {
    res.status(500).json({ error: 'アドバイス生成エラー' });
  }
});

// AI Chat Endpoint (for AI Tab)
app.post('/api/ai/chat', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { messages, contextData, systemInstruction } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: '会話履歴（messages）が必要です' });
    }

    const reply = await chatWithGemini(messages, contextData, systemInstruction);
    res.json({ reply, keyCount: getAvailableKeyCount() });
  } catch (err: any) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: 'AI応答エラー' });
  }
});

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
      prompt = `以下の文章の誤字脱字、表現の不自然さを校正し、改善後の文章を提示してください:\n\n${content}`;
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
app.get('/api/timetables', authMiddleware, async (req, res) => {
  try {
    const scheduleType = (req.query.scheduleType as string) || 'normal';
    const result = await pool.query(
      `SELECT * FROM timetables WHERE schedule_type = $1 ORDER BY day_of_week ASC, period ASC`,
      [scheduleType]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '時間割取得エラー' });
  }
});

app.post('/api/timetables', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { dayOfWeek, period, subject, scheduleType } = req.body;
    if (dayOfWeek === undefined || !period || !subject) {
      return res.status(400).json({ error: '曜日、時限、教科名は必須です' });
    }

    const result = await pool.query(
      `INSERT INTO timetables (day_of_week, period, subject, schedule_type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [dayOfWeek, period, subject, scheduleType || 'normal']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '時間割登録エラー' });
  }
});

app.delete('/api/timetables/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM timetables WHERE id = $1`, [id]);
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
    await pool.query(`DELETE FROM board_strokes`);
    await pool.query(`DELETE FROM board_texts`);
    broadcast({ type: 'BOARD_CLEARED' });
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

// Notes (Slots 1-10) API
app.get('/api/notes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM notes ORDER BY slot_index ASC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'メモ取得エラー' });
  }
});

app.put('/api/notes/:slotIndex', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const slotIndex = parseInt(req.params.slotIndex, 10);
    const { title, content, mode, assigned_user_id } = req.body;
    const userId = req.user!.id;
    const username = req.user!.username;

    const currentNoteRes = await pool.query(`SELECT * FROM notes WHERE slot_index = $1`, [slotIndex]);
    const currentNote = currentNoteRes.rows[0];

    if (
      currentNote && 
      currentNote.mode === 'monaco' && 
      currentNote.assigned_user_id && 
      currentNote.assigned_user_id !== userId
    ) {
      return res.status(403).json({ error: 'このメモは他ユーザーの専用ゾーンです（閲覧専用）' });
    }

    if (currentNote && currentNote.content !== content) {
      await pool.query(
        `INSERT INTO note_history (slot_index, content, updated_by_id) VALUES ($1, $2, $3)`,
        [slotIndex, currentNote.content, userId]
      );
    }

    const updated = await pool.query(
      `UPDATE notes 
       SET title = COALESCE($1, title), 
           content = COALESCE($2, content), 
           mode = COALESCE($3, mode), 
           assigned_user_id = COALESCE($4, assigned_user_id),
           version = version + 1, 
           updated_at = NOW() 
       WHERE slot_index = $5 RETURNING *`,
      [title, content, mode, assigned_user_id !== undefined ? assigned_user_id : null, slotIndex]
    );

    broadcast({
      type: 'NOTE_UPDATED',
      payload: updated.rows[0],
      sender: username,
    });

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Note update error:', err);
    res.status(500).json({ error: 'メモ更新エラー' });
  }
});

// Audit Logs & Users List
app.get('/api/audit-logs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '監査ログ取得エラー' });
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
      await pool.query(
        `INSERT INTO assignments (title, subject, description, deadline) VALUES ($1, $2, $3, $4)`,
        [details.title, details.subject, details.description, details.deadline || new Date()]
      );
    }

    await pool.query(`UPDATE audit_logs SET restored = TRUE WHERE id = $1`, [id]);
    res.json({ success: true, id });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: '復元に失敗しました' });
  }
});

// Discord Webhook Test & Relay
app.post('/api/webhook/test', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { webhookUrl } = req.body;
    const targetUrl = webhookUrl || DISCORD_WEBHOOK_URL;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Discord Webhook URLが指定されていません' });
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'パスワード変更エラー' });
  }
});

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, status, custom_status, last_active_at FROM users ORDER BY username ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'ユーザー一覧取得エラー' });
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
    res.json({ success: true, userId: targetUserId });
  } catch (err) {
    console.error('User delete error:', err);
    res.status(500).json({ error: 'アカウント削除に失敗しました' });
  }
});

// WebSocket Server & Broadcast
interface ClientInfo {
  ws: WebSocket;
  userId?: number;
  username?: string;
}

const clients = new Map<WebSocket, ClientInfo>();

function broadcast(message: object, excludeWs?: WebSocket) {
  const data = JSON.stringify(message);
  for (const [ws] of clients.entries()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

wss.on('connection', (ws: WebSocket) => {
  clients.set(ws, { ws });

  ws.on('message', async (data: string) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'AUTH') {
        const decoded = jwt.verify(msg.token, JWT_SECRET) as { id: number; username: string; role: string };
        clients.set(ws, { ws, userId: decoded.id, username: decoded.username });
        
        await pool.query(`UPDATE users SET status = 'online', last_active_at = NOW() WHERE id = $1`, [decoded.id]);
        broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId: decoded.id, status: 'online' } });
        return;
      }

      const clientInfo = clients.get(ws);
      if (!clientInfo || !clientInfo.userId) return;

      if (msg.type === 'SEND_MESSAGE') {
        const { channelId, content, attachments, replyToId } = msg;
        const result = await pool.query(
          `INSERT INTO messages (channel_id, user_id, username, content, attachments, reply_to_id) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [channelId, clientInfo.userId, clientInfo.username, content, JSON.stringify(attachments || []), replyToId || null]
        );
        const savedMessage = { ...result.rows[0], sender_username: clientInfo.username };

        broadcast({ type: 'NEW_MESSAGE', payload: savedMessage });

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

        // Handle AI reply via WS
        const trimmed = content.trim();
        if (trimmed.includes('@gemini')) {
          const prompt = trimmed.replace(/@gemini/g, '').trim();
          if (prompt) {
            setTimeout(async () => {
              const aiResponse = await askGemini(prompt, '簡潔に答えてください。');
              const botResult = await pool.query(
                `INSERT INTO messages (channel_id, user_id, username, content, reply_to_id) 
                 VALUES ($1, NULL, 'Gemini', $2, $3) RETURNING *`,
                [channelId, aiResponse, savedMessage.id]
              );
              broadcast({
                type: 'NEW_MESSAGE',
                payload: { ...botResult.rows[0], sender_username: 'Gemini' },
              });
            }, 100);
          }
        }
      }

      // Realtime text/markdown note sync
      if (msg.type === 'NOTE_CONTENT_SYNC') {
        const { slotIndex, content, title } = msg;
        broadcast({
          type: 'NOTE_CONTENT_SYNC',
          payload: { slotIndex, content, title, senderId: clientInfo.userId, senderUsername: clientInfo.username },
        }, ws);
      }

      // WebRTC Signaling for Voice Chat & Screen Share
      if (msg.type === 'WEBRTC_SIGNAL') {
        const { targetUserId, signal, channelId } = msg;
        // Direct to target user
        for (const [targetWs, info] of clients.entries()) {
          if (info.userId === targetUserId && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({
              type: 'WEBRTC_SIGNAL',
              payload: {
                fromUserId: clientInfo.userId,
                fromUsername: clientInfo.username,
                signal,
                channelId,
              }
            }));
            break;
          }
        }
      }

      if (msg.type === 'VC_JOIN') {
        const { channelId } = msg;
        broadcast({
          type: 'VC_USER_JOINED',
          payload: { userId: clientInfo.userId, username: clientInfo.username, channelId }
        });
      }

      if (msg.type === 'VC_LEAVE') {
        const { channelId } = msg;
        broadcast({
          type: 'VC_USER_LEFT',
          payload: { userId: clientInfo.userId, username: clientInfo.username, channelId }
        });
      }

      if (msg.type === 'VC_STATE_CHANGE') {
        const { channelId, isMuted, isDeafened, isScreenSharing } = msg;
        broadcast({
          type: 'VC_STATE_CHANGED',
          payload: {
            userId: clientInfo.userId,
            username: clientInfo.username,
            channelId,
            isMuted,
            isDeafened,
            isScreenSharing,
          }
        });
      }

      if (msg.type === 'SET_STATUS') {
        const { status } = msg;
        await pool.query(`UPDATE users SET status = $1, last_active_at = NOW() WHERE id = $2`, [status, clientInfo.userId]);
        broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId: clientInfo.userId, status } });
      }
    } catch (err) {
      console.error('WS Message error:', err);
    }
  });

  ws.on('close', async () => {
    const info = clients.get(ws);
    if (info && info.userId) {
      await pool.query(`UPDATE users SET status = 'offline', last_active_at = NOW() WHERE id = $1`, [info.userId]);
      broadcast({ type: 'USER_STATUS_CHANGED', payload: { userId: info.userId, status: 'offline' } });
    }
    clients.delete(ws);
  });
});

server.listen(PORT, async () => {
  console.log(`[asdfbase-backend] Server listening on http://127.0.0.1:${PORT}`);
  try {
    await initDb();
  } catch (err) {
    console.error('DB Init failed:', err);
  }
});
