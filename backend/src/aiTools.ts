// AI が asdfbase のデータを読んだり、頼まれた操作を実行するためのツール群
// 書き込み系は既存の API を本人のトークンで呼ぶので、権限チェック・配信・監査ログは通常操作と同じになる
import { Type, type FunctionDeclaration } from '@google/genai';
import type { Pool } from 'pg';
import { closingFor, nowInTokyo, type ScheduleType, type TimetableConfig } from './schedule.js';
import { readWebPage, webSearch } from './webSearch.js';

export interface AiToolContext {
  pool: Pool;
  baseUrl: string;
  authHeader: string;
  userId: number;
  username: string;
  allowWrite: boolean;
}

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

export function generateLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // 行数が多すぎる場合は簡易プレビュー
  if (m > 500 || n > 500) {
    return [
      ...oldLines.slice(0, 100).map(t => ({ type: 'del' as const, text: t })),
      ...newLines.slice(0, 100).map(t => ({ type: 'add' as const, text: t })),
    ];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = m, j = n;
  const trace: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      trace.push({ type: 'same', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      trace.push({ type: 'add', text: newLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      trace.push({ type: 'del', text: oldLines[i - 1] });
      i--;
    }
  }

  return trace.reverse();
}

export interface AiToolStep {
  name: string;
  label: string;
  ok: boolean;
  write: boolean;
  diff?: {
    target: string;
    slot?: number;
    oldText: string;
    newText: string;
    lines: DiffLine[];
  };
}

const DAY = ['日', '月', '火', '水', '木', '金', '土'];
const SCHEDULE_LABELS: Record<ScheduleType, string> = { normal: '通常時程', short: '短縮時程', s_short: 'S短時程', special: '特別時程' };
const STATUS_LABELS: Record<string, string> = {
  unstarted: '未着手', in_progress: '進行中', submitted: '提出済み', resubmit: '再提出', passed: '合格',
};
const EXAM_LABELS: Record<string, string> = { midterm: '中間', final: '期末', yearend: '学年末', diagnostic: '診断' };

const jstDate = (v: any) => (v ? new Date(v).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : null);
const jstDateTime = (v: any) => (v ? new Date(v).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isYmd = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const READ_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_timetable',
    description: '時間割と時程 (朝の会・各時限・帰りの会の時刻、教科、持ち物) を取得する。曜日を省略すると月〜金すべて。クラスを省略すると話している相手のクラス。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        day_of_week: { type: Type.INTEGER, description: '1=月 … 5=金' },
        class_no: { type: Type.INTEGER, description: '1〜6 (組)' },
      },
    },
  },
  {
    name: 'get_homework',
    description: '宿題 (次の授業までにやってくる簡単な課題) の一覧と、自分がやったかどうかを取得する。',
    parameters: { type: Type.OBJECT, properties: { include_done: { type: Type.BOOLEAN, description: 'やった宿題も含める' } } },
  },
  {
    name: 'get_assignments',
    description: '提出物の一覧 (締切・教科・自分の進捗・説明) を取得する。',
    parameters: {
      type: Type.OBJECT,
      properties: { include_archived: { type: Type.BOOLEAN, description: '全員合格で完了したものも含める' } },
    },
  },
  {
    name: 'get_calendar_events',
    description: 'カレンダーの予定を期間指定で取得する。省略時は今日から30日間。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, description: 'YYYY-MM-DD' },
        to: { type: Type.STRING, description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_test_scores',
    description: '自分のテストの点数 (中間・期末・学年末・診断) を取得する。',
    parameters: {
      type: Type.OBJECT,
      properties: { exam_type: { type: Type.STRING, enum: ['midterm', 'final', 'yearend', 'diagnostic'] } },
    },
  },
  {
    name: 'list_notes',
    description: '共有メモの一覧 (番号・タイトル・更新日時・文字数) を取得する。',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'read_note',
    description: 'メモの本文を番号で読む。',
    parameters: {
      type: Type.OBJECT,
      properties: { slot: { type: Type.INTEGER, description: 'メモ番号' } },
      required: ['slot'],
    },
  },
  {
    name: 'search_messages',
    description: 'チャットの過去メッセージをキーワードで検索する。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        channel: { type: Type.STRING, description: 'チャンネル名 (省略で全チャンネル)' },
        limit: { type: Type.INTEGER, description: '最大30' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_channel_messages',
    description: 'チャンネルの最新メッセージを取得する。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        channel: { type: Type.STRING, description: 'チャンネル名' },
        limit: { type: Type.INTEGER, description: '最大50' },
      },
      required: ['channel'],
    },
  },
  {
    name: 'list_members',
    description: 'メンバー一覧とオンライン状態を取得する。',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_weather',
    description: '学校周辺の現在の天気・今日の予報・週間予報を取得する。',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'web_search',
    description: 'インターネットを検索する。サイト外の知識、ニュース、最新の情報、調べものに使う。結果はタイトル・URL・抜粋。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: '検索語 (日本語可)' },
        limit: { type: Type.INTEGER, description: '最大8' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_webpage',
    description: 'Web ページの本文を読む。web_search の抜粋だけでは足りないときに URL を指定して使う。',
    parameters: {
      type: Type.OBJECT,
      properties: { url: { type: Type.STRING } },
      required: ['url'],
    },
  },
];

