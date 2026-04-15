import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

// ─── Types ────────────────────────────────────────────────────────────────────

type ClassTab = 'virtual' | 'evening' | 'external' | 'woodsSquare' | 'reschedule' | 'cancelled' | 'bukitTimah';

const TABS: { key: ClassTab; label: string }[] = [
  { key: 'virtual',    label: 'Virtual Class' },
  { key: 'evening',    label: 'Evening Class' },
  { key: 'external',   label: 'External Class' },
  { key: 'woodsSquare',label: 'Woods Square' },
  { key: 'bukitTimah', label: 'Bukit Timah Training Centre' },
  { key: 'reschedule', label: 'Reschedule Class' },
  { key: 'cancelled',  label: 'Cancelled Class' },
];

// Colour palette per class type
// active tab bg | active tab text | tab badge bg | tab badge text | header left-border | header badge bg | header badge text
const TAB_COLORS: Record<ClassTab, {
  activeBg: string; activeText: string;
  badgeBg: string; badgeText: string;
  borderAccent: string;
  headerBadgeBg: string; headerBadgeText: string;
  headerBg: string; headerText: string;
}> = {
  virtual:    { activeBg: 'bg-teal-500',    activeText: 'text-white',      badgeBg: 'bg-teal-100 dark:bg-teal-900/40',      badgeText: 'text-teal-700 dark:text-teal-300',        borderAccent: 'border-l-teal-500',    headerBadgeBg: 'bg-teal-200/60',      headerBadgeText: 'text-teal-800',    headerBg: 'bg-teal-700',       headerText: 'text-teal-50' },
  evening:    { activeBg: 'bg-slate-500',    activeText: 'text-white',      badgeBg: 'bg-slate-100 dark:bg-slate-800',        badgeText: 'text-slate-600 dark:text-slate-300',      borderAccent: 'border-l-slate-400',   headerBadgeBg: 'bg-slate-300/60',     headerBadgeText: 'text-slate-800',   headerBg: 'bg-slate-600',      headerText: 'text-slate-50' },
  external:   { activeBg: 'bg-orange-500',   activeText: 'text-white',      badgeBg: 'bg-orange-100 dark:bg-orange-900/40',  badgeText: 'text-orange-700 dark:text-orange-300',    borderAccent: 'border-l-orange-500',  headerBadgeBg: 'bg-orange-200/60',    headerBadgeText: 'text-orange-900',  headerBg: 'bg-orange-600',     headerText: 'text-orange-50' },
  woodsSquare:{ activeBg: 'bg-blue-500',     activeText: 'text-white',      badgeBg: 'bg-blue-100 dark:bg-blue-900/40',      badgeText: 'text-blue-700 dark:text-blue-300',        borderAccent: 'border-l-blue-500',    headerBadgeBg: 'bg-blue-200/60',      headerBadgeText: 'text-blue-900',    headerBg: 'bg-blue-700',       headerText: 'text-blue-50' },
  bukitTimah: { activeBg: 'bg-green-600',    activeText: 'text-white',      badgeBg: 'bg-green-100 dark:bg-green-900/40',    badgeText: 'text-green-700 dark:text-green-300',      borderAccent: 'border-l-green-600',   headerBadgeBg: 'bg-green-200/60',     headerBadgeText: 'text-green-900',   headerBg: 'bg-green-700',      headerText: 'text-green-50' },
  reschedule: { activeBg: 'bg-yellow-400',   activeText: 'text-yellow-900', badgeBg: 'bg-yellow-100 dark:bg-yellow-900/40',  badgeText: 'text-yellow-700 dark:text-yellow-300',    borderAccent: 'border-l-yellow-400',  headerBadgeBg: 'bg-yellow-200/60',    headerBadgeText: 'text-yellow-900',  headerBg: 'bg-yellow-500',     headerText: 'text-yellow-950' },
  cancelled:  { activeBg: 'bg-neutral-800',  activeText: 'text-white',      badgeBg: 'bg-neutral-200 dark:bg-neutral-700',   badgeText: 'text-neutral-700 dark:text-neutral-200',  borderAccent: 'border-l-neutral-800', headerBadgeBg: 'bg-neutral-400/40',   headerBadgeText: 'text-neutral-100', headerBg: 'bg-neutral-800',    headerText: 'text-neutral-100' },
};

interface TraineeRow {
  id: string;
  name: string;
  contact_no: string;
  email: string;
  magento_order_no: string;
  virtual_reschedule: string;
  comments: string;
  date: string;
  grant: string;
  invoice_no: string;
  payment_mode: string;
  course_fee: string;
  nett_fee: string;
  payment_status: string;
  followup_by: string;
  remark: string;
}

interface ScheduleEntry {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  done: boolean;
}

interface ClassRun {
  id: string;
  courseTitle: string;
  courseRunNo: string;
  trainer: string;
  trainerEmail: string;
  qrAttendance: string;
  zoomId: string;
  meetingId: string;
  startDate: string;
  endDate: string;
  venue: string;
  scheduleEntries: ScheduleEntry[];
  trainees: TraineeRow[];
  headerColor: { bg: string; text: string };
}

type TraineeField = keyof TraineeRow;
type ClassField = keyof Omit<ClassRun, 'id' | 'trainees' | 'scheduleEntries'>;

// ─── Header colour palette (random per class block) ──────────────────────────

