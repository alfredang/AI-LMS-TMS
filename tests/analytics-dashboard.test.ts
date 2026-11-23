import assert from 'node:assert/strict';
import test from 'node:test';
import { forecastNext3Months } from '../lib/analytics/forecast';
import { buildBuckets, filteredEnrolmentsCte, parseFilters, periodStart } from '../lib/analytics/filters';

const now = new Date(Date.UTC(2026, 10, 14)); // 14 Nov 2026

test('forecast: no data, weighted average, trend, trend+seasonal', () => {
  assert.deepEqual(forecastNext3Months([], now), { value: 0, method: 'none' });

  // 3 months: last two weigh double -> (10*1 + 20*2 + 30*2) / 5 * 3 = 66
  const wa = forecastNext3Months(
    [
      { yr: 2026, mo: 8, total: 10 },
      { yr: 2026, mo: 9, total: 20 },
      { yr: 2026, mo: 10, total: 30 },
    ],
    now,
  );
  assert.equal(wa.method, 'weighted avg');
  assert.ok(Math.abs(wa.value - 66) < 1e-9);

  // 8 months on a perfect line y = 10 * k (k = 1..8, Apr..Nov) -> Dec..Feb = 90 + 100 + 110
  const line = Array.from({ length: 8 }, (_, i) => ({ yr: 2026, mo: 4 + i, total: 10 * (i + 1) }));
  const tr = forecastNext3Months(line, now);
  assert.equal(tr.method, 'trend');
  assert.ok(Math.abs(tr.value - 300) < 1e-6);

  // 24 flat months -> seasonal index 1 everywhere, forecast = 3 x level
  const flat = Array.from({ length: 24 }, (_, i) => ({ yr: 2024 + Math.floor((i + 11) / 12), mo: ((i + 11) % 12) + 1, total: 50 }));
  const ts = forecastNext3Months(flat, now);
  assert.equal(ts.method, 'trend+seasonal');
  assert.ok(Math.abs(ts.value - 150) < 1e-6);
});

test('forecast never goes negative', () => {
  const falling = Array.from({ length: 8 }, (_, i) => ({ yr: 2026, mo: 3 + i, total: 80 - 10 * i }));
  assert.equal(forecastNext3Months(falling, now).value, 0);
});

test('parseFilters accepts known values and drops the rest', () => {
  assert.deepEqual(parseFilters({}), { period: 'all', courseType: null, sponsorship: null, course: null });
  assert.deepEqual(
    parseFilters({ period: '12m', courseType: 'WSQ', sponsorship: 'Employer', course: 'TGS-2019503161' }),
    { period: '12m', courseType: 'WSQ', sponsorship: 'employer', course: 'TGS-2019503161' },
  );
  assert.deepEqual(parseFilters({ period: '7y', courseType: 'all', sponsorship: 'x' }), {
    period: 'all',
    courseType: null,
    sponsorship: null,
    course: null,
  });
});

test('periodStart and buckets', () => {
  assert.equal(periodStart('all', now), null);
  assert.equal(periodStart('ytd', now)?.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(periodStart('12m', now)?.toISOString().slice(0, 10), '2025-12-01');
  assert.equal(periodStart('3m', now)?.toISOString().slice(0, 10), '2026-09-01');

  const months = buildBuckets('12m', 'month', now);
  assert.equal(months.length, 12);
  assert.equal(months[0], '2025-12-01');
  assert.equal(months[11], '2026-11-01');

  const weeks = buildBuckets('3m', 'week', now);
  assert.equal(weeks[0], '2026-08-31'); // Monday on/before 1 Sep 2026
  assert.equal(weeks[weeks.length - 1], '2026-11-09'); // Monday of the current week
  assert.ok(weeks.every((w) => new Date(`${w}T00:00:00Z`).getUTCDay() === 1));
});

test('slicer values reach SQL only as parameters', () => {
  const params: unknown[] = [];
  const sql = filteredEnrolmentsCte(
    { period: '12m', courseType: "WSQ'; DROP TABLE x;--", sponsorship: 'employer', course: 'TGS-1' },
    params,
    { period: true, ignore: ['sponsorship'] },
  );
  assert.ok(!sql.includes('DROP TABLE'));
  assert.equal(params.length, 3); // period start, course type, course (sponsorship ignored)
  assert.ok(sql.includes('$1') && sql.includes('$2') && sql.includes('$3'));
});
