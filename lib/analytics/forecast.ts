/**
 * Three-month forecast used by the Training Analytics dashboard.
 *
 * A TypeScript port of the SQL that used to live in /api/analytics/dashboard,
 * so the same maths can run over a filtered monthly series:
 *   - no months of data   -> 0            ('none')
 *   - fewer than 6 months -> weighted avg ('weighted avg'): the last two months
 *                            count double; the monthly average x 3
 *   - fewer than 12       -> linear trend ('trend'): sum of the next 3 months
 *   - 12 or more          -> trend x seasonal index of the calendar month
 *                            ('trend+seasonal')
 * Each projected month is clamped at 0.
 */

export type ForecastMethod = 'trend+seasonal' | 'trend' | 'weighted avg' | 'none';

export interface MonthlyTotal {
  yr: number;
  mo: number; // 1-12
  total: number;
}

export interface Forecast {
  value: number;
  method: ForecastMethod;
}

const monthIdx = (yr: number, mo: number) => yr * 12 + mo;

export function forecastNext3Months(rows: MonthlyTotal[], now: Date = new Date()): Forecast {
  const data = rows.filter((r) => Number.isFinite(r.yr) && Number.isFinite(r.mo) && Number.isFinite(r.total));
  const n = data.length;
  if (n === 0) return { value: 0, method: 'none' };

  const xs = data.map((r) => monthIdx(r.yr, r.mo));
  const ys = data.map((r) => r.total);
  const maxIdx = Math.max(...xs);

  if (n < 6) {
    let sw = 0;
    let swy = 0;
    data.forEach((r, i) => {
      const w = xs[i] > maxIdx - 2 ? 2 : 1;
      sw += w;
      swy += r.total * w;
    });
    return { value: sw > 0 ? (swy / sw) * 3 : 0, method: 'weighted avg' };
  }

  // Least-squares regression (Postgres regr_slope / regr_intercept).
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, x) => a + x * x, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = denom !== 0 ? (sy - slope * sx) / n : 0;

  const next = [1, 2, 3].map((k) => {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    return { mo: d.getMonth() + 1, idx: monthIdx(d.getFullYear(), d.getMonth() + 1) };
  });

  if (n < 12) {
    const value = next.reduce((a, m) => a + Math.max(intercept + slope * m.idx, 0), 0);
    return { value, method: 'trend' };
  }

  const avg = sy / n;
  const byMonth = new Map<number, number[]>();
  data.forEach((r) => byMonth.set(r.mo, [...(byMonth.get(r.mo) || []), r.total]));
  const seasonal = (mo: number) => {
    const vals = byMonth.get(mo);
    if (!vals || vals.length === 0) return 1;
    return avg > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length / avg : 1;
  };
  const value = next.reduce((a, m) => a + Math.max((intercept + slope * m.idx) * seasonal(m.mo), 0), 0);
  return { value, method: 'trend+seasonal' };
}