const HEADER_PALETTE: { bg: string; text: string }[] = [
  { bg: 'bg-indigo-700',  text: 'text-indigo-50' },
  { bg: 'bg-violet-700',  text: 'text-violet-50' },
  { bg: 'bg-rose-700',    text: 'text-rose-50' },
  { bg: 'bg-sky-700',     text: 'text-sky-50' },
  { bg: 'bg-emerald-700', text: 'text-emerald-50' },
  { bg: 'bg-amber-600',   text: 'text-amber-50' },
  { bg: 'bg-pink-700',    text: 'text-pink-50' },
  { bg: 'bg-cyan-700',    text: 'text-cyan-50' },
  { bg: 'bg-lime-700',    text: 'text-lime-50' },
  { bg: 'bg-fuchsia-700', text: 'text-fuchsia-50' },
];

// Derive a stable color from the class id so it never changes on re-fetch
const headerColorFromId = (id: string) => {
  const hash = id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return HEADER_PALETTE[hash % HEADER_PALETTE.length];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const newTrainee = (): TraineeRow => ({
  id: crypto.randomUUID(),
  name: '', contact_no: '', email: '', magento_order_no: '',
  virtual_reschedule: '', comments: '', date: '', grant: '',
  invoice_no: '', payment_mode: '', course_fee: '', nett_fee: '',
  payment_status: '', followup_by: '', remark: '',
});


const newScheduleEntry = (): ScheduleEntry => ({
  id: crypto.randomUUID(), label: '', startTime: '', endTime: '', done: false,
});

const newClass = (): ClassRun => {
  const id = crypto.randomUUID();
  return {
    id,
    courseTitle: '', courseRunNo: '', trainer: '', trainerEmail: '',
    qrAttendance: '', zoomId: '', meetingId: '',
    startDate: '', endDate: '', venue: '',
    scheduleEntries: [],
    trainees: [newTrainee()],
    headerColor: headerColorFromId(id),
  };
};

const formatDisplayDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
};

// ─── Confirm dialog ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  message: string;
  details?: { label: string; value: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ message, details, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-surface border border-default rounded-xl shadow-xl p-6 w-96 flex flex-col gap-4">
      <p className="text-sm text-on-surface text-center">{message}</p>
      {details && details.length > 0 && (
        <div className="bg-surface-elevated rounded-lg px-4 py-3 flex flex-col gap-1.5">
          {details.map(d => d.value ? (
            <div key={d.label} className="flex items-start gap-2 text-xs">
              <span className="text-on-surface-secondary shrink-0 w-24">{d.label}</span>
              <span className="text-on-surface font-medium">{d.value}</span>
            </div>
          ) : null)}
        </div>
      )}
      <div className="flex gap-3 justify-center">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
);

// ─── Inline text input cell ───────────────────────────────────────────────────

interface InputCellProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  align?: 'left' | 'center';
  digitsOnly?: boolean;
  onFillAll?: (v: string) => void;
}

const InputCell: React.FC<InputCellProps> = ({ value, onChange, placeholder = '', align = 'left', digitsOnly = false, onFillAll }) => (
  <td className={`relative px-1.5 py-1 border-r border-default last:border-r-0 group/cell ${align === 'center' ? 'text-center' : ''}`}>
    <input
      value={value}
      onChange={e => onChange(digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value)}
      placeholder={placeholder}
      inputMode={digitsOnly ? 'numeric' : 'text'}
      className={`w-full px-2 py-1 text-xs bg-transparent rounded focus:outline-none focus:bg-primary/5 focus:ring-1 focus:ring-primary/30 placeholder:text-on-surface-secondary/30 ${align === 'center' ? 'text-center' : ''}`}
    />
    {onFillAll && value && (
      <button
        onMouseDown={e => { e.preventDefault(); onFillAll(value); }}
        title="Apply to all rows"
        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 transition-opacity bg-primary/10 hover:bg-primary/20 text-primary rounded px-1 py-0.5 text-[9px] font-medium leading-none whitespace-nowrap"
      >
        fill all ↓
      </button>
    )}
  </td>
);

// ─── Learner lookup cell (auto-fill name / email / contact_no) ───────────────

interface LearnerSuggestion { id: string; name: string; email: string; contact_no: string; invoice_no?: string }

interface LookupCellProps {
  value: string;
  onChange: (v: string) => void;
  onAutofill: (s: LearnerSuggestion) => void;
  placeholder?: string;
}

const LookupCell: React.FC<LookupCellProps> = ({ value, onChange, onAutofill, placeholder = '' }) => {
  const [suggestions, setSuggestions] = useState<LearnerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLTableCellElement>(null);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!q || q.length < 2) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/learners/search?query=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && json.data.length > 0) {
          setSuggestions(json.data);
          setOpen(true);
        } else {
          setSuggestions([]); setOpen(false);
        }
      } catch { setSuggestions([]); setOpen(false); }
    }, 300);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <td ref={wrapRef} className="relative px-1.5 py-1 border-r border-default last:border-r-0">
      <input
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); search(e.target.value); }}
        onPaste={e => {
          const el = e.currentTarget;
          setTimeout(() => { if (el.value) search(el.value); }, 0);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        className="w-full px-2 py-1 text-xs bg-transparent rounded focus:outline-none focus:bg-primary/5 focus:ring-1 focus:ring-primary/30 placeholder:text-on-surface-secondary/30"
      />
      {open && suggestions.length > 0 && createPortal(
        <div
          style={{
            position: 'fixed',
            top: wrapRef.current ? wrapRef.current.getBoundingClientRect().bottom + 2 : 0,
            left: wrapRef.current ? wrapRef.current.getBoundingClientRect().left : 0,
            zIndex: 9999,
            minWidth: wrapRef.current ? wrapRef.current.offsetWidth : 200,
          }}
          className="bg-surface border border-default rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto"
        >
          {suggestions.map(s => (
            <button
              key={s.id}
              onMouseDown={e => { e.preventDefault(); onAutofill(s); setOpen(false); setSuggestions([]); }}
              className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors border-b border-default last:border-b-0"
            >
              <p className="text-xs font-medium text-on-surface">{s.name}</p>
              <p className="text-[10px] text-on-surface-secondary">{s.email}{s.contact_no ? ` · ${s.contact_no}` : ''}{s.invoice_no ? ` · ${s.invoice_no}` : ''}</p>
            </button>
          ))}
        </div>,
        document.body
      )}
    </td>
  );
};

