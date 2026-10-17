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
        slot_index INT PRIMARY KEY CHECK (slot_index BETWEEN 1 AND 10),
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
    `);
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
