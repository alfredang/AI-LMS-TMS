/**
 * Lightweight, dependency-free interactive charts for the Training Analytics
 * dashboard: segmented slicer buttons, a bar + line trend chart with hover
 * tooltips and toggleable legend, and clickable horizontal bar lists and donut charts that
 * act as slicers.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const CHART_COLORS = {
  blue: '#60a5fa',
  green: '#34d399',
  violet: '#a78bfa',
  amber: '#fbbf24',
  rose: '#fb7185',
  slate: '#94a3b8',
};

// ---------------------------------------------------------------- helpers

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A "nice" axis maximum and tick step for 0..max. */
export function niceScale(max: number, ticks = 5): { max: number; step: number } {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  let step = nice * mag;
  if (max <= ticks && Number.isInteger(max)) step = 1; // small counts: integer ticks
  return { max: Math.ceil(max / step) * step, step };
}

/** Monotone cubic (Fritsch–Carlson) path: smooth, never overshoots below 0. */
function monotonePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

// ---------------------------------------------------------------- controls

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <div className="inline-flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`${pad} rounded-lg border font-semibold transition-colors whitespace-nowrap ${
              active
                ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SelectBox<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- trend chart

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  type: 'bar' | 'line';
}

export function TrendChart({
  labels,
  tooltipTitles,
  series,
  data,
  format,
  axisFormat,
  height = 300,
  emptyText = 'No data for these filters',
}: {
  labels: string[];
  tooltipTitles?: string[];
  series: TrendSeries[];
  data: Record<string, number[]>;
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  emptyText?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const visible = series.filter((s) => !hidden.has(s.key));
  const bars = visible.filter((s) => s.type === 'bar');
  const lines = visible.filter((s) => s.type === 'line');
  const n = labels.length;
  const rawMax = Math.max(0, ...visible.flatMap((s) => data[s.key] || []));
  const { max, step } = niceScale(rawMax);
  const fmtAxis = axisFormat || format;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);

  const padL = Math.max(28, Math.max(...ticks.map((t) => fmtAxis(t).length)) * 7 + 12);
  const padR = 12;
  const padT = 10;
  const padB = 28;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const band = n > 0 ? plotW / n : 0;
  const y = (v: number) => padT + plotH - (max > 0 ? (v / max) * plotH : 0);
  const cx = (i: number) => padL + band * i + band / 2;
  const groupW = Math.min(band * 0.62, 64 * Math.max(1, bars.length));
  const barW = bars.length ? groupW / bars.length : 0;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
  const allZero = rawMax === 0;

  return (
    <div>
      <div ref={ref} className="relative w-full select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(' and ') + ' chart'}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />
                <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-gray-500 dark:fill-gray-400" fontSize={11}>
                  {fmtAxis(t)}
                </text>
              </g>
            ))}
            {hover !== null && (
              <rect x={padL + band * hover} y={padT} width={band} height={plotH} className="fill-gray-200/60 dark:fill-gray-700/50" />
            )}
            {bars.map((s, si) => (
              <g key={s.key}>
                {(data[s.key] || []).map((v, i) => {
                  const h = padT + plotH - y(v);
                  return (
                    <rect
                      key={i}
                      x={cx(i) - groupW / 2 + si * barW}
                      y={y(v)}
                      width={Math.max(1, barW - (bars.length > 1 ? 2 : 0))}
                      height={Math.max(0, h)}
                      rx={2}
                      fill={s.color}
                      opacity={hover === null || hover === i ? 0.95 : 0.55}
                    />
                  );
                })}
              </g>
            ))}
            {lines.map((s) => {
              const pts = (data[s.key] || []).map((v, i) => [cx(i), y(v)] as [number, number]);
              return (
                <g key={s.key}>
                  <path d={monotonePath(pts)} fill="none" stroke={s.color} strokeWidth={2.25} />
                  {pts.map(([px, py], i) => (
                    <circle key={i} cx={px} cy={py} r={hover === i ? 4.5 : n > 40 ? 0 : 2.75} fill={s.color} />
                  ))}
                </g>
              );
            })}
            <line x1={padL} x2={width - padR} y1={padT + plotH} y2={padT + plotH} className="stroke-gray-300 dark:stroke-gray-600" />
            {labels.map((l, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={cx(i)} y={height - 8} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize={11}>
                  {l}
                </text>
              ) : null,
            )}
            {labels.map((_, i) => (
              <rect
                key={`hit-${i}`}
                x={padL + band * i}
                y={padT}
                width={band}
                height={plotH + padB}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
            ))}
          </svg>
        )}
        {allZero && width > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">{emptyText}</div>
        )}
        {hover !== null && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-600 dark:bg-gray-900"
            style={{ top: 4, left: cx(hover) + 182 > width ? Math.max(0, cx(hover) - 182) : cx(hover) + 12 }}
          >
            <div className="mb-1 font-semibold text-gray-800 dark:text-gray-100">{(tooltipTitles || labels)[hover]}</div>
            {series.map((s) => (
              <div key={s.key} className={`flex items-center justify-between gap-4 ${hidden.has(s.key) ? 'opacity-40' : ''}`}>
                <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{format((data[s.key] || [])[hover] || 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={!off}
              title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.key)) next.delete(s.key);
                  else if (series.length - next.size > 1) next.add(s.key); // keep at least one series
                  return next;
                })
              }
              className={`flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white ${off ? 'line-through opacity-50' : ''}`}
            >
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- horizontal bars

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Extra line in the hover title. */
  hint?: string;
}

