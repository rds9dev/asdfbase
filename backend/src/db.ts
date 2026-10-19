import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://asdfbase:asdfbase_secure_password_2026@127.0.0.1:5432/asdfbase',
});

export async function initDb() {
  const client = await pool.connect();
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
  } finally {
    client.release();
  }
}