// ─── Select cell ─────────────────────────────────────────────────────────────

const SelectCell: React.FC<{ value: string; onChange: (v: string) => void; options: string[] }> = ({ value, onChange, options }) => (
  <td className="px-1.5 py-1 border-r border-default last:border-r-0 text-center">
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-1 py-1 text-xs bg-surface rounded focus:outline-none focus:ring-1 focus:ring-primary/30 text-on-surface cursor-pointer [&>option]:bg-surface [&>option]:text-on-surface"
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </td>
);

// ─── Date range cell (flight-booking style) ──────────────────────────────────
// value stored as "YYYY-MM-DD" (single) or "YYYY-MM-DD~YYYY-MM-DD" (range)

const CAL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAL_DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const fmtDisplay = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const DateRangeCell: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const isRange   = value.includes('~');
  const [rawStart, rawEnd] = isRange ? value.split('~') : [value, ''];

  const [open, setOpen]         = useState(false);
  const [phase, setPhase]       = useState<'start' | 'end'>('start');
  const [tempStart, setTempStart] = useState('');
  const [tempEnd,   setTempEnd]   = useState('');
  const [hover,     setHover]     = useState('');
  const [viewYear,  setViewYear]  = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [pos,       setPos]       = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef   = useRef<HTMLDivElement>(null);

  // open calendar
  const openCalendar = () => {
    setTempStart(rawStart);
    setTempEnd(rawEnd);
    setPhase('start');
    setHover('');
    const base = rawStart ? new Date(rawStart) : new Date();
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const popupWidth = 288; // w-72
      const left = r.right + popupWidth > window.innerWidth
        ? Math.max(4, r.right - popupWidth)
        : r.left;
      setPos({ top: r.bottom + 6, left });
    }
    setOpen(true);
  };

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current   && !popupRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleDayClick = (dateStr: string) => {
    if (phase === 'start') {
      setTempStart(dateStr);
      setTempEnd('');
      setPhase('end');
    } else {
      if (dateStr < tempStart) {
        // clicked before start — restart
        setTempStart(dateStr);
        setTempEnd('');
      } else if (dateStr === tempStart) {
        // same day → single date
        onChange(dateStr);
        setOpen(false);
      } else {
        onChange(`${tempStart}~${dateStr}`);
        setOpen(false);
      }
    }
  };

  // calendar grid
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekDay = new Date(viewYear, viewMonth, 1).getDay();
  const cells: (number | null)[] = [
    ...Array(firstWeekDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const toIso = (d: number) =>
    `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const effectiveEnd = phase === 'end' && hover > tempStart ? hover : tempEnd;

  const prevMonth = () => viewMonth === 0  ? (setViewMonth(11), setViewYear(y => y - 1)) : setViewMonth(m => m - 1);
  const nextMonth = () => viewMonth === 11 ? (setViewMonth(0),  setViewYear(y => y + 1)) : setViewMonth(m => m + 1);

  const displayLabel = rawStart
    ? (rawEnd ? `${fmtDisplay(rawStart)} – ${fmtDisplay(rawEnd)}` : fmtDisplay(rawStart))
    : 'Select Date';

  return (
    <td className="px-1.5 py-1 border-r border-default last:border-r-0">
      <button
        ref={triggerRef}
        onClick={openCalendar}
        className={`text-xs px-2 py-1 rounded hover:bg-primary/10 transition-colors text-left whitespace-nowrap ${rawStart ? 'text-on-surface' : 'text-on-surface-secondary/30'}`}
      >
        {displayLabel}
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 rounded-xl shadow-2xl p-4 w-72 select-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600"
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-lg font-bold leading-none">‹</button>
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{CAL_MONTHS[viewMonth]} {viewYear}</span>
            <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-lg font-bold leading-none">›</button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {CAL_DAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 dark:text-gray-500 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const iso   = toIso(day);
              const isS   = iso === tempStart;
              const isE   = iso === effectiveEnd;
              const inRng = !!tempStart && !!effectiveEnd && iso > tempStart && iso < effectiveEnd;
              return (
                <button
                  key={i}
                  onClick={() => handleDayClick(iso)}
                  onMouseEnter={() => phase === 'end' && setHover(iso)}
                  onMouseLeave={() => setHover('')}
                  className={[
                    'h-8 text-xs font-medium flex items-center justify-center transition-colors',
                    isS || isE
                      ? 'bg-primary text-white font-bold rounded-full'
                      : inRng
                      ? 'bg-primary/15 text-primary rounded-none'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full',
                  ].join(' ')}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Hint */}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-3 italic">
            {phase === 'start' ? 'Select start date' : 'Select end date — or same date for single day'}
          </p>

          {/* Clear */}
          {(rawStart) && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="mt-2 w-full text-[11px] text-gray-400 hover:text-red-400 transition-colors text-center"
            >
              Clear
            </button>
          )}
        </div>,
        document.body,
      )}
    </td>
  );
};

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: { key: TraineeField | '_no' | '_actions'; label: string; minW: string; placeholder?: string; align?: 'center'; digitsOnly?: boolean }[] = [
  { key: '_no',               label: 'No.',                       minW: 'min-w-[2.5rem]',  align: 'center' },
  { key: 'name',              label: 'Name',                      minW: 'min-w-[10rem]',   placeholder: 'Full Name' },
  { key: 'contact_no',        label: 'Contact No.',               minW: 'min-w-[8rem]',    placeholder: '9XXXXXXX', digitsOnly: true },
  { key: 'email',             label: 'Email',                     minW: 'min-w-[12rem]',   placeholder: 'email@example.com' },
  { key: 'magento_order_no',  label: 'Magento Order #',           minW: 'min-w-[9rem]',    placeholder: 'Order #' },
  { key: 'virtual_reschedule',label: 'Virtual / Reschedule',      minW: 'min-w-[9rem]',    placeholder: 'Virtual' },
  { key: 'comments',          label: 'Comments',                  minW: 'min-w-[10rem]',   placeholder: 'Comments' },
  { key: 'date',              label: 'Date',                      minW: 'min-w-[8rem]',    placeholder: 'DD/MM/YYYY' },
  { key: 'grant',             label: 'Grant (Yes/No)',                     minW: 'min-w-[6rem]',    placeholder: '', align: 'center' },
  { key: 'invoice_no',        label: 'Invoice No. / E-Invoice #', minW: 'min-w-[10rem]',   placeholder: 'TCXX-XXXX-XXXXXX' },
  { key: 'payment_mode',      label: 'Payment Mode',              minW: 'min-w-[8rem]',    placeholder: 'e.g. PayNow' },
  { key: 'course_fee',        label: 'Course Fee (excl. GST)',    minW: 'min-w-[9rem]',    placeholder: '$0.00' },
  { key: 'nett_fee',          label: 'Nett Fee',                  minW: 'min-w-[7rem]',    placeholder: '$0.00' },
  { key: 'payment_status',    label: 'Payment Status',            minW: 'min-w-[8rem]',    placeholder: 'Paid / Pending' },
  { key: 'followup_by',       label: 'Followup By',               minW: 'min-w-[8rem]',    placeholder: 'Name' },
  { key: 'remark',            label: 'Remark',                    minW: 'min-w-[10rem]',   placeholder: 'Remarks' },
  { key: '_actions',          label: '',                          minW: 'min-w-[2.5rem]',  align: 'center' },
];

// ─── Single class block ───────────────────────────────────────────────────────

interface ClassBlockProps {
  classRun: ClassRun;
  activeTab: ClassTab;
  selectedDate: string;
  saving?: boolean;
  onClassChange: (field: ClassField, value: string) => void;
  onTraineeChange: (traineeId: string, field: TraineeField, value: string) => void;
  onFillAll: (field: TraineeField, value: string) => void;
  onAddTrainee: () => void;
  onRemoveTrainee: (traineeId: string) => void;
  onRemoveClass: () => void;
  onMoveClass: (targetTab: ClassTab) => void;
  onAddScheduleEntry: () => void;
  onScheduleEntryChange: (entryId: string, field: keyof Omit<ScheduleEntry, 'id'>, value: string | boolean) => void;
  onRemoveScheduleEntry: (entryId: string) => void;
}

const ClassBlock: React.FC<ClassBlockProps> = ({
  classRun, activeTab, selectedDate, saving,
  onClassChange, onTraineeChange, onFillAll,
  onAddTrainee, onRemoveTrainee, onRemoveClass, onMoveClass,
  onAddScheduleEntry, onScheduleEntryChange, onRemoveScheduleEntry,
}) => {
  const tabLabel = TABS.find(t => t.key === activeTab)?.label ?? '';
  const tabColors = TAB_COLORS[activeTab];
  const [confirmDeleteClass, setConfirmDeleteClass] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const [confirmDeleteRow, setConfirmDeleteRow] = useState<string | null>(null);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<string | null>(null);

  return (
    <div className="mb-8 overflow-x-clip">
      {confirmDeleteClass && (
        <ConfirmDialog
          message="Delete this entire class and all its trainee rows?"
          details={[
            { label: 'Course Title', value: classRun.courseTitle },
            { label: 'Course Run No.', value: classRun.courseRunNo },
          ]}
          onConfirm={() => { setConfirmDeleteClass(false); onRemoveClass(); }}
          onCancel={() => setConfirmDeleteClass(false)}
        />
      )}
      {confirmDeleteRow && (() => {
        const trainee = classRun.trainees.find(t => t.id === confirmDeleteRow);
        return (
          <ConfirmDialog
            message="Remove this trainee row?"
            details={[
              { label: 'Name', value: trainee?.name ?? '' },
              { label: 'Email', value: trainee?.email ?? '' },
              { label: 'Contact No.', value: trainee?.contact_no ?? '' },
            ]}
            onConfirm={() => { const id = confirmDeleteRow; setConfirmDeleteRow(null); onRemoveTrainee(id); }}
            onCancel={() => setConfirmDeleteRow(null)}
          />
        );
      })()}
      {confirmDeleteSession && (() => {
        const entry = classRun.scheduleEntries.find(e => e.id === confirmDeleteSession);
        return (
          <ConfirmDialog
            message="Remove this session?"
            details={[
              { label: 'Session', value: entry?.label ?? '' },
              { label: 'Time', value: entry ? `${entry.startTime} – ${entry.endTime}` : '' },
            ]}
            onConfirm={() => { const id = confirmDeleteSession; setConfirmDeleteSession(null); onRemoveScheduleEntry(id); }}
            onCancel={() => setConfirmDeleteSession(null)}
          />
        );
      })()}
      {/* ── Title header ───────────────────────────────────────────────────── */}
      <div className={`rounded-t-lg border border-default border-b-0 border-l-4 ${tabColors.borderAccent} ${classRun.headerColor.bg} px-4 py-3`}>
        <div className="relative flex items-center justify-center gap-3">
          {/* Course run no — left */}
          <div className="absolute left-0 flex items-center gap-1">
            <span className={`text-xs whitespace-nowrap opacity-80 ${classRun.headerColor.text}`}>Course Run:</span>
            <input
              value={classRun.courseRunNo}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 7);
                onClassChange('courseRunNo', v);
              }}
              placeholder=""
              maxLength={7}
              inputMode="numeric"
              className={`w-28 text-xs bg-transparent border-b border-dashed border-white/40 focus:outline-none focus:border-white ${classRun.headerColor.text} placeholder:opacity-40`}
            />
          </div>

          {/* Course title — centred */}
          <input
            value={classRun.courseTitle}
            onChange={e => onClassChange('courseTitle', e.target.value)}
            placeholder="Course Title"
            className={`text-sm font-semibold text-center bg-transparent border-b border-dashed border-white/40 focus:outline-none focus:border-white placeholder:opacity-40 w-full max-w-lg ${classRun.headerColor.text}`}
          />

          {/* Tab badge + saving indicator + move + delete — right */}
          <div className="absolute right-0 flex items-center gap-2">
            {saving && (
              <span className={`text-xs animate-pulse opacity-70 ${classRun.headerColor.text}`}>Saving…</span>
            )}
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border border-white/20 ${tabColors.headerBadgeBg} ${tabColors.headerBadgeText}`}>
              {tabLabel}
            </span>
            {/* Move to tab */}
            <div className="relative">
              <button
                onClick={() => setShowMoveMenu(v => !v)}
                title="Move to another class type"
                className={`p-1.5 rounded hover:bg-black/20 transition-colors opacity-70 hover:opacity-100 ${classRun.headerColor.text}`}
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" />
                </svg>
              </button>
              {showMoveMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-default rounded-lg shadow-xl py-1 min-w-[170px]">
                  {TABS.filter(t => t.key !== activeTab).map(t => (
                    <button
                      key={t.key}
                      onClick={() => { setShowMoveMenu(false); onMoveClass(t.key); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-on-surface hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setConfirmDeleteClass(true)}
              title="Remove this class"
              className={`p-1.5 rounded hover:bg-black/20 transition-colors opacity-70 hover:opacity-100 ${classRun.headerColor.text}`}
            >
              <Icon name={IconName.Delete} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="border border-default overflow-x-auto">
        <table className="min-w-max w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface border-b border-default">
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 text-xs font-semibold text-on-surface-secondary whitespace-nowrap border-r border-default last:border-r-0 ${col.minW} ${col.align === 'center' ? 'text-center' : 'text-left'}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classRun.trainees.map((t, idx) => (
              <tr
                key={t.id}
                className="border-b border-default last:border-b-0 hover:bg-surface-hover/20 transition-colors"
              >
                <td className="px-2 py-1 text-xs text-center text-on-surface-secondary border-r border-default select-none">
                  {idx + 1}
                </td>
                {(COLUMNS.filter(c => c.key !== '_no' && c.key !== '_actions') as typeof COLUMNS).map(col =>
                  col.key === 'date' ? (
                    <DateRangeCell
                      key={col.key}
                      value={t.date}
                      onChange={v => onTraineeChange(t.id, 'date', v)}
                    />
                  ) : col.key === 'grant' ? (
                    <SelectCell
                      key={col.key}
                      value={t.grant}
                      onChange={v => onTraineeChange(t.id, 'grant', v)}
                      options={['Yes', 'No']}
                    />
                  ) : (col.key === 'name' || col.key === 'email' || col.key === 'contact_no') ? (
                    <LookupCell
                      key={col.key}
                      value={t[col.key]}
                      placeholder={col.placeholder}
                      onChange={v => onTraineeChange(t.id, col.key as TraineeField, v)}
                      onAutofill={async s => {
                        onTraineeChange(t.id, 'name', s.name);
                        onTraineeChange(t.id, 'email', s.email);
                        onTraineeChange(t.id, 'contact_no', s.contact_no ?? '');
                        // Look up invoice using email + name + class date
                        try {
                          const params = new URLSearchParams();
                          if (s.email) params.set('email', s.email);
                          if (s.name)  params.set('name',  s.name);
                          if (selectedDate) params.set('date', selectedDate);
                          const res  = await fetch(`/api/admin/invoice-lookup?${params}`);
                          const json = await res.json();
                          if (json.success && json.invoice_no) {
                            onTraineeChange(t.id, 'invoice_no', json.invoice_no);
                          }
                        } catch { /* silent — invoice field stays empty */ }
                      }}
                    />
                  ) : (
                    <InputCell
                      key={col.key}
                      value={t[col.key as TraineeField]}
                      onChange={v => onTraineeChange(t.id, col.key as TraineeField, v)}
                      onFillAll={v => onFillAll(col.key as TraineeField, v)}
                      placeholder={col.placeholder}
                      align={col.align}
                      digitsOnly={col.digitsOnly}
                    />
                  )
                )}
                <td className="px-1.5 py-1 text-center border-r border-default last:border-r-0">
                  <button
                    onClick={() => setConfirmDeleteRow(t.id)}
                    title="Remove row"
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-on-surface-secondary/40 hover:text-red-500 transition-colors"
                  >
                    <Icon name={IconName.Close} className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-2">
                <button
                  onClick={onAddTrainee}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  <Icon name={IconName.Plus} className="w-3.5 h-3.5" />
                  Add trainee
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Footer: trainer info (left) + class schedule (right) ────────────── */}
      <div className="border border-default border-t-0 rounded-b-lg flex">

        {/* Trainer info */}
        <div className="flex-1 bg-surface-elevated/40 px-5 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-on-surface-secondary">
            <span className="font-medium w-36 shrink-0">No. of Participants:</span>
            <span className="font-semibold text-on-surface">{classRun.trainees.length}</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
            <span className="font-medium w-36 shrink-0">Trainer:</span>
            <input
              value={classRun.trainer}
              onChange={e => onClassChange('trainer', e.target.value)}
              placeholder="Trainer Name"
              className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 w-48"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
            <span className="font-medium w-36 shrink-0">Trainer Email:</span>
            <input
              value={classRun.trainerEmail}
              onChange={e => onClassChange('trainerEmail', e.target.value)}
              placeholder="trainer@example.com"
              className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 w-48"
            />
          </label>
          <div className="mt-1 pt-2 border-t border-default">
            <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
              <span className="font-medium w-36 shrink-0">QR Attendance:</span>
              <input
                value={classRun.qrAttendance}
                onChange={e => onClassChange('qrAttendance', e.target.value)}
                placeholder="QR link"
                className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 flex-1 min-w-0"
              />
            </label>
          </div>
          {activeTab === 'virtual' && (
            <div className="mt-1 pt-2 border-t border-default flex gap-6">
              <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
                <span className="font-medium w-36 shrink-0">Zoom ID:</span>
                <input
                  value={classRun.zoomId}
                  onChange={e => onClassChange('zoomId', e.target.value)}
                  placeholder="Zoom ID"
                  className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 w-36"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-on-surface-secondary ml-24">
                <span className="font-medium shrink-0">Meeting ID:</span>
                <input
                  value={classRun.meetingId}
                  onChange={e => onClassChange('meetingId', e.target.value)}
                  placeholder="Meeting ID"
                  className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 w-36"
                />
              </label>
            </div>
          )}
        </div>

        {/* Class Schedule */}
        <div className="w-[26rem] shrink-0 border-l border-default bg-surface-elevated/20 flex flex-col">
          <div className="px-4 py-2 border-b border-default bg-surface-elevated/60 flex items-center justify-between">
            <span className="text-xs font-semibold text-on-surface-secondary uppercase tracking-wide">Class Schedule</span>
            <button
              onClick={onAddScheduleEntry}
              disabled={classRun.scheduleEntries.length >= 10}
              className="flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-primary hover:text-primary/80"
            >
              <Icon name={IconName.Plus} className="w-3.5 h-3.5" />
              Add session {classRun.scheduleEntries.length >= 10 ? '(max 10)' : ''}
            </button>
          </div>
          <div className="flex-1 flex flex-col divide-y divide-default">
            {classRun.scheduleEntries.length === 0 && (
              <p className="text-xs text-on-surface-secondary/50 text-center py-4 italic">No sessions yet</p>
            )}
            {classRun.scheduleEntries.map(entry => (
              <div key={entry.id} className="flex items-center gap-2 px-3 py-2 group">
                <select
                  value={entry.label}
                  onChange={e => onScheduleEntryChange(entry.id, 'label', e.target.value)}
                  className="text-xs text-on-surface bg-surface border border-default rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40 w-16 shrink-0"
                >
                  <option value="">—</option>
                  <option value="C/R">C/R</option>
                  <option value="PP">PP</option>
                  <option value="ASM">ASM</option>
                </select>
                <input
                  type="time"
                  value={entry.startTime}
                  onChange={e => onScheduleEntryChange(entry.id, 'startTime', e.target.value)}
                  className="text-xs text-on-surface bg-surface border border-default rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40 w-24 shrink-0 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:w-3 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <span className="text-on-surface-secondary/50 text-xs shrink-0">–</span>
                <input
                  type="time"
                  value={entry.endTime}
                  onChange={e => onScheduleEntryChange(entry.id, 'endTime', e.target.value)}
                  className="text-xs text-on-surface bg-surface border border-default rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40 w-24 shrink-0 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:w-3 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <label className="ml-auto flex items-center gap-1.5 cursor-pointer shrink-0 group/att">
                  <input
                    type="checkbox"
                    checked={entry.done}
                    onChange={e => onScheduleEntryChange(entry.id, 'done', e.target.checked)}
                    className="accent-primary w-3.5 h-3.5 shrink-0 cursor-pointer"
                  />
                  <span className={`text-[10px] font-medium transition-colors ${entry.done ? 'text-green-400' : 'text-on-surface-secondary/50 group-hover/att:text-on-surface-secondary'}`}>
                    Attendance
                  </span>
                </label>
                <button
                  onClick={() => setConfirmDeleteSession(entry.id)}
                  title="Delete session"
                  className="ml-1 shrink-0 p-1 rounded hover:bg-red-500/10 text-red-400 hover:text-red-500 transition-colors"
                >
                  <Icon name={IconName.Delete} className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};

// ─── Helpers: convert DB rows → ClassRun[] ───────────────────────────────────

function rowsToClasses(rows: Record<string, any>[]): ClassRun[] {
  const map = new Map<string, ClassRun>();
  for (const row of rows) {
    if (!map.has(row.class_id)) {
      map.set(row.class_id, {
        id: row.class_id,
        courseTitle: row.course_title ?? '',
        courseRunNo: row.course_run_no ?? '',
        trainer: row.trainer ?? '',
        trainerEmail: row.trainer_email ?? '',
        qrAttendance: row.qr_attendance ?? '',
        zoomId: row.zoom_id ?? '',
        meetingId: row.meeting_id ?? '',
        startDate: row.start_date ?? '',
        endDate: row.end_date ?? '',
        venue: row.venue ?? '',
        scheduleEntries: row.schedule_entries
          ? (typeof row.schedule_entries === 'string'
              ? JSON.parse(row.schedule_entries)
              : row.schedule_entries)
          : [],
        trainees: [],
        headerColor: headerColorFromId(row.class_id),
      });
    }
    map.get(row.class_id)!.trainees.push({
      id: row.id,
      name: row.name ?? '',
      contact_no: row.contact_no ?? '',
      email: row.email ?? '',
      magento_order_no: row.magento_order_no ?? '',
      virtual_reschedule: row.virtual_reschedule ?? '',
      comments: row.comments ?? '',
      date: row.entry_date ?? '',
      grant: row.grant ?? '',
      invoice_no: row.invoice_no ?? '',
      payment_mode: row.payment_mode ?? '',
      course_fee: row.course_fee ?? '',
      nett_fee: row.nett_fee ?? '',
      payment_status: row.payment_status ?? '',
      followup_by: row.followup_by ?? '',
      remark: row.remark ?? '',
    });
  }
  return Array.from(map.values());
}

// ─── Helpers: convert ClassRun → DB rows ─────────────────────────────────────

function classToRows(cr: ClassRun, classType: ClassTab, listDate: string): Record<string, any>[] {
  return cr.trainees.map(t => ({
    class_id: cr.id,
    class_type: classType,
    list_date: listDate || null,
    course_title: cr.courseTitle || null,
    trainer: cr.trainer || null,
    trainer_email: cr.trainerEmail || null,
    qr_attendance: cr.qrAttendance || null,
    zoom_id: cr.zoomId || null,
    meeting_id: cr.meetingId || null,
    name: t.name || null,
    contact_no: t.contact_no || null,
    email: t.email || null,
    magento_order_no: t.magento_order_no || null,
    virtual_reschedule: t.virtual_reschedule || null,
    comments: t.comments || null,
    entry_date: t.date || null,
    grant: t.grant || null,
    invoice_no: t.invoice_no || null,
    payment_mode: t.payment_mode || null,
    course_fee: t.course_fee || null,
    nett_fee: t.nett_fee || null,
    payment_status: t.payment_status || null,
    followup_by: t.followup_by || null,
    remark: t.remark || null,
    schedule_entries: JSON.stringify(cr.scheduleEntries ?? []),
  }));
}

// ─── Main view ────────────────────────────────────────────────────────────────

type TabData = Record<ClassTab, ClassRun[]>;

const emptyTabData = (): TabData => ({
  virtual: [], evening: [], external: [], woodsSquare: [], reschedule: [], cancelled: [], bukitTimah: [],
});

const MasterListView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<ClassTab>('virtual');
  const [tabData, setTabData] = useState<TabData>(emptyTabData);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const classes = tabData[activeTab];

  const setClasses = (updater: (prev: ClassRun[]) => ClassRun[]) =>
    setTabData(prev => ({ ...prev, [activeTab]: updater(prev[activeTab]) }));

  // ── Fetch on date + tab change ────────────────────────────────────────────

  const fetchClasses = useCallback(async (date: string, tab: ClassTab) => {
    if (!date) { setTabData(prev => ({ ...prev, [tab]: [] })); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/masterlist?date=${date}&class_type=${tab}`);
      const json = await res.json();
      if (json.success) {
        setTabData(prev => ({ ...prev, [tab]: rowsToClasses(json.data) }));
      }
    } catch (e) {
      console.error('[masterlist] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClasses(selectedDate, activeTab);
  }, [selectedDate, activeTab, fetchClasses]);

  // ── Auto-save a class block (debounced 800 ms) ────────────────────────────

  const saveClass = useCallback(async (cr: ClassRun, tab: ClassTab, date: string) => {
    setSaving(prev => ({ ...prev, [cr.id]: true }));
    try {
      await fetch('/api/admin/masterlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: classToRows(cr, tab, date) }),
      });
    } catch (e) {
      console.error('[masterlist] save error:', e);
    } finally {
      setSaving(prev => ({ ...prev, [cr.id]: false }));
    }
  }, []);

  const scheduleSave = useCallback((cr: ClassRun, tab: ClassTab, date: string) => {
    clearTimeout(debounceTimers.current[cr.id]);
    debounceTimers.current[cr.id] = setTimeout(() => saveClass(cr, tab, date), 2000);
  }, [saveClass]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleAddClass = () => {
    const nc = newClass();
    setClasses(prev => [...prev, nc]);
    // Save the empty class shell immediately so it exists in DB
    saveClass(nc, activeTab, selectedDate);
  };

  const handleRemoveClass = async (classId: string) => {
    setClasses(prev => prev.filter(cr => cr.id !== classId));
    try {
      await fetch(`/api/admin/masterlist?class_id=${classId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('[masterlist] delete error:', e);
    }
  };

  const handleMoveClass = async (classId: string, targetTab: ClassTab) => {
    const cr = tabData[activeTab].find(c => c.id === classId);
    if (!cr) return;
    setLoading(true);
    // Persist first so DB is ready before the tab switch triggers a fetch
    try {
      await fetch(`/api/admin/masterlist?class_id=${classId}`, { method: 'DELETE' });
      await fetch('/api/admin/masterlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: classToRows(cr, targetTab, selectedDate) }),
      });
    } catch (e) {
      console.error('[masterlist] move error:', e);
    }
    // Move in local state then switch tab — fetch will now see correct DB state
    setTabData(prev => ({
      ...prev,
      [activeTab]: prev[activeTab].filter(c => c.id !== classId),
      [targetTab]: [...prev[targetTab], cr],
    }));
    setActiveTab(targetTab);
    // loading will be cleared by the fetchClasses triggered by setActiveTab
  };

  const handleClassChange = (classId: string, field: ClassField, value: string) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId ? { ...cr, [field]: value } : cr);
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleAddTrainee = (classId: string) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, trainees: [...cr.trainees, newTrainee()] }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleRemoveTrainee = (classId: string, traineeId: string) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, trainees: cr.trainees.filter(t => t.id !== traineeId) }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleTraineeChange = (classId: string, traineeId: string, field: TraineeField, value: string) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, trainees: cr.trainees.map(t => t.id === traineeId ? { ...t, [field]: value } : t) }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleFillAll = (classId: string, field: TraineeField, value: string) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, trainees: cr.trainees.map(t => ({ ...t, [field]: value })) }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleAddScheduleEntry = (classId: string) => {
    setClasses(prev => {
      const existing = prev.find(c => c.id === classId);
      if (existing && existing.scheduleEntries.length >= 10) return prev;
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, scheduleEntries: [...cr.scheduleEntries, newScheduleEntry()] }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleScheduleEntryChange = (
    classId: string,
    entryId: string,
    field: keyof Omit<ScheduleEntry, 'id'>,
    value: string | boolean,
  ) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, scheduleEntries: cr.scheduleEntries.map(e => e.id === entryId ? { ...e, [field]: value } : e) }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleRemoveScheduleEntry = (classId: string, entryId: string) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, scheduleEntries: cr.scheduleEntries.filter(e => e.id !== entryId) }
        : cr,
      );
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const tabLabel = TABS.find(t => t.key === activeTab)?.label ?? '';

  return (
    <div className="space-y-6">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-on-surface">Master List</h2>
          <p className="text-sm text-on-surface-secondary mt-1">
            Manage master list records by date
          </p>
        </div>
      </div>

      {/* ── Date picker ──────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label className="text-xs font-medium text-on-surface-secondary uppercase tracking-wide">
              Select Date
            </label>
            <div className="relative">
              <Icon
                name={IconName.Calendar}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary pointer-events-none"
              />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="pl-10 pr-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface w-full sm:w-52"
              />
            </div>
          </div>

          {selectedDate && (
            <button
              onClick={() => setSelectedDate('')}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface-secondary transition-colors"
            >
              <Icon name={IconName.Close} className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>

        {selectedDate && (
          <div className="mt-4 flex items-center gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-lg w-fit">
            <Icon name={IconName.Calendar} className="w-4 h-4 text-primary" />
            <span className="text-sm text-on-surface">
              Viewing:{' '}
              <span className="font-semibold text-primary">
                {formatDisplayDate(selectedDate)}
              </span>
            </span>
          </div>
        )}
      </Card>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(tab => {
          const c = TAB_COLORS[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? `${c.activeBg} ${c.activeText}`
                  : 'bg-surface-elevated text-on-surface-secondary hover:bg-surface-hover border border-default'
              }`}
            >
              {tab.label}
              {tabData[tab.key].length > 0 && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : `${c.badgeBg} ${c.badgeText}`
                }`}>
                  {tabData[tab.key].length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content area ─────────────────────────────────────────────────────── */}
      <div>
        {/* Section label + Add New Class button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-on-surface">{tabLabel}</span>
          </div>

          <button
            onClick={handleAddClass}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Icon name={IconName.Plus} className="w-4 h-4" />
            Add New Class
          </button>
        </div>

        {/* Class blocks */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-on-surface-secondary text-sm gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading…
          </div>
        ) : classes.length === 0 ? (
          <Card className="overflow-hidden">
            <div className="px-4 py-16 text-center">
              <div className="flex flex-col items-center gap-3 text-on-surface-secondary">
                <div className="w-14 h-14 rounded-full bg-surface-elevated flex items-center justify-center">
                  <Icon
                    name={IconName.Calendar}
                    className="w-7 h-7 text-on-surface-secondary opacity-50"
                  />
                </div>
                <div>
                  <p className="font-medium text-on-surface">No classes yet</p>
                  <p className="text-xs mt-0.5">
                    Click <span className="font-medium">Add New Class</span> to get started
                  </p>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          classes.map((cr) => (
            <ClassBlock
              key={cr.id}
              classRun={cr}
              activeTab={activeTab}
              selectedDate={selectedDate}
              saving={saving[cr.id] ?? false}
              onClassChange={(field, value) => handleClassChange(cr.id, field, value)}
              onTraineeChange={(traineeId, field, value) =>
                handleTraineeChange(cr.id, traineeId, field, value)
              }
              onFillAll={(field, value) => handleFillAll(cr.id, field, value)}
              onAddTrainee={() => handleAddTrainee(cr.id)}
              onRemoveTrainee={traineeId => handleRemoveTrainee(cr.id, traineeId)}
              onRemoveClass={() => handleRemoveClass(cr.id)}
              onMoveClass={targetTab => handleMoveClass(cr.id, targetTab)}
              onAddScheduleEntry={() => handleAddScheduleEntry(cr.id)}
              onScheduleEntryChange={(entryId, field, value) =>
                handleScheduleEntryChange(cr.id, entryId, field, value)
              }
              onRemoveScheduleEntry={entryId => handleRemoveScheduleEntry(cr.id, entryId)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default MasterListView;
