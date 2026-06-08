import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './Icon';

// Shared dark-themed calendar popup used by the Master List and Payroll.
// value stored as "YYYY-MM-DD" (single) or "YYYY-MM-DD~YYYY-MM-DD" (range).

export const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const CAL_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const fmtDisplay = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const DateRangeCell: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onFillAll?: (v: string) => void;
  singleDate?: boolean;
  standalone?: boolean;
  compact?: boolean;
  placeholder?: string;
  // When empty, show a calendar icon instead of the placeholder text (compact mode).
  emptyAsIcon?: boolean;
}> = ({ value, onChange, onFillAll, singleDate = false, standalone = false, compact = false, placeholder = 'Select Date', emptyAsIcon = false }) => {
  const isRange = value.includes('~');
  const [rawStart, rawEnd] = isRange ? value.split('~') : [value, ''];

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'start' | 'end'>('start');
  const [tempStart, setTempStart] = useState('');
  const [tempEnd, setTempEnd] = useState('');
  const [hover, setHover] = useState('');
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
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
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekDay = new Date(viewYear, viewMonth, 1).getDay();
  const cells: (number | null)[] = [
    ...Array(firstWeekDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const toIso = (d: number) =>
    `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const effectiveEnd = phase === 'end' && hover > tempStart ? hover : tempEnd;

  const prevMonth = () => viewMonth === 0 ? (setViewMonth(11), setViewYear(y => y - 1)) : setViewMonth(m => m - 1);
  const nextMonth = () => viewMonth === 11 ? (setViewMonth(0), setViewYear(y => y + 1)) : setViewMonth(m => m + 1);

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
          const iso = toIso(day);
          const isS = iso === tempStart;
          const isE = iso === effectiveEnd;
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

  const isEmpty = !rawStart && !isMultiDate;
  const triggerButton = (
    <button
      ref={triggerRef}
      onClick={openCalendar}
      aria-label={isEmpty && emptyAsIcon ? (placeholder || 'Select date') : undefined}
      className={`text-xs px-2 py-1 rounded hover:bg-primary/10 transition-colors text-left whitespace-nowrap ${rawStart ? 'text-on-surface' : 'text-on-surface-secondary/30'}`}
    >
      {isEmpty && emptyAsIcon ? (
        <Icon name={IconName.Calendar} className="w-4 h-4 text-on-surface-secondary" />
      ) : (
        displayLabel
      )}
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

export default DateRangeCell;
