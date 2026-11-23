import React, { useEffect, useState } from 'react';

/**
 * Charts for Receivables Reconciliation.
 *
 * - OverdueSummary: the headline overdue total + one 100% bar of what needs to happen to it,
 *   each part labelled directly underneath (amount, share, invoices).
 * - SourceDonut: the overdue by source, largest slice from 12 o'clock, legend with values.
 * - SourceStatusBars: each source as one bar split by what needs to happen.
 *
 * Colours: the dataviz reference categorical palette in its fixed slot order for sources (light /
 * dark steps), and status steps for the "what needs to happen" groups. Every coloured mark also has
 * a text label, so colour never carries meaning alone. Every clickable mark is a real button.
 */

export type ChartSourceKey = 'grn' | 'sfc_ca' | 'sfc_tc' | 'company_tc' | 'individual_tc' | 'other';
export type StatusGroup = 'action' | 'check' | 'waiting' | 'owes' | 'credited';

const SOURCE_COLOR: Record<ChartSourceKey, [light: string, dark: string]> = {
  grn: ['#2a78d6', '#3987e5'],
  sfc_ca: ['#eb6834', '#d95926'],
  sfc_tc: ['#1baf7a', '#199e70'],
  company_tc: ['#eda100', '#c98500'],
  individual_tc: ['#e87ba4', '#d55181'],
  other: ['#008300', '#008300'],
};

export const STATUS_GROUPS: Array<{ key: StatusGroup; label: string; hint: string; color: [string, string] }> = [
  { key: 'action', label: 'Action needed', hint: 'TPG paid but not received, wrong invoice, or cancelled', color: ['#d03b3b', '#e05252'] },
  { key: 'check', label: 'Needs checking', hint: 'No grant / claim found in the LMS', color: ['#e9a100', '#fab219'] },
  // Violet, not blue: blue already means "SSG Grant" in the source donut.
  { key: 'waiting', label: 'Waiting for TPG', hint: 'TPG has not paid yet', color: ['#6250d6', '#9085e9'] },
  { key: 'owes', label: 'Customer owes', hint: 'Company / learner to pay the TC', color: ['#a8a7a1', '#6b6a64'] },
  { key: 'credited', label: 'Credit note issued', hint: 'A QuickBooks credit note already covers it', color: ['#0ca30c', '#0ca30c'] },
];

export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const check = () => setDark(el.classList.contains('dark') || el.getAttribute('data-theme') === 'dark');
    check();
    const obs = new MutationObserver(check);
    obs.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export const sourceColor = (key: ChartSourceKey, dark: boolean) => SOURCE_COLOR[key][dark ? 1 : 0];
const groupColor = (key: StatusGroup, dark: boolean) => STATUS_GROUPS.find((g) => g.key === key)!.color[dark ? 1 : 0];

