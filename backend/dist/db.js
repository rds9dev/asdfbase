"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDb = initDb;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://asdfbase:asdfbase_secure_password_2026@127.0.0.1:5432/asdfbase',
});
async function initDb() {
    const client = await exports.pool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'member',
        status VARCHAR(20) DEFAULT 'offline',
        custom_status VARCHAR(100) DEFAULT '',
        last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        type VARCHAR(20) DEFAULT 'text',
        position INT DEFAULT 0,
        discord_channel_id VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        channel_id INT REFERENCES channels(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        content TEXT NOT NULL,
        attachments JSONB DEFAULT '[]',
        reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL,
        reactions JSONB DEFAULT '{}',
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notes (
        slot_index INT PRIMARY KEY CHECK (slot_index >= 1),
        title VARCHAR(100) DEFAULT '無題のメモ',
        content TEXT DEFAULT '',
        mode VARCHAR(20) DEFAULT 'markdown',
        assigned_user_id INT REFERENCES users(id) ON DELETE SET NULL,
        version INT DEFAULT 1,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS note_history (
        id SERIAL PRIMARY KEY,
        slot_index INT REFERENCES notes(slot_index) ON DELETE CASCADE,
        content TEXT NOT NULL,
        updated_by_id INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS timetables (
        id SERIAL PRIMARY KEY,
        day_of_week INT NOT NULL,
        period INT NOT NULL,
        subject VARCHAR(50) NOT NULL,
        schedule_type VARCHAR(20) DEFAULT 'normal'
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        subject VARCHAR(50) NOT NULL,
        description TEXT,
        deadline TIMESTAMP WITH TIME ZONE NOT NULL,
        resubmit_deadline TIMESTAMP WITH TIME ZONE,
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assignment_progress (
        assignment_id INT REFERENCES assignments(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'unstarted',
        PRIMARY KEY (assignment_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        action VARCHAR(50) NOT NULL,
        target_type VARCHAR(50) NOT NULL,
        target_id INT,
        details JSONB,
        can_restore BOOLEAN DEFAULT FALSE,
        restored BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS test_scores (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        subject VARCHAR(50) NOT NULL,
        score NUMERIC(5, 2) NOT NULL,
        max_score NUMERIC(5, 2) DEFAULT 100,
        exam_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS board_strokes (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        color VARCHAR(20) DEFAULT '#f59e0b',
        width INT DEFAULT 3,
        points JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS board_texts (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        x INT NOT NULL,
        y INT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS shared_clipboard (
        id INT PRIMARY KEY DEFAULT 1,
        content TEXT DEFAULT '',
        updated_by VARCHAR(50) DEFAULT 'system',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
        // マイグレーション: notesの制約解除とchannelsのposition追加
        await client.query(`
      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_slot_index_check;
      ALTER TABLE channels ADD COLUMN IF NOT EXISTS position INT DEFAULT 0;
    `).catch(err => console.warn('Migration note/channel warning:', err.message));
        // マイグレーション: テスト種別 / アイコン / カレンダー予定
        await client.query(`
      ALTER TABLE test_scores ADD COLUMN IF NOT EXISTS exam_type VARCHAR(20) DEFAULT 'midterm';
      ALTER TABLE test_scores ADD COLUMN IF NOT EXISTS exam_label VARCHAR(100) DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        username VARCHAR(50),
        event_date DATE NOT NULL,
        event_time VARCHAR(5) DEFAULT '',
        title VARCHAR(100) NOT NULL,
        note TEXT DEFAULT '',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events (event_date);
    `).catch(err => console.warn('Migration test/avatar/calendar warning:', err.message));
        // マイグレーション: クラス (1〜6組) / 編集済み / Discord 連携 / 既読位置 / 宿題
        await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS class_no INT DEFAULT NULL;
      ALTER TABLE timetables ADD COLUMN IF NOT EXISTS items TEXT DEFAULT '';
      ALTER TABLE timetables ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
      ALTER TABLE timetables ADD COLUMN IF NOT EXISTS class_no INT NOT NULL DEFAULT 1;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS class_no INT DEFAULT NULL;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_avatar TEXT DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS timetables_class_idx ON timetables (class_no, day_of_week, period);
      CREATE TABLE IF NOT EXISTS discord_message_links (
        asdf_message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        discord_channel_id VARCHAR(32) NOT NULL,
        discord_message_id VARCHAR(32) NOT NULL,
        direction VARCHAR(3) NOT NULL,
        PRIMARY KEY (discord_message_id, asdf_message_id)
      );
      CREATE INDEX IF NOT EXISTS discord_links_asdf_idx ON discord_message_links (asdf_message_id);
      CREATE TABLE IF NOT EXISTS channel_reads (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        last_read_id INT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS homework (
        id SERIAL PRIMARY KEY,
        class_no INT DEFAULT NULL,
        subject VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        due_date DATE NOT NULL,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS homework_due_idx ON homework (due_date);
      CREATE TABLE IF NOT EXISTS homework_done (
        homework_id INT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (homework_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_roles JSONB DEFAULT '[]';
      ALTER TABLE channels ADD COLUMN IF NOT EXISTS server_id VARCHAR(64) DEFAULT NULL;
      ALTER TABLE channels ADD COLUMN IF NOT EXISTS view_roles JSONB DEFAULT '[]';
      ALTER TABLE channels ADD COLUMN IF NOT EXISTS write_roles JSONB DEFAULT '[]';
      CREATE TABLE IF NOT EXISTS custom_emojis (
        id SERIAL PRIMARY KEY,
        name VARCHAR(64) UNIQUE NOT NULL,
        url TEXT NOT NULL,
        created_by VARCHAR(64),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ai_threads (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL DEFAULT '新しい会話',
        persona VARCHAR(64) NOT NULL DEFAULT 'standard',
        custom_persona TEXT DEFAULT '',
        messages JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_threads_user_idx ON ai_threads (user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS discord_link_requests (
        id SERIAL PRIMARY KEY,
        requester_id INT REFERENCES users(id) ON DELETE SET NULL,
        requester_username VARCHAR(64) NOT NULL,
        guild_id VARCHAR(64) NOT NULL,
        guild_name VARCHAR(200) DEFAULT '',
        discord_channel_id VARCHAR(64) NOT NULL,
        discord_channel_name VARCHAR(200) DEFAULT '',
        asdf_channel_id INT REFERENCES channels(id) ON DELETE CASCADE,
        new_channel_name VARCHAR(100) DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR(64),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `).catch(err => console.warn('Migration class/edit/discord/homework warning:', err.message));
        // 以前の編集 (updated_at だけ更新されていたもの) にも「編集済み」を付ける (初回のみ)
        const editMigrated = await client.query(`SELECT 1 FROM system_settings WHERE key = 'migr_message_edited_at'`);
        if (editMigrated.rows.length === 0) {
            await client.query(`UPDATE messages SET edited_at = updated_at WHERE edited_at IS NULL AND updated_at > created_at + INTERVAL '2 seconds'`);
            await client.query(`INSERT INTO system_settings (key, value) VALUES ('migr_message_edited_at', 'done') ON CONFLICT DO NOTHING`);
        }
        // 既存のテスト記録はテスト名から種別を推定 (初回のみ)
        const migrated = await client.query(`SELECT 1 FROM system_settings WHERE key = 'migr_test_exam_type'`);
        if (migrated.rows.length === 0) {
            await client.query(`
        UPDATE test_scores SET exam_type = CASE
          WHEN exam_name LIKE '%学年末%' THEN 'yearend'
          WHEN exam_name LIKE '%期末%' THEN 'final'
          WHEN exam_name LIKE '%診断%' OR exam_name LIKE '%実力%' THEN 'diagnostic'
          ELSE 'midterm' END,
          exam_label = exam_name
      `);
            await client.query(`INSERT INTO system_settings (key, value) VALUES ('migr_test_exam_type', 'done') ON CONFLICT DO NOTHING`);
        }
        // general 以外の既存チャンネルを対応する Discord サーバーへ振り分け (初回のみ)
        const srvMigrated = await client.query(`SELECT 1 FROM system_settings WHERE key = 'migr_channel_server_assign_v1'`);
        if (srvMigrated.rows.length === 0) {
            await client.query(`UPDATE channels SET server_id = NULL WHERE LOWER(name) = 'general'`);
            await client.query(`UPDATE channels SET server_id = '1550475182643347466' WHERE server_id IS NULL AND (name ILIKE '%rds9%' OR name ILIKE '%bot%')`);
            await client.query(`UPDATE channels SET server_id = '1524703392927191100' WHERE server_id IS NULL AND LOWER(name) <> 'general'`);
            // 削除済み Discord チャンネル (1562072121612697692) の古いバインディングを除去
            const bRes = await client.query(`SELECT value FROM system_settings WHERE key = 'discord_bindings'`);
            if (bRes.rows.length > 0 && bRes.rows[0].value) {
                try {
                    const list = JSON.parse(bRes.rows[0].value);
                    if (Array.isArray(list)) {
                        const cleaned = list.filter((b) => b.discordChannelId !== '1562072121612697692');
                        await client.query(`UPDATE system_settings SET value = $1 WHERE key = 'discord_bindings'`, [JSON.stringify(cleaned)]);
                    }
                }
                catch (_) { }
            }
            await client.query(`INSERT INTO system_settings (key, value) VALUES ('migr_channel_server_assign_v1', 'done') ON CONFLICT DO NOTHING`);
        }
        // チャンネル入れ違い修復マイグレーション (お知らせ・自己紹介の2年団/rds9分離 & server_id整合)
        const swapRepair = await client.query(`SELECT 1 FROM system_settings WHERE key = 'migr_channel_swap_repair_v2'`);
        if (swapRepair.rows.length === 0) {
            const bRes = await client.query(`SELECT value FROM system_settings WHERE key = 'discord_bindings'`);
            let bindings = [];
            if (bRes.rows.length > 0 && bRes.rows[0].value) {
                try {
                    bindings = JSON.parse(bRes.rows[0].value) || [];
                }
                catch (_) { }
            }
            // 1. 2年団のお知らせ (1525039269662691328) を asdfChannelId: 4 に正しく紐付け、server_id を 2年団に戻す
            await client.query(`UPDATE channels SET server_id = '1524703392927191100' WHERE id = 4`);
            // rds9のお知らせ (1550716941314822224) は rds9用に新規チャンネル作成
            const rds9NoticeRes = await client.query(`INSERT INTO channels (name, type, position, server_id) VALUES ('お知らせ', 'text', 100, '1550475182643347466') RETURNING id`);
            const rds9NoticeId = rds9NoticeRes.rows[0].id;
            // 2. 2年団の自己紹介 (1525690725277241344) を asdfChannelId: 24 に正しく紐付け、server_id を 2年団に戻す
            await client.query(`UPDATE channels SET server_id = '1524703392927191100' WHERE id = 24`);
            // rds9の自己紹介 (1560903171654815766) は rds9用に新規チャンネル作成
            const rds9IntroRes = await client.query(`INSERT INTO channels (name, type, position, server_id) VALUES ('自己紹介', 'text', 101, '1550475182643347466') RETURNING id`);
            const rds9IntroId = rds9IntroRes.rows[0].id;
            // バインディングを更新
            bindings = bindings.map((b) => {
                if (b.discordChannelId === '1550716941314822224') {
                    return { ...b, asdfChannelId: rds9NoticeId, guildId: '1550475182643347466' };
                }
                if (b.discordChannelId === '1560903171654815766') {
                    return { ...b, asdfChannelId: rds9IntroId, guildId: '1550475182643347466' };
                }
                return b;
            });
            if (!bindings.some(b => b.discordChannelId === '1525039269662691328')) {
                bindings.push({ discordChannelId: '1525039269662691328', asdfChannelId: 4, guildId: '1524703392927191100' });
            }
            if (!bindings.some(b => b.discordChannelId === '1525690725277241344')) {
                bindings.push({ discordChannelId: '1525690725277241344', asdfChannelId: 24, guildId: '1524703392927191100' });
            }
            await client.query(`UPDATE system_settings SET value = $1 WHERE key = 'discord_bindings'`, [JSON.stringify(bindings)]);
            // すべてのバインド済みチャンネルの server_id を確実に guildId と一致させる
            for (const b of bindings) {
                if (b.guildId && b.asdfChannelId) {
                    await client.query(`UPDATE channels SET server_id = $1 WHERE id = $2`, [b.guildId, b.asdfChannelId]);
                }
            }
            await client.query(`INSERT INTO system_settings (key, value) VALUES ('migr_channel_swap_repair_v2', 'done') ON CONFLICT DO NOTHING`);
        }
        // 初期チャンネルの作成
        const channelRes = await client.query('SELECT COUNT(*) FROM channels');
        if (parseInt(channelRes.rows[0].count, 10) === 0) {
            await client.query(`
        INSERT INTO channels (name, type) VALUES 
        ('general', 'text'),
        ('homework', 'text'),
        ('vc1', 'voice');
      `);
        }
        // 初期メモ（スロット1〜10）の作成
        const noteRes = await client.query('SELECT COUNT(*) FROM notes');
        if (parseInt(noteRes.rows[0].count, 10) === 0) {
            for (let i = 1; i <= 10; i++) {
                await client.query(`
          INSERT INTO notes (slot_index, title, content, mode) 
          VALUES ($1, $2, '', 'markdown')
          ON CONFLICT (slot_index) DO NOTHING;
        `, [i, `メモ #${i}`]);
            }
        }
        console.log('Database tables and initial records verified successfully.');
    }
    finally {
        client.release();
    }
}
