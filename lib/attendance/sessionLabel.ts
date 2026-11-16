// Session names for the E-Attendance tabs, the Take Attendance QR and the public check-in page:
// "Day 1 · Mon 16 Nov · AM". Pure functions: safe to import on the client and the server.
//
// course_session stores SSG dates as text ("20261116"; older rows may be "2026-11-16") and times
// as "09:15". When one half-day holds more than one session (e.g. 14:00–15:00 and 15:00–18:00),
// the label shows the time range in place of AM/PM so the tabs stay distinct.

export interface SessionTimes {
  id: string;
  start_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export type LabelledSession<T extends SessionTimes> = T & {
  /** YYYY-MM-DD, or '' when the date is missing/unreadable. */
  isoDate: string;
  dayNumber: number;
  /** "Day 1 · Mon 16 Nov · AM" */
  label: string;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20261116" / "2026-11-16" / "2026-11-16T…" → "2026-11-16"; anything else → ''. */
export function toIsoDate(d?: string | null): string {
  const s = String(d ?? '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** "2026-11-16" → "Mon 16 Nov" (calendar date, no time-zone shift). */
export function shortDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

const minutes = (t?: string | null): number | null => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function halfOfDay(startTime?: string | null): 'AM' | 'PM' | 'Eve' | '' {
  const m = minutes(startTime);
  if (m === null) return '';
  if (m < 12 * 60) return 'AM';
  if (m < 18 * 60) return 'PM';
  return 'Eve';
}

const timeRange = (s: SessionTimes) =>
  [s.start_time, s.end_time].filter(Boolean).map(t => String(t).slice(0, 5)).join('–');

/** Sorted by date + start time, each with its day number and tab label. */
export function labelSessions<T extends SessionTimes>(sessions: T[]): LabelledSession<T>[] {
  const sorted = [...sessions]
    .map(s => ({ s, iso: toIsoDate(s.start_date) }))
    .sort((a, b) => (a.iso || '9999').localeCompare(b.iso || '9999') || (minutes(a.s.start_time) ?? 0) - (minutes(b.s.start_time) ?? 0));

  const days = [...new Set(sorted.map(x => x.iso).filter(Boolean))];
  const halfCount = new Map<string, number>();
  for (const { s, iso } of sorted) {
    const k = `${iso}|${halfOfDay(s.start_time)}`;
    halfCount.set(k, (halfCount.get(k) || 0) + 1);
  }

  return sorted.map(({ s, iso }, i) => {
    const dayNumber = iso ? days.indexOf(iso) + 1 : i + 1;
    const half = halfOfDay(s.start_time);
    const clash = (halfCount.get(`${iso}|${half}`) || 0) > 1;
    const when = clash || !half ? timeRange(s) : half;
    const label = [`Day ${dayNumber}`, iso ? shortDay(iso) : '', when].filter(Boolean).join(' · ');
    return { ...s, isoDate: iso, dayNumber, label };
  });
}

/** Singapore calendar date + clock now: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function sgtNow(now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/**
 * The session to open by default: the one running now (or the next one today), else the next
 * future session, else the last one (a past class).
 */
export function pickCurrentSession<T extends SessionTimes>(labelled: LabelledSession<T>[], now: Date = new Date()): LabelledSession<T> | null {
  if (labelled.length === 0) return null;
  const { date, time } = sgtNow(now);
  const nowMin = minutes(time) ?? 0;
  const today = labelled.filter(s => s.isoDate === date);
  if (today.length > 0) {
    return today.find(s => (minutes(s.end_time) ?? 24 * 60) >= nowMin) || today[today.length - 1];
  }
  return labelled.find(s => s.isoDate && s.isoDate > date) || labelled[labelled.length - 1];
}
