// 時程 (朝の会・1〜6限・帰りの会) と「今日の時程」
export type PeriodTime = { start: string; end: string };
export interface ScheduleDef {
  morning: PeriodTime;
  periods: PeriodTime[];
  lunch?: PeriodTime;
  lunchBreak?: PeriodTime;
  cleaning?: PeriodTime;
  closing: PeriodTime;
}

export const SCHEDULE_TYPES = ['normal', 'short', 's_short', 'special'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export const MAX_PERIODS = 6;

export const DEFAULT_SCHEDULES: Record<ScheduleType, ScheduleDef> = {
  normal: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:25' }, { start: '09:35', end: '10:25' }, { start: '10:35', end: '11:25' },
      { start: '11:35', end: '12:25' }, { start: '13:20', end: '14:10' }, { start: '14:20', end: '15:10' },
    ],
    lunch: { start: '12:25', end: '12:50' },
    lunchBreak: { start: '12:50', end: '13:20' },
    cleaning: { start: '15:10', end: '15:25' },
    closing: { start: '15:25', end: '15:40' },
  },
  short: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:15' }, { start: '09:25', end: '10:05' }, { start: '10:15', end: '10:55' },
      { start: '11:05', end: '11:45' }, { start: '12:40', end: '13:20' }, { start: '13:30', end: '14:10' },
    ],
    lunch: { start: '11:45', end: '12:10' },
    lunchBreak: { start: '12:10', end: '12:40' },
    cleaning: { start: '14:10', end: '14:25' },
    closing: { start: '14:25', end: '14:40' },
  },
  s_short: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:05' }, { start: '09:15', end: '09:45' }, { start: '09:55', end: '10:25' },
      { start: '10:35', end: '11:05' }, { start: '12:00', end: '12:30' }, { start: '12:40', end: '13:10' },
    ],
    lunch: { start: '11:05', end: '11:30' },
    lunchBreak: { start: '11:30', end: '12:00' },
    cleaning: { start: '13:10', end: '13:25' },
    closing: { start: '13:25', end: '13:40' },
  },
  special: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:20' }, { start: '09:30', end: '10:15' }, { start: '10:25', end: '11:10' },
      { start: '11:20', end: '12:05' }, { start: '13:00', end: '13:45' }, { start: '13:55', end: '14:40' },
    ],
    lunch: { start: '12:05', end: '12:30' },
    lunchBreak: { start: '12:30', end: '13:00' },
    cleaning: { start: '14:40', end: '14:55' },
    closing: { start: '14:55', end: '15:15' },
  },
};

// 曜日(1=月..5=金)ごとの授業数 (1〜6限)
export const DEFAULT_DAY_PERIOD_COUNTS: Record<string, number> = { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 };
export const DEFAULT_SPECIAL_DAY_PERIOD_COUNTS: Record<string, number> = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 };

const TIME_RE = /^\d{2}:\d{2}$/;
const isTime = (p: any): p is PeriodTime => Boolean(p) && TIME_RE.test(p.start) && TIME_RE.test(p.end);

export function isValidSchedule(def: any): def is ScheduleDef {
  if (!def || !isTime(def.morning) || !isTime(def.closing)) return false;
  if (!Array.isArray(def.periods) || def.periods.length !== MAX_PERIODS || !def.periods.every(isTime)) return false;
  if (def.lunch && !isTime(def.lunch)) return false;
  if (def.lunchBreak && !isTime(def.lunchBreak)) return false;
  if (def.cleaning && !isTime(def.cleaning)) return false;
  return true;
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 5限の日は帰りの会を5限の直後へずらす (長さは同じ)
export function closingFor(def: ScheduleDef, periodCount: number): PeriodTime {
  const last = def.periods[Math.min(periodCount, def.periods.length) - 1];
  if (!last || periodCount >= def.periods.length) return def.closing;
  const length = toMinutes(def.closing.end) - toMinutes(def.closing.start);
  const start = toMinutes(last.end);
  return { start: fromMinutes(start), end: fromMinutes(start + length) };
}

// 日本時間の「今」
export function nowInTokyo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dow,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export interface TimetableConfig {
  activeScheduleType: ScheduleType;
  schedules: Record<ScheduleType, ScheduleDef>;
  dayPeriodCounts: Record<string, number>;
  specialDayPeriodCounts?: Record<string, number>;
  dateOverrides?: Record<string, ScheduleType>;
}

// YYYY-MM-DD に日数を足す
export function addDaysYmd(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const normalizeSubject = (s: string) => s.replace(/[\s・]/g, '');

// 教科の次の授業日 (今日より後の平日で、時間割にその教科がある最初の日)。見つからなければ null
export function nextLessonDate(
  rows: { day_of_week: number; period: number; subject: string }[],
  subject: string,
  fromYmd: string,
  dayPeriodCounts: Record<string, number> = DEFAULT_DAY_PERIOD_COUNTS
): string | null {
  const target = normalizeSubject(subject);
  if (!target) return null;
  const matches = (s: string) => {
    const n = normalizeSubject(s);
    return n === target || n.includes(target) || target.includes(n);
  };
  for (let i = 1; i <= 14; i++) {
    const ymd = addDaysYmd(fromYmd, i);
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const count = dayPeriodCounts[String(dow)] || MAX_PERIODS;
    if (rows.some(r => r.day_of_week === dow && r.period <= count && matches(r.subject))) return ymd;
  }
  return null;
}

// 次の平日
export function nextWeekday(fromYmd: string) {
  for (let i = 1; i <= 7; i++) {
    const ymd = addDaysYmd(fromYmd, i);
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return ymd;
  }
  return addDaysYmd(fromYmd, 1);
}
