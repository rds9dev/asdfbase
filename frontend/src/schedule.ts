// 時程 (朝の会・1〜6限・帰りの会) と、ヘッダーに出す「今」の状態
export type ScheduleType = 'normal' | 'short' | 's_short' | 'special';
export type PeriodTime = { start: string; end: string };
export interface ScheduleDef {
  morning: PeriodTime;
  periods: PeriodTime[];
  closing: PeriodTime;
}
export interface TimetableConfig {
  activeScheduleType: ScheduleType;
  schedules: Record<ScheduleType, ScheduleDef>;
  dayPeriodCounts: Record<string, number>;
}

export interface TimetableItem {
  id: number;
  day_of_week: number;
  period: number;
  subject: string;
  schedule_type: string;
  items?: string;
  note?: string;
}

export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  normal: '通常時程',
  short: '短縮時程',
  s_short: 'S短時程',
  special: '特別時程',
};
// クラス (1〜6組)
export const CLASS_NUMBERS = [1, 2, 3, 4, 5, 6];
export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
export const MAX_PERIODS = 6;

// 中学校の教科
export const SUBJECTS = ['国語', '数学', '英語', '理科', '社会', '音楽', '美術', '保健体育', '技術', '家庭', '道徳', '総合', '学活', '行事', 'テスト'];
export const MAIN_SUBJECTS = ['国語', '数学', '英語', '理科', '社会'];
export const PRACTICAL_SUBJECTS = ['音楽', '美術', '保健体育', '技術・家庭'];

export const DEFAULT_CONFIG: TimetableConfig = {
  activeScheduleType: 'normal',
  schedules: {
    normal: {
      morning: { start: '08:10', end: '08:25' },
      periods: [
        { start: '08:35', end: '09:25' }, { start: '09:35', end: '10:25' }, { start: '10:35', end: '11:25' },
        { start: '11:35', end: '12:25' }, { start: '13:20', end: '14:10' }, { start: '14:20', end: '15:10' },
      ],
      closing: { start: '15:25', end: '15:40' },
    },
    short: {
      morning: { start: '08:10', end: '08:25' },
      periods: [
        { start: '08:35', end: '09:15' }, { start: '09:25', end: '10:05' }, { start: '10:15', end: '10:55' },
        { start: '11:05', end: '11:45' }, { start: '12:40', end: '13:20' }, { start: '13:30', end: '14:10' },
      ],
      closing: { start: '14:25', end: '14:40' },
    },
    s_short: {
      morning: { start: '08:10', end: '08:25' },
      periods: [
        { start: '08:35', end: '09:05' }, { start: '09:15', end: '09:45' }, { start: '09:55', end: '10:25' },
        { start: '10:35', end: '11:05' }, { start: '12:00', end: '12:30' }, { start: '12:40', end: '13:10' },
      ],
      closing: { start: '13:25', end: '13:40' },
    },
    special: {
      morning: { start: '08:10', end: '08:25' },
      periods: [
        { start: '08:35', end: '09:20' }, { start: '09:30', end: '10:15' }, { start: '10:25', end: '11:10' },
        { start: '11:20', end: '12:05' }, { start: '13:00', end: '13:45' }, { start: '13:55', end: '14:40' },
      ],
      closing: { start: '14:55', end: '15:15' },
    },
  },
  dayPeriodCounts: { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 },
};

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function periodCountFor(config: TimetableConfig, dow: number): number {
  return config.dayPeriodCounts[String(dow)] || MAX_PERIODS;
}

// 5限の日は帰りの会を5限の直後へずらす (長さは同じ)
export function closingFor(def: ScheduleDef, periodCount: number): PeriodTime {
  const last = def.periods[Math.min(periodCount, def.periods.length) - 1];
  if (!last || periodCount >= def.periods.length) return def.closing;
  const length = toMinutes(def.closing.end) - toMinutes(def.closing.start);
  const start = toMinutes(last.end);
  return { start: fromMinutes(start), end: fromMinutes(start + length) };
}

// その日の流れ (朝の会 → 1〜4限 → 給食 → 昼休み → 5〜6限 → 清掃 → 帰りの会)
export function daySlots(config: TimetableConfig, dow: number, rows: TimetableItem[]) {
  const def = config.schedules[config.activeScheduleType] || DEFAULT_CONFIG.schedules.normal;
  const count = Math.max(1, Math.min(MAX_PERIODS, periodCountFor(config, dow)));
  const subjectOf = (p: number) => rows.find(t => t.period === p)?.subject || '';

  const slots: Array<{ key: string; label: string; time: PeriodTime; subject: string; isBreak?: boolean }> = [
    { key: 'morning', label: '朝の会', time: def.morning, subject: '' },
  ];

  // 1〜4限
  for (let i = 0; i < Math.min(count, 4); i++) {
    slots.push({ key: `p${i + 1}`, label: `${i + 1}限`, time: def.periods[i], subject: subjectOf(i + 1) });
  }

  // 4限以降がある日の給食・昼休み
  if (count >= 4 && def.periods[3] && def.periods[4]) {
    const p4End = toMinutes(def.periods[3].end);
    const p5Start = toMinutes(def.periods[4].start);
    if (p5Start - p4End >= 30) {
      const lunchEnd = p4End + 25;
      slots.push({
        key: 'lunch',
        label: '給食',
        time: { start: fromMinutes(p4End), end: fromMinutes(lunchEnd) },
        subject: '',
        isBreak: true,
      });
      slots.push({
        key: 'lunch_break',
        label: '昼休み',
        time: { start: fromMinutes(lunchEnd), end: fromMinutes(p5Start) },
        subject: '',
        isBreak: true,
      });
    }
  }

  // 5限〜6限
  for (let i = 4; i < count; i++) {
    slots.push({ key: `p${i + 1}`, label: `${i + 1}限`, time: def.periods[i], subject: subjectOf(i + 1) });
  }

  // 最終時限終了後の清掃と帰りの会
  const lastPeriod = def.periods[count - 1];
  if (lastPeriod) {
    const lastEnd = toMinutes(lastPeriod.end);
    const cleaningEnd = lastEnd + 15;
    slots.push({
      key: 'cleaning',
      label: '清掃',
      time: { start: fromMinutes(lastEnd), end: fromMinutes(cleaningEnd) },
      subject: '',
      isBreak: true,
    });
    const closingLen = Math.max(15, toMinutes(def.closing.end) - toMinutes(def.closing.start));
    slots.push({
      key: 'closing',
      label: '帰りの会',
      time: { start: fromMinutes(cleaningEnd), end: fromMinutes(cleaningEnd + closingLen) },
      subject: '',
    });
  } else {
    slots.push({ key: 'closing', label: '帰りの会', time: closingFor(def, count), subject: '' });
  }

  return slots;
}