export const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-SG')}`;
const pct = (n: number, total: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—');
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

interface Slice<K extends string> {
  key: K;
  label: string;
  amount: number;
  count: number;
}

/** Card header used by every chart card, so they line up. */
export const ChartCardHeader: React.FC<{ title: string; hint?: string; children?: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 mb-5">
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
    {children}
  </div>
);

/** Headline total + what needs to happen to it. */
export const OverdueSummary: React.FC<{
  groups: Array<Slice<StatusGroup>>;
  total: number;
  invoiceCount: number;
  active?: StatusGroup;
  onSelect: (key: StatusGroup) => void;
}> = ({ groups, total, invoiceCount, active, onSelect }) => {
  const dark = useIsDarkTheme();
  const [hover, setHover] = useState<StatusGroup | null>(null);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const shown = STATUS_GROUPS.filter((m) => (byKey.get(m.key)?.amount ?? 0) > 0);
  const lit = hover ?? active ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr] gap-6 lg:gap-10 items-center">
      <div>
        <div className="text-sm text-muted">Overdue in QuickBooks</div>
        <div className="text-4xl font-bold tracking-tight tabular-nums text-on-surface mt-1">{money0(total)}</div>
        <div className="text-sm text-muted mt-1">{invoiceCount.toLocaleString('en-SG')} invoices</div>
      </div>

      <div>
        <div className="flex h-3.5 w-full gap-[2px]" aria-hidden="true">
          {shown.map((m, i) => {
            const g = byKey.get(m.key)!;
            return (
              <div
                key={m.key}
                className={`h-full transition-opacity duration-200 motion-reduce:transition-none ${i === 0 ? 'rounded-l-md' : ''} ${i === shown.length - 1 ? 'rounded-r-md' : ''}`}
                style={{ width: `${(g.amount / total) * 100}%`, minWidth: 3, background: groupColor(m.key, dark), opacity: lit && lit !== m.key ? 0.3 : 1 }}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 mt-4">
          {STATUS_GROUPS.map((m) => {
            const g = byKey.get(m.key);
            const isActive = active === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onSelect(m.key)}
                onMouseEnter={() => setHover(m.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(m.key)}
                onBlur={() => setHover(null)}
                aria-pressed={isActive}
                className={`group text-left rounded-lg border px-3.5 py-3 cursor-pointer transition-colors duration-200 motion-reduce:transition-none ${FOCUS} ${
                  isActive
                    ? 'border-strong bg-surface-hover'
                    : 'border-default hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-on-surface-secondary">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: groupColor(m.key, dark) }} aria-hidden="true" />
                  {m.label}
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums text-on-surface">{money0(g?.amount ?? 0)}</span>
                  <span className="text-xs tabular-nums text-muted">{pct(g?.amount ?? 0, total)}</span>
                </div>
                <div className="text-xs text-muted mt-1 leading-snug">
                  {(g?.count ?? 0).toLocaleString('en-SG')} inv. · {m.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** Donut of the overdue by source. Largest slice starts at 12 o'clock; the legend carries the values. */
export const SourceDonut: React.FC<{
  slices: Array<Slice<ChartSourceKey>>;
  total: number;
  active?: ChartSourceKey;
  onSelect: (key: ChartSourceKey) => void;
}> = ({ slices, total, active, onSelect }) => {
  const dark = useIsDarkTheme();
  const [hover, setHover] = useState<ChartSourceKey | null>(null);
  const R = 78;
  const C = 2 * Math.PI * R;
  const GAP = 2.5;
  const shown = slices.filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  const lit = hover ?? active ?? null;
  const focus = shown.find((s) => s.key === lit);
  let offset = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
      <div className="relative w-44 h-44 shrink-0">
        <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90" aria-hidden="true">
          <circle cx="100" cy="100" r={R} fill="none" strokeWidth={22} className="stroke-surface-hover" />
          {shown.map((s) => {
            const frac = total > 0 ? s.amount / total : 0;
            const len = Math.max(frac * C - (shown.length > 1 ? GAP : 0), 1.5);
            const el = (
              <circle
                key={s.key}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={sourceColor(s.key, dark)}
                strokeWidth={lit === s.key ? 28 : 22}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                opacity={lit && lit !== s.key ? 0.3 : 1}
                className="cursor-pointer transition-all duration-200 motion-reduce:transition-none"
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(s.key)}
              />
            );
            offset += frac * C;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-8">
          <div className="text-[11px] leading-tight text-muted">{focus ? focus.label : 'All sources'}</div>
          <div className="text-lg font-bold tabular-nums text-on-surface mt-0.5">{money0(focus ? focus.amount : total)}</div>
          <div className="text-[11px] tabular-nums text-muted">{focus ? pct(focus.amount, total) : '100%'}</div>
        </div>
      </div>

      <ul className="w-full min-w-0 divide-y divide-default">
        {shown.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              aria-pressed={active === s.key}
              className={`w-full grid grid-cols-[12px_1fr_auto_3.25rem] items-center gap-3 px-2 py-2 rounded-md text-left text-sm cursor-pointer transition-colors duration-200 motion-reduce:transition-none ${FOCUS} ${
                active === s.key ? 'bg-surface-hover' : 'hover:bg-surface-hover'
              }`}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(s.key)}
            >
              <span className="w-3 h-3 rounded-sm" style={{ background: sourceColor(s.key, dark) }} aria-hidden="true" />
              <span className="min-w-0 text-on-surface">
                <span className="block truncate" title={s.label}>
                  {s.label}
                </span>
                <span className="block text-xs text-muted">{s.count.toLocaleString('en-SG')} inv.</span>
              </span>
              <span className="tabular-nums font-semibold whitespace-nowrap text-on-surface">{money0(s.amount)}</span>
              <span className="tabular-nums text-right text-muted">{pct(s.amount, total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Each source as one bar (scaled to the largest source), split by what needs to happen. */
export const SourceStatusBars: React.FC<{
  sources: Array<Slice<ChartSourceKey>>;
  amountOf: (source: ChartSourceKey, group: StatusGroup) => number;
  active?: { source?: ChartSourceKey; group?: StatusGroup };
  onSelect: (source: ChartSourceKey, group?: StatusGroup) => void;
}> = ({ sources, amountOf, active, onSelect }) => {
  const dark = useIsDarkTheme();
  const shown = sources.filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  const largest = Math.max(0, ...shown.map((s) => s.amount));

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs text-on-surface-secondary">
        {STATUS_GROUPS.map((g) => (
          <span key={g.key} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: groupColor(g.key, dark) }} aria-hidden="true" />
            {g.label}
          </span>
        ))}
      </div>
      <div className="space-y-3.5">
        {shown.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <button
                type="button"
                className={`flex items-center gap-2 text-sm text-on-surface hover:underline cursor-pointer rounded ${FOCUS}`}
                onClick={() => onSelect(s.key)}
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: sourceColor(s.key, dark) }} aria-hidden="true" />
                {s.label}
              </button>
              <span className="text-sm font-semibold tabular-nums text-on-surface whitespace-nowrap">{money0(s.amount)}</span>
            </div>
            <div className="flex h-2.5 gap-[2px]" style={{ width: `${largest > 0 ? Math.max((s.amount / largest) * 100, 1.5) : 0}%` }}>
              {STATUS_GROUPS.map((g) => {
                const amt = amountOf(s.key, g.key);
                if (amt <= 0) return null;
                const dim = active && (active.source || active.group) && !(active.source === s.key && (!active.group || active.group === g.key)) && !(!active.source && active.group === g.key);
                return (
                  <button
                    key={g.key}
                    type="button"
                    aria-label={`${s.label} · ${g.label}: ${money0(amt)}`}
                    title={`${g.label}: ${money0(amt)} (${pct(amt, s.amount)} of ${s.label})`}
                    className={`h-full first:rounded-l last:rounded-r cursor-pointer transition-opacity duration-200 motion-reduce:transition-none hover:opacity-80 ${FOCUS}`}
                    style={{ width: `${(amt / s.amount) * 100}%`, minWidth: 3, background: groupColor(g.key, dark), opacity: dim ? 0.3 : 1 }}
                    onClick={() => onSelect(s.key, g.key)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
