"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DAY_PERIOD_COUNTS = exports.DEFAULT_SCHEDULES = exports.MAX_PERIODS = exports.SCHEDULE_TYPES = void 0;
exports.isValidSchedule = isValidSchedule;
exports.toMinutes = toMinutes;
exports.fromMinutes = fromMinutes;
exports.closingFor = closingFor;
exports.nowInTokyo = nowInTokyo;
exports.SCHEDULE_TYPES = ['normal', 'short', 's_short'];
exports.MAX_PERIODS = 6;
exports.DEFAULT_SCHEDULES = {
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
exports.DEFAULT_DAY_PERIOD_COUNTS = { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 };
const TIME_RE = /^\d{2}:\d{2}$/;
const isTime = (p) => Boolean(p) && TIME_RE.test(p.start) && TIME_RE.test(p.end);
function isValidSchedule(def) {
    return Boolean(def) && isTime(def.morning) && isTime(def.closing) &&
        Array.isArray(def.periods) && def.periods.length === exports.MAX_PERIODS && def.periods.every(isTime);
}
function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}
function fromMinutes(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
// 5限の日は帰りの会を5限の直後へずらす (長さは同じ)
function closingFor(def, periodCount) {
    const last = def.periods[Math.min(periodCount, def.periods.length) - 1];
    if (!last || periodCount >= def.periods.length)
        return def.closing;
    const length = toMinutes(def.closing.end) - toMinutes(def.closing.start);
    const start = toMinutes(last.end);
    return { start: fromMinutes(start), end: fromMinutes(start + length) };
}
// 日本時間の「今」
function nowInTokyo(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(date);
    const get = (t) => parts.find(p => p.type === t)?.value || '';
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        dow,
        minutes: Number(get('hour')) * 60 + Number(get('minute')),
    };
}
