/**
 * MyCalendarView — "My Calendar" for the Trainer and Learner roles.
 *
 * Read-only month/day/year calendar of the CURRENT user's own classes
 * (trainer: assigned runs; learner: enrolled runs), one chip per
 * (course run, session day). Data: /api/calendar/my-events.
 * Clicking a chip or a day opens a details popup for that day.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from './ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

interface MyClassEvent {
  courseRunUuid: string;
  courseRunId: string;
  courseCode: string;
  courseTitle: string;
  classStatus: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  dayNumber: number;
  totalDays: number;
  sessionCount: number;
}

type ViewMode = 'day' | 'month' | 'year';

const STATUS_STYLES: Record<string, { chip: string; badge: string }> = {
  Confirmed: {
    chip: 'border-green-500 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/25 hover:bg-green-100 dark:hover:bg-green-900/40',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  Pending: {
    chip: 'border-amber-500 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/25 hover:bg-amber-100 dark:hover:bg-amber-900/40',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  Cancelled: {
    chip: 'border-red-500 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/25 hover:bg-red-100 dark:hover:bg-red-900/40',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  default: {
    chip: 'border-blue-500 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/25 hover:bg-blue-100 dark:hover:bg-blue-900/40',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
};
const styleFor = (status: string) => STATUS_STYLES[status] || STATUS_STYLES.default;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Times come as free text ("9:30 am" / "09:30"). Show as compact 24h HH:mm.
const fmtTime = (t?: string): string => {
  if (!t) return '';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return String(t).trim();
  let h = parseInt(m[1], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${pad(h)}:${m[2]}`;
};
// Monday-first index of a date's weekday (Mon=0 … Sun=6)
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** The 42 cells (6 weeks, Monday-first) shown for a month. */
const monthGridDays = (year: number, month: number): Date[] => {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - mondayIndex(first));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
};

interface MyCalendarViewProps {
  role: 'trainer' | 'learner';
}

