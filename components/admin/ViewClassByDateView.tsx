import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { getApiUrl } from '@lib/urlHelpers';
import UpsertFromSsgModal from './UpsertFromSsgModal';
import { ClassSessionsCard } from './ClassSessionsCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  courseRunUuid: string;
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: 'Pending' | 'Confirmed' | 'Cancelled' | string;
  classType: 'Physical' | 'Virtual' | 'Hybrid' | 'External' | string;
  invitationPaused: boolean;
  invitationRepliesBlocked: boolean;
  sessionDate: string;   // YYYY-MM-DD
  startTime: string;     // HH:MM
  endTime: string;       // HH:MM
  dayNumber: number;
  sessionNumbers: string[]; // e.g. ["3","4"] — session numbers covered by this date
  allSessionDates: string[]; // all unique session dates for this CR (YYYY-MM-DD)
  numLearners: number;
  tpgTrainerName: string;
  tpgTrainerEmail: string;
  localTrainerName: string;
  localTrainerEmail: string;
  localTrainers: Array<{ name: string; email: string }>;
  nextAvailableTrainer: string;
  nextAvailableTrainerEmail: string;
  latestInvitationStatus: string;
  approvedTrainers: string[]; // options for the Next Trainer dropdown
  trainerInvitations?: Record<string, Array<{ status: string; sent_at: string; responded_at: string | null }>>;
}

// Format session numbers as "S3, S4" (e.g. ["3","4"] → "S3, S4").
// Returns empty string if no numbers so callers can conditionally render.
const formatSessionNumbers = (nums: string[]): string => {
  if (!nums || nums.length === 0) return '';
  return nums.map((n) => `S${n}`).join(', ');
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Return YYYY-MM-DD for a Date in local time (avoids toISOString UTC drift).
const localIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const firstOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
const lastOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d: Date, delta: number): Date => new Date(d.getFullYear(), d.getMonth() + delta, 1);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const SHORT_MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];
const SHORT_WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const statusDotClass = (status: string): string => {
  switch (status) {
    case 'Confirmed':   return 'bg-emerald-500';
    case 'Pending':     return 'bg-yellow-400';
    case 'Cancelled':   return 'bg-red-500';
    case 'Unconfirmed': return 'bg-purple-500';
    default:            return 'bg-gray-400';
  }
};

const statusDotTooltip = (status: string): string => {
  switch (status) {
    case 'Confirmed': return 'Class confirmed — trainer accepted (in local)';
    case 'Pending':   return 'Pending trainer — waiting for trainers to accept OR have not sent trainer invitation';
    case 'Cancelled':   return 'Class cancelled — no enrolment OR no trainer found';
    case 'Unconfirmed': return 'Class unconfirmed';
    default:            return 'Unknown status';
  }
};