const WRITE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'add_assignment',
    description: '提出物を新しく登録する (全員に共有される)。ユーザーが登録を頼んだときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        subject: { type: Type.STRING, description: '国語 数学 英語 理科 社会 音楽 美術 保健体育 技術 家庭 道徳 総合 学活 など' },
        deadline: { type: Type.STRING, description: 'YYYY-MM-DD' },
        description: { type: Type.STRING },
      },
      required: ['title', 'subject', 'deadline'],
    },
  },
  {
    name: 'set_assignment_status',
    description: '自分の提出物の進捗を変更する。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        assignment_id: { type: Type.INTEGER },
        status: { type: Type.STRING, enum: Object.keys(STATUS_LABELS) },
      },
      required: ['assignment_id', 'status'],
    },
  },
  {
    name: 'add_homework',
    description: '宿題を登録する (クラスで共有)。期限を省略すると、時間割からその教科の次の授業日になる。ユーザーが登録を頼んだときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: { type: Type.STRING },
        content: { type: Type.STRING, description: '例: ワーク P.12〜13' },
        due_date: { type: Type.STRING, description: 'YYYY-MM-DD (任意)' },
      },
      required: ['subject', 'content'],
    },
  },
  {
    name: 'add_calendar_event',
    description: 'カレンダーに予定を追加する。ユーザーが追加を頼んだときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        time: { type: Type.STRING, description: 'HH:MM (任意)' },
        title: { type: Type.STRING },
        note: { type: Type.STRING },
      },
      required: ['date', 'title'],
    },
  },
  {
    name: 'append_to_note',
    description: 'メモの末尾に文章を追記する (既存の本文は消さない)。ユーザーが頼んだときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        slot: { type: Type.INTEGER },
        text: { type: Type.STRING },
      },
      required: ['slot', 'text'],
    },
  },
  {
    name: 'write_note',
    description: 'メモの新規作成または本文・タイトルの書き換え。修正・要約・コード編集時に使う。変更前後の差分がユーザーにプレビューされます。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        slot: { type: Type.INTEGER, description: 'メモ番号 (1〜10、またはユーザー専用番号)' },
        title: { type: Type.STRING, description: 'メモのタイトル (省略時は既存のまま)' },
        content: { type: Type.STRING, description: '新しいメモの本文全文' },
        mode: { type: Type.STRING, enum: ['markdown', 'plain', 'monaco'], description: 'エディタモード' },
      },
      required: ['slot', 'content'],
    },
  },
  {
    name: 'set_homework_done',
    description: '宿題の完了状態を切り替える (例: 「数学の宿題終わった」)。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        homework_id: { type: Type.INTEGER, description: '宿題ID' },
        done: { type: Type.BOOLEAN, description: 'true=完了、false=未完了' },
      },
      required: ['homework_id', 'done'],
    },
  },
  {
    name: 'delete_homework',
    description: '宿題を削除する。頼まれたときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        homework_id: { type: Type.INTEGER },
      },
      required: ['homework_id'],
    },
  },
  {
    name: 'record_test_score',
    description: 'テストの点数を記録・登録する (中間・期末・学年末・診断)。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        exam_type: { type: Type.STRING, enum: ['midterm', 'final', 'yearend', 'diagnostic'] },
        subject: { type: Type.STRING, description: '国語 数学 英語 理科 社会 音楽 美術 保健体育 技術 家庭 など' },
        score: { type: Type.INTEGER, description: '0〜100点' },
        class_average: { type: Type.INTEGER, description: '平均点 (任意)' },
      },
      required: ['exam_type', 'subject', 'score'],
    },
  },
  {
    name: 'send_channel_message',
    description: '指定チャンネルにメッセージを代理送信する。ユーザーがチャットへの連絡・投稿を頼んだときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        channel: { type: Type.STRING, description: 'チャンネル名 (例: 雑談, 連絡)' },
        message: { type: Type.STRING, description: '送信するメッセージ本文' },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'カレンダーの予定を削除する。頼まれたときだけ使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_id: { type: Type.INTEGER, description: '予定ID' },
      },
      required: ['event_id'],
    },
  },
];

