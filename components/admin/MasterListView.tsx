import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

type CellBgColor = '' | 'red' | 'yellow' | 'green';

const BG_COLOR_CELL_CLASSES: Record<CellBgColor, string> = {
  '':     '',
  red:    'bg-red-200 dark:bg-red-900/50',
  yellow: 'bg-yellow-200 dark:bg-yellow-900/50',
  green:  'bg-green-200 dark:bg-green-900/50',
};

const BG_COLOR_SWATCH_CLASSES: Record<CellBgColor, string> = {
  '':     'bg-transparent',
  red:    'bg-red-400',
  yellow: 'bg-yellow-400',
  green:  'bg-green-400',
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
  payment_status: string;
  followup_by: string;
  remark: string;
  cancelled: boolean;
  invoice_no_color: CellBgColor;
  payment_mode_color: CellBgColor;
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
  classDate: string;
  venue: string;
  notes: string;
  calendarEventId: string; // Google Calendar event ID (stored as "{evtId}_{date}")
  scheduleEntries: ScheduleEntry[];
  trainees: TraineeRow[];
  headerColor: { bg: string; text: string };
}

type TraineeField = keyof TraineeRow;
type ClassField = keyof Omit<ClassRun, 'id' | 'trainees' | 'scheduleEntries' | 'calendarEventId'>;

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
  invoice_no: '', payment_mode: '', course_fee: '',
  payment_status: '', followup_by: '', remark: '', cancelled: false,
  invoice_no_color: '', payment_mode_color: '',
});


const newScheduleEntry = (): ScheduleEntry => ({
  id: crypto.randomUUID(), label: '', startTime: '', endTime: '', done: false,
});

// Map an SSG mode_of_training code/name to the UI's session label dropdown.
// Falls back to empty so the user can pick manually for categories we can't infer.
const modeToScheduleLabel = (mode: any): string => {
  const s = String(mode ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === '8' || s.includes('assess'))    return 'ASM';
  if (s === '1' || s.includes('classroom')) return 'C/R';
  if (s === '4' || s.includes('ojt') || s.includes('on the job')) return 'PP';
  return '';
};

// Normalise a session.start_date coming back from the API (Date object from
// pg, ISO datetime, ISO date, or YYYYMMDD) to YYYY-MM-DD so it can be
// compared to the masterlist's selectedDate.
const sessionDateToIso = (d: any): string => {
  if (!d) return '';
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(d).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
};

