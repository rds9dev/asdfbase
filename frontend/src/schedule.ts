// 時程 (朝の会・1〜6限・帰りの会) と、ヘッダーに出す「今」の状態
export type ScheduleType = 'normal' | 'short' | 's_short';
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

export const SCHEDULE_LABELS: Record<ScheduleType, string> = { normal: '通常時程', short: '短縮時程', s_short: 'S短時程' };
// クラス (1〜6組)
export const CLASS_NUMBERS = [1, 2, 3, 4, 5, 6];
export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
export const MAX_PERIODS = 6;

// 中学校の教科
export const SUBJECTS = ['国語', '数学', '英語', '理科', '社会', '音楽', '美術', '保健体育', '技術', '家庭', '道徳', '総合', '学活'];
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

// その日の流れ (朝の会 → 各時限 → 帰りの会)
export function daySlots(config: TimetableConfig, dow: number, rows: TimetableItem[]) {
  const def = config.schedules[config.activeScheduleType] || DEFAULT_CONFIG.schedules.normal;
  const count = periodCountFor(config, dow);
  const subjectOf = (p: number) => rows.find(t => t.period === p)?.subject || '';
  return [
    { key: 'morning', label: '朝の会', time: def.morning, subject: '' },
    ...def.periods.slice(0, count).map((time, i) => ({ key: `p${i + 1}`, label: `${i + 1}限`, time, subject: subjectOf(i + 1) })),
    { key: 'closing', label: '帰りの会', time: closingFor(def, count), subject: '' },
  ];
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
      return {
        kind: isHomeroom ? 'homeroom' : 'class',
        label: isHomeroom ? s.label : `${s.label} ${s.subject || '授業中'}`,
        sub: `~${s.time.end}`,
        currentKey: s.key,
      };
    }
    const next = slots[i + 1];
    if (next && nowMin >= end && nowMin < toMinutes(next.time.start)) {
      const isLunch = toMinutes(next.time.start) - end >= 30;
      return {
        kind: 'break',
        label: `Next: ${next.label} ${next.subject}`.trim(),
        sub: `${isLunch ? '昼休み' : '休み時間'} · ${next.time.start}~`,
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

// 今日から見て何日後か (ローカル日付)
export function daysFromToday(ymdStr: string, now = new Date()): number {
  const d = new Date(`${ymdStr}T00:00:00`);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}
