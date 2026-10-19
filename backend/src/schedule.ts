// 時程 (朝の会・1〜6限・帰りの会) と「今日の時程」、授業時間中の判定
export type PeriodTime = { start: string; end: string };
export interface ScheduleDef {
  morning: PeriodTime;
  periods: PeriodTime[];
  closing: PeriodTime;
}

export const SCHEDULE_TYPES = ['normal', 'short', 's_short'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export const MAX_PERIODS = 6;

export const DEFAULT_SCHEDULES: Record<ScheduleType, ScheduleDef> = {
  normal: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:25' }, { start: '09:35', end: '10:25' }, { start: '10:35', end: '11:25' },
      { start: '11:35', end: '12:25' }, { start: '13:20', end: '14:10' }, { start: '14:20', end: '15:10' },
    ],
    closing: { start: '15:10', end: '15:40' },
  },
  short: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:15' }, { start: '09:25', end: '10:05' }, { start: '10:15', end: '10:55' },
      { start: '11:05', end: '11:45' }, { start: '12:40', end: '13:20' }, { start: '13:30', end: '14:10' },
    ],
    closing: { start: '14:10', end: '14:40' },
  },
  s_short: {
    morning: { start: '08:10', end: '08:25' },
    periods: [
      { start: '08:35', end: '09:05' }, { start: '09:15', end: '09:45' }, { start: '09:55', end: '10:25' },
      { start: '10:35', end: '11:05' }, { start: '12:00', end: '12:30' }, { start: '12:40', end: '13:10' },
    ],
    closing: { start: '13:10', end: '13:40' },
  },
};

// 曜日(1=月..5=金)ごとの授業数 (5限 or 6限)
export const DEFAULT_DAY_PERIOD_COUNTS: Record<string, number> = { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 };

const TIME_RE = /^\d{2}:\d{2}$/;
const isTime = (p: any): p is PeriodTime => Boolean(p) && TIME_RE.test(p.start) && TIME_RE.test(p.end);

export function isValidSchedule(def: any): def is ScheduleDef {
  return Boolean(def) && isTime(def.morning) && isTime(def.closing) &&
    Array.isArray(def.periods) && def.periods.length === MAX_PERIODS && def.periods.every(isTime);
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
}

// 授業時間中 (朝の会の開始〜帰りの会の終了) かどうか
export function schoolTimeStatus(config: TimetableConfig, date = new Date()) {
  const now = nowInTokyo(date);
  if (now.dow < 1 || now.dow > 5) return { inSchool: false as const };
  const def = config.schedules[config.activeScheduleType] || DEFAULT_SCHEDULES.normal;
  const count = config.dayPeriodCounts[String(now.dow)] || MAX_PERIODS;
  const closing = closingFor(def, count);
  const start = toMinutes(def.morning.start);
  const end = toMinutes(closing.end);
  if (now.minutes >= start && now.minutes < end) return { inSchool: true as const, until: closing.end };
  return { inSchool: false as const };
}
