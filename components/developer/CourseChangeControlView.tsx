import React, { useEffect, useMemo, useState } from 'react';

interface ChangeRow {
  id: string;
  courseId: string;
  courseTitle: string;
  courseType: string | null;
  originalCode: string | null;
  currentCode: string | null;
  field: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  /** ISO date, or null when the change predates date tracking. */
  changedAt: string | null;
  changedByName: string | null;
  note: string | null;
}

const PAGE_SIZE = 20;

/** dd-mm-yyyy, the format the change log is read in. */
const fmtDdMmYyyy = (d: string | null): string => {
  if (!d) return 'Not recorded';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(dt.getUTCDate())}-${pad(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
};

/** Values are stored as text; render an unset one as an em dash. */
const val = (v: string | null): string => (v === null || v === '' ? '—' : v);

/**
 * Course Change Control — the chronological audit trail of course changes.
 *
 * One row per change: when it happened, which field moved, and what it moved
 * from and to. A course keeps its identity (and all its enrolments and classes)
 * across a rename or a funding renewal that issues a new reference code, so
 * records created under a superseded code or a former title stay traceable.
 *
 * Changes recorded before per-field tracking shipped carry no date; those are
 * shown as "Not recorded" and sorted last rather than given an invented date.
 */
const CourseChangeControlView: React.FC = () => {
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [fieldFilter, setFieldFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/course-change-log');
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const data = await res.json();
        if (!cancelled) setRows(data.changes || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load change log');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The set of fields actually present, so the filter never offers an empty option.
  const fields = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach(r => seen.set(r.field, r.fieldLabel));
    return Array.from(seen, ([field, label]) => ({ field, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (fieldFilter !== 'all' && r.field !== fieldFilter) return false;
      if (!q) return true;
      // Match the course title, and the values themselves so a superseded code
      // pasted from an old invoice finds the change that retired it.
      return (
        r.courseTitle.toLowerCase().includes(q) ||
        (r.oldValue || '').toLowerCase().includes(q) ||
        (r.newValue || '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, fieldFilter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // A filter change can leave the current page past the end of the new result set.
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visible, safePage]
  );

  // Any change to what is being listed puts the reader back at the first page.
  useEffect(() => { setPage(1); }, [query, fieldFilter]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">Course Change Control</h1>
        <p className="mt-1 text-sm text-on-surface-secondary">
          Every recorded change to a course, newest first — what changed, when, and from what
          to what. Enrolments and classes stay attached to the course across a change, so
          records created under a superseded code or a former title remain traceable.
        </p>
      </div>

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by course title, or any old/new value…"
          className="w-full sm:max-w-md rounded-lg border border-default bg-surface px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <select
          value={fieldFilter}
          onChange={e => setFieldFilter(e.target.value)}
          className="rounded-lg border border-default bg-surface px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">All fields</option>
          {fields.map(f => (
            <option key={f.field} value={f.field}>{f.label}</option>
          ))}
        </select>
        {!loading && !error && (
          <span className="text-sm text-muted sm:ml-auto">
            {visible.length === 0
              ? '0 changes'
              : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, visible.length)} of ${visible.length}`}
            {visible.length !== rows.length && ` (of ${rows.length} total)`}
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-on-surface-secondary">Loading change log…</p>}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="text-sm text-on-surface-secondary">
          {rows.length === 0
            ? 'No changes recorded yet. Course edits are logged here from now on.'
            : 'No changes match this filter.'}
        </p>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-default">
          <table className="w-full min-w-[1100px] border-collapse text-left">
            <thead>
              <tr className="bg-background-secondary">
                <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
                  Date of Change
                </th>
                <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
                  Course Title
                </th>
                <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
                  Original Course Code
                </th>
                <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
                  Current Course Code
                </th>
                <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">
                  Detail of Change
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const mono = r.field === 'courseCode' || r.field === 'newCourseCode';
                return (
                  <tr key={r.id} className="border-t border-default">
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-sm ${
                        r.changedAt ? 'font-mono text-on-surface' : 'italic text-muted'
                      }`}
                    >
                      {fmtDdMmYyyy(r.changedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-on-surface">
                      {r.courseTitle}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-on-surface-secondary">
                      {val(r.originalCode)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-on-surface">
                      {val(r.currentCode)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-on-surface">
                      {r.fieldLabel} changed to{' '}
                      <span className={`${mono ? 'font-mono' : ''} font-semibold`}>
                        {val(r.newValue)}
                      </span>
                      {r.changedByName && (
                        <span className="ml-2 text-xs text-muted">by {r.changedByName}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
