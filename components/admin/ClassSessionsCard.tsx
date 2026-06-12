import React from 'react';

export interface ClassSession {
  id?: string | null;
  sessionNumber?: string | null;
  ssgSessionId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  modeOfTraining?: string | null;
  trainerName?: string | null;
  attendanceTaken?: boolean;
  classType?: string | null;
  // Live calendar match (per session), filled by /api/admin/class-sessions.
  calendarMatched?: boolean;
  calendarLink?: string | null;
  calendarEventDate?: string | null;
}

export interface ClassSessionsCardProps {
  sessions: ClassSession[];
  /** Whether the calendar was actually queried (vs unavailable in this env). */
  calendarChecked?: boolean;
  /** SSG error message, if the live fetch couldn't load sessions. */
  ssgError?: string | null;
}

const fmtDay = (iso?: string | null): string => {
  if (!iso) return 'Unscheduled';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

// SSG mode-of-training codes (mirror modeOfTrainingOptions in Edit/CreateNewClassView).
const MODE: Record<string, { short: string; full: string }> = {
  '1':  { short: 'Classroom',         full: '1 - Classroom Facilitated Training' },
  '2':  { short: 'Async e-learning',  full: '2 - Asynchronous E-learning' },
  '4':  { short: 'On-the-Job',        full: '4 - On the Job Training' },
  '8':  { short: 'Assessment',        full: '8 - Assessment' },
  '9':  { short: 'Sync e-learning',   full: '9 - Synchronous E-learning' },
  '10': { short: 'Workplace',         full: '10 - Work-based/Workplace Learning' },
};
const modeLabel = (s: ClassSession) => {
  const code = (s.modeOfTraining ?? '').toString().trim();
  if (code && MODE[code]) return MODE[code];
  const raw = code || (s.classType ?? '') || '';
  return raw ? { short: raw, full: raw } : null;
};

const TH = 'px-3 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap';

const CalendarCell: React.FC<{ s: ClassSession; checked: boolean }> = ({ s, checked }) => {
  if (!checked) {
    return <span className="text-gray-400" title="Calendar not checked — Google Calendar wasn't reachable in this environment.">—</span>;
  }
  if (s.calendarMatched && s.calendarLink) {
    return (
      <a href={s.calendarLink} target="_blank" rel="noopener noreferrer"
         className="text-blue-600 dark:text-blue-400 hover:underline"
         title={s.calendarEventDate ? `Calendar event on ${s.calendarEventDate}` : 'Open calendar event'}>
        View event ↗
      </a>
    );
  }
  if (s.calendarMatched) return <span className="text-emerald-600 dark:text-emerald-400">Matched</span>;
  return (
    <span className="text-amber-600 dark:text-amber-400"
          title="No calendar event matched on this date. Check the session date/time (from SSG) against Google Calendar, and that the event title still matches.">
      Not found
    </span>
  );
};

/**
 * Renders a class's sessions in a single aligned table, VISUALLY GROUPED BY DAY,
 * with a live-matched Google Calendar event link per session. Shared across all
 * class-list views + the Edit Class Sessions tab.
 */
export function ClassSessionsCard({ sessions, calendarChecked = false, ssgError = null }: ClassSessionsCardProps) {
  if (!sessions || sessions.length === 0) {
    return ssgError
      ? <div className="text-sm text-amber-600 dark:text-amber-400">Couldn’t load sessions from SSG — {ssgError}</div>
      : <div className="text-sm text-gray-500 dark:text-gray-400">No sessions found for this class.</div>;
  }

  // Group by startDate, preserving first-seen order.
  const groups: { day: string; items: ClassSession[] }[] = [];
  const idx: Record<string, number> = {};
  for (const s of sessions) {
    const key = s.startDate || 'Unscheduled';
    if (idx[key] === undefined) { idx[key] = groups.length; groups.push({ day: key, items: [] }); }
    groups[idx[key]].items.push(s);
  }

  const anyUnmatched = calendarChecked && sessions.some(s => s.startDate && !s.calendarMatched);

  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        Sessions ({sessions.length}) · {groups.length} day{groups.length !== 1 ? 's' : ''}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Showing latest SSG information · calendar matched live
      </div>
      <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className={`${TH} w-10`}>#</th>
              <th className={TH}>Time</th>
              <th className={TH}>Mode</th>
              <th className={TH}>Trainer</th>
              <th className={TH}>Attendance</th>
              <th className={TH}>Calendar</th>
              <th className="w-full p-0"></th>
            </tr>
          </thead>
          <tbody className="text-gray-700 dark:text-gray-200">
            {groups.map((g, gi) => (
              <React.Fragment key={g.day || gi}>
                <tr className="bg-gray-100 dark:bg-gray-700/60">
                  <td colSpan={7} className="px-3 py-1.5 font-semibold text-gray-700 dark:text-gray-200">
                    <span>{fmtDay(g.day)}</span>
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                      · {g.items.length} session{g.items.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                </tr>
                {g.items.map((s, si) => {
                  const m = modeLabel(s);
                  return (
                    <tr key={s.id || s.ssgSessionId || si} className="border-t border-gray-100 dark:border-gray-700/60">
                      <td className="px-3 py-1.5 whitespace-nowrap w-10 text-gray-500 dark:text-gray-400">{s.sessionNumber ?? si + 1}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap font-medium">{s.startTime || '—'}{s.endTime ? ` – ${s.endTime}` : ''}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap" title={m?.full || undefined}>{m?.short || '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{s.trainerName || '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{s.attendanceTaken ? <span className="text-emerald-600 dark:text-emerald-400">Taken</span> : <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap"><CalendarCell s={s} checked={calendarChecked} /></td>
                      <td className="w-full p-0"></td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {anyUnmatched && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          ⚠ Some sessions have no matching calendar event. Check the SSG session date/time against Google Calendar, and that the event <strong>title</strong> still matches (a renamed event won’t match).
        </div>
      )}
    </div>
  );
}