export function HBarList({
  items,
  color,
  format = (n) => n.toLocaleString(),
  selectedKey,
  onSelect,
  labelWidth = '34%',
  showAxis = false,
  emptyText = 'No data for these filters',
}: {
  items: BarItem[];
  color: string;
  format?: (n: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  labelWidth?: string;
  showAxis?: boolean;
  emptyText?: string;
}) {
  const rawMax = Math.max(0, ...items.map((i) => i.value));
  const { max, step } = useMemo(() => niceScale(rawMax, 7), [rawMax]);
  const scaleMax = showAxis ? max : rawMax || 1;
  const ticks: number[] = [];
  if (showAxis) for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);

  if (items.length === 0 || rawMax === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">{emptyText}</div>;
  }

  const grid = { gridTemplateColumns: `minmax(0, ${labelWidth}) minmax(0, 1fr)` };
  // Room to the right of the longest bar for its value label.
  const longest = Math.max(...items.map((i) => format(i.value).length));
  const valuePad = longest > 7 ? 'pr-20' : longest > 4 ? 'pr-14' : 'pr-10';

  return (
    <div>
      <div className="space-y-1.5">
        {items.map((it) => {
          const pct = Math.max(0, (it.value / scaleMax) * 100);
          const dim = selectedKey != null && selectedKey !== it.key;
          const active = selectedKey === it.key;
          const Row: React.ElementType = onSelect ? 'button' : 'div';
          return (
            <Row
              key={it.key}
              {...(onSelect
                ? { type: 'button', onClick: () => onSelect(it.key), 'aria-pressed': active }
                : {})}
              title={`${it.label}: ${format(it.value)}${it.hint ? `\n${it.hint}` : ''}${onSelect ? `\nClick to ${active ? 'clear the filter' : 'filter the dashboard'}` : ''}`}
              className={`group grid w-full items-center gap-3 rounded-md px-1 py-0.5 text-left ${
                onSelect ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/60' : ''
              } ${active ? 'bg-gray-100 dark:bg-gray-700/60' : ''}`}
              style={grid}
            >
              <span
                className={`truncate text-right text-sm ${
                  active ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'
                } ${dim ? 'opacity-60' : ''}`}
              >
                {it.label}
              </span>
              <span className={`flex h-6 items-center ${valuePad}`}>
                <span className="relative flex h-full flex-1 items-center">
                  {showAxis &&
                    ticks.map((t) => (
                      <span
                        key={t}
                        className="absolute inset-y-[-3px] w-px bg-gray-200 dark:bg-gray-700"
                        style={{ left: `${(t / scaleMax) * 100}%` }}
                      />
                    ))}
                  <span
                    className="relative h-5 rounded-r transition-all duration-300"
                    style={{ width: `${pct}%`, minWidth: it.value > 0 ? 2 : 0, background: color, opacity: dim ? 0.35 : 0.95 }}
                  />
                  <span
                    className={`absolute whitespace-nowrap pl-1.5 text-xs font-semibold tabular-nums ${
                      dim ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200'
                    }`}
                    style={{ left: `${pct}%` }}
                  >
                    {format(it.value)}
                  </span>
                </span>
              </span>
            </Row>
          );
        })}
      </div>
      {showAxis && (
        <div className="mt-1 grid gap-3 px-1" style={grid}>
          <span />
          <span className={`flex ${valuePad}`}>
          <span className="relative h-4 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
            {ticks.map((t, i) => (
              <span
                key={t}
                // every other tick label only on small screens, so they don't collide
                className={`absolute -translate-x-1/2 tabular-nums ${i % 2 ? 'hidden sm:inline' : ''}`}
                style={{ left: `${(t / scaleMax) * 100}%`, display: i % Math.ceil(ticks.length / 8) === 0 ? undefined : 'none' }}
              >
                {format(t)}
              </span>
            ))}
          </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- donut

export function DonutChart({
  items,
  colors,
  format = (n) => n.toLocaleString(),
  centerLabel = 'Total',
  selectedKey,
  onSelect,
  size = 180,
  emptyText = 'No data for these filters',
}: {
  items: BarItem[];
  /** Colour per item key; falls back to the palette order. */
  colors: Record<string, string>;
  format?: (n: number) => string;
  centerLabel?: string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  size?: number;
  emptyText?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = items.reduce((a, i) => a + Math.max(0, i.value), 0);
  if (items.length === 0 || total === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">{emptyText}</div>;
  }

  const palette = Object.values(CHART_COLORS);
  const colorOf = (key: string, i: number) => colors[key] || palette[i % palette.length];
  const pct = (v: number) => (v / total) * 100;
  const pctText = (v: number) => {
    const p = pct(v);
    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };

  const stroke = size * 0.16;
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const visible = items.filter((i) => i.value > 0);
  const gap = visible.length > 1 ? Math.min(3, c * 0.004) : 0;
  const focusKey = hover ?? selectedKey ?? null;
  const focus = focusKey ? items.find((i) => i.key === focusKey) : undefined;

  let offset = 0;
  const arcs = items.map((it, i) => {
    const len = (Math.max(0, it.value) / total) * c;
    const arc = { it, i, len, offset };
    offset += len;
    return arc;
  });

  const interactive = (key: string) =>
    onSelect
      ? {
          role: 'button',
          tabIndex: 0,
          onClick: () => onSelect(key),
          onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onSelect(key),
          style: { cursor: 'pointer' },
        }
      : {};

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
      <div className="relative shrink-0" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-gray-100 dark:stroke-gray-700/60" />
          {arcs.map(({ it, i, len, offset: off }) =>
            len > 0 ? (
              <circle
                key={it.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colorOf(it.key, i)}
                strokeWidth={focusKey === it.key ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${c - Math.max(0.5, len - gap)}`}
                strokeDashoffset={-off}
                opacity={focusKey && focusKey !== it.key ? 0.4 : 1}
                className="transition-all duration-200"
                onMouseEnter={() => setHover(it.key)}
                {...interactive(it.key)}
              >
                <title>{`${it.label}: ${format(it.value)} (${pctText(it.value)})`}</title>
              </circle>
            ) : null,
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {focus ? pctText(focus.value) : format(total)}
          </span>
          <span className="max-w-[60%] truncate text-xs text-gray-500 dark:text-gray-400">{focus ? focus.label : centerLabel}</span>
        </div>
      </div>
      <ul className="w-full max-w-xs space-y-1">
        {items.map((it, i) => {
          const active = selectedKey === it.key;
          const dim = !!focusKey && focusKey !== it.key;
          // Not a <button disabled> when read-only: disabled buttons get no mouse events, so hover would break.
          const Row: React.ElementType = onSelect ? 'button' : 'div';
          return (
            <li key={it.key}>
              <Row
                {...(onSelect
                  ? {
                      type: 'button',
                      'aria-pressed': active,
                      onClick: () => onSelect(it.key),
                      title: `Click to ${active ? 'clear the filter' : 'filter the dashboard'}`,
                    }
                  : {})}
                onMouseEnter={() => setHover(it.key)}
                onMouseLeave={() => setHover(null)}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm ${
                  onSelect ? 'hover:bg-gray-100 dark:hover:bg-gray-700/60' : ''
                } ${active ? 'bg-gray-100 dark:bg-gray-700/60' : ''} ${dim ? 'opacity-50' : ''}`}
              >
                <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: colorOf(it.key, i) }} />
                <span className={`flex-1 truncate ${active ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                  {it.label}
                </span>
                <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{format(it.value)}</span>
                <span className="w-10 text-right tabular-nums text-gray-500 dark:text-gray-400">{pctText(it.value)}</span>
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
