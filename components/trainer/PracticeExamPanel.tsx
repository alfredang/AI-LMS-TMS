import React, { useCallback, useEffect, useState } from 'react';

interface Learner {
  name: string;
  email: string;
  registeredAt: string | null;
  signedIn: boolean;
}

interface CatalogItem {
  slug: string;
  code: string;
  title: string;
  vendor: string;
}

interface PanelData {
  configured: boolean;
  isStaff?: boolean;
  courseRunId?: string;
  examCode?: string | null;
  examTitle?: string | null;
  warning?: string | null;
  catalog?: CatalogItem[];
  learners?: Learner[];
}

interface RowResult { ok: boolean; error?: string; accountCreated?: boolean }

const btn = 'px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }) : '—';

/**
 * E-Attendance page → Practice Exam. For courses linked to a practice exam on
 * exams.tertiaryinfotech.com (e.g. CCAR-F), the trainer registers the class's
 * learners (name + email) there in one click; the Exams account records the
 * course run ID, register date and "Registered from TMS". Staff link the course
 * to its exam here. Hidden when the integration isn't configured, and for
 * trainers when the course has no practice exam.
 */
export function PracticeExamPanel({ courseRunUuid }: { courseRunUuid: string }) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // 'all' | email | 'exam'
  const [rowResult, setRowResult] = useState<Record<string, RowResult>>({});
  const [summary, setSummary] = useState<{ ok: boolean; text: string } | null>(null);
  const [examPick, setExamPick] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice-exam/course-run?courseRunUuid=${encodeURIComponent(courseRunUuid)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
      const hit = (json.catalog || []).find((c: CatalogItem) => c.slug === json.examCode || c.code.toUpperCase() === String(json.examCode || '').toUpperCase());
      setExamPick(hit ? hit.slug : json.examCode || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load practice exam');
    } finally {
      setLoading(false);
    }
  }, [courseRunUuid]);

  useEffect(() => {
    setData(null);
    setRowResult({});
    setSummary(null);
    load();
  }, [load]);

  const register = async (emails?: string[]) => {
    setBusy(emails?.length === 1 ? emails[0] : 'all');
    setSummary(null);
    try {
      const res = await fetch('/api/practice-exam/course-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid, action: 'register', emails }),
      });
      const json = await res.json();
      if (Array.isArray(json.results)) {
        setRowResult(prev => {
          const next = { ...prev };
          for (const r of json.results) next[r.email] = { ok: r.ok, error: r.error, accountCreated: r.accountCreated };
          return next;
        });
        setSummary({
          ok: json.failed === 0,
          text: `${json.registered} registered${json.newAccounts ? ` (${json.newAccounts} new account${json.newAccounts === 1 ? '' : 's'}, welcome email sent)` : ''}${json.failed ? `, ${json.failed} failed` : ''}.`,
        });
        await load();
      } else {
        setSummary({ ok: false, text: json.error || 'Registration failed' });
      }
    } catch {
      setSummary({ ok: false, text: 'Request failed. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const saveExam = async () => {
    setBusy('exam');
    setSummary(null);
    try {
      const res = await fetch('/api/practice-exam/course-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid, action: 'set_exam', examCode: examPick || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) setSummary({ ok: false, text: json.error || 'Could not save' });
      else await load();
    } finally {
      setBusy(null);
    }
  };

  if (!data && !error) return null;
  if (data && !data.configured) return null;
  if (data && !data.examCode && !data.isStaff) return null;

  const learners = data?.learners || [];
  const pending = learners.filter(l => !l.registeredAt).length;
  const known = !examPick || !!data?.catalog?.some(c => c.slug === examPick);
  const savedSlug = data?.catalog?.find(c => c.slug === data.examCode || c.code.toUpperCase() === String(data.examCode || '').toUpperCase())?.slug ?? data?.examCode ?? '';

  return (
    <div className="bg-surface rounded-lg border border-default shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-default">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left">
          <h2 className="text-sm font-semibold text-on-surface">Practice Exam</h2>
          {data?.examCode && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {data.examCode}
            </span>
          )}
          {data?.examCode && learners.length > 0 && (
            <span className="text-xs text-on-surface-secondary">
              {learners.length - pending}/{learners.length} registered
            </span>
          )}
          <span className="text-xs text-on-surface-secondary">{open ? '▾' : '▸'}</span>
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className={`${btn} border border-default text-on-surface-secondary hover:bg-surface-elevated`}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {data?.examCode && learners.length > 0 && (
            <button
              type="button"
              onClick={() => register()}
              disabled={!!busy || !data.courseRunId}
              className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}
              title="Create Tertiary Exams accounts (name + email) and assign the practice exam to every learner in this class"
            >
              {busy === 'all' ? 'Registering…' : pending > 0 ? `Register ${pending} learner${pending === 1 ? '' : 's'}` : 'Re-register all'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 py-3 space-y-3">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {data?.warning && <p className="text-xs text-amber-600 dark:text-amber-400">{data.warning}</p>}

          {data?.isStaff && (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-on-surface-secondary">Practice exam for this course (all classes)</span>
                <select
                  value={examPick}
                  onChange={e => setExamPick(e.target.value)}
                  className="min-w-[18rem] rounded border border-default bg-surface px-2 py-1 text-on-surface"
                >
                  <option value="">— None —</option>
                  {!known && <option value={examPick}>{examPick} (not found)</option>}
                  {(data.catalog || []).map(c => (
                    <option key={c.slug} value={c.slug}>{c.code} — {c.title}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={saveExam}
                disabled={busy === 'exam' || examPick === savedSlug}
                className={`${btn} border border-default text-on-surface hover:bg-surface-elevated`}
              >
                {busy === 'exam' ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {data?.examCode && (
            <p className="text-xs text-on-surface-secondary">
              {data.examTitle || data.examCode} on exams.tertiaryinfotech.com · Course Run ID{' '}
              <span className="font-mono text-on-surface">{data.courseRunId || '—'}</span>. New learners get an account and a
              welcome email; they sign in with Google or an email code.
            </p>
          )}

          {summary && <p className={`text-xs ${summary.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{summary.text}</p>}

          {data?.examCode && (
            learners.length === 0 ? (
              <p className="text-xs text-on-surface-secondary">No learners are enrolled in this class yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-on-surface-secondary border-b border-default">
                      <th className="py-1.5 pr-3 font-medium">Name</th>
                      <th className="py-1.5 pr-3 font-medium">Email</th>
                      <th className="py-1.5 pr-3 font-medium">Register Date</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map(l => {
                      const r = rowResult[l.email];
                      return (
                        <tr key={l.email} className="border-b border-default last:border-0">
                          <td className="py-1.5 pr-3 text-on-surface">{l.name || '—'}</td>
                          <td className="py-1.5 pr-3 text-on-surface-secondary">{l.email}</td>
                          <td className="py-1.5 pr-3 text-on-surface-secondary">{fmtDate(l.registeredAt)}</td>
                          <td className="py-1.5 pr-3">
                            {r && !r.ok ? (
                              <span className="text-red-500" title={r.error}>Failed: {r.error}</span>
                            ) : l.registeredAt ? (
                              <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                {l.signedIn ? 'Registered · signed in' : 'Registered'}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Not registered</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right">
                            {!l.registeredAt && (
                              <button
                                type="button"
                                onClick={() => register([l.email])}
                                disabled={!!busy}
                                className={`${btn} border border-default text-on-surface hover:bg-surface-elevated`}
                              >
                                {busy === l.email ? 'Registering…' : 'Register'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
