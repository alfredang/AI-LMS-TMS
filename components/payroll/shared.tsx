import React from 'react';
import { Icon, IconName } from '../ui/Icon';

// Shared presentational primitives for the Payroll views (Payout List + Non-WSQ
// Classes) so both screens stay visually consistent from a single source.

export const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

// Native <option> elements ignore the parent's theme, so set an explicit
// background/text so the open dropdown popup matches the dark UI (no grey).
export const OPTION_CLASS = 'bg-white text-gray-900 dark:bg-slate-800 dark:text-white';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cls =
    status === 'completed'
      ? 'bg-green-100 text-green-700 ring-green-600/20 dark:bg-green-900/40 dark:text-green-300'
      : status === 'cancelled'
      ? 'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-slate-700 dark:text-gray-300'
      : 'bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300';
  const dot =
    status === 'completed' ? 'bg-green-500' : status === 'cancelled' ? 'bg-gray-400' : 'bg-amber-500';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {STATUS_LABEL[status] || status}
    </span>
  );
};

export type StatTone = 'amber' | 'green' | 'blue' | 'gray' | 'rose' | 'violet';

export const StatCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  iconName: IconName;
  tone?: StatTone;
}> = ({ label, value, sub, iconName, tone = 'blue' }) => {
  const tones = {
    amber: {
      icon: 'bg-amber-100 text-amber-600 ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400',
      value: 'text-amber-700 dark:text-amber-300',
      glow: 'from-amber-500/[0.10]',
    },
    green: {
      icon: 'bg-green-100 text-green-600 ring-green-500/20 dark:bg-green-500/15 dark:text-green-400',
      value: 'text-green-700 dark:text-green-300',
      glow: 'from-green-500/[0.10]',
    },
    blue: {
      icon: 'bg-sky-100 text-sky-600 ring-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400',
      value: 'text-sky-700 dark:text-sky-300',
      glow: 'from-sky-500/[0.10]',
    },
    rose: {
      icon: 'bg-rose-100 text-rose-600 ring-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400',
      value: 'text-rose-700 dark:text-rose-300',
      glow: 'from-rose-500/[0.10]',
    },
    violet: {
      icon: 'bg-violet-100 text-violet-600 ring-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400',
      value: 'text-violet-700 dark:text-violet-300',
      glow: 'from-violet-500/[0.12]',
    },
    gray: {
      icon: 'bg-gray-100 text-gray-500 ring-gray-400/20 dark:bg-slate-600/30 dark:text-gray-400',
      value: 'text-gray-600 dark:text-gray-300',
      glow: 'from-gray-500/[0.06]',
    },
  }[tone];
  return (
    <div className={`relative overflow-hidden rounded-xl border border-default bg-gradient-to-br ${tones.glow} to-transparent bg-white dark:bg-slate-800/80 p-4 shadow-sm transition-shadow hover:shadow-md`}>
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-inset ${tones.icon}`}>
          <Icon name={iconName} className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-semibold">{label}</div>
          <div className={`text-2xl font-bold leading-tight truncate tabular-nums ${tones.value}`} title={value}>{value}</div>
          {sub && <div className="text-[11px] text-on-surface-secondary mt-0.5">{sub}</div>}
        </div>
      </div>
      <Icon name={iconName} className="absolute -right-3 -bottom-3 w-20 h-20 opacity-[0.04] pointer-events-none" />
    </div>
  );
};

// Accent for non-WSQ (manually-added) classes. Amber row tint + left stripe +
// badge. Note amber is also the "pending" status color, so a pending non-WSQ
// row reads amber-on-amber — kept per preference; swap the values here to
// recolor every non-WSQ marker at once.
export const NON_WSQ_ROW = 'bg-amber-50 dark:bg-amber-900/20';
export const NON_WSQ_ROW_HOVER = 'hover:bg-amber-100 dark:hover:bg-amber-900/30';
export const NON_WSQ_ACCENT = 'border-amber-400 dark:border-amber-500/70';

// "NON-WSQ" pill. Pass children to show a count, e.g. <NonWsqTag>2 Non-WSQ</NonWsqTag>.
export const NonWsqTag: React.FC<{ children?: React.ReactNode; title?: string }> = ({ children, title }) => (
  <span
    title={title}
    className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-900/40 dark:text-amber-300"
  >
    {children ?? 'Non-WSQ'}
  </span>
);

export const LoadingRow: React.FC<{ colSpan: number; label?: string }> = ({ colSpan, label = 'Loading…' }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-16">
      <div className="flex flex-col items-center justify-center gap-3 text-on-surface-secondary">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        </div>
        <p className="text-sm font-medium">{label}</p>
      </div>
    </td>
  </tr>
);