const statusPillClass = (status: string): string => {
  switch (status) {
    case 'Confirmed':   return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'Pending':     return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    case 'Cancelled':   return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    case 'Unconfirmed': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    default:            return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
};

// ── Mini Month Picker ─────────────────────────────────────────────────────────

interface MonthPickerProps {
  currentMonth: Date;
  selectedDate: string;
  eventDates: Set<string>;
  onPrev: () => void;
  onNext: () => void;
  onSelectDate: (iso: string) => void;
}

const MonthPicker: React.FC<MonthPickerProps> = ({
  currentMonth, selectedDate, eventDates, onPrev, onNext, onSelectDate
}) => {
  const todayIso = localIso(new Date());
  const monthLabel = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

  // Build 6-row grid starting from the Monday on/before the 1st of the month.
  const firstDay = firstOfMonth(currentMonth);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startWeekday);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onPrev}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{monthLabel}</div>
        <button
          onClick={onNext}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">
        {['M','T','W','T','F','S','S'].map((w, i) => (
          <div key={i} className="text-center">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const iso = localIso(d);
          const inMonth = d.getMonth() === currentMonth.getMonth();
          const isToday = iso === todayIso;
          const isSelected = iso === selectedDate;
          const hasEvent = eventDates.has(iso);
          let cls = 'relative w-7 h-7 flex items-center justify-center text-[11px] rounded-full transition-colors ';
          if (isSelected) {
            cls += 'bg-blue-600 text-white font-semibold ';
          } else if (isToday) {
            cls += 'ring-2 ring-blue-500 text-blue-700 dark:text-blue-300 font-semibold ';
          } else if (inMonth) {
            cls += 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 ';
          } else {
            cls += 'text-gray-300 dark:text-gray-600 ';
          }
          return (
            <button
              key={i}
              onClick={() => onSelectDate(iso)}
              className={cls}
              aria-label={iso}
            >
              {d.getDate()}
              {hasEvent && inMonth && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                  isSelected ? 'bg-white' : 'bg-blue-500'
                }`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Event Row ─────────────────────────────────────────────────────────────────

interface EventRowProps {
  event: CalendarEvent;
  expanded: boolean;
  inviting: boolean;
  nextTrainerOverride: string; // selected approved trainer, empty = use server-computed default
  onToggle: () => void;
  onOpenEditor: () => void;
  onInviteNext: () => void;
  onChangeNextTrainer: (trainerName: string) => void;
  onChangeClassStatus: (newStatus: 'Confirmed' | 'Pending' | 'Cancelled' | 'Unconfirmed') => void;
  onChangeClassType: (newType: 'Physical' | 'Virtual' | 'Hybrid' | 'External') => void;
  onTogglePauseInvites: () => void;
  onToggleBlockReplies: () => void;
  onViewAttendance: () => void;
  onViewEnrolment: () => void;
}

const DetailCell: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
    <div className="text-sm text-gray-900 dark:text-gray-100 truncate" title={typeof value === 'string' ? value : undefined}>
      {value || <span className="text-gray-400 dark:text-gray-600">—</span>}
    </div>
  </div>
);

// Trainer state dot — 5 possible states:
//   red    = neither SSG nor Local trainer set
//   orange = Local trainer set, SSG trainer missing
//   purple = SSG trainer set, Local trainer missing
//   yellow = both set but do not match (by email or name)
//   green  = both set and match (same person)
type TrainerMatchState = 'red' | 'orange' | 'purple' | 'yellow' | 'green';

const trainersMatchState = (event: CalendarEvent): TrainerMatchState => {
  const hasTpg = !!(event.tpgTrainerName || '').trim();
  const locals = event.localTrainers?.filter(t => (t.name || '').trim()) || [];
  const hasLocal = locals.length > 0 || !!(event.localTrainerName || '').trim();
  if (!hasTpg && !hasLocal) return 'red';
  if (hasLocal && !hasTpg) return 'orange';
  if (hasTpg && !hasLocal) return 'purple';
  // Both exist — check if any local trainer matches TPG by email or name
  const tpgEmail = (event.tpgTrainerEmail || '').trim().toLowerCase();
  const tpgNorm = (event.tpgTrainerName || '').toLowerCase().trim();
  const allLocals = locals.length > 0
    ? locals
    : [{ name: event.localTrainerName || '', email: event.localTrainerEmail || '' }];
  for (const local of allLocals) {
    const localEmail = (local.email || '').trim().toLowerCase();
    if (tpgEmail && localEmail && tpgEmail === localEmail) return 'green';
    const localNorm = (local.name || '').toLowerCase().trim();
    if (tpgNorm && localNorm && tpgNorm === localNorm) return 'green';
  }
  return 'yellow';
};

const TRAINER_STATE_STYLES: Record<TrainerMatchState, { dot: string; label: string }> = {
  red:    { dot: 'bg-red-500',    label: 'No SSG and no Local trainer' },
  orange: { dot: 'bg-orange-500', label: 'Local trainer set, no SSG trainer' },
  purple: { dot: 'bg-purple-500', label: 'SSG trainer set, no Local trainer' },
  yellow: { dot: 'bg-yellow-400', label: 'SSG and Local trainers do not match' },
  green:  { dot: 'bg-green-500',  label: 'SSG and Local trainers match' },
};

const EventRow: React.FC<EventRowProps> = ({
  event, expanded, inviting, nextTrainerOverride, onToggle, onOpenEditor, onInviteNext, onChangeNextTrainer, onChangeClassStatus, onChangeClassType, onTogglePauseInvites, onToggleBlockReplies, onViewAttendance, onViewEnrolment
}) => {
  // Admin can override the server-computed next trainer via the dropdown.
  // Fall back to server-computed when no override set yet.
  const effectiveNextTrainer = nextTrainerOverride || event.nextAvailableTrainer;
  // Derive display status the same way as the dropdown label so dot color and
  // pill color stay in sync with the displayed text.
  const derivedStatus: string = (event.classStatus === 'Cancelled' || event.classStatus === 'Unconfirmed')
    ? event.classStatus
    : ((event.localTrainerName || '').trim() ? 'Confirmed' : 'Pending');
  // Unconfirmed = trainer fell through, awaiting re-source — inviting IS allowed
  // (it transitions the run back to Pending). Only Cancelled blocks inviting.
  const canInvite = !!effectiveNextTrainer && derivedStatus !== 'Cancelled';
  const sessionLabel = formatSessionNumbers(event.sessionNumbers);
  const matchState = trainersMatchState(event);

  // Full run schedule (all sessions grouped by day) — lazy-loaded once this row
  // is expanded. This view is date-grouped, so the card gives the whole-run
  // context alongside the single day shown in the row. Keyed per EventRow; the
  // class-sessions endpoint is cheap and cached by the browser per run.
  const [runSessions, setRunSessions] = useState<any | null>(null);
  const [runSessionsLoading, setRunSessionsLoading] = useState(false);
  useEffect(() => {
    if (!expanded || runSessions !== null || runSessionsLoading) return;
    setRunSessionsLoading(true);
    fetch(getApiUrl(`/api/admin/class-sessions?courseRunId=${encodeURIComponent(event.courseRunUuid || event.courseRunId)}`))
      .then((r) => r.json())
      .then((d) => setRunSessions(d.success ? d : { sessions: [] }))
      .catch(() => setRunSessions({ sessions: [] }))
      .finally(() => setRunSessionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
      {/* Collapsed row — click anywhere toggles expand. Ctrl+click title opens editor in new tab. */}
      <div
        onClick={onToggle}
        className="group/row flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        aria-label={expanded ? 'Collapse row' : 'Expand row'}
      >
        <span
          className={`w-3 h-3 rounded-full flex-shrink-0 ${statusDotClass(derivedStatus)}`}
          title={statusDotTooltip(derivedStatus)}
          aria-label={statusDotTooltip(derivedStatus)}
        />
        <div className="text-xs font-mono text-gray-600 dark:text-gray-400 w-28 flex-shrink-0 tabular-nums">
          {event.startTime} – {event.endTime}
        </div>
        <div className="flex-1 min-w-0">
          <span
            className="text-left text-sm text-gray-900 dark:text-gray-100 rounded px-1 max-w-full flex items-center gap-1.5 min-w-0"
            title="Click to expand (Ctrl+click for editor)"
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.stopPropagation();
                window.open(`/?adminPage=editClass&courseRunId=${event.courseRunId}`, '_blank');
              }
            }}
          >
            <span className="truncate">Day {event.dayNumber} - {event.courseTitle}</span>
            <span className="flex-shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">[{event.courseRunId}]</span>
            <span className={`flex-shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 leading-none ${
              event.classType === 'Virtual' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
              event.classType === 'Hybrid' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
              event.classType === 'External' ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' :
              'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
            }`}>{event.classType || 'Physical'}</span>
          </span>
        </div>
        {sessionLabel && (
          <span
            className="hidden sm:inline-flex flex-shrink-0 items-center px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            title={`${event.sessionNumbers.length} ${event.sessionNumbers.length === 1 ? 'session' : 'sessions'} on this day`}
          >
            {sessionLabel}
          </span>
        )}
        <div className="hidden md:flex flex-col w-56 flex-shrink-0 text-[11px] leading-tight">
          <div className="flex items-baseline gap-1.5 min-w-0" title={event.tpgTrainerName}>
            <span className="inline-block w-10 flex-shrink-0 text-gray-400 dark:text-gray-500">TPG:</span>
            <span className="truncate text-gray-700 dark:text-gray-200">{event.tpgTrainerName || '—'}</span>
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0" title={event.localTrainers?.length > 1 ? event.localTrainers.map(t => t.name).filter(Boolean).join(', ') : event.localTrainerName}>
            <span className="inline-block w-10 flex-shrink-0 text-gray-400 dark:text-gray-500">Local:</span>
            <span className="truncate text-gray-700 dark:text-gray-200">
              {event.localTrainers?.length > 1
                ? event.localTrainers.map(t => t.name).filter(Boolean).join(', ')
                : (event.localTrainerName || '—')}
            </span>
          </div>
        </div>
        <span
          className={`hidden md:block w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white/20 dark:ring-gray-700 ${TRAINER_STATE_STYLES[matchState].dot}`}
          title={TRAINER_STATE_STYLES[matchState].label}
          aria-label={TRAINER_STATE_STYLES[matchState].label}
        />
        <span
          className="p-1 text-gray-500 dark:text-gray-400 flex-shrink-0 select-none"
          aria-hidden="true"
        >
          {expanded ? '▴' : '▾'}
        </span>
      </div>

      {/* Expanded detail — 13 columns + actions */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
            <DetailCell label="Course Run ID" value={event.courseRunId} />
            <DetailCell label="Course Ref Code" value={event.courseCode} />
            <DetailCell label="Course Title" value={event.courseTitle} />
            <DetailCell
              label="Class Status"
              value={
                <select
                  value={derivedStatus === 'Cancelled' ? 'Cancelled' : derivedStatus === 'Unconfirmed' ? 'Unconfirmed' : 'auto'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const selection = e.target.value;
                    const hasLocalTrainer = !!(event.localTrainerName || '').trim();
                    const newStatus = (selection === 'Cancelled' || selection === 'Unconfirmed')
                      ? selection
                      : (hasLocalTrainer ? 'Confirmed' : 'Pending');
                    onChangeClassStatus(newStatus);
                  }}
                  className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 ${statusPillClass(derivedStatus)}`}
                >
                  {derivedStatus === 'Cancelled' ? (
                    <>
                      <option value="Cancelled" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Cancelled</option>
                      <option value="auto" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Confirmed/Pending</option>
                      <option value="Unconfirmed" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Unconfirmed</option>
                    </>
                  ) : derivedStatus === 'Unconfirmed' ? (
                    <>
                      <option value="Unconfirmed" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Unconfirmed</option>
                      <option value="auto" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Confirmed/Pending</option>
                      <option value="Cancelled" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Cancelled</option>
                    </>
                  ) : (
                    <>
                      <option value="auto" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">
                        {(event.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}
                      </option>
                      <option value="Cancelled" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Cancelled</option>
                      <option value="Unconfirmed" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Unconfirmed</option>
                    </>
                  )}
                </select>
              }
            />
            <DetailCell
              label="Class Type"
              value={
                <select
                  value={event.classType || 'Physical'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChangeClassType(e.target.value as 'Physical' | 'Virtual' | 'Hybrid' | 'External')}
                  className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                >
                  <option value="Physical" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Physical</option>
                  <option value="Virtual" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Virtual</option>
                  <option value="Hybrid" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Hybrid</option>
                  <option value="External" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">External</option>
                </select>
              }
            />
            <DetailCell
              label="Date"
              value={
                event.allSessionDates && event.allSessionDates.length > 1 ? (
                  <div className="flex flex-wrap gap-1">
                    {event.allSessionDates.map((d) => {
                      const isCurrent = d === event.sessionDate;
                      return (
                        <span
                          key={d}
                          className={
                            isCurrent
                              ? 'px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-600 text-white'
                              : 'px-1.5 py-0.5 rounded text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800'
                          }
                          title={isCurrent ? 'This row' : undefined}
                        >
                          {d}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  event.sessionDate
                )
              }
            />
            <DetailCell label="Start Time" value={event.startTime} />
            <DetailCell label="End Time" value={event.endTime} />
            <DetailCell label="Learners" value={String(event.numLearners)} />
            <DetailCell label="Trainer (TPG)" value={event.tpgTrainerName} />
            <DetailCell
              label="Trainer (Local)"
              value={
                event.localTrainers && event.localTrainers.length > 0
                  ? event.localTrainers.map((t) => t.name).filter(Boolean).join(', ')
                  : (event.localTrainerName || '')
              }
            />
            <DetailCell
              label="Next Trainer"
              value={
                event.approvedTrainers.length > 0 ? (
                  <select
                    value={effectiveNextTrainer}
                    onChange={(e) => onChangeNextTrainer(e.target.value)}
                    className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">— Select —</option>
                    {event.approvedTrainers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-gray-400 dark:text-gray-600">No approved trainers</span>
                )
              }
            />
            <DetailCell label="Sessions Covered" value={sessionLabel} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.open(`/?adminPage=editClass&courseRunId=${event.courseRunId}`, '_blank');
                  return;
                }
                onOpenEditor();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Open in Editor
            </button>
            <button
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.open(`/?adminPage=checkAttendance&courseRunId=${event.courseRunId}`, '_blank');
                  return;
                }
                onViewAttendance();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              View Attendance
            </button>
            <button
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.open(`/?adminPage=searchEnrolment&courseRunId=${event.courseRunId}`, '_blank');
                  return;
                }
                onViewEnrolment();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              View Enrolment
            </button>
            {event.latestInvitationStatus && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                Latest invitation: <span className="font-semibold">{event.latestInvitationStatus}</span>
              </span>
            )}
            {/* Invite button + pause toggle pushed to the right */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePauseInvites();
                }}
                className={`px-2 py-1 text-[10px] font-medium rounded border ${
                  event.invitationPaused
                    ? 'border-orange-400 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-600'
                    : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
                title={event.invitationPaused ? 'Invitations paused — click to unpause' : 'Click to pause invitations for this CR'}
              >
                {event.invitationPaused ? 'Unpause Invite' : 'Pause Invite'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBlockReplies();
                }}
                className={`px-2 py-1 text-[10px] font-medium rounded border ${
                  event.invitationRepliesBlocked
                    ? 'border-red-400 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 dark:border-red-600'
                    : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
                title={event.invitationRepliesBlocked ? 'Replies blocked — click to unblock' : 'Click to block trainer replies for this CR'}
              >
                {event.invitationRepliesBlocked ? 'Unblock Reply' : 'Block Reply'}
              </button>
              <button
                onClick={onInviteNext}
                disabled={!canInvite || inviting || event.invitationPaused}
                className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
                title={
                  event.invitationPaused ? 'Invitations paused' :
                  !effectiveNextTrainer ? 'No trainer selected' :
                  event.classStatus === 'Cancelled' ? 'Class is cancelled' : ''
                }
              >
                {inviting ? 'Sending…' : `Invite${effectiveNextTrainer ? ` ${effectiveNextTrainer}` : ' Next Trainer'}`}
              </button>
            </div>
          </div>

          {/* Full run schedule, grouped by day */}
          <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3">
            {runSessionsLoading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading sessions…</div>
            ) : (
              <ClassSessionsCard sessions={runSessions?.sessions || []} calendarChecked={runSessions?.calendarChecked} ssgError={runSessions?.ssgError} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main View ─────────────────────────────────────────────────────────────────

const ViewClassByDateView: React.FC = () => {
  const { setAdminPage, setEditingCourseRun, setClassListReturnTo } = useLms();

  const [currentMonth, setCurrentMonth] = useState<Date>(() => firstOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => localIso(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [ongoingEvents, setOngoingEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [inviting, setInviting] = useState<Record<string, boolean>>({});
  // Per-courseRunUuid override for the Next Trainer dropdown — lets admin pick
  // a specific approved trainer instead of the auto-computed next in line.
  const [nextTrainerOverrides, setNextTrainerOverrides] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  // Upsert-from-SSG modal state (backlog #65)
  const [isUpsertModalOpen, setUpsertModalOpen] = useState<boolean>(false);
  // Sync-from-Calendar modal state
  const [isSyncCalendarOpen, setSyncCalendarOpen] = useState<boolean>(false);
  const [syncCalendarResults, setSyncCalendarResults] = useState<any[] | null>(null);
  const [syncCalendarLoading, setSyncCalendarLoading] = useState<boolean>(false);
  const [syncCalendarMeta, setSyncCalendarMeta] = useState<{ total: number; wsq: number } | null>(null);
  const [syncNotInCalendar, setSyncNotInCalendar] = useState<any[] | null>(null);
  const [overrideMismatchedTrainers, setOverrideMismatchedTrainers] = useState<boolean>(false);
  const [confirmCancelUuids, setConfirmCancelUuids] = useState<Set<string>>(new Set());
  // Bump this to force the month fetch effect to re-run (e.g. after Apply completes)
  const [refetchKey, setRefetchKey] = useState<number>(0);

  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Fetch events whenever the viewed month changes
  useEffect(() => {
    let cancelled = false;
    const monthStart = localIso(firstOfMonth(currentMonth));
    const monthEnd = localIso(lastOfMonth(currentMonth));

    setLoading(true);
    setError(null);

    fetch(getApiUrl(`/api/admin/classes-by-date?monthStart=${monthStart}&monthEnd=${monthEnd}`))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'Unknown error');
        setEvents(json.data?.events || []);
        setOngoingEvents(json.data?.ongoingEvents || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load events');
        setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [currentMonth, refetchKey]);

  // Group events by session date (YYYY-MM-DD), sorted ascending. If the
  // selected date is within the currently-viewed month, filter to days
  // >= selectedDate so the list visibly starts on that date (Google Calendar
  // schedule-view behavior). If the selected date is outside the viewed
  // month (e.g. user navigated via arrows), show the whole month.
  // Split events into active (main list) and cancelled (separate section per day)
  const { grouped, cancelledByDate } = useMemo(() => {
    const activeMap = new Map<string, CalendarEvent[]>();
    const cancelledMap = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const isCancelled = ev.classStatus === 'Cancelled';
      const map = isCancelled ? cancelledMap : activeMap;
      const arr = map.get(ev.sessionDate) || [];
      arr.push(ev);
      map.set(ev.sessionDate, arr);
    }
    // Sort each day's events by start time
    activeMap.forEach((arr) => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    cancelledMap.forEach((arr) => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));

    const allEntries = Array.from(activeMap.entries())
      .sort((a: [string, CalendarEvent[]], b: [string, CalendarEvent[]]) => a[0].localeCompare(b[0]));

    // Filter only when selectedDate falls within the currently-viewed month
    const selected = new Date(selectedDate + 'T00:00:00');
    const sameMonth = selected.getFullYear() === currentMonth.getFullYear() &&
                      selected.getMonth() === currentMonth.getMonth();
    const filtered = sameMonth
      ? allEntries.filter(([date]) => date >= selectedDate)
      : allEntries;

    return { grouped: filtered, cancelledByDate: cancelledMap };
  }, [events, selectedDate, currentMonth]);

  const eventDates = useMemo(() => new Set(events.map(e => e.sessionDate)), [events]);

  // When the selection changes (or filtering changes the first visible day),
  // scroll the first rendered day into view. Because `grouped` is already
  // filtered to start at selectedDate when in the same month, the first
  // entry IS the target. scroll-mt-32 on the day wrapper handles the sticky
  // header offset. On initial mount, this lands the user on today's classes.
  useEffect(() => {
    if (grouped.length === 0) return;
    const firstDate = grouped[0][0];
    const ref = dayRefs.current.get(firstDate);
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDate, grouped]);

  const handlePrevMonth = useCallback(() => setCurrentMonth((m) => addMonths(m, -1)), []);
  const handleNextMonth = useCallback(() => setCurrentMonth((m) => addMonths(m, 1)), []);
  const handleSelectDate = useCallback((iso: string) => {
    setSelectedDate(iso);
    // If the picked date is outside the currently viewed month, switch months
    const picked = new Date(iso + 'T00:00:00');
    if (picked.getMonth() !== currentMonth.getMonth() || picked.getFullYear() !== currentMonth.getFullYear()) {
      setCurrentMonth(firstOfMonth(picked));
    }
  }, [currentMonth]);

  const handleToday = useCallback(() => {
    const now = new Date();
    setCurrentMonth(firstOfMonth(now));
    setSelectedDate(localIso(now));
  }, []);

  // Called after UpsertFromSsgModal's Apply succeeds — triggers the month fetch
  // effect to re-run so newly-upserted sessions/enrolments appear immediately.
  const handleUpsertApplyComplete = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  // Sync from Calendar — preview
  const handleSyncCalendarPreview = useCallback(async () => {
    setSyncCalendarLoading(true);
    setSyncCalendarResults(null);
    setSyncCalendarMeta(null);
    try {
      const res = await fetch(getApiUrl('/api/admin/sync-from-calendar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, mode: 'preview' }),
      });
      const json = await res.json();
      if (json.success) {
        setSyncCalendarResults(json.results);
        setSyncCalendarMeta({ total: json.totalCalendarEvents, wsq: json.wsqEvents });
        setSyncNotInCalendar(json.notInCalendar || []);
      } else {
        setToast(json.error || 'Sync preview failed');
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      setToast('Failed to connect to sync endpoint');
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSyncCalendarLoading(false);
    }
  }, [selectedDate]);

  // Sync from Calendar — apply
  const handleSyncCalendarApply = useCallback(async () => {
    setSyncCalendarLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/sync-from-calendar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          mode: 'apply',
          overrideMismatchedTrainers,
          confirmCancellations: Array.from(confirmCancelUuids),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSyncCalendarResults(json.results);
        setSyncNotInCalendar(json.notInCalendar || []);
        setRefetchKey((k) => k + 1);
        setToast(`Synced ${json.results.filter((r: any) => r.status === 'upserted' || r.status === 'trainer_synced').length} course run(s)`);
        setTimeout(() => setToast(null), 4000);
      } else {
        setToast(json.error || 'Sync apply failed');
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      setToast('Failed to connect to sync endpoint');
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSyncCalendarLoading(false);
    }
  }, [selectedDate, overrideMismatchedTrainers, confirmCancelUuids]);

  const handleOpenEditor = useCallback((event: CalendarEvent) => {
    // Mirror the shape used by UpcomingClassesTable/ClassDetailView — setEditingCourseRun accepts any
    setEditingCourseRun({
      id: event.courseRunUuid,
      courseRunId: event.courseRunId,
      courseTitle: event.courseTitle,
      courseCode: event.courseCode,
      startDate: event.sessionDate,
      endDate: event.sessionDate,
      trainersList: event.approvedTrainers.join(' | '),
      trainerInvitations: event.trainerInvitations || {},
      invitationPaused: event.invitationPaused,
      invitationRepliesBlocked: event.invitationRepliesBlocked,
    });
    // Set return-to so ClassManagerView's Cancel button bounces back to the
    // calendar instead of the admin dashboard.
    setClassListReturnTo(AdminPage.ViewClassByDate);
    setAdminPage(AdminPage.EditClass);
  }, [setAdminPage, setEditingCourseRun, setClassListReturnTo]);

  const handleInviteNext = useCallback(async (event: CalendarEvent) => {
    const key = `${event.courseRunUuid}|${event.sessionDate}`;
    // Pick override if admin selected one from the dropdown, else fall back to
    // the server-computed next available trainer.
    const overrideTrainerName = nextTrainerOverrides[event.courseRunUuid] || event.nextAvailableTrainer;
    if (!overrideTrainerName) {
      setToast('No trainer selected');
      setTimeout(() => setToast(null), 3500);
      return;
    }
    setInviting((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(getApiUrl('/api/admin/send-trainer-invitation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid: event.courseRunUuid, overrideTrainerName }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Request failed: ${res.status}`);
      }
      // Optimistically flip the row's invitation status without refetching
      setEvents((prev) => prev.map((e) =>
        e.courseRunUuid === event.courseRunUuid
          ? { ...e, latestInvitationStatus: 'pending' }
          : e
      ));
      setToast(`Invitation sent to ${overrideTrainerName}`);
      setTimeout(() => setToast(null), 3500);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to send invitation');
      setTimeout(() => setToast(null), 4500);
    } finally {
      setInviting((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [nextTrainerOverrides]);

  const handleSetNextTrainerOverride = useCallback((courseRunUuid: string, trainerName: string) => {
    setNextTrainerOverrides((prev) => ({ ...prev, [courseRunUuid]: trainerName }));
  }, []);

  const handleChangeClassStatus = useCallback(async (courseRunUuid: string, newStatus: 'Confirmed' | 'Pending' | 'Cancelled' | 'Unconfirmed') => {
    // Optimistic update — flip the row immediately, then PUT to the generic
    // /api/admin/upcoming-classes endpoint which accepts any course_run UUID.
    setEvents((prev) => prev.map((e) =>
      e.courseRunUuid === courseRunUuid ? { ...e, classStatus: newStatus } : e
    ));
    try {
      if (newStatus === 'Unconfirmed') {
        // Unconfirm is a multi-step reset (clear trainer locally + on SSG, supersede
        // invitations) — dedicated endpoint, not the generic status PUT.
        await fetch(getApiUrl('/api/admin/unconfirm-class'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseRunUuid }),
        });
      } else {
        await fetch(getApiUrl('/api/admin/upcoming-classes'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: courseRunUuid, class_status: newStatus }),
        });
      }
    } catch (err) {
      console.error('[ViewClassByDateView] Failed to update class status:', err);
      setToast('Failed to update class status');
      setTimeout(() => setToast(null), 3500);
    }
  }, []);

  const handleChangeClassType = useCallback(async (courseRunUuid: string, newType: 'Physical' | 'Virtual' | 'Hybrid' | 'External') => {
    setEvents((prev) => prev.map((e) =>
      e.courseRunUuid === courseRunUuid ? { ...e, classType: newType } : e
    ));
    try {
      await fetch(getApiUrl('/api/admin/upcoming-classes'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseRunUuid, class_type: newType }),
      });
    } catch (err) {
      console.error('[ViewClassByDateView] Failed to update class type:', err);
      setToast('Failed to update class type');
      setTimeout(() => setToast(null), 3500);
    }
  }, []);

  const handleTogglePauseInvites = useCallback(async (courseRunUuid: string) => {
    const current = events.find(e => e.courseRunUuid === courseRunUuid);
    const newVal = !current?.invitationPaused;
    setEvents((prev) => prev.map((e) =>
      e.courseRunUuid === courseRunUuid ? { ...e, invitationPaused: newVal } : e
    ));
    try {
      await fetch(getApiUrl('/api/admin/upcoming-classes'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseRunUuid, invitation_paused: newVal }),
      });
    } catch {
      setEvents((prev) => prev.map((e) =>
        e.courseRunUuid === courseRunUuid ? { ...e, invitationPaused: !newVal } : e
      ));
    }
  }, [events]);

  const handleToggleBlockReplies = useCallback(async (courseRunUuid: string) => {
    const current = events.find(e => e.courseRunUuid === courseRunUuid);
    const newVal = !current?.invitationRepliesBlocked;
    setEvents((prev) => prev.map((e) =>
      e.courseRunUuid === courseRunUuid ? { ...e, invitationRepliesBlocked: newVal } : e
    ));
    try {
      await fetch(getApiUrl('/api/admin/upcoming-classes'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseRunUuid, invitation_replies_blocked: newVal }),
      });
    } catch {
      setEvents((prev) => prev.map((e) =>
        e.courseRunUuid === courseRunUuid ? { ...e, invitationRepliesBlocked: !newVal } : e
      ));
    }
  }, [events]);

  const handleViewAttendance = useCallback(() => {
    setAdminPage(AdminPage.CheckAttendance);
  }, [setAdminPage]);

  const handleViewEnrolment = useCallback(() => {
    setAdminPage(AdminPage.SearchEnrolment);
  }, [setAdminPage]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const formatDayHeader = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    const day = String(d.getDate()).padStart(2, '0');
    const mon = SHORT_MONTH_NAMES[d.getMonth()];
    const wkd = SHORT_WEEKDAYS[(d.getDay() + 6) % 7];
    return `${day} ${mon}, ${wkd}`;
  };

  return (
    <div>
      {/* Sticky page header — stays pinned below the 64px site nav.
          z-20 keeps it below the site Header's z-30 stacking context so
          role-switcher dropdowns from the site header render on top. */}
      <div className="sticky top-16 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold dark:text-white">View Class By Date</h2>
          <div className="flex items-center gap-2">
            <a
              href="https://www.tpgateway.gov.sg/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm font-medium rounded border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 bg-white dark:bg-gray-800"
            >
              TPG
            </a>
            <button
              onClick={() => setSyncCalendarOpen(true)}
              className="px-3 py-1.5 text-sm font-medium rounded border border-orange-600 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/30 bg-white dark:bg-gray-800"
              title="Sync Google Calendar events to local DB for the selected date"
            >
              Sync Calendar
            </button>
            <button
              onClick={() => setUpsertModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium rounded border border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 bg-white dark:bg-gray-800"
              title="Bulk-hydrate local DB from SSG for one or more Course Run IDs"
            >
              Upsert from SSG
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 bg-white dark:bg-gray-800"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      <UpsertFromSsgModal
        isOpen={isUpsertModalOpen}
        onClose={() => setUpsertModalOpen(false)}
        onApplyComplete={handleUpsertApplyComplete}
      />

      {/* Sync from Calendar modal */}
      {isSyncCalendarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold dark:text-white">Sync from Google Calendar</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Date: {selectedDate}
                  {syncCalendarMeta && ` • ${syncCalendarMeta.total} calendar events, ${syncCalendarMeta.wsq} WSQ/IBF`}
                </p>
              </div>
              <button onClick={() => { setSyncCalendarOpen(false); setSyncCalendarResults(null); setSyncCalendarMeta(null); setSyncNotInCalendar(null); setConfirmCancelUuids(new Set()); setOverrideMismatchedTrainers(false); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!syncCalendarResults && !syncCalendarLoading && (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400 mb-4">
                    Fetch Google Calendar events for <strong>{selectedDate}</strong>, match to SSG course runs, and preview trainer sync.
                  </p>
                  <button
                    onClick={handleSyncCalendarPreview}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
                  >
                    Preview
                  </button>
                </div>
              )}

              {syncCalendarLoading && (
                <div className="text-center py-8">
                  <div className="inline-block w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-gray-500 dark:text-gray-400">Fetching calendar events and searching SSG...</p>
                  <p className="text-xs text-gray-400 mt-1">This may take a minute (SSG rate limits)</p>
                </div>
              )}

              {syncCalendarResults && !syncCalendarLoading && (
                <div className="space-y-2">
                  {syncCalendarResults.map((item: any, i: number) => {
                    const statusColors: Record<string, string> = {
                      new_cr: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
                      trainer_mismatch: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
                      already_synced: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
                      ambiguous: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
                      no_course_match: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
                      no_cr_match: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
                      upserted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                      trainer_synced: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
                    };
                    const statusLabels: Record<string, string> = {
                      new_cr: 'New / No Trainer',
                      trainer_mismatch: 'Trainer Mismatch',
                      already_synced: 'Already Synced',
                      ambiguous: 'Ambiguous',
                      no_course_match: 'No Course Match',
                      no_cr_match: 'No CR Match',
                      upserted: 'Upserted',
                      trainer_synced: 'Trainer Synced',
                      cancelled: 'Cancelled',
                    };
                    const classTypeColors: Record<string, string> = {
                      Virtual: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
                      Hybrid: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                      External: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
                      Physical: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
                    };
                    return (
                      <div key={i} className={`rounded-lg border px-4 py-3 ${item.status === 'trainer_mismatch' ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium dark:text-white truncate">{item.calendarTitle}</p>
                              {item.classType && (
                                <span className={`flex-shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 leading-none ${classTypeColors[item.classType] || classTypeColors.Physical}`}>{item.classType}</span>
                              )}
                              {item.localClassType && item.localClassType !== item.classType && (
                                <span className="flex-shrink-0 text-[10px] text-red-500 dark:text-red-400">
                                  (local: {item.localClassType})
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {item.courseCode && <span>Course: {item.courseCode}</span>}
                              {item.courseRunId && <span>CR: {item.courseRunId}</span>}
                              {item.ssgStartDate && <span>{item.ssgStartDate} → {item.ssgEndDate}</span>}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs">
                              {item.calendarTrainers?.length > 0 ? (
                                <span className="text-blue-600 dark:text-blue-400">
                                  Calendar: {item.calendarTrainers.map((t: any) => t.name).join(', ')}
                                </span>
                              ) : (
                                <span className="text-yellow-600 dark:text-yellow-400">No trainer in calendar</span>
                              )}
                              {item.localTrainer && (
                                <span className="text-gray-600 dark:text-gray-300">
                                  Local: {item.localTrainer.name}
                                </span>
                              )}
                            </div>
                            {item.alert && (
                              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{item.alert}</p>
                            )}
                          </div>
                          <span className={`flex-shrink-0 px-2 py-0.5 text-[11px] font-semibold rounded-full ${statusColors[item.status] || 'bg-gray-100 text-gray-600'}`}>
                            {statusLabels[item.status] || item.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Not in Calendar section — admin must explicitly tick each item to cancel.
                  Confirmed classes and those with enrollments are now filtered out server-side. */}
              {syncNotInCalendar && syncNotInCalendar.length > 0 && !syncCalendarLoading && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 border-t border-dashed border-red-300 dark:border-red-700" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400 dark:text-red-500">Not in Calendar — tick to cancel</span>
                    <div className="flex-1 border-t border-dashed border-red-300 dark:border-red-700" />
                  </div>
                  <div className="space-y-2">
                    {syncNotInCalendar.map((item: any, i: number) => {
                      const checked = confirmCancelUuids.has(item.courseRunUuid);
                      const blocked = (item.enrollmentCount ?? 0) > 0;
                      return (
                        <label key={i} className={`flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 px-4 py-3 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            disabled={blocked}
                            checked={checked}
                            onChange={(e) => {
                              setConfirmCancelUuids(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(item.courseRunUuid);
                                else next.delete(item.courseRunUuid);
                                return next;
                              });
                            }}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium dark:text-white truncate">{item.courseTitle}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                              <span>CR: {item.courseRunId}</span>
                              <span>Current status: {item.classStatus}</span>
                              {typeof item.enrollmentCount === 'number' && (
                                <span>Enrollments: {item.enrollmentCount}</span>
                              )}
                            </div>
                            {blocked && (
                              <p className="text-[11px] mt-1 text-amber-600 dark:text-amber-400">
                                Has enrollments — cannot auto-cancel. Cancel manually if needed.
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {syncCalendarResults && !syncCalendarLoading && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 gap-4 flex-wrap">
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {syncCalendarResults.filter((r: any) => r.status === 'new_cr' || r.status === 'trainer_mismatch').length} sync action(s)
                    {confirmCancelUuids.size > 0 && ` • ${confirmCancelUuids.size} to cancel`}
                  </p>
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={overrideMismatchedTrainers}
                      onChange={(e) => setOverrideMismatchedTrainers(e.target.checked)}
                    />
                    Override local trainer on mismatch (use with care — replaces manual assignments)
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSyncCalendarPreview}
                    className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={handleSyncCalendarApply}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-orange-600 text-white hover:bg-orange-700"
                  >
                    Apply Sync
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Sidebar — sticky on desktop so the month picker stays visible while scrolling.
            No max-height / overflow so no scrollbars appear; if content is taller than the
            viewport the bottom legend items simply require scrolling the page back up. */}
        <aside className="lg:w-60 flex-shrink-0 lg:sticky lg:top-32 lg:self-start">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <MonthPicker
              currentMonth={currentMonth}
              selectedDate={selectedDate}
              eventDates={eventDates}
              onPrev={handlePrevMonth}
              onNext={handleNextMonth}
              onSelectDate={handleSelectDate}
            />
          </div>
          <div className="mt-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-[11px] text-gray-600 dark:text-gray-300 space-y-2">
            <div>
              <div className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Class Status</div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" /> Confirmed</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" /> Pending trainer</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /> Cancelled</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" /> Unconfirmed</div>
              </div>
            </div>
            <div>
              <div className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Trainer State</div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> SSG &amp; Local match</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" /> SSG &amp; Local differ</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" /> Local only</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" /> SSG only</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /> None</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main pane */}
        <main className="flex-1 min-w-0">
          {loading && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6">Loading events…</div>
          )}
          {error && (
            <div className="mb-4 p-3 rounded border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 text-sm">
              {error}
            </div>
          )}
          {!loading && !error && grouped.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-6">
              No classes found for {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}.
            </div>
          )}

          <div className="space-y-6">
            {grouped.map(([dateIso, dayEvents]) => (
              <div
                key={dateIso}
                ref={(el) => {
                  if (el) dayRefs.current.set(dateIso, el);
                  else dayRefs.current.delete(dateIso);
                }}
                className="scroll-mt-32"
              >
                {/* Sticky day header — pins below the sticky page header (top: 64 + page header ~= 128px → top-32).
                    z-10 keeps it below the page header and site header dropdowns. */}
                <div className={`sticky top-32 z-10 flex items-baseline gap-3 px-3 py-2 mb-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur rounded-t ${
                  dateIso === selectedDate ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-100'
                }`}>
                  <div className="text-2xl font-bold tabular-nums">{Number(dateIso.slice(8, 10))}</div>
                  <div className="text-sm font-semibold tracking-wide">
                    {SHORT_MONTH_NAMES[Number(dateIso.slice(5, 7)) - 1]}, {SHORT_WEEKDAYS[(new Date(dateIso + 'T00:00:00').getDay() + 6) % 7]}
                  </div>
                  <div className="ml-auto text-xs font-normal text-gray-500 dark:text-gray-400">
                    {dayEvents.length} {dayEvents.length === 1 ? 'class' : 'classes'}
                  </div>
                </div>
                <div className="space-y-2">
                  {dayEvents.map((event) => {
                    const key = `${event.courseRunUuid}|${event.sessionDate}`;
                    return (
                      <EventRow
                        key={key}
                        event={event}
                        expanded={!!expanded[key]}
                        inviting={!!inviting[key]}
                        nextTrainerOverride={nextTrainerOverrides[event.courseRunUuid] || ''}
                        onToggle={() => toggleExpanded(key)}
                        onOpenEditor={() => handleOpenEditor(event)}
                        onChangeNextTrainer={(name) => handleSetNextTrainerOverride(event.courseRunUuid, name)}
                        onChangeClassStatus={(newStatus) => handleChangeClassStatus(event.courseRunUuid, newStatus)}
                        onChangeClassType={(newType) => handleChangeClassType(event.courseRunUuid, newType)}
                        onTogglePauseInvites={() => handleTogglePauseInvites(event.courseRunUuid)}
                        onToggleBlockReplies={() => handleToggleBlockReplies(event.courseRunUuid)}
                        onViewAttendance={() => handleViewAttendance()}
                        onViewEnrolment={() => handleViewEnrolment()}
                        onInviteNext={() => handleInviteNext(event)}
                      />
                    );
                  })}
                </div>
                {/* #64 / #80: Cancelled + Ongoing sections under "Not in Calendar" */}
                {(() => {
                  const cancelledForDay = cancelledByDate.get(dateIso) || [];
                  const ongoingForDay = ongoingEvents.filter((oe) => {
                    const start = oe.startDate?.slice(0, 10);
                    const end = oe.endDate?.slice(0, 10);
                    return start && end && dateIso >= start && dateIso <= end;
                  });
                  const noSessionsInCalendar = ongoingForDay.filter((oe) => oe.totalSessions === 0 && oe.inCalendar === true);
                  const noSessionsNotInCalendar = ongoingForDay.filter((oe) => oe.totalSessions === 0 && oe.inCalendar !== true);
                  const ongoingWithSessions = ongoingForDay.filter((oe) => oe.totalSessions > 0);
                  if (cancelledForDay.length === 0 && ongoingForDay.length === 0) return null;
                  return (
                    <div className="mt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-600" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Not in Calendar</span>
                      <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-600" />
                    </div>
                    {cancelledForDay.length > 0 && (
                      <details className="mb-2 border border-dashed border-red-300 dark:border-red-700 rounded-lg">
                        <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg select-none">
                          Cancelled
                          <span className="ml-1 text-red-400">({cancelledForDay.length})</span>
                        </summary>
                        <div className="space-y-2 px-3 pb-2">
                          {cancelledForDay.map((event) => {
                            const key = `${event.courseRunUuid}|${event.sessionDate}`;
                            return (
                              <EventRow
                                key={key}
                                event={event}
                                expanded={!!expanded[key]}
                                inviting={!!inviting[key]}
                                nextTrainerOverride={nextTrainerOverrides[event.courseRunUuid] || ''}
                                onToggle={() => toggleExpanded(key)}
                                onOpenEditor={() => handleOpenEditor(event)}
                                onChangeNextTrainer={(name) => handleSetNextTrainerOverride(event.courseRunUuid, name)}
                                onChangeClassStatus={(newStatus) => handleChangeClassStatus(event.courseRunUuid, newStatus)}
                                onChangeClassType={(newType) => handleChangeClassType(event.courseRunUuid, newType)}
                                onTogglePauseInvites={() => handleTogglePauseInvites(event.courseRunUuid)}
                                onToggleBlockReplies={() => handleToggleBlockReplies(event.courseRunUuid)}
                                onViewAttendance={() => handleViewAttendance()}
                                onViewEnrolment={() => handleViewEnrolment()}
                                onInviteNext={() => handleInviteNext(event)}
                              />
                            );
                          })}
                        </div>
                      </details>
                    )}
                    {noSessionsInCalendar.length > 0 && (
                    <details className="mb-2 border border-dashed border-orange-300 dark:border-orange-700 rounded-lg">
                      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg select-none">
                        In Calendar, no sessions imported
                        <span className="ml-1 text-orange-400">({noSessionsInCalendar.length})</span>
                      </summary>
                      <div className="px-3 pb-2 space-y-1">
                        {noSessionsInCalendar.map((oe: any) => {
                          const oeKey = `ongoing|${oe.courseRunUuid}|${dateIso}`;
                          const oeExpanded = !!expanded[oeKey];
                          return (
                            <div key={oe.courseRunUuid}>
                              <div
                                className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800/50 text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                                onClick={() => toggleExpanded(oeKey)}
                              >
                                {(() => {
                                  const oeStatus = (oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed')
                                    ? oe.classStatus
                                    : ((oe.localTrainerName || oe.tpgTrainerName || '').trim() ? 'Confirmed' : 'Pending');
                                  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(oeStatus)}`} title={statusDotTooltip(oeStatus)} />;
                                })()}
                                <span className="truncate flex-1 text-gray-600 dark:text-gray-300">
                                  {oe.courseTitle}
                                  <span className="ml-1 text-gray-400 font-mono">[{oe.courseRunId}]</span>
                                </span>
                                <span className="text-gray-400 flex-shrink-0">
                                  {oe.startDate?.slice(0, 10)} → {oe.endDate?.slice(0, 10)}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                                  {oe.localTrainerName || oe.tpgTrainerName || '—'}
                                </span>
                                {oe.totalSessions === 0 && (
                                  <span className="px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex-shrink-0 text-[10px]" title="No sessions imported — may need upsert from SSG">
                                    0 sessions
                                  </span>
                                )}
                                <span className="text-gray-400 flex-shrink-0 select-none text-[10px]">{oeExpanded ? '▴' : '▾'}</span>
                              </div>
                              {oeExpanded && (
                                <div className="ml-4 mt-1 mb-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                                  <div>
                                    <p className="text-gray-400 dark:text-gray-500 mb-1">Class Status</p>
                                    <select
                                      value={oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed' ? oe.classStatus : 'auto'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const newStatus = val === 'auto'
                                          ? ((oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending')
                                          : val;
                                        handleChangeClassStatus(oe.courseRunUuid, newStatus as any);
                                      }}
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                    >
                                      {(oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed') ? (
                                        <>
                                          <option value={oe.classStatus}>{oe.classStatus}</option>
                                          <option value="auto">{(oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}</option>
                                        </>
                                      ) : (
                                        <>
                                          <option value="auto">{(oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}</option>
                                          <option value="Cancelled">Cancelled</option>
                                          <option value="Unconfirmed">Unconfirmed</option>
                                        </>
                                      )}
                                    </select>
                                  </div>
                                  <div>
                                    <p className="text-gray-400 dark:text-gray-500 mb-1">Class Type</p>
                                    <select
                                      value={oe.classType || 'Physical'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => handleChangeClassType(oe.courseRunUuid, e.target.value as any)}
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                    >
                                      <option value="Physical">Physical</option>
                                      <option value="Virtual">Virtual</option>
                                      <option value="Hybrid">Hybrid</option>
                                      <option value="External">External</option>
                                    </select>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Start Date</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.startDate?.slice(0, 10) || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">End Date</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.endDate?.slice(0, 10) || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">TPG Trainer</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.tpgTrainerName || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Local Trainer</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.localTrainerName || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Learners</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.numLearners}</p>
                                  </div>
                                  <div className="col-span-2 md:col-span-4">
                                    <span className="text-gray-400 dark:text-gray-500">Sessions ({oe.totalSessions})</span>
                                    {oe.sessionDates && oe.sessionDates.length > 0 ? (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {oe.sessionDates.map((d: string) => (
                                          <span
                                            key={d}
                                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                                              d === dateIso
                                                ? 'font-semibold bg-blue-600 text-white'
                                                : 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800'
                                            }`}
                                          >{d}</span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="font-semibold text-red-600 dark:text-red-400">No sessions imported</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                    )}
                    {noSessionsNotInCalendar.length > 0 && (
                    <details className="mb-2 border border-dashed border-red-300 dark:border-red-700 rounded-lg">
                      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg select-none">
                        Not in Calendar, no sessions
                        <span className="ml-1 text-red-400">({noSessionsNotInCalendar.length})</span>
                      </summary>
                      <div className="px-3 pb-2 space-y-1">
                        {noSessionsNotInCalendar.map((oe: any) => {
                          const oeKey = `ongoing-nic|${oe.courseRunUuid}|${dateIso}`;
                          const oeExpanded = !!expanded[oeKey];
                          return (
                            <div key={oe.courseRunUuid}>
                              <div
                                className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800/50 text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                                onClick={() => toggleExpanded(oeKey)}
                              >
                                {(() => {
                                  const oeStatus = (oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed')
                                    ? oe.classStatus
                                    : ((oe.localTrainerName || oe.tpgTrainerName || '').trim() ? 'Confirmed' : 'Pending');
                                  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(oeStatus)}`} title={statusDotTooltip(oeStatus)} />;
                                })()}
                                <span className="truncate flex-1 text-gray-600 dark:text-gray-300">
                                  {oe.courseTitle}
                                  <span className="ml-1 text-gray-400 font-mono">[{oe.courseRunId}]</span>
                                </span>
                                <span className="text-gray-400 flex-shrink-0">
                                  {oe.startDate?.slice(0, 10)} → {oe.endDate?.slice(0, 10)}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                                  {oe.localTrainerName || oe.tpgTrainerName || '—'}
                                </span>
                                <span className="px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex-shrink-0 text-[10px]">
                                  0 sessions
                                </span>
                                <span className="text-gray-400 flex-shrink-0 select-none text-[10px]">{oeExpanded ? '▴' : '▾'}</span>
                              </div>
                              {oeExpanded && (
                                <div className="ml-4 mt-1 mb-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                                  <div>
                                    <p className="text-gray-400 dark:text-gray-500 mb-1">Class Status</p>
                                    <select
                                      value={oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed' ? oe.classStatus : 'auto'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const newStatus = val === 'auto'
                                          ? ((oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending')
                                          : val;
                                        handleChangeClassStatus(oe.courseRunUuid, newStatus as any);
                                      }}
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                    >
                                      {(oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed') ? (
                                        <>
                                          <option value={oe.classStatus}>{oe.classStatus}</option>
                                          <option value="auto">{(oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}</option>
                                        </>
                                      ) : (
                                        <>
                                          <option value="auto">{(oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}</option>
                                          <option value="Cancelled">Cancelled</option>
                                          <option value="Unconfirmed">Unconfirmed</option>
                                        </>
                                      )}
                                    </select>
                                  </div>
                                  <div>
                                    <p className="text-gray-400 dark:text-gray-500 mb-1">Class Type</p>
                                    <select
                                      value={oe.classType || 'Physical'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => handleChangeClassType(oe.courseRunUuid, e.target.value as any)}
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                    >
                                      <option value="Physical">Physical</option>
                                      <option value="Virtual">Virtual</option>
                                      <option value="Hybrid">Hybrid</option>
                                      <option value="External">External</option>
                                    </select>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Start Date</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.startDate?.slice(0, 10) || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">End Date</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.endDate?.slice(0, 10) || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">TPG Trainer</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.tpgTrainerName || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Local Trainer</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.localTrainerName || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Learners</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.numLearners}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                    )}
                    {ongoingWithSessions.length > 0 && (
                    <details className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg select-none">
                        Ongoing course runs, no session today
                        <span className="ml-1 text-gray-400">({ongoingWithSessions.length})</span>
                      </summary>
                      <div className="px-3 pb-2 space-y-1">
                        {ongoingWithSessions.map((oe: any) => {
                          const oeKey = `ongoing-ws|${oe.courseRunUuid}|${dateIso}`;
                          const oeExpanded = !!expanded[oeKey];
                          return (
                            <div key={oe.courseRunUuid}>
                              <div
                                className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800/50 text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50"
                                onClick={() => toggleExpanded(oeKey)}
                              >
                                {(() => {
                                  const oeStatus = (oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed')
                                    ? oe.classStatus
                                    : ((oe.localTrainerName || oe.tpgTrainerName || '').trim() ? 'Confirmed' : 'Pending');
                                  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(oeStatus)}`} title={statusDotTooltip(oeStatus)} />;
                                })()}
                                <span className="truncate flex-1 text-gray-600 dark:text-gray-300">
                                  {oe.courseTitle}
                                  <span className="ml-1 text-gray-400 font-mono">[{oe.courseRunId}]</span>
                                </span>
                                <span className="text-gray-400 flex-shrink-0">
                                  {oe.startDate?.slice(0, 10)} → {oe.endDate?.slice(0, 10)}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                                  {oe.localTrainerName || oe.tpgTrainerName || '—'}
                                </span>
                                <span className="text-gray-400 flex-shrink-0 select-none text-[10px]">{oeExpanded ? '▴' : '▾'}</span>
                              </div>
                              {oeExpanded && (
                                <div className="ml-4 mt-1 mb-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                                  <div>
                                    <p className="text-gray-400 dark:text-gray-500 mb-1">Class Status</p>
                                    <select
                                      value={oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed' ? oe.classStatus : 'auto'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const newStatus = val === 'auto'
                                          ? ((oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending')
                                          : val;
                                        handleChangeClassStatus(oe.courseRunUuid, newStatus as any);
                                      }}
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                    >
                                      {(oe.classStatus === 'Cancelled' || oe.classStatus === 'Unconfirmed') ? (
                                        <>
                                          <option value={oe.classStatus}>{oe.classStatus}</option>
                                          <option value="auto">{(oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}</option>
                                        </>
                                      ) : (
                                        <>
                                          <option value="auto">{(oe.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}</option>
                                          <option value="Cancelled">Cancelled</option>
                                          <option value="Unconfirmed">Unconfirmed</option>
                                        </>
                                      )}
                                    </select>
                                  </div>
                                  <div>
                                    <p className="text-gray-400 dark:text-gray-500 mb-1">Class Type</p>
                                    <select
                                      value={oe.classType || 'Physical'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => handleChangeClassType(oe.courseRunUuid, e.target.value as any)}
                                      className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                    >
                                      <option value="Physical">Physical</option>
                                      <option value="Virtual">Virtual</option>
                                      <option value="Hybrid">Hybrid</option>
                                      <option value="External">External</option>
                                    </select>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Start Date</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.startDate?.slice(0, 10) || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">End Date</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.endDate?.slice(0, 10) || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">TPG Trainer</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.tpgTrainerName || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Local Trainer</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.localTrainerName || '—'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 dark:text-gray-500">Learners</span>
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">{oe.numLearners}</p>
                                  </div>
                                  <div className="col-span-2 md:col-span-4">
                                    <span className="text-gray-400 dark:text-gray-500">Sessions ({oe.totalSessions})</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {oe.sessionDates.map((d: string) => (
                                        <span
                                          key={d}
                                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                                            d === dateIso
                                              ? 'font-semibold bg-blue-600 text-white'
                                              : 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800'
                                          }`}
                                        >{d}</span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                    )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-2 rounded bg-gray-900 text-white text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
};

export default ViewClassByDateView;