export type SchoolStatusKind = 'holiday' | 'before' | 'homeroom' | 'class' | 'break' | 'after';

export function computeSchoolStatus(now: Date, config: TimetableConfig, today: TimetableItem[]): {
  kind: SchoolStatusKind;
  label: string;
  sub: string;
  currentKey?: string;
} {
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return { kind: 'holiday', label: '休み', sub: dow === 6 ? '土曜日' : '日曜日' };
  const slots = daySlots(config, dow, today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const first = slots[0];
  if (nowMin < toMinutes(first.time.start)) {
    return { kind: 'before', label: '登校前', sub: `朝の会 ${first.time.start}~` };
  }
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const start = toMinutes(s.time.start);
    const end = toMinutes(s.time.end);
    if (nowMin >= start && nowMin < end) {
      const isHomeroom = s.key === 'morning' || s.key === 'closing';
      const isBreak = Boolean(s.isBreak);
      return {
        kind: isHomeroom ? 'homeroom' : isBreak ? 'break' : 'class',
        label: isHomeroom || isBreak ? s.label : `${s.label} ${s.subject || '授業中'}`,
        sub: `~${s.time.end}`,
        currentKey: s.key,
      };
    }
    const next = slots[i + 1];
    if (next && nowMin >= end && nowMin < toMinutes(next.time.start)) {
      return {
        kind: 'break',
        label: `Next: ${next.label}${next.subject ? ` ${next.subject}` : ''}`.trim(),
        sub: `休み時間 · ${next.time.start}~`,
        currentKey: next.key,
      };
    }
  }
  return { kind: 'after', label: '放課後', sub: `${periodCountFor(config, dow)}限授業の日` };
}

// 'YYYY-MM-DD' (ローカル日付) → 「10/22(木)」
export function shortDateLabel(ymdStr: string): string {
  const d = new Date(`${ymdStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymdStr;
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_LABELS[d.getDay()]})`;
}

// 日本の祝日判定 (内閣府「国民の祝日」ロジック)
export function daysFromToday(ymdStr: string, now = new Date()): number {
  const d = new Date(`${ymdStr}T00:00:00`);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export function getJapaneseHoliday(date: Date): string | null {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dow = date.getDay();

  // 固定祝日
  if (m === 1 && d === 1) return '元日';
  if (m === 2 && d === 11) return '建国記念の日';
  if (m === 2 && d === 23) return '天皇誕生日';
  if (m === 4 && d === 29) return '昭和の日';
  if (m === 5 && d === 3) return '憲法記念日';
  if (m === 5 && d === 4) return 'みどりの日';
  if (m === 5 && d === 5) return 'こどもの日';
  if (m === 8 && d === 11) return '山の日';
  if (m === 11 && d === 3) return '文化の日';
  if (m === 11 && d === 23) return '勤労感謝の日';

  // ハッピーマンデー (第2月曜 / 第3月曜)
  const nthMonday = (targetN: number) => {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const cur = new Date(y, m - 1, day);
      if (cur.getMonth() !== m - 1) break;
      if (cur.getDay() === 1) {
        count++;
        if (count === targetN) return day;
      }
    }
    return -1;
  };

  if (m === 1 && d === nthMonday(2)) return '成人の日';
  if (m === 7 && d === nthMonday(3)) return '海の日';
  if (m === 9 && d === nthMonday(3)) return '敬老の日';
  if (m === 10 && d === nthMonday(2)) return 'スポーツの日';

  // 春分の日 (簡易計算式: 2000-2099年対応)
  if (m === 3) {
    const shunbun = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    if (d === shunbun) return '春分の日';
  }
  // 秋分の日
  if (m === 9) {
    const shubun = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    if (d === shubun) return '秋分の日';
    // 国民の休日 (敬老の日と秋分の日に挟まれた日)
    const keiro = nthMonday(3);
    if (shubun === keiro + 2 && d === keiro + 1) return '国民の休日';
  }

  // 振替休日判定: 日曜日の祝日の翌平日
  if (dow !== 0) {
    const yesterday = new Date(y, m - 1, d - 1);
    if (yesterday.getDay() === 0 && getJapaneseHoliday(yesterday)) {
      return '振替休日';
    }
  }

  return null;
}
