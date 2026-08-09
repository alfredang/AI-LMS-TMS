import React, { useEffect, useMemo, useState } from 'react';

interface CodeEntry {
  code: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
}

interface TitleEntry {
  title: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
}

interface CourseRow {
  courseId: string;
  title: string;
  courseType: string | null;
  fundingValidity: string | null;
  fundingValid: boolean | null;
  enrolments: number;
  runs: number;
  codes: CodeEntry[];
  titles: TitleEntry[];
}

const fmt = (d: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Course Change Control — the audit trail of course code and title changes.
 *
 * A course keeps its identity (and all its enrolments and runs) across a funding
 * renewal that issues a new reference code, or a rename. This view shows every
 * code and title a course has carried and when each took effect, so a record
 * created under a superseded code or a former title can still be traced.
 */
const CourseChangeControlView: React.FC = () => {
  const [rows, setRows] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/course-code-history');
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const data = await res.json();
        if (!cancelled) setRows(data.courses || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load change history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      const changed = (r.codes?.length || 0) > 1 || (r.titles?.length || 0) > 1;
      if (changedOnly && !changed) return false;
      if (!q) return true;
      if (r.title.toLowerCase().includes(q)) return true;
      if (r.codes?.some(c => c.code.toLowerCase().includes(q))) return true;
      if (r.titles?.some(t => t.title.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [rows, query, changedOnly]);

  const changedCount = useMemo(
    () => rows.filter(r => (r.codes?.length || 0) > 1 || (r.titles?.length || 0) > 1).length,
    [rows]
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">Course Change Control</h1>
        <p className="mt-1 text-sm text-on-surface-secondary">
          Every course reference code and title a course has carried, and when each took effect.
          Enrolments and classes stay attached to the course across a change, so records created
          under a superseded code or a former title remain traceable.
        </p>
      </div>

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by course title or any code, current or superseded…"
          className="w-full sm:max-w-md rounded-lg border border-default bg-surface px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <label className="flex items-center gap-2 text-sm text-on-surface-secondary select-none">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={e => setChangedOnly(e.target.checked)}
            className="rounded border-default"
          />
          Only courses with changes
        </label>
        {!loading && !error && (
          <span className="text-sm text-muted sm:ml-auto">
            {visible.length} shown · {changedCount} changed · {rows.length} total
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-on-surface-secondary">Loading change history…</p>}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="text-sm text-on-surface-secondary">No courses match.</p>
      )}

      <div className="space-y-4">
        {visible.map(course => {
          const codes = [...(course.codes || [])].sort(
            (a, b) => Number(a.isCurrent) - Number(b.isCurrent)
          );
          const titles = [...(course.titles || [])].sort(
            (a, b) => Number(a.isCurrent) - Number(b.isCurrent)
          );
          const current = codes.find(c => c.isCurrent);

          return (
            <div key={course.courseId} className="rounded-xl border border-default bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                <h2 className="text-base font-semibold text-on-surface">{course.title}</h2>
                {course.courseType && (
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {course.courseType}
                  </span>
                )}
                <span className="text-xs text-muted">
                  {course.enrolments} enrolments · {course.runs} classes
                </span>
                {course.fundingValidity && (
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      course.fundingValid
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                    }`}
                  >
                    Funding to {fmt(course.fundingValidity)}
                    {course.fundingValid === false && ' · Expired'}
                  </span>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                    Course code history
                  </p>
                  <ul className="space-y-1">
                    {codes.map(c => (
                      <li key={c.code} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={`font-mono ${c.isCurrent ? 'text-on-surface font-semibold' : 'text-on-surface-secondary line-through'}`}>
                          {c.code}
                        </span>
                        {c.isCurrent ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
                            CURRENT
                          </span>
                        ) : (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            superseded
                          </span>
                        )}
                        <span className="text-xs text-muted">
                          {fmt(c.validFrom)} → {fmt(c.validTo)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                    Course title history
                  </p>
                  <ul className="space-y-1">
                    {titles.map(t => (
                      <li key={t.title} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={t.isCurrent ? 'text-on-surface font-medium' : 'text-on-surface-secondary line-through'}>
                          {t.title}
                        </span>
                        {t.isCurrent ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
                            CURRENT
                          </span>
                        ) : (
                          <span className="text-xs text-muted">
                            until {fmt(t.validTo)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {codes.length > 1 && current && (
                <p className="mt-3 border-t border-default pt-2 text-xs text-on-surface-secondary">
                  Records created under {codes.filter(c => !c.isCurrent).map(c => c.code).join(', ')}{' '}
                  belong to this same course and are retrievable under{' '}
                  <span className="font-mono">{current.code}</span>.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CourseChangeControlView;