export function aiToolDeclarations(allowWrite: boolean) {
  return allowWrite ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
}

const WRITE_NAMES = new Set(WRITE_TOOLS.map(t => t.name));

export function createAiToolRunner(ctx: AiToolContext) {
  const api = async (pathname: string, init: { method?: string; body?: any } = {}) => {
    const res = await fetch(`${ctx.baseUrl}${pathname}`, {
      method: init.method || 'GET',
      headers: { Authorization: ctx.authHeader, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const findChannel = async (name: string) => {
    const clean = String(name || '').replace(/^#/, '').trim();
    const r = await ctx.pool.query(
      `SELECT id, name FROM channels WHERE type <> 'voice' AND (name = $1 OR name ILIKE $2) ORDER BY (name = $1) DESC LIMIT 1`,
      [clean, `%${clean}%`]
    );
    return r.rows[0] as { id: number; name: string } | undefined;
  };

  let classCache: number | null | undefined;
  const myClass = async (): Promise<number | null> => {
    if (classCache === undefined) {
      const r = await ctx.pool.query(`SELECT class_no FROM users WHERE id = $1`, [ctx.userId]);
      classCache = r.rows[0]?.class_no ?? null;
    }
    return classCache ?? null;
  };

  const handlers: Record<string, (args: any) => Promise<{ label: string; result: any }>> = {
    async get_timetable(args) {
      const config: TimetableConfig = await api('/api/timetables/config');
      const classNo = args.class_no >= 1 && args.class_no <= 6 ? args.class_no : await myClass();
      const rows: any[] = await api(`/api/timetables${classNo ? `?classNo=${classNo}` : ''}`);
      const def = config.schedules[config.activeScheduleType] || config.schedules.normal;
      const days = args.day_of_week >= 1 && args.day_of_week <= 5 ? [args.day_of_week] : [1, 2, 3, 4, 5];
      const result = days.map(dow => {
        const count = config.dayPeriodCounts[String(dow)] || 6;
        const closing = closingFor(def, count);
        return {
          day: `${DAY[dow]}曜日`,
          periods: count,
          slots: [
            { name: '朝の会', time: `${def.morning.start}-${def.morning.end}` },
            ...def.periods.slice(0, count).map((t, i) => {
              const row = rows.find(r => r.day_of_week === dow && r.period === i + 1);
              return {
                name: `${i + 1}限`,
                time: `${t.start}-${t.end}`,
                subject: row?.subject || '(未設定)',
                items: row?.items || undefined,
                note: row?.note || undefined,
              };
            }),
            { name: '帰りの会', time: `${closing.start}-${closing.end}` },
          ],
        };
      });
      return {
        label: `${classNo ? `${classNo}組 ` : ''}${args.day_of_week ? `${DAY[args.day_of_week]}曜の時間割を確認` : '時間割を確認'}`,
        result: { class_no: classNo, today_schedule: SCHEDULE_LABELS[config.activeScheduleType], days: result },
      };
    },

    async get_homework(args) {
      const classNo = await myClass();
      const rows: any[] = await api('/api/homework');
      const today = nowInTokyo().date;
      const list = rows
        .filter(h => h.class_no == null || !classNo || h.class_no === classNo)
        .filter(h => args.include_done || !h.my_done)
        .filter(h => h.due_date >= today || !h.my_done)
        .map(h => ({
          id: h.id, subject: h.subject, content: h.content, due: h.due_date,
          days_left: Math.round((Date.parse(h.due_date) - Date.parse(today)) / 86400000),
          done: h.my_done, class: h.class_no ? `${h.class_no}組` : '全クラス',
        }));
      return { label: `宿題を確認 (${list.length}件)`, result: list };
    },

    async web_search(args) {
      const q = String(args.query || '').trim();
      if (!q) throw new Error('検索語が空です');
      const { provider, results } = await webSearch(q, Math.min(Math.max(Number(args.limit) || 6, 1), 8));
      return { label: `Web検索「${q}」(${results.length}件)`, result: { provider, results } };
    },

    async read_webpage(args) {
      const page = await readWebPage(String(args.url || ''));
      return { label: `ページを読む: ${page.title || page.url}`.slice(0, 80), result: page };
    },

    async get_assignments(args) {
      const rows: any[] = await api('/api/assignments');
      const today = nowInTokyo().date;
      const classNo = await myClass();
      const list = rows
        .filter(a => args.include_archived || !a.is_archived)
        .filter(a => a.class_no == null || !classNo || a.class_no === classNo)
        .map(a => {
          const deadline = jstDate(a.deadline);
          return {
            id: a.id,
            title: a.title,
            subject: a.subject,
            deadline,
            days_left: deadline ? Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000) : null,
            resubmit_deadline: jstDate(a.resubmit_deadline),
            my_status: STATUS_LABELS[a.my_status] || a.my_status,
            archived: a.is_archived || undefined,
            description: a.description ? String(a.description).slice(0, 600) : undefined,
          };
        });
      return { label: `提出物を確認 (${list.length}件)`, result: list };
    },

    async get_calendar_events(args) {
      const today = nowInTokyo().date;
      const from = isYmd(args.from) ? args.from : today;
      const to = isYmd(args.to) ? args.to : addDays(from, 30);
      const rows: any[] = await api(`/api/calendar?from=${from}&to=${to}`);
      return {
        label: `予定を確認 (${from}〜${to})`,
        result: rows.map(e => ({ date: e.date || e.event_date, time: e.time || e.event_time || undefined, title: e.title, note: e.note || undefined, by: e.username })),
      };
    },

    async get_test_scores(args) {
      const rows: any[] = await api('/api/test-scores');
      const list = rows
        .filter(r => !args.exam_type || r.exam_type === args.exam_type)
        .map(r => ({
          exam: `${EXAM_LABELS[r.exam_type] || r.exam_type}${r.exam_label ? ` ${r.exam_label}` : ''}`,
          subject: r.subject,
          score: r.score,
          max: r.max_score,
          date: jstDate(r.created_at),
        }));
      return { label: 'テストの点数を確認', result: list };
    },

    async list_notes() {
      const rows: any[] = await api('/api/notes');
      return {
        label: 'メモ一覧を確認',
        result: rows.map(n => ({
          slot: n.slot_index, title: n.title, mode: n.mode, chars: String(n.content || '').length,
          owner: n.assigned_username || undefined, updated: jstDateTime(n.updated_at),
        })),
      };
    },

    async read_note(args) {
      const rows: any[] = await api('/api/notes');
      const note = rows.find(n => n.slot_index === Number(args.slot));
      if (!note) throw new Error(`メモ #${args.slot} はありません`);
      const content = String(note.content || '');
      return {
        label: `メモ #${note.slot_index}「${note.title || '無題'}」を読む`,
        result: { slot: note.slot_index, title: note.title, mode: note.mode, content: content.slice(0, 20000), truncated: content.length > 20000 || undefined },
      };
    },

    async search_messages(args) {
      const q = String(args.query || '').trim();
      if (!q) throw new Error('検索語が空です');
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 30);
      const params: any[] = [`%${q}%`, limit];
      let where = `m.content ILIKE $1`;
      if (args.channel) {
        const ch = await findChannel(args.channel);
        if (!ch) throw new Error(`チャンネル「${args.channel}」が見つかりません`);
        params.push(ch.id);
        where += ` AND m.channel_id = $3`;
      }
      const r = await ctx.pool.query(
        `SELECT m.id, c.name AS channel, COALESCE(u.username, m.username) AS sender, m.content, m.created_at
         FROM messages m JOIN channels c ON c.id = m.channel_id LEFT JOIN users u ON u.id = m.user_id
         WHERE ${where} ORDER BY m.id DESC LIMIT $2`,
        params
      );
      return {
        label: `チャットを検索「${q}」(${r.rows.length}件)`,
        result: r.rows.map(m => ({ channel: m.channel, sender: m.sender, at: jstDateTime(m.created_at), content: String(m.content).slice(0, 500) })),
      };
    },

    async get_channel_messages(args) {
      const ch = await findChannel(args.channel);
      if (!ch) throw new Error(`チャンネル「${args.channel}」が見つかりません`);
      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 50);
      const r = await ctx.pool.query(
        `SELECT COALESCE(u.username, m.username) AS sender, m.content, m.created_at
         FROM messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1 ORDER BY m.id DESC LIMIT $2`,
        [ch.id, limit]
      );
      return {
        label: `#${ch.name} の会話を読む`,
        result: r.rows.reverse().map(m => ({ sender: m.sender, at: jstDateTime(m.created_at), content: String(m.content).slice(0, 500) })),
      };
    },

    async list_members() {
      const r = await ctx.pool.query(`SELECT username, status, custom_status, last_active_at FROM users ORDER BY username`);
      return {
        label: 'メンバーを確認',
        result: r.rows.map(u => ({ username: u.username, status: u.status, custom_status: u.custom_status || undefined, last_active: jstDateTime(u.last_active_at) })),
      };
    },

    async get_weather() {
      const w = await api('/api/weather');
      return {
        label: '天気を確認',
        result: {
          now: { temp: w.temp, desc: w.desc, humidity: w.humidity, feels_like: w.feelsLike, wind: w.windSpeed },
          today: { max: w.tempMax, min: w.tempMin, precip_prob: w.precipProb },
          weekly: (w.daily || []).slice(0, 7),
        },
      };
    },

    async add_assignment(args) {
      if (!isYmd(args.deadline)) throw new Error('締切は YYYY-MM-DD で指定してください');
      const created = await api('/api/assignments', {
        method: 'POST',
        body: { title: String(args.title).slice(0, 200), subject: args.subject, description: args.description || '', deadline: args.deadline },
      });
      return { label: `提出物を登録: ${created.title} (${args.deadline})`, result: { ok: true, id: created.id } };
    },

    async set_assignment_status(args) {
      if (!STATUS_LABELS[args.status]) throw new Error('進捗の値が正しくありません');
      await api(`/api/assignments/${Number(args.assignment_id)}/progress`, { method: 'PUT', body: { status: args.status } });
      return { label: `提出物 #${args.assignment_id} を「${STATUS_LABELS[args.status]}」に変更`, result: { ok: true } };
    },

    async add_homework(args) {
      if (args.due_date && !isYmd(args.due_date)) throw new Error('期限は YYYY-MM-DD で指定してください');
      const created = await api('/api/homework', {
        method: 'POST',
        body: { subject: args.subject, content: String(args.content || '').slice(0, 2000), dueDate: args.due_date || undefined },
      });
      return { label: `宿題を登録: ${created.subject} ${created.content} (${created.due_date}まで)`, result: { ok: true, id: created.id, due: created.due_date } };
    },

    async add_calendar_event(args) {
      const created = await api('/api/calendar', {
        method: 'POST',
        body: { date: args.date, time: args.time || '', title: args.title, note: args.note || '' },
      });
      return { label: `予定を追加: ${args.date}${args.time ? ` ${args.time}` : ''} ${args.title}`, result: { ok: true, id: created.id } };
    },

    async append_to_note(args) {
      const rows: any[] = await api('/api/notes');
      const note = rows.find(n => n.slot_index === Number(args.slot));
      if (!note) throw new Error(`メモ #${args.slot} はありません`);
      const text = String(args.text || '').trim();
      if (!text) throw new Error('追記する文章が空です');
      const current = String(note.content || '');
      const newContent = current ? `${current.replace(/\s+$/, '')}\n\n${text}` : text;
      await api(`/api/notes/${note.slot_index}`, {
        method: 'PUT',
        body: { title: note.title, content: newContent, mode: note.mode },
      });
      return {
        label: `メモ #${note.slot_index}「${note.title || '無題'}」に追記`,
        result: { ok: true },
        diff: {
          target: `メモ #${note.slot_index}「${note.title || '無題'}」`,
          slot: note.slot_index,
          oldText: current,
          newText: newContent,
          lines: generateLineDiff(current, newContent),
        },
      };
    },

    async write_note(args) {
      const slot = Number(args.slot);
      const rows: any[] = await api('/api/notes');
      const note = rows.find(n => n.slot_index === slot);
      const oldContent = note ? String(note.content || '') : '';
      const newContent = String(args.content || '');
      const title = args.title ? String(args.title).slice(0, 100) : (note?.title || `メモ #${slot}`);
      const mode = args.mode || note?.mode || 'markdown';

      const lines = generateLineDiff(oldContent, newContent);

      await api(`/api/notes/${slot}`, {
        method: 'PUT',
        body: { title, content: newContent, mode },
      });

      return {
        label: `メモ #${slot}「${title}」を更新`,
        result: { ok: true, slot, title },
        diff: {
          target: `メモ #${slot}「${title}」`,
          slot,
          oldText: oldContent,
          newText: newContent,
          lines,
        },
      };
    },

    async set_homework_done(args) {
      const hwId = Number(args.homework_id);
      const done = Boolean(args.done);
      await api(`/api/homework/${hwId}/done`, {
        method: 'PUT',
        body: { done },
      });
      return {
        label: `宿題 #${hwId} を「${done ? '完了' : '未完了'}」に設定`,
        result: { ok: true, homework_id: hwId, done },
      };
    },

    async delete_homework(args) {
      const hwId = Number(args.homework_id);
      await api(`/api/homework/${hwId}`, { method: 'DELETE' });
      return { label: `宿題 #${hwId} を削除`, result: { ok: true, homework_id: hwId } };
    },

    async record_test_score(args) {
      const score = Math.max(0, Math.min(100, Number(args.score)));
      await api('/api/test-scores', {
        method: 'POST',
        body: {
          examType: args.exam_type,
          subject: args.subject,
          score,
          classAverage: args.class_average !== undefined ? Number(args.class_average) : undefined,
        },
      });
      const examLabel = EXAM_LABELS[args.exam_type] || args.exam_type;
      return {
        label: `${examLabel}テスト ${args.subject}: ${score}点を記録`,
        result: { ok: true, exam: examLabel, subject: args.subject, score },
      };
    },

    async send_channel_message(args) {
      const ch = await findChannel(args.channel);
      if (!ch) throw new Error(`チャンネル「${args.channel}」が見つかりません`);
      const content = String(args.message || '').trim();
      if (!content) throw new Error('メッセージが空です');
      await api(`/api/channels/${ch.id}/messages`, {
        method: 'POST',
        body: { content },
      });
      return {
        label: `#${ch.name} へメッセージを送信: ${content.slice(0, 30)}...`,
        result: { ok: true, channel: ch.name },
      };
    },

    async delete_calendar_event(args) {
      const id = Number(args.event_id);
      await api(`/api/calendar/${id}`, { method: 'DELETE' });
      return { label: `カレンダー予定 #${id} を削除`, result: { ok: true, event_id: id } };
    },
  };

  return async function run(name: string, args: any): Promise<{ step: AiToolStep; response: Record<string, unknown> }> {
    const write = WRITE_NAMES.has(name);
    const handler = handlers[name];
    if (!handler || (write && !ctx.allowWrite)) {
      return { step: { name, label: `${name} (使えません)`, ok: false, write }, response: { error: 'このツールは使えません' } };
    }
    try {
      const res = await handler(args || {});
      const { label, result } = res;
      const diff = (res as any).diff;
      return { step: { name, label, ok: true, write, diff }, response: { result } };
    } catch (err: any) {
      return { step: { name, label: `${name}: ${err.message}`, ok: false, write }, response: { error: err.message } };
    }
  };
}
