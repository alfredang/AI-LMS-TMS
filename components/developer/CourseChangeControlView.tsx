import React, { useEffect, useMemo, useState } from 'react';

interface CodeEntry {
  code: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
  effectiveFrom: string | null;
}

interface TitleEntry {
  title: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
  effectiveFrom: string | null;
}

interface ChangeEvent {
  date: string | null;
  field: 'code' | 'title';
  from: string;
  to: string;
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
  changes: ChangeEvent[];
}

const PAGE_SIZE = 20;

const fmt = (d: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** dd-mm-yyyy, the format the change log is read in. */
const fmtDdMmYyyy = (d: string | null): string => {
  if (!d) return 'Date not recorded';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(dt.getUTCDate())}-${pad(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
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
  const [page, setPage] = useState(1);

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
    return rows
      .filter(r => {
        const changed = (r.codes?.length || 0) > 1 || (r.titles?.length || 0) > 1;
        if (changedOnly && !changed) return false;
        if (!q) return true;
        if (r.title.toLowerCase().includes(q)) return true;
        if (r.codes?.some(c => c.code.toLowerCase().includes(q))) return true;
        if (r.titles?.some(t => t.title.toLowerCase().includes(q))) return true;
        return false;
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  }, [rows, query, changedOnly]);

  const changedCount = useMemo(
    () => rows.filter(r => (r.codes?.length || 0) > 1 || (r.titles?.length || 0) > 1).length,
    [rows]
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // A filter change can leave the current page past the end of the new result set.
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visible, safePage]
  );

  // Any change to what is being listed puts the reader back at the first page.
  useEffect(() => { setPage(1); }, [query, changedOnly]);

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
            {visible.length === 0
              ? '0 shown'
              : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, visible.length)} of ${visible.length}`}{' '}
            · {changedCount} changed · {rows.length} total
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
        {pageRows.map(course => {
          const codes = course.codes || [];
          const titles = course.titles || [];
          const changes = course.changes || [];
          const current = codes.find(c => c.isCurrent);
          const currentTitle = titles.find(t => t.isCurrent);

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

              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-on-surface-secondary">
                  Current code:{' '}
                  <span className="font-mono font-semibold text-on-surface">
                    {current?.code || '—'}
                  </span>
                </span>
                <span className="text-on-surface-secondary">
                  Current title:{' '}
                  <span className="font-medium text-on-surface">
                    {currentTitle?.title || course.title}
                  </span>
                </span>
              </div>

              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                Change history
              </p>

              {changes.length === 0 ? (
                <p className="text-sm text-on-surface-secondary">
                  No changes recorded — this course still carries its original code and title.
                </p>
              ) : (
                <ul className="divide-y divide-default border-t border-default">
                  {changes.map((ch, i) => (
                    <li
                      key={`${ch.field}-${ch.from}-${ch.to}-${i}`}
                      className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4"
                    >
                      <span
                        className={`shrink-0 text-xs sm:w-32 sm:pt-0.5 ${
                          ch.date ? 'font-mono text-on-surface-secondary' : 'italic text-muted'
                        }`}
                      >
                        {fmtDdMmYyyy(ch.date)}
                      </span>
                      <span className="text-sm text-on-surface">
                        {ch.field === 'code' ? 'Changed course code from ' : 'Changed course title from '}
                        <span className={ch.field === 'code' ? 'font-mono font-medium' : 'font-medium'}>
                          {ch.from}
                        </span>
                        {' to '}
                        <span className={ch.field === 'code' ? 'font-mono font-medium' : 'font-medium'}>
                          {ch.to}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

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

      {!loading && !error && pageCount > 1 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="rounded-lg border border-default px-3 py-1.5 text-sm text-on-surface disabled:opacity-40 disabled:cursor-not-allowed bg-surface-hover"
          >
            Previous
          </button>
          <span className="px-2 text-sm text-on-surface-secondary">
            Page {safePage} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            disabled={safePage === pageCount}
            className="rounded-lg border border-default px-3 py-1.5 text-sm text-on-surface disabled:opacity-40 disabled:cursor-not-allowed bg-surface-hover"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default CourseChangeControlView;