const MyCalendarView: React.FC<MyCalendarViewProps> = ({ role }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<MyClassEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [dayModal, setDayModal] = useState<string | null>(null); // YYYY-MM-DD

  const today = ymd(new Date());

  // Visible range per view (month view includes leading/trailing grid days).
  const range = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    if (viewMode === 'day') {
      const d = ymd(cursor);
      return { start: d, end: d };
    }
    if (viewMode === 'year') {
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    const days = monthGridDays(y, m);
    return { start: ymd(days[0]), end: ymd(days[days.length - 1]) };
  }, [cursor, viewMode]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ role, start: range.start, end: range.end });
        const res = await fetch(getApiUrl(`/api/calendar/my-events?${params}`));
        const data = await res.json();
        if (alive) setEvents(data?.success ? (data.data?.events || []) : []);
      } catch {
        if (alive) setEvents([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [role, range.start, range.end]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, MyClassEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date);
      if (list) list.push(ev); else map.set(ev.date, [ev]);
    }
    return map;
  }, [events]);

  const goToday = useCallback(() => setCursor(new Date()), []);
  const step = useCallback((dir: 1 | -1) => {
    setCursor((prev) => {
      const d = new Date(prev);
      if (viewMode === 'day') d.setDate(d.getDate() + dir);
      else if (viewMode === 'month') d.setMonth(d.getMonth() + dir, 1);
      else d.setFullYear(d.getFullYear() + dir, 0, 1);
      return d;
    });
  }, [viewMode]);

  const title = useMemo(() => {
    if (viewMode === 'day') {
      return cursor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (viewMode === 'year') return String(cursor.getFullYear());
    return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }, [cursor, viewMode]);

  // Stronger, clearly visible grid borders (requested): slate-300 / slate-500.
  const cellBorder = 'border border-gray-300 dark:border-slate-500';
  const btnCls = 'px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-500 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors';
  const segCls = (active: boolean) =>
    `px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
      active
        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
        : 'border-gray-300 dark:border-slate-500 text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700'
    }`;

  const EventChip: React.FC<{ ev: MyClassEvent }> = ({ ev }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setDayModal(ev.date); }}
      title={`${ev.courseCode} · ${ev.courseTitle}\nDay ${ev.dayNumber}/${ev.totalDays}${ev.startTime ? ` · ${fmtTime(ev.startTime)}–${fmtTime(ev.endTime)}` : ''} · ${ev.classStatus}`}
      className={`w-full text-left truncate text-xs px-1.5 py-0.5 rounded border ${styleFor(ev.classStatus).chip} transition-colors`}
    >
      {ev.courseRunId} · {ev.courseTitle}
    </button>
  );

  // ── Month view ──────────────────────────────────────────────────────────────
  const renderMonth = () => {
    const days = monthGridDays(cursor.getFullYear(), cursor.getMonth());
    return (
      <div className="rounded-lg border-2 border-gray-300 dark:border-slate-500 overflow-hidden bg-white dark:bg-slate-800">
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className={`${cellBorder} px-2 py-2 text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-300 bg-gray-50 dark:bg-slate-900`}>
              {wd}
            </div>
          ))}
          {days.map((d) => {
            const iso = ymd(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = iso === today;
            const dayEvents = eventsByDate.get(iso) || [];
            const shown = dayEvents.slice(0, 3);
            return (
              <div
                key={iso}
                onClick={() => dayEvents.length > 0 && setDayModal(iso)}
                className={`${cellBorder} min-h-[104px] px-1.5 py-1.5 align-top ${inMonth ? 'bg-white dark:bg-slate-800' : 'bg-gray-50/70 dark:bg-slate-900/50'} ${dayEvents.length > 0 ? 'cursor-pointer hover:bg-blue-50/60 dark:hover:bg-slate-700/40' : ''} transition-colors`}
              >
                <span className={`inline-flex items-center justify-center text-sm mb-1 ${
                  isToday
                    ? 'w-6 h-6 rounded-full bg-blue-600 text-white font-bold'
                    : inMonth ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {d.getDate()}
                </span>
                <div className="space-y-1">
                  {shown.map((ev) => <EventChip key={`${ev.courseRunUuid}|${ev.date}`} ev={ev} />)}
                  {dayEvents.length > shown.length && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDayModal(iso); }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-1.5"
                    >
                      +{dayEvents.length - shown.length} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Day view ────────────────────────────────────────────────────────────────
  const renderDay = () => {
    const iso = ymd(cursor);
    const dayEvents = eventsByDate.get(iso) || [];
    return (
      <div className="rounded-lg border-2 border-gray-300 dark:border-slate-500 overflow-hidden bg-white dark:bg-slate-800">
        <div className={`px-4 py-2.5 text-sm font-semibold bg-gray-50 dark:bg-slate-900 text-gray-700 dark:text-gray-200 border-b border-gray-300 dark:border-slate-500 ${iso === today ? 'text-blue-600 dark:text-blue-400' : ''}`}>
          {cursor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{iso === today ? ' · Today' : ''}
        </div>
        {dayEvents.length === 0 ? (
          <div className="px-4 py-10 text-sm text-gray-400 dark:text-gray-500 text-center">No classes on this day.</div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-slate-600">
            {dayEvents.map((ev) => (
              <li key={`${ev.courseRunUuid}|${ev.date}`} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{ev.courseCode} · {ev.courseTitle}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Day {ev.dayNumber}/{ev.totalDays}
                    {ev.startTime ? ` · ${fmtTime(ev.startTime)}–${fmtTime(ev.endTime)}` : ''}
                    {` · Run ${ev.courseRunId}`}
                  </p>
                </div>
                <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${styleFor(ev.classStatus).badge}`}>{ev.classStatus}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  // ── Year view ───────────────────────────────────────────────────────────────
  const renderYear = () => {
    const y = cursor.getFullYear();
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {MONTH_NAMES.map((name, m) => {
          const days = monthGridDays(y, m);
          return (
            <div key={name} className="rounded-lg border-2 border-gray-300 dark:border-slate-500 bg-white dark:bg-slate-800 p-3">
              <button
                type="button"
                onClick={() => { setCursor(new Date(y, m, 1)); setViewMode('month'); }}
                className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline mb-2"
              >
                {name}
              </button>
              <div className="grid grid-cols-7 gap-y-0.5 text-center">
                {['M', 'T', 'W', 'T2', 'F', 'S', 'S2'].map((wd) => (
                  <span key={wd} className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">{wd.charAt(0)}</span>
                ))}
                {days.map((d) => {
                  const iso = ymd(d);
                  const inMonth = d.getMonth() === m;
                  const hasEvents = (eventsByDate.get(iso) || []).length > 0;
                  const isToday = iso === today;
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={!hasEvents}
                      onClick={() => { setCursor(new Date(d)); setViewMode('day'); }}
                      className={`mx-auto w-6 h-6 flex items-center justify-center rounded-full text-[11px] transition-colors ${
                        !inMonth ? 'text-transparent'
                          : isToday ? 'bg-blue-600 text-white font-bold'
                          : hasEvents ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-semibold hover:bg-green-200 dark:hover:bg-green-900/60 cursor-pointer'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {inMonth ? d.getDate() : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const modalEvents = dayModal ? (eventsByDate.get(dayModal) || []) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon name={IconName.Calendar} className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        <h1 className="text-2xl font-bold text-on-surface">My Calendar</h1>
        {loading && <span className="ml-2 animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" aria-label="Loading" />}
      </div>

      {/* Toolbar: Prev / Today / Next · title · Day / Month / Year */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} className={btnCls}>← Prev</button>
          <button type="button" onClick={goToday} className={btnCls}>Today</button>
          <button type="button" onClick={() => step(1)} className={btnCls}>Next →</button>
          <h2 className="ml-3 text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {(['day', 'month', 'year'] as ViewMode[]).map((v) => (
            <button key={v} type="button" onClick={() => setViewMode(v)} className={segCls(viewMode === v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'month' && renderMonth()}
      {viewMode === 'day' && renderDay()}
      {viewMode === 'year' && renderYear()}

      {/* Day details popup */}
      {dayModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setDayModal(null)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border-2 border-gray-300 dark:border-slate-500 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-300 dark:border-slate-500 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {new Date(dayModal + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h3>
              <button type="button" onClick={() => setDayModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>
            {modalEvents.length === 0 ? (
              <div className="px-4 py-8 text-sm text-gray-400 text-center">No classes on this day.</div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-slate-600">
                {modalEvents.map((ev) => (
                  <li key={`${ev.courseRunUuid}|${ev.date}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{ev.courseCode} · {ev.courseTitle}</p>
                      <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${styleFor(ev.classStatus).badge}`}>{ev.classStatus}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Day {ev.dayNumber}/{ev.totalDays}
                      {ev.startTime ? ` · ${fmtTime(ev.startTime)}–${fmtTime(ev.endTime)}` : ''}
                      {ev.sessionCount > 1 ? ` · ${ev.sessionCount} sessions` : ''}
                      {` · Run ${ev.courseRunId}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MyCalendarView;
