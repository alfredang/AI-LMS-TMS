import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { getApiUrl } from '@lib/urlHelpers';
import UpsertFromSsgModal from './UpsertFromSsgModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  courseRunUuid: string;
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: 'Pending' | 'Confirmed' | 'Cancelled' | string;
  classType: 'Physical' | 'Virtual' | 'Hybrid' | string;
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
    case 'Confirmed': return 'bg-emerald-500';
    case 'Pending':   return 'bg-yellow-400';
    case 'Cancelled': return 'bg-red-500';
    default:          return 'bg-gray-400';
  }
};

const statusDotTooltip = (status: string): string => {
  switch (status) {
    case 'Confirmed': return 'Class confirmed — trainer accepted (in local)';
    case 'Pending':   return 'Pending trainer — waiting for trainers to accept OR have not sent trainer invitation';
    case 'Cancelled': return 'Class cancelled — no enrolment OR no trainer found';
    default:          return 'Unknown status';
  }
};

const statusPillClass = (status: string): string => {
  switch (status) {
    case 'Confirmed': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'Pending':   return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    case 'Cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    default:          return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
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
  onChangeClassStatus: (newStatus: 'Confirmed' | 'Pending' | 'Cancelled') => void;
  onChangeClassType: (newType: 'Physical' | 'Virtual' | 'Hybrid') => void;
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
  event, expanded, inviting, nextTrainerOverride, onToggle, onOpenEditor, onInviteNext, onChangeNextTrainer, onChangeClassStatus, onChangeClassType, onViewAttendance, onViewEnrolment
}) => {
  // Admin can override the server-computed next trainer via the dropdown.
  // Fall back to server-computed when no override set yet.
  const effectiveNextTrainer = nextTrainerOverride || event.nextAvailableTrainer;
  // Derive display status the same way as the dropdown label so dot color and
  // pill color stay in sync with the displayed text.
  const derivedStatus: string = event.classStatus === 'Cancelled'
    ? 'Cancelled'
    : ((event.localTrainerName || '').trim() ? 'Confirmed' : 'Pending');
  const canInvite = !!effectiveNextTrainer && derivedStatus !== 'Cancelled';
  const sessionLabel = formatSessionNumbers(event.sessionNumbers);
  const matchState = trainersMatchState(event);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
      {/* Collapsed row — TWO distinct click targets:
          1. The course title (blue hover) → opens CourseEditor
          2. The rest of the row (gray hover) → toggles expand
          Click on the title uses stopPropagation so it doesn't bubble up to the row's expand handler. */}
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (e.ctrlKey || e.metaKey) {
                window.open(`/?adminPage=editClass&courseRunId=${event.courseRunId}`, '_blank');
                return;
              }
              onOpenEditor();
            }}
            className="text-left text-sm text-gray-900 dark:text-gray-100 truncate rounded px-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300 transition-colors max-w-full"
            title="Open in Editor (Ctrl+click for new tab)"
          >
            Day {event.dayNumber} - {event.courseTitle} [{event.courseRunId}]
          </button>
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
                  value={derivedStatus === 'Cancelled' ? 'Cancelled' : 'auto'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    // Two-option dropdown: "Pending/Confirmed" (auto-derived from local trainer)
                    // or "Cancelled" (manual sticky override). Parent handles the PUT.
                    const selection = e.target.value;
                    const hasLocalTrainer = !!(event.localTrainerName || '').trim();
                    const newStatus: 'Confirmed' | 'Pending' | 'Cancelled' = selection === 'Cancelled'
                      ? 'Cancelled'
                      : (hasLocalTrainer ? 'Confirmed' : 'Pending');
                    onChangeClassStatus(newStatus);
                  }}
                  className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 ${statusPillClass(derivedStatus)}`}
                >
                  {/* Force option colors explicitly — pill background/text on the
                      <select> bleeds into <option> native styling and makes the
                      dropdown menu text blend into the OS dropdown background. */}
                  <option value="auto" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">
                    {(event.localTrainerName || '').trim() ? 'Confirmed' : 'Pending'}
                  </option>
                  <option value="Cancelled" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">
                    Cancelled
                  </option>
                </select>
              }
            />
            <DetailCell
              label="Class Type"
              value={
                <select
                  value={event.classType || 'Physical'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChangeClassType(e.target.value as 'Physical' | 'Virtual' | 'Hybrid')}
                  className="text-[11px] font-semibold rounded-full px-2 py-0.5 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                >
                  <option value="Physical" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Physical</option>
                  <option value="Virtual" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Virtual</option>
                  <option value="Hybrid" className="bg-white text-gray-900 dark:bg-gray-800 dark:text-white">Hybrid</option>
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
            {/* Invite button pushed to the right with ml-auto so it mirrors the
                top-row TPG/Local column alignment. */}
            <button
              onClick={onInviteNext}
              disabled={!canInvite || inviting}
              className="ml-auto px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
              title={
                !effectiveNextTrainer ? 'No trainer selected' :
                event.classStatus === 'Cancelled' ? 'Class is cancelled' : ''
              }
            >
              {inviting ? 'Sending…' : `Invite${effectiveNextTrainer ? ` ${effectiveNextTrainer}` : ' Next Trainer'}`}
            </button>
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
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const arr = map.get(ev.sessionDate) || [];
      arr.push(ev);
      map.set(ev.sessionDate, arr);
    }
    // Sort each day's events by start time
    map.forEach((arr) => {
      arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
    });
    const allEntries = Array.from(map.entries())
      .sort((a: [string, CalendarEvent[]], b: [string, CalendarEvent[]]) => a[0].localeCompare(b[0]));

    // Filter only when selectedDate falls within the currently-viewed month
    const selected = new Date(selectedDate + 'T00:00:00');
    const sameMonth = selected.getFullYear() === currentMonth.getFullYear() &&
                      selected.getMonth() === currentMonth.getMonth();
    if (sameMonth) {
      return allEntries.filter(([date]) => date >= selectedDate);
    }
    return allEntries;
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

  const handleOpenEditor = useCallback((event: CalendarEvent) => {
    // Mirror the shape used by UpcomingClassesTable/ClassDetailView — setEditingCourseRun accepts any
    setEditingCourseRun({
      id: event.courseRunUuid,
      courseRunId: event.courseRunId,
      courseTitle: event.courseTitle,
      courseCode: event.courseCode,
      startDate: event.sessionDate,
      endDate: event.sessionDate,
      trainersList: event.approvedTrainers.join(', '),
      trainerInvitations: event.trainerInvitations || {},
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

  const handleChangeClassStatus = useCallback(async (courseRunUuid: string, newStatus: 'Confirmed' | 'Pending' | 'Cancelled') => {
    // Optimistic update — flip the row immediately, then PUT to the generic
    // /api/admin/upcoming-classes endpoint which accepts any course_run UUID.
    setEvents((prev) => prev.map((e) =>
      e.courseRunUuid === courseRunUuid ? { ...e, classStatus: newStatus } : e
    ));
    try {
      await fetch(getApiUrl('/api/admin/upcoming-classes'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseRunUuid, class_status: newStatus }),
      });
    } catch (err) {
      console.error('[ViewClassByDateView] Failed to update class status:', err);
      setToast('Failed to update class status');
      setTimeout(() => setToast(null), 3500);
    }
  }, []);

  const handleChangeClassType = useCallback(async (courseRunUuid: string, newType: 'Physical' | 'Virtual' | 'Hybrid') => {
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
                        onViewAttendance={() => handleViewAttendance()}
                        onViewEnrolment={() => handleViewEnrolment()}
                        onInviteNext={() => handleInviteNext(event)}
                      />
                    );
                  })}
                </div>
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