// "HH:MM:SS" / "HH:MM" → "HH:MM" so it fits the <input type="time"> control.
const sessionTimeToHHmm = (t: any): string => {
  const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

const newClass = (): ClassRun => {
  const id = crypto.randomUUID();
  return {
    id,
    courseTitle: '', courseRunNo: '', trainer: '', trainerEmail: '',
    qrAttendance: '', zoomId: '', meetingId: '',
    classDate: '', venue: '', notes: '', calendarEventId: '',
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

// Convert a stored entry_date value to a human-readable DD/MM/YYYY text string.
// Handles ISO single, ISO datetime (with T), ISO range (~), comma-separated,
// and already-formatted / free-text values (returned unchanged).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Normalise any single token to YYYY-MM-DD, applying SGT offset for datetime strings.
const toIsoDate = (s: string): string => {
  s = s.trim();
  if (s.includes('T')) {
    const sgt = new Date(new Date(s).getTime() + 8 * 3_600_000);
    return sgt.toISOString().slice(0, 10);
  }
  return s;
};

const toDisplayDate = (v: string): string => {
  if (!v) return '';

  // Range: split on ~, normalise each side, then format
  if (v.includes('~')) {
    const [rawS, rawE] = v.split('~');
    const s = toIsoDate(rawS);
    const e = toIsoDate(rawE);
    if (ISO_DATE_RE.test(s) && ISO_DATE_RE.test(e)) {
      return `${fmtDisplay(s)} – ${fmtDisplay(e)}`;
    }
    return v; // unrecognised range — leave as-is
  }

  // Comma-separated: normalise, deduplicate, sort, then group consecutive runs into ranges
  // e.g. 19 Apr + 22–26 Apr  →  "19/04/2026, 22/04/2026 – 26/04/2026"
  if (v.includes(',')) {
    const parts = v.split(',').map(toIsoDate);
    if (parts.every(p => ISO_DATE_RE.test(p))) {
      const unique = [...new Set(parts)].sort();
      if (unique.length === 1) return fmtDisplay(unique[0]);
      // Build consecutive runs then format each run as single date or range
      const runs: string[][] = [];
      let run = [unique[0]];
      for (let i = 1; i < unique.length; i++) {
        const diff = (new Date(unique[i]).getTime() - new Date(unique[i - 1]).getTime()) / 86_400_000;
        if (diff === 1) { run.push(unique[i]); } else { runs.push(run); run = [unique[i]]; }
      }
      runs.push(run);
      return runs
        .map(r => r.length === 1 ? fmtDisplay(r[0]) : `${fmtDisplay(r[0])} – ${fmtDisplay(r[r.length - 1])}`)
        .join(', ');
    }
  }

  // Single value
  const normalised = toIsoDate(v);
  if (ISO_DATE_RE.test(normalised)) return fmtDisplay(normalised);

  return v; // already display-formatted or free text
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
  onPasteGrid?: (text: string) => void;
  placeholder?: string;
  align?: 'left' | 'center';
  digitsOnly?: boolean;
  onFillAll?: (v: string) => void;
  bgColor?: CellBgColor;
  onBgColorChange?: (c: CellBgColor) => void;
}

const InputCell: React.FC<InputCellProps> = ({ value, onChange, onPasteGrid, placeholder = '', align = 'left', digitsOnly = false, onFillAll, bgColor = '', onBgColorChange }) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = `${taRef.current.scrollHeight}px`;
    }
  }, [value]);

  useEffect(() => {
    if (!colorMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorMenuOpen]);

  return (
    <td className={`relative px-1.5 py-1 border-r border-default last:border-r-0 group/cell ${align === 'center' ? 'text-center' : ''} ${BG_COLOR_CELL_CLASSES[bgColor]}`}>
      <textarea
        ref={taRef}
        value={value}
        rows={1}
        onChange={e => {
          const v = digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value;
          onChange(v);
        }}
        onPaste={e => {
          const text = e.clipboardData.getData('text');
          if (!/[\t\r\n]/.test(text)) return;
          const { isGrid, singleValue } = analyzeClipboardPaste(e);
          if (isGrid) {
            if (!onPasteGrid) return;
            e.preventDefault();
            onPasteGrid(text);
            return;
          }
          e.preventDefault();
          onChange(digitsOnly ? singleValue.replace(/\D/g, '') : singleValue);
        }}
        placeholder={placeholder}
        inputMode={digitsOnly ? 'numeric' : 'text'}
        className={`w-full px-2 py-1 text-xs bg-transparent rounded focus:outline-none focus:bg-primary/5 focus:ring-1 focus:ring-primary/30 placeholder:text-on-surface-secondary/30 resize-none overflow-hidden leading-snug ${align === 'center' ? 'text-center' : ''}`}
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
      {onBgColorChange && (
        <div
          ref={colorMenuRef}
          className={`absolute right-1 top-1 transition-opacity ${colorMenuOpen || bgColor ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100'}`}
        >
          <button
            type="button"
            onClick={() => setColorMenuOpen(v => !v)}
            title="Highlight colour"
            className={`w-3.5 h-3.5 rounded-full ring-1 ring-on-surface-secondary/50 hover:ring-primary ${BG_COLOR_SWATCH_CLASSES[bgColor]}`}
          />
          {colorMenuOpen && (
            <div className="absolute right-0 top-5 z-30 flex items-center gap-1 bg-surface border border-default rounded-md p-1 shadow-lg">
              {(['', 'red', 'yellow', 'green'] as CellBgColor[]).map(c => (
                <button
                  key={c || 'none'}
                  type="button"
                  onClick={() => { onBgColorChange(c); setColorMenuOpen(false); }}
                  title={c || 'none'}
                  className={`w-4 h-4 rounded-full ring-1 ring-on-surface-secondary/40 hover:ring-2 hover:ring-primary ${BG_COLOR_SWATCH_CLASSES[c]} ${c === '' ? 'relative' : ''}`}
                >
                  {c === '' && (
                    <span className="absolute inset-0 flex items-center justify-center text-on-surface-secondary text-[10px] leading-none">∅</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </td>
  );
};

// ─── Learner lookup cell (auto-fill name / email / contact_no) ───────────────

interface LearnerSuggestion { id: string; name: string; email: string; contact_no: string; invoice_no?: string }

interface LookupCellProps {
  value: string;
  onChange: (v: string) => void;
  onAutofill: (s: LearnerSuggestion) => void;
  onPasteGrid?: (text: string) => void;
  placeholder?: string;
}

const LookupCell: React.FC<LookupCellProps> = ({ value, onChange, onAutofill, onPasteGrid, placeholder = '' }) => {
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
          const text = e.clipboardData.getData('text');
          if (/[\t\r\n]/.test(text)) {
            const { isGrid, singleValue } = analyzeClipboardPaste(e);
            if (isGrid) {
              if (!onPasteGrid) return;
              e.preventDefault();
              onPasteGrid(text);
              return;
            }
            e.preventDefault();
            const flat = singleValue.replace(/\s+/g, ' ').trim();
            onChange(flat);
            search(flat);
            return;
          }
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

// ─── Trainer lookup input (autocomplete by name or email) ────────────────────

const TrainerLookupInput: React.FC<{
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onAutofill: (name: string, email: string) => void;
}> = ({ value, placeholder, onChange, onAutofill }) => {
  const [suggestions, setSuggestions] = useState<{ name: string; email: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    if (!q.trim()) { setSuggestions([]); setOpen(false); return; }
    clearTimeout(timerRef.current!);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/trainer-lookup?query=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.success && json.data.length > 0) {
          if (inputRef.current) {
            const r = inputRef.current.getBoundingClientRect();
            setPos({ top: r.bottom + 4, left: r.left, width: r.width });
          }
          setSuggestions(json.data);
          setOpen(true);
        } else {
          setSuggestions([]); setOpen(false);
        }
      } catch { setSuggestions([]); setOpen(false); }
    }, 300);
  };

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); search(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 w-48"
      />
      {open && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
          className="bg-surface border border-default rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto"
        >
          {suggestions.map(s => (
            <button
              key={s.email}
              onMouseDown={e => { e.preventDefault(); onAutofill(s.name, s.email); setOpen(false); setSuggestions([]); }}
              className="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors border-b border-default last:border-b-0"
            >
              <p className="text-xs font-medium text-on-surface">{s.name}</p>
              <p className="text-[10px] text-on-surface-secondary">{s.email}</p>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

// ─── Select cell ─────────────────────────────────────────────────────────────

const SelectCell: React.FC<{ value: string; onChange: (v: string) => void; options: string[]; onPasteGrid?: (text: string) => void }> = ({ value, onChange, options, onPasteGrid }) => (
  <td className="px-1.5 py-1 border-r border-default last:border-r-0 text-center">
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onPaste={e => {
        const text = e.clipboardData.getData('text');
        if (!/[\t\r\n]/.test(text)) return;
        const { isGrid, singleValue } = analyzeClipboardPaste(e);
        if (isGrid) {
          if (!onPasteGrid) return;
          e.preventDefault();
          onPasteGrid(text);
          return;
        }
        e.preventDefault();
        const v = singleValue.trim();
        const matched = options.find(o => o.toLowerCase() === v.toLowerCase());
        if (matched) onChange(matched);
      }}
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

const DateRangeCell: React.FC<{ value: string; onChange: (v: string) => void; onFillAll?: (v: string) => void; singleDate?: boolean; standalone?: boolean; compact?: boolean; placeholder?: string }> = ({ value, onChange, onFillAll, singleDate = false, standalone = false, compact = false, placeholder = 'Select Date' }) => {
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
      const popupWidth  = 288; // w-72
      const popupHeight = 340; // approximate calendar height
      const left = r.right + popupWidth > window.innerWidth
        ? Math.max(4, r.right - popupWidth)
        : r.left;
      const top = r.bottom + 6 + popupHeight > window.innerHeight
        ? Math.max(4, r.top - popupHeight - 6)
        : r.bottom + 6;
      setPos({ top, left });
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
    if (singleDate) {
      onChange(dateStr);
      setOpen(false);
      return;
    }
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

  // Comma-separated ISO dates (non-consecutive multi-day) — display each date formatted
  const isMultiDate = !isRange && value.includes(',');
  const displayLabel = isMultiDate
    ? value.split(',').map(d => fmtDisplay(d.trim())).join(', ')
    : rawStart
      ? (rawEnd ? `${fmtDisplay(rawStart)} – ${fmtDisplay(rawEnd)}` : fmtDisplay(rawStart))
      : placeholder;

  const calendarPopup = open && createPortal(
    <div
      ref={popupRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] rounded-xl shadow-2xl p-4 w-72 select-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600"
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
      {!singleDate && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-3 italic">
          {phase === 'start' ? 'Select start date' : 'Select end date — or same date for single day'}
        </p>
      )}

      {/* Clear */}
      {rawStart && (
        <button
          onClick={() => { onChange(''); setOpen(false); }}
          className="mt-2 w-full text-[11px] text-gray-400 hover:text-red-400 transition-colors text-center"
        >
          Clear
        </button>
      )}
    </div>,
    document.body,
  );

  const triggerButton = (
    <button
      ref={triggerRef}
      onClick={openCalendar}
      className={`text-xs px-2 py-1 rounded hover:bg-primary/10 transition-colors text-left whitespace-nowrap ${rawStart ? 'text-on-surface' : 'text-on-surface-secondary/30'}`}
    >
      {displayLabel}
    </button>
  );

  if (compact) {
    return (
      <>
        {triggerButton}
        {calendarPopup}
      </>
    );
  }

  if (standalone) {
    return (
      <>
        <div className="relative">
          <Icon
            name={IconName.Calendar}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary pointer-events-none"
          />
          <button
            ref={triggerRef}
            onClick={openCalendar}
            className="pl-10 pr-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface w-full sm:w-52 text-left"
          >
            {rawStart
              ? fmtDisplay(rawStart)
              : <span className="text-on-surface-secondary/40">Select date</span>
            }
          </button>
        </div>
        {calendarPopup}
      </>
    );
  }

  return (
    <td className="px-1.5 py-1 border-r border-default last:border-r-0">
      <div className="flex items-center gap-1">
        {triggerButton}
        {onFillAll && value && (
          <button
            onMouseDown={e => { e.preventDefault(); onFillAll(value); }}
            className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
          >
            fill all ↓
          </button>
        )}
      </div>
      {calendarPopup}
    </td>
  );
};

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: { key: TraineeField | '_no' | '_cancelled' | '_actions'; label: string; minW: string; placeholder?: string; align?: 'center'; digitsOnly?: boolean }[] = [
  { key: '_no',               label: 'No.',                       minW: 'min-w-[2rem]',    align: 'center' },
  { key: 'name',              label: 'Name',                      minW: 'min-w-[8rem]',    placeholder: 'Full Name' },
  { key: 'contact_no',        label: 'Contact No.',               minW: 'min-w-[5rem]',    placeholder: '9XXXXXXX', digitsOnly: true },
  { key: 'email',             label: 'Email',                     minW: 'min-w-[10rem]',   placeholder: 'email@example.com' },
  { key: 'magento_order_no',  label: 'Magento Order #',           minW: 'min-w-[7rem]',    placeholder: 'Order #' },
  { key: 'virtual_reschedule',label: 'Virtual / Reschedule',      minW: 'min-w-[7rem]',    placeholder: 'Virtual' },
  { key: 'comments',          label: 'Comments',                  minW: 'min-w-[8rem]',    placeholder: 'Comments' },
  { key: 'date',              label: 'Date',                      minW: 'min-w-[6.5rem]',  placeholder: 'DD/MM/YYYY' },
  { key: 'grant',             label: 'Grant (Yes/No)',            minW: 'min-w-[5rem]',    placeholder: '', align: 'center' },
  { key: 'invoice_no',        label: 'Invoice No. / E-Invoice #', minW: 'min-w-[8.5rem]',  placeholder: 'TCXX-XXXX-XXXXXX' },
  { key: 'payment_mode',      label: 'Payment Mode',              minW: 'min-w-[6.5rem]',  placeholder: 'e.g. PayNow' },
  { key: 'course_fee',        label: 'Course Fee (excl. GST)',    minW: 'min-w-[7rem]',    placeholder: '$0.00' },
  { key: 'payment_status',    label: 'Payment Status',            minW: 'min-w-[6.5rem]',  placeholder: 'Paid / Pending' },
  { key: 'followup_by',       label: 'Followup By',               minW: 'min-w-[6.5rem]',  placeholder: 'Name' },
  { key: 'remark',            label: 'Remark',                    minW: 'min-w-[8rem]',    placeholder: 'Remarks' },
  { key: '_cancelled',        label: 'C/W',                       minW: 'min-w-[2.5rem]',  align: 'center' },
  { key: '_actions',          label: 'Remove',                    minW: 'min-w-[3rem]',    align: 'center' },
];

// ─── Duplicate modal ──────────────────────────────────────────────────────────

// ─── Single class block ───────────────────────────────────────────────────────

const PASTE_TRAINEE_FIELDS = COLUMNS
  .map(c => c.key)
  .filter((key): key is TraineeField => key !== '_no' && key !== '_cancelled' && key !== '_actions');

const parseClipboardGrid = (text: string): string[][] => {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i];
    const next = normalised[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === '\t' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
};

// Decide whether a paste is a single-cell value (with possible internal line breaks)
// or a real multi-cell grid paste. Sheets/Excel emit an HTML clipboard with one <td>
// per source cell, which lets us tell the two apart:
//   - 1 <td>  (a single Sheets cell, possibly with <br> inside)  → single value
//   - >1 <td> (multiple Sheets cells)                            → grid paste
// Tab-separated text (multi-column TSV) without HTML also counts as a grid paste.
const analyzeClipboardPaste = (e: React.ClipboardEvent): { isGrid: boolean; singleValue: string } => {
  const text = e.clipboardData.getData('text');
  if (!/[\t\r\n]/.test(text)) return { isGrid: false, singleValue: text };

  const html = e.clipboardData.getData('text/html');
  if (html && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tds = doc.querySelectorAll('td');
    if (tds.length === 1) {
      tds[0].querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      return { isGrid: false, singleValue: (tds[0].textContent ?? '').replace(/\r\n/g, '\n') };
    }
    if (tds.length > 1) return { isGrid: true, singleValue: '' };
  }

  const grid = parseClipboardGrid(text);
  if (grid.length === 1 && grid[0].length === 1) {
    return { isGrid: false, singleValue: grid[0][0] };
  }
  return { isGrid: true, singleValue: '' };
};

const normalisePastedTraineeValue = (field: TraineeField, value: string): string => {
  const trimmed = value.trim();
  if (field === 'contact_no') return trimmed.replace(/\D/g, '');
  if (field === 'grant') {
    const lower = trimmed.toLowerCase();
    if (lower === 'y' || lower === 'yes') return 'Yes';
    if (lower === 'n' || lower === 'no') return 'No';
  }
  return trimmed;
};

interface ClassBlockProps {
  classRun: ClassRun;
  activeTab: ClassTab;
  selectedDate: string;
  saving?: boolean;
  searchQuery?: string;
  onClassChange: (field: ClassField, value: string) => void;
  onTraineeChange: (traineeId: string, field: TraineeField, value: string | boolean) => void;
  onFillAll: (field: TraineeField, value: string) => void;
  onAddTrainee: () => void;
  onRemoveTrainee: (traineeId: string) => void;
  onRemoveClass: () => void;
  onMoveClass: (targetTab: ClassTab) => void;
  onBulkAddTrainees: (trainees: { name: string; contact_no: string; email: string }[]) => void;
  onPasteTraineeGrid: (traineeId: string, startField: TraineeField, text: string) => void;
  onAddScheduleEntry: () => void;
  onScheduleEntryChange: (entryId: string, field: keyof Omit<ScheduleEntry, 'id'>, value: string | boolean) => void;
  onRemoveScheduleEntry: (entryId: string) => void;
  onReplaceScheduleEntries: (entries: ScheduleEntry[]) => void;
}

const ClassBlock: React.FC<ClassBlockProps> = ({
  classRun, activeTab, selectedDate, saving, searchQuery = '',
  onClassChange, onTraineeChange, onFillAll,
  onAddTrainee, onRemoveTrainee, onRemoveClass, onMoveClass, onBulkAddTrainees,
  onPasteTraineeGrid,
  onAddScheduleEntry, onScheduleEntryChange, onRemoveScheduleEntry,
  onReplaceScheduleEntries,
}) => {
  const tabLabel = TABS.find(t => t.key === activeTab)?.label ?? '';
  const tabColors = TAB_COLORS[activeTab];
  const [confirmDeleteClass, setConfirmDeleteClass] = useState(false);

  // Detect duplicate rows by name, email, or contact_no (case-insensitive, non-empty)
  const duplicateRowIds = useMemo(() => {
    const seen = new Map<string, string[]>();
    const dups = new Set<string>();
    for (const t of classRun.trainees) {
      const keys = [
        t.name.trim().toLowerCase(),
        t.email.trim().toLowerCase(),
        t.contact_no.trim(),
      ].filter(Boolean);
      for (const k of keys) {
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k)!.push(t.id);
      }
    }
    for (const ids of seen.values()) {
      if (ids.length > 1) ids.forEach(id => dups.add(id));
    }
    return dups;
  }, [classRun.trainees]);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<string | null>(null);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const autoImportedRef = useRef(false);

  const handleImportTrainees = async () => {
    setImporting(true);
    try {
      const params = new URLSearchParams({ course_title: classRun.courseTitle });
      if (selectedDate) params.set('list_date', selectedDate);
      if (classRun.courseRunNo) params.set('course_run_no', classRun.courseRunNo);
      if (classRun.calendarEventId) params.set('calendar_event_id', classRun.calendarEventId);
      const res = await fetch(`/api/admin/masterlist-learner-lookup?${params}`);
      const json = await res.json();
      if (json.success) {
        console.log('[masterlist] import result — trainer:', json.trainer, '| learners:', json.data?.length);
        // Auto-fill trainer field if found in guest list and not already set
        if (json.trainer && !classRun.trainer.trim() && !classRun.trainerEmail.trim()) {
          onClassChange('trainer', json.trainer.name || '');
          onClassChange('trainerEmail', json.trainer.email || '');
        }
        if (Array.isArray(json.data) && json.data.length > 0) {
          onBulkAddTrainees(json.data);
        }
      }
    } catch (e) {
      console.error('[masterlist] import trainees error:', e);
    } finally {
      setImporting(false);
    }
  };

  // Auto-import once when the block first mounts with no real trainee data yet.
  // "No real data" = every trainee row has an empty name AND empty email.
  useEffect(() => {
    if (autoImportedRef.current) return;
    const allEmpty = classRun.trainees.every(t => !t.name.trim() && !t.email.trim());
    if (!allEmpty) { autoImportedRef.current = true; return; }
    autoImportedRef.current = true;
    handleImportTrainees();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fill Class Schedule when a full 7-digit Course Run ID is entered.
  // - Looks up the run in the local DB (falling back to SSG), then fetches
  //   every session for that run.
  // - This block gets only the sessions whose start_date matches selectedDate,
  //   so a consecutive-day course shows the correct subset per day.
  // - Other linked-day blocks in the same classDate range are also filled via
  //   direct masterlist POSTs so that when the user navigates to Day 2/3/…,
  //   the schedule is already there.
  // - Skips the fetch entirely if the block already has schedule entries so
  //   user-entered or previously-synced data isn't clobbered.
  const lastFetchedRunRef = useRef<string>('');
  const [fetchingSessions, setFetchingSessions] = useState(false);

  useEffect(() => {
    const run = (classRun.courseRunNo || '').trim();
    if (!/^\d{7}$/.test(run)) return;
    if (run === lastFetchedRunRef.current) return;
    if (classRun.scheduleEntries.length > 0) {
      // Already populated — remember the run so a later edit on an empty block
      // still triggers a fetch when the value actually changes.
      lastFetchedRunRef.current = run;
      return;
    }
    lastFetchedRunRef.current = run;

    let cancelled = false;
    (async () => {
      setFetchingSessions(true);
      try {
        const lookRes  = await fetch(`/api/admin/lookup-course-run?courseRunCode=${encodeURIComponent(run)}`);
        const lookJson = await lookRes.json();
        if (cancelled) return;
        if (!lookJson.success || !lookJson.data?.courseRunId) {
          console.warn('[masterlist] course run not found:', run);
          return;
        }

        const courseRunUuid = lookJson.data.courseRunId;
        const sessRes  = await fetch(`/api/admin/course-sessions/list-with-trainers?courseRunUuid=${encodeURIComponent(courseRunUuid)}`);
        const sessJson = await sessRes.json();
        if (cancelled) return;
        if (!sessJson.success) return;

        const all: any[] = sessJson.data?.sessions ?? [];
        // Sort chronologically so the schedule reads top-to-bottom in course order.
        const sorted = [...all].sort((a, b) => {
          const da = sessionDateToIso(a.startDate);
          const db = sessionDateToIso(b.startDate);
          if (da !== db) return da < db ? -1 : 1;
          const ta = sessionTimeToHHmm(a.startTime);
          const tb = sessionTimeToHHmm(b.startTime);
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });

        const buildEntries = (ss: any[]): ScheduleEntry[] =>
          ss.slice(0, 10).map(s => ({
            id: crypto.randomUUID(),
            label: modeToScheduleLabel(s.modeOfTraining),
            startTime: sessionTimeToHHmm(s.startTime),
            endTime:   sessionTimeToHHmm(s.endTime),
            done: false,
          }));

        // Sessions for the currently-viewed day.
        const thisDay = sorted.filter(s => sessionDateToIso(s.startDate) === selectedDate);
        // If nothing matches (e.g. single-day block where the session dates
        // weren't stored against the same day), use the full list so the block
        // still fills rather than showing "No sessions yet".
        const thisEntries = thisDay.length > 0 ? buildEntries(thisDay) : buildEntries(sorted);

        if (cancelled) return;
        if (thisEntries.length > 0) onReplaceScheduleEntries(thisEntries);

        // Fill course title if still blank.
        const resolvedTitle = classRun.courseTitle.trim() || lookJson.data.title || '';
        if (!cancelled && !classRun.courseTitle.trim() && lookJson.data.title) {
          onClassChange('courseTitle', lookJson.data.title);
        }

        // Propagate per-date schedules to the other linked-day blocks in the
        // same date range. Each day's block stores its own scheduleEntries, so
        // we save each one directly to the masterlist endpoint. Blocks that
        // already have entries are left alone.
        if (!cancelled && classRun.classDate?.includes('~')) {
          const normTitle = (s: string) => (s || '').replace(/^Day\s+\d+\s*[-–—]\s*/i, '').toLowerCase().trim();
          const baseTitle = normTitle(resolvedTitle);
          const otherDates = expandDateRange(classRun.classDate).filter(d => d !== selectedDate);

          for (const otherDate of otherDates) {
            if (cancelled) break;
            const otherDaySessions = sorted.filter(s => sessionDateToIso(s.startDate) === otherDate);
            if (otherDaySessions.length === 0) continue;
            const otherEntries = buildEntries(otherDaySessions);

            try {
              const res  = await fetch(`/api/admin/masterlist?date=${otherDate}&class_type=${activeTab}`);
              const json = await res.json();
              if (!json.success) continue;
              const linked = rowsToClasses(json.data).find(
                c => c.classDate === classRun.classDate && normTitle(c.courseTitle) === baseTitle,
              );
              if (!linked) continue;
              if (linked.scheduleEntries.length > 0) continue;

              const synced: ClassRun = {
                ...linked,
                scheduleEntries: otherEntries,
                courseRunNo: run,
                courseTitle: linked.courseTitle || resolvedTitle,
              };
              await fetch('/api/admin/masterlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: classToRows(synced, activeTab, otherDate) }),
              });
            } catch (e) {
              console.error('[masterlist] linked-day auto-fill error:', e);
            }
          }
        }
      } catch (err) {
        console.error('[masterlist] auto-fetch sessions error:', err);
      } finally {
        if (!cancelled) setFetchingSessions(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classRun.courseRunNo, selectedDate]);

  return (
    <div className="mb-8 overflow-x-clip">
      {confirmDeleteClass && (
        <ConfirmDialog
          message={
            classRun.classDate?.includes('~')
              ? `Delete this class and all its linked days (${classRun.classDate})?`
              : 'Delete this entire class and all its trainee rows?'
          }
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
            {fetchingSessions && (
              <span className={`text-[10px] animate-pulse opacity-70 ${classRun.headerColor.text}`}>
                Fetching sessions…
              </span>
            )}
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
              onClick={handleImportTrainees}
              disabled={importing}
              title="Import trainees from enrollments"
              className={`p-1.5 rounded hover:bg-black/20 transition-colors opacity-70 hover:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed ${classRun.headerColor.text}`}
            >
              {importing ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v6m-3-3h6" />
                </svg>
              )}
            </button>
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
            {classRun.trainees.map((t, idx) => {
              const isDup = duplicateRowIds.has(t.id);
              const isSearchHit = !!searchQuery && traineeMatchesQuery(t, searchQuery);
              return (
              <tr
                key={t.id}
                className={`border-b border-default last:border-b-0 transition-colors ${
                  isDup
                    ? 'bg-red-50/70 dark:bg-red-900/15'
                    : t.cancelled
                    ? 'bg-gray-100 dark:bg-gray-800/60 opacity-50'
                    : isSearchHit
                    ? 'bg-yellow-100/80 dark:bg-yellow-900/30'
                    : 'hover:bg-surface-hover/20'
                }`}
              >
                {/* No. */}
                <td className="px-2 py-1 text-xs text-center border-r border-default select-none">
                  {isDup ? (
                    <span title="Duplicate — same name, email or contact no. already exists in this class" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold cursor-default">!</span>
                  ) : (
                    <span className="text-on-surface-secondary">{idx + 1}</span>
                  )}
                </td>
                {(COLUMNS.filter(c => c.key !== '_no' && c.key !== '_cancelled' && c.key !== '_actions') as typeof COLUMNS).map(col =>
                  col.key === 'date' ? (
                    <InputCell
                      key={col.key}
                      value={t.date}
                      onChange={v => onTraineeChange(t.id, 'date', v)}
                      onPasteGrid={text => onPasteTraineeGrid(t.id, 'date', text)}
                      placeholder="DD/MM/YYYY"
                      onFillAll={v => onFillAll('date', v)}
                    />
                  ) : col.key === 'grant' ? (
                    <SelectCell
                      key={col.key}
                      value={t.grant}
                      onChange={v => onTraineeChange(t.id, 'grant', v)}
                      onPasteGrid={text => onPasteTraineeGrid(t.id, 'grant', text)}
                      options={['Yes', 'No']}
                    />
                  ) : (col.key === 'name' || col.key === 'email' || col.key === 'contact_no') ? (
                    <LookupCell
                      key={col.key}
                      value={t[col.key]}
                      placeholder={col.placeholder}
                      onChange={v => onTraineeChange(t.id, col.key as TraineeField, v)}
                      onPasteGrid={text => onPasteTraineeGrid(t.id, col.key as TraineeField, text)}
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
                  ) : (col.key === 'invoice_no' || col.key === 'payment_mode') ? (
                    <InputCell
                      key={col.key}
                      value={t[col.key as TraineeField] as string}
                      onChange={v => onTraineeChange(t.id, col.key as TraineeField, v)}
                      onPasteGrid={text => onPasteTraineeGrid(t.id, col.key as TraineeField, text)}
                      placeholder={col.placeholder}
                      align={col.align}
                      digitsOnly={col.digitsOnly}
                      bgColor={col.key === 'invoice_no' ? t.invoice_no_color : t.payment_mode_color}
                      onBgColorChange={c => onTraineeChange(
                        t.id,
                        (col.key === 'invoice_no' ? 'invoice_no_color' : 'payment_mode_color') as TraineeField,
                        c,
                      )}
                    />
                  ) : (
                    <InputCell
                      key={col.key}
                      value={t[col.key as TraineeField] as string}
                      onChange={v => onTraineeChange(t.id, col.key as TraineeField, v)}
                      onPasteGrid={text => onPasteTraineeGrid(t.id, col.key as TraineeField, text)}
                      onFillAll={col.key !== 'payment_status' && col.key !== 'magento_order_no' ? v => onFillAll(col.key as TraineeField, v) : undefined}
                      placeholder={col.placeholder}
                      align={col.align}
                      digitsOnly={col.digitsOnly}
                    />
                  )
                )}
                {/* Cancelled / Withdrawn toggle */}
                <td className="px-2 py-1 text-center border-r border-default">
                  <input
                    type="checkbox"
                    checked={t.cancelled}
                    onChange={e => onTraineeChange(t.id, 'cancelled', e.target.checked)}
                    title={t.cancelled ? 'Restore — mark as active' : 'Mark as cancelled / withdrawn'}
                    className="w-3.5 h-3.5 cursor-pointer accent-gray-500"
                  />
                </td>
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
              );
            })}
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

      {/* ── Footer: trainer info (left) + class schedule (right) ──────────────── */}
      <div className="border border-default border-t-0 rounded-b-lg flex">

        {/* Trainer info */}
        <div className="flex-1 bg-surface-elevated/40 px-5 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-on-surface-secondary">
            <span className="font-medium w-36 shrink-0">No. of Participants:</span>
            <span className="font-semibold text-on-surface">{classRun.trainees.length}</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
            <span className="font-medium w-36 shrink-0">Trainer:</span>
            <TrainerLookupInput
              value={classRun.trainer}
              placeholder="Trainer Name"
              onChange={v => onClassChange('trainer', v)}
              onAutofill={(name, email) => { onClassChange('trainer', name); onClassChange('trainerEmail', email); }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
            <span className="font-medium w-36 shrink-0">Trainer Email:</span>
            <TrainerLookupInput
              value={classRun.trainerEmail}
              placeholder="trainer@example.com"
              onChange={v => onClassChange('trainerEmail', v)}
              onAutofill={(name, email) => { onClassChange('trainer', name); onClassChange('trainerEmail', email); }}
            />
          </label>
          {activeTab === 'external' && (
            <div className="mt-1 pt-2 border-t border-default">
              <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
                <span className="font-medium w-36 shrink-0">Location:</span>
                <input
                  value={classRun.venue}
                  onChange={e => onClassChange('venue', e.target.value)}
                  placeholder="Venue / Location"
                  className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 flex-1 min-w-0"
                />
              </label>
            </div>
          )}
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
              <label className="flex items-center gap-2 text-xs text-on-surface-secondary flex-1 min-w-0">
                <span className="font-medium shrink-0">Meeting ID:</span>
                <input
                  value={classRun.meetingId}
                  onChange={e => onClassChange('meetingId', e.target.value)}
                  placeholder="Meeting ID"
                  className="text-on-surface bg-transparent border-b border-dashed border-default focus:outline-none focus:border-primary placeholder:text-on-surface-secondary/30 min-w-0 flex-1"
                />
              </label>
            </div>
          )}
          <div className="mt-1 pt-2 border-t border-default">
            <textarea
              value={classRun.notes}
              onChange={e => onClassChange('notes', e.target.value.slice(0, 1000))}
              placeholder="Notes (optional)…"
              rows={2}
              maxLength={1000}
              className="w-full text-xs bg-transparent resize-none focus:outline-none placeholder:text-on-surface-secondary/30 text-on-surface leading-relaxed"
            />
          </div>
        </div>

        {/* Class Schedule — far right */}
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
        classDate: row.class_date ?? '',
        venue: row.venue ?? '',
        notes: row.notes ?? '',
        calendarEventId: row.calendar_event_id ?? '',
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
      // Priority: class_date range > entry_date > list_date.
      // When entry_date is a raw machine-generated ISO single date (YYYY-MM-DD or
      // datetime with T), skip it and prefer the class_date range so multi-day classes
      // show the full span (e.g. 20/04/2026 – 21/04/2026) on every row.
      // User-edited display values (containing / or free text) are respected as-is.
      // Priority for the Date cell:
      //   1. User-edited display value in entry_date (contains / or is free text)
      //   2. class_date range  (e.g. 20/04/2026 – 21/04/2026 for multi-day courses)
      //   3. list_date         (the actual class date for single-day courses)
      // Raw machine-generated ISO dates in entry_date (YYYY-MM-DD or T…Z) are skipped
      // because they often reflect an enrollment/sync date, not the class date.
      date: (() => {
        const rawEntry = (row.entry_date ?? '').trim();
        const rawClass = (row.class_date ?? '').trim();
        const rawList  = (row.list_date  ?? '').trim();

        if (!rawEntry) return toDisplayDate(rawClass) || toDisplayDate(rawList);

        // Comma-separated ISO dates: actual class days from calendar sync — most accurate,
        // use entry_date (e.g. "19/04/2026, 22/04/2026 – 26/04/2026") over the rough span
        if (rawEntry.includes(',')) return toDisplayDate(rawEntry) || toDisplayDate(rawList);

        // ISO range in entry_date — use directly
        if (rawEntry.includes('~')) return toDisplayDate(rawEntry);

        // Single ISO date or datetime — may be an enrollment/sync date, not the class date;
        // prefer class_date range (or list_date for single-day classes)
        if (rawEntry.includes('T') || ISO_DATE_RE.test(rawEntry)) {
          return toDisplayDate(rawClass) || toDisplayDate(rawList);
        }

        // User-edited display value (contains / or free text) — respect as-is
        return rawEntry;
      })(),
      grant: row.grant ?? '',
      invoice_no: row.invoice_no ?? '',
      payment_mode: row.payment_mode ?? '',
      course_fee: row.course_fee ?? '',
      payment_status: row.payment_status ?? '',
      followup_by: row.followup_by ?? '',
      remark: row.remark ?? '',
      cancelled: row.cancelled ?? false,
      invoice_no_color: (row.invoice_no_color ?? '') as CellBgColor,
      payment_mode_color: (row.payment_mode_color ?? '') as CellBgColor,
    });
  }
  const classes = Array.from(map.values());

  // UI-level dedup: if two class blocks share the same normalised course title,
  // keep only the one with real trainee data (has name/email). This guards
  // against duplicate calendar events that slipped past the DB constraint.
  const seenTitles = new Map<string, ClassRun>();
  const deduped: ClassRun[] = [];
  for (const cr of classes) {
    const key = (cr.courseTitle || '').toLowerCase().trim();
    if (!seenTitles.has(key)) {
      seenTitles.set(key, cr);
      deduped.push(cr);
    } else {
      // Keep whichever block has real trainee data
      const existing = seenTitles.get(key)!;
      const existingHasData = existing.trainees.some(t => t.name.trim() || t.email.trim());
      const newHasData = cr.trainees.some(t => t.name.trim() || t.email.trim());
      if (newHasData && !existingHasData) {
        const idx = deduped.indexOf(existing);
        deduped[idx] = cr;
        seenTitles.set(key, cr);
      }
    }
  }
  return deduped;
}

// ─── Helpers: convert ClassRun → DB rows ─────────────────────────────────────

function classToRows(cr: ClassRun, classType: ClassTab, listDate: string): Record<string, any>[] {
  return cr.trainees.map((t, idx) => ({
    class_id: cr.id,
    class_type: classType,
    list_date: listDate || null,
    course_title: cr.courseTitle || null,
    course_run_no: cr.courseRunNo || null,
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
    invoice_no_color: t.invoice_no_color || null,
    payment_mode_color: t.payment_mode_color || null,
    course_fee: t.course_fee || null,
    payment_status: t.payment_status || null,
    followup_by: t.followup_by || null,
    remark: t.remark || null,
    cancelled: t.cancelled ?? false,
    schedule_entries: JSON.stringify(cr.scheduleEntries ?? []),
    class_date: cr.classDate || null,
    venue: cr.venue || null,
    notes: cr.notes || null,
    // Preserve calendar_event_id on the first row only (unique index allows one per class)
    calendar_event_id: idx === 0 ? (cr.calendarEventId || null) : null,
  }));
}

// ─── Expand a DateRangeCell value to individual ISO date strings ──────────────

function expandDateRange(value: string): string[] {
  if (!value) return [];
  if (value.includes('~')) {
    const [start, end] = value.split('~');
    const dates: string[] = [];
    const d = new Date(start);
    const endDate = new Date(end);
    while (d <= endDate) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }
  return [value];
}

// ─── Main view ────────────────────────────────────────────────────────────────

type TabData = Record<ClassTab, ClassRun[]>;

const emptyTabData = (): TabData => ({
  virtual: [], evening: [], external: [], woodsSquare: [], reschedule: [], cancelled: [], bukitTimah: [],
});

const traineeMatchesQuery = (t: TraineeRow, q: string): boolean => {
  if (!q) return true;
  return [
    t.name, t.email, t.contact_no, t.magento_order_no,
    t.invoice_no, t.payment_mode, t.comments, t.remark,
    t.followup_by, t.date,
  ].some(v => (v || '').toLowerCase().includes(q));
};

const classMatchesQuery = (cr: ClassRun, q: string): boolean => {
  if (!q) return true;
  const classFields = [
    cr.courseTitle, cr.courseRunNo, cr.trainer, cr.trainerEmail,
    cr.classDate, cr.venue, cr.notes,
  ];
  if (classFields.some(v => (v || '').toLowerCase().includes(q))) return true;
  return cr.trainees.some(t => traineeMatchesQuery(t, q));
};

const MasterListView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<ClassTab>('virtual');
  const [tabData, setTabData] = useState<TabData>(emptyTabData);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const syncedMonths = useRef<Set<string>>(new Set());

  const normalisedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalisedQuery.length > 0;

  const filteredTabData = useMemo(() => {
    if (!isSearching) return tabData;
    const next = emptyTabData();
    (Object.keys(tabData) as ClassTab[]).forEach(key => {
      next[key] = tabData[key].filter(cr => classMatchesQuery(cr, normalisedQuery));
    });
    return next;
  }, [tabData, normalisedQuery, isSearching]);

  // Note: search no longer filters the classes shown in the active tab —
  // navigation happens via the suggestions dropdown. `filteredTabData` is
  // still computed to power that dropdown and the trainee-row highlights.

  // Suggestions panel — shown when search matches span 2+ tabs so the user
  // can pick which class to jump to. Rendered via a portal at fixed position
  // so the parent Card's `overflow-hidden` doesn't clip it.
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const suggestionsPanelRef = useRef<HTMLDivElement>(null);
  const [suggestionsPos, setSuggestionsPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => { setSuggestionsOpen(true); }, [normalisedQuery]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchBoxRef.current && searchBoxRef.current.contains(target)) return;
      if (suggestionsPanelRef.current && suggestionsPanelRef.current.contains(target)) return;
      setSuggestionsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [suggestionsOpen]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const update = () => {
      const el = searchBoxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSuggestionsPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [suggestionsOpen, normalisedQuery]);

  const tabsWithMatchCount = useMemo(() => {
    if (!isSearching) return 0;
    let count = 0;
    TABS.forEach(t => { if (filteredTabData[t.key].length > 0) count++; });
    return count;
  }, [filteredTabData, isSearching]);

  const totalMatchCount = useMemo(() => {
    if (!isSearching) return 0;
    let total = 0;
    TABS.forEach(t => { total += filteredTabData[t.key].length; });
    return total;
  }, [filteredTabData, isSearching]);

  const showSuggestionsList = isSearching && suggestionsOpen && totalMatchCount > 0;

  // Switching tabs triggers a re-fetch (loading=true), so the target class
  // block isn't in the DOM immediately. Stash the desired class id and let an
  // effect scroll once the new tab has rendered. The scrollTrigger counter
  // forces the effect to re-run even when the user picks a class on the
  // tab that's already active (where setActiveTab is a no-op).
  const pendingScrollIdRef = useRef<string | null>(null);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [highlightedClassId, setHighlightedClassId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const id = pendingScrollIdRef.current;
    if (!id) return;
    // Wait one frame for the new tab's class blocks to lay out, then scroll.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`masterlist-class-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pendingScrollIdRef.current = null;
      setHighlightedClassId(id);
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, activeTab, tabData, scrollTrigger]);

  // Clear the flash highlight after a couple of seconds.
  useEffect(() => {
    if (!highlightedClassId) return;
    const timer = setTimeout(() => setHighlightedClassId(null), 1800);
    return () => clearTimeout(timer);
  }, [highlightedClassId]);

  const handleJumpToClass = (tab: ClassTab, classId: string) => {
    pendingScrollIdRef.current = classId;
    setSuggestionsOpen(false);
    setActiveTab(tab);
    setScrollTrigger(n => n + 1);
  };

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

  const fetchAllTabs = useCallback(async (date: string) => {
    if (!date) { setTabData(emptyTabData()); return; }
    setLoading(true);
    try {
      const results = await Promise.all(
        TABS.map(async tab => {
          try {
            const res = await fetch(`/api/admin/masterlist?date=${date}&class_type=${tab.key}`);
            const json = await res.json();
            return { key: tab.key, data: json.success ? rowsToClasses(json.data) : [] as ClassRun[] };
          } catch {
            return { key: tab.key, data: [] as ClassRun[] };
          }
        }),
      );
      const next = emptyTabData();
      results.forEach(r => { next[r.key as ClassTab] = r.data; });
      setTabData(next);
    } catch (e) {
      console.error('[masterlist] fetchAllTabs error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const prevDateRef = useRef<string>('');

  useEffect(() => {
    const dateChanged = selectedDate !== prevDateRef.current;
    prevDateRef.current = selectedDate;

    if (!selectedDate) { setTabData(emptyTabData()); return; }

    if (dateChanged) {
      const snapDate = selectedDate;
      const willSync = !syncedMonths.current.has('done');

      // Mark syncing BEFORE any fetch so the empty state immediately shows the
      // "Syncing from Google Calendar…" indicator rather than "No classes yet"
      if (willSync) {
        syncedMonths.current.add('done');
        setSyncing(true);
      }

      // Fetch existing masterlist data for all tabs, then kick off calendar sync
      fetchAllTabs(snapDate).then(() => {
        if (!willSync) return;

        fetch('/api/admin/masterlist-calendar-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
          .then(r => r.json())
          .then(json => {
            if (json.success && json.added > 0) {
              // New classes were added from calendar — re-fetch all tabs to show them
              return fetchAllTabs(snapDate);
            }
          })
          .catch(e => console.error('[masterlist] calendar sync error:', e))
          .finally(() => setSyncing(false));
      });
    } else {
      // Only the active tab changed — fetch just that tab
      fetchClasses(selectedDate, activeTab);
    }
  }, [selectedDate, activeTab, fetchClasses, fetchAllTabs]);

  // ── Auto-save a class block (debounced 800 ms) ────────────────────────────

  const saveClass = useCallback(async (cr: ClassRun, tab: ClassTab, date: string) => {
    setSaving(prev => ({ ...prev, [cr.id]: true }));
    try {
      // Save the current day
      await fetch('/api/admin/masterlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: classToRows(cr, tab, date) }),
      });

      // Propagate to linked days in the same date range.
      // Match by BOTH classDate AND normalised courseTitle so we never accidentally
      // overwrite a different course that happens to share the same date range (e.g. PL-900).
      if (cr.classDate?.includes('~')) {
        const normTitle = (s: string) =>
          (s || '').replace(/^Day\s+\d+\s*[-–—]\s*/i, '').toLowerCase().trim();
        const baseTitle = normTitle(cr.courseTitle);
        const sortedDates = expandDateRange(cr.classDate).sort();

        for (const otherDate of sortedDates.filter(d => d !== date)) {
          try {
            const res  = await fetch(`/api/admin/masterlist?date=${otherDate}&class_type=${tab}`);
            const json = await res.json();
            if (!json.success) continue;
            // Only update an already-existing copy of THIS specific course
            const existing = rowsToClasses(json.data).find(
              c => c.classDate === cr.classDate && normTitle(c.courseTitle) === baseTitle,
            );
            if (!existing) continue;
            const synced: ClassRun = {
              ...cr,
              id: existing.id,
              // Preserve the other day's calendar event ID so calendar sync stays deduped
              calendarEventId: existing.calendarEventId || cr.calendarEventId,
              headerColor: existing.headerColor,
              trainees: cr.trainees.map((t, i) => ({
                ...t,
                id: existing.trainees[i]?.id ?? crypto.randomUUID(),
              })),
              // Each day keeps its own class schedule
              scheduleEntries: existing.scheduleEntries,
            };
            await fetch('/api/admin/masterlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: classToRows(synced, tab, otherDate) }),
            });
          } catch (e) {
            console.error('[masterlist] linked-day sync error:', e);
          }
        }
      }
    } catch (e) {
      console.error('[masterlist] save error:', e);
    } finally {
      setSaving(prev => ({ ...prev, [cr.id]: false }));
    }
  }, []);

  const scheduleSave = useCallback((cr: ClassRun, tab: ClassTab, date: string) => {
    clearTimeout(debounceTimers.current[cr.id]);
    debounceTimers.current[cr.id] = setTimeout(() => saveClass(cr, tab, date), 400);
  }, [saveClass]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleCalendarSync = async () => {
    setSyncing(true);
    // Mark as done so the auto-sync on next date change doesn't re-run
    syncedMonths.current.add('done');
    try {
      const res = await fetch('/api/admin/masterlist-calendar-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = await res.json();
      if (json.success) {
        await fetchAllTabs(selectedDate);
      }
    } catch (e) {
      console.error('[masterlist] manual calendar sync error:', e);
    } finally {
      setSyncing(false);
    }
  };

  const handleAddClass = async () => {
    const nc = newClass();
    // Save to DB first, then re-fetch so UI reflects the persisted record
    await saveClass(nc, activeTab, selectedDate);
    fetchClasses(selectedDate, activeTab);
  };

  const handleRemoveClass = async (classId: string) => {
    const cr = tabData[activeTab].find(c => c.id === classId);

    // Cancel any pending debounced save so it doesn't re-create the record after delete
    clearTimeout(debounceTimers.current[classId]);
    delete debounceTimers.current[classId];

    // Optimistically remove from UI
    setClasses(prev => prev.filter(c => c.id !== classId));

    try {
      await fetch(`/api/admin/masterlist?class_id=${classId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('[masterlist] delete error:', e);
    }

    // Cascade delete — remove linked copies on all other dates in the range
    if (cr?.classDate?.includes('~')) {
      const otherDates = expandDateRange(cr.classDate).filter(d => d !== selectedDate);
      for (const date of otherDates) {
        try {
          const res = await fetch(`/api/admin/masterlist?date=${date}&class_type=${activeTab}`);
          const json = await res.json();
          if (!json.success) continue;
          const linked = rowsToClasses(json.data).filter(c => c.classDate === cr.classDate);
          for (const lc of linked) {
            clearTimeout(debounceTimers.current[lc.id]);
            delete debounceTimers.current[lc.id];
            await fetch(`/api/admin/masterlist?class_id=${lc.id}`, { method: 'DELETE' });
          }
        } catch (e) {
          console.error('[masterlist] cascade delete error:', e);
        }
      }
    }

    // Re-fetch to confirm UI matches DB (catches any edge cases)
    fetchClasses(selectedDate, activeTab);
  };

  const handleMoveClass = async (classId: string, targetTab: ClassTab) => {
    const cr = tabData[activeTab].find(c => c.id === classId);
    if (!cr) return;
    const sourceTab = activeTab;
    setLoading(true);
    try {
      // Move the current day
      await fetch(`/api/admin/masterlist?class_id=${classId}`, { method: 'DELETE' });
      await fetch('/api/admin/masterlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: classToRows(cr, targetTab, selectedDate) }),
      });

      // Cascade move — update all linked days in the date range
      if (cr.classDate?.includes('~')) {
        const otherDates = expandDateRange(cr.classDate).filter(d => d !== selectedDate);
        for (const date of otherDates) {
          try {
            const res = await fetch(`/api/admin/masterlist?date=${date}&class_type=${sourceTab}`);
            const json = await res.json();
            if (!json.success) continue;
            const linked = rowsToClasses(json.data).filter(c => c.classDate === cr.classDate);
            for (const lc of linked) {
              await fetch(`/api/admin/masterlist?class_id=${lc.id}`, { method: 'DELETE' });
              await fetch('/api/admin/masterlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: classToRows(lc, targetTab, date) }),
              });
            }
          } catch (e) {
            console.error('[masterlist] cascade move error:', e);
          }
        }
      }
    } catch (e) {
      console.error('[masterlist] move error:', e);
    }
    // Switch to target tab and re-fetch both tabs from DB
    setActiveTab(targetTab);
    await Promise.all([
      fetchClasses(selectedDate, sourceTab),
      fetchClasses(selectedDate, targetTab),
    ]);
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
      const updated = prev.map(cr => {
        if (cr.id !== classId) return cr;
        // Inherit date from existing rows, or default to selectedDate as DD/MM/YYYY
        const entryDate = cr.trainees.find(t => t.date)?.date || fmtDisplay(selectedDate);
        return { ...cr, trainees: [...cr.trainees, { ...newTrainee(), date: entryDate }] };
      });
      const cr = updated.find(c => c.id === classId);
      if (cr) scheduleSave(cr, activeTab, selectedDate);
      return updated;
    });
  };

  const handleBulkAddTrainees = (classId: string, incoming: { name: string; contact_no: string; email: string }[]) => {
    setClasses(prev => {
      const updated = prev.map(cr => {
        if (cr.id !== classId) return cr;

        // Capture the date from any existing row (including the placeholder) before
        // filtering so it can be inherited by all newly imported trainees.
        const entryDate = cr.trainees.find(t => t.date)?.date || '';

        // Drop blank placeholder rows (empty name + empty email) before merging
        // real learner data so they don't linger alongside the imported rows.
        const existingReal = cr.trainees.filter(t => t.name.trim() || t.email.trim());

        const existingEmails = new Set(existingReal.map(t => t.email.toLowerCase().trim()).filter(Boolean));
        const existingNames  = new Set(existingReal.map(t => t.name.toLowerCase().trim()).filter(Boolean));

        const toAdd = incoming.filter(({ email, name }) => {
          if (email && existingEmails.has(email.toLowerCase().trim())) return false;
          if (!email && name && existingNames.has(name.toLowerCase().trim())) return false;
          return true;
        });

        if (toAdd.length === 0) {
          // No new learners — restore placeholder if list would be empty
          return existingReal.length > 0 ? { ...cr, trainees: existingReal } : cr;
        }

        const newTrainees = toAdd.map(({ name, contact_no, email }) => ({
          ...newTrainee(),
          name,
          contact_no,
          email,
          date: entryDate,
        }));

        return { ...cr, trainees: [...existingReal, ...newTrainees] };
      });
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

  const handleTraineeChange = (classId: string, traineeId: string, field: TraineeField, value: string | boolean) => {
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

  const handlePasteTraineeGrid = (classId: string, traineeId: string, startField: TraineeField, text: string) => {
    const grid = parseClipboardGrid(text);
    if (grid.length === 0) return;

    const startCol = PASTE_TRAINEE_FIELDS.indexOf(startField);
    if (startCol < 0) return;

    setClasses(prev => {
      const updated = prev.map(cr => {
        if (cr.id !== classId) return cr;

        const startRow = cr.trainees.findIndex(t => t.id === traineeId);
        if (startRow < 0) return cr;

        const trainees = [...cr.trainees];
        const inheritedDate = trainees.find(t => t.date)?.date || fmtDisplay(selectedDate);

        while (trainees.length < startRow + grid.length) {
          trainees.push({ ...newTrainee(), date: inheritedDate });
        }

        grid.forEach((cells, rowOffset) => {
          const rowIndex = startRow + rowOffset;
          let trainee = trainees[rowIndex];

          cells.forEach((cellValue, colOffset) => {
            const field = PASTE_TRAINEE_FIELDS[startCol + colOffset];
            if (!field) return;
            trainee = {
              ...trainee,
              [field]: normalisePastedTraineeValue(field, cellValue),
            };
          });

          trainees[rowIndex] = trainee;
        });

        return { ...cr, trainees };
      });

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

  const handleReplaceScheduleEntries = (classId: string, entries: ScheduleEntry[]) => {
    setClasses(prev => {
      const updated = prev.map(cr => cr.id === classId
        ? { ...cr, scheduleEntries: entries }
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const base = selectedDate ? new Date(selectedDate) : new Date();
                  base.setDate(base.getDate() - 1);
                  setSelectedDate(base.toISOString().slice(0, 10));
                }}
                className="flex items-center justify-center w-9 h-[42px] rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface-secondary transition-colors text-sm font-bold shrink-0"
                title="Previous day"
              >
                ‹
              </button>
              <DateRangeCell
                value={selectedDate}
                onChange={setSelectedDate}
                singleDate
                standalone
              />
              <button
                onClick={() => {
                  const base = selectedDate ? new Date(selectedDate) : new Date();
                  base.setDate(base.getDate() + 1);
                  setSelectedDate(base.toISOString().slice(0, 10));
                }}
                className="flex items-center justify-center w-9 h-[42px] rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface-secondary transition-colors text-sm font-bold shrink-0"
                title="Next day"
              >
                ›
              </button>
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

          <div className="flex flex-col gap-1.5 w-full sm:flex-1 sm:max-w-md sm:ml-auto">
            <label className="text-xs font-medium text-on-surface-secondary uppercase tracking-wide">
              Search
            </label>
            <div ref={searchBoxRef} className="relative">
              <Icon
                name={IconName.Search}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => setSuggestionsOpen(true)}
                placeholder="Search by course title or course run"
                className="w-full h-[42px] pl-9 pr-9 rounded-lg border border-default bg-surface text-sm text-on-surface placeholder:text-on-surface-secondary/60 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {isSearching && (
                <button
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-hover text-on-surface-secondary"
                >
                  <Icon name={IconName.Close} className="w-3.5 h-3.5" />
                </button>
              )}

              {showSuggestionsList && typeof window !== 'undefined' && createPortal(
                <div
                  ref={suggestionsPanelRef}
                  style={{
                    position: 'fixed',
                    top: suggestionsPos.top,
                    left: suggestionsPos.left,
                    width: suggestionsPos.width,
                    zIndex: 1000,
                  }}
                  className="max-h-80 overflow-y-auto rounded-lg border border-default bg-surface shadow-lg"
                >
                  <div className="px-3 py-1.5 text-[11px] text-on-surface-secondary border-b border-default bg-surface-elevated">
                    {totalMatchCount} {totalMatchCount === 1 ? 'match' : 'matches'}
                    {tabsWithMatchCount > 1 && <> across {tabsWithMatchCount} class types</>}
                    {' '}— click to jump
                  </div>
                  {TABS.filter(t => filteredTabData[t.key].length > 0).map(tab => {
                    const c = TAB_COLORS[tab.key];
                    return (
                      <div key={tab.key}>
                        <div className={`px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${c.badgeBg} ${c.badgeText}`}>
                          {tab.label}
                          <span className="ml-1.5 opacity-70 normal-case">({filteredTabData[tab.key].length})</span>
                        </div>
                        {filteredTabData[tab.key].map(cr => (
                          <button
                            key={cr.id}
                            onClick={() => handleJumpToClass(tab.key, cr.id)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover border-b border-default last:border-b-0 transition-colors"
                          >
                            <div className="font-medium text-on-surface truncate">
                              {cr.courseTitle || '(Untitled course)'}
                            </div>
                            <div className="text-xs text-on-surface-secondary mt-0.5 truncate">
                              {cr.courseRunNo && <>Run {cr.courseRunNo}</>}
                              {cr.courseRunNo && cr.classDate && <> · </>}
                              {cr.classDate}
                              {cr.trainer && <> · {cr.trainer}</>}
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>,
                document.body,
              )}
            </div>
          </div>
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
          const total = tabData[tab.key].length;
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
              {total > 0 && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : `${c.badgeBg} ${c.badgeText}`
                }`}>
                  {total}
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

          <div className="flex items-center gap-2">
            <button
              onClick={handleCalendarSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear and re-import all classes from Google Calendar"
            >
              <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? 'Syncing…' : 'Sync from Calendar'}
            </button>
            <button
              onClick={handleAddClass}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Icon name={IconName.Plus} className="w-4 h-4" />
              Add New Class
            </button>
          </div>
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
              {syncing ? (
                <div className="flex flex-col items-center gap-3 text-on-surface-secondary">
                  <svg className="animate-spin w-8 h-8 text-primary/60" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <div>
                    <p className="font-medium text-on-surface">Syncing from Google Calendar…</p>
                    <p className="text-xs mt-0.5 text-on-surface-secondary">Importing your classes, just a moment</p>
                  </div>
                </div>
              ) : (
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
              )}
            </div>
          </Card>
        ) : (
          classes.map((cr) => (
            <div
              key={cr.id}
              id={`masterlist-class-${cr.id}`}
              className={`scroll-mt-20 transition-shadow duration-500 rounded-lg ${
                highlightedClassId === cr.id
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : ''
              }`}
            >
            <ClassBlock
              classRun={cr}
              activeTab={activeTab}
              selectedDate={selectedDate}
              saving={saving[cr.id] ?? false}
              searchQuery={normalisedQuery}
              onClassChange={(field, value) => handleClassChange(cr.id, field, value)}
              onTraineeChange={(traineeId, field, value) =>
                handleTraineeChange(cr.id, traineeId, field, value)
              }
              onFillAll={(field, value) => handleFillAll(cr.id, field, value)}
              onAddTrainee={() => handleAddTrainee(cr.id)}
              onRemoveTrainee={traineeId => handleRemoveTrainee(cr.id, traineeId)}
              onRemoveClass={() => handleRemoveClass(cr.id)}
              onMoveClass={targetTab => handleMoveClass(cr.id, targetTab)}
              onBulkAddTrainees={trainees => handleBulkAddTrainees(cr.id, trainees)}
              onPasteTraineeGrid={(traineeId, startField, text) =>
                handlePasteTraineeGrid(cr.id, traineeId, startField, text)
              }
              onAddScheduleEntry={() => handleAddScheduleEntry(cr.id)}
              onScheduleEntryChange={(entryId, field, value) =>
                handleScheduleEntryChange(cr.id, entryId, field, value)
              }
              onRemoveScheduleEntry={entryId => handleRemoveScheduleEntry(cr.id, entryId)}
              onReplaceScheduleEntries={entries => handleReplaceScheduleEntries(cr.id, entries)}
            />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MasterListView;
