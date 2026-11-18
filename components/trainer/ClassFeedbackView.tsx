import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@components/ui/Card';
import { Icon, IconName } from '@components/ui/Icon';

interface Detail { section: string; label: string; type: string; value: string }
interface FeedbackResponse {
  id: string;
  learner: string;
  email: string | null;
  ratings: Array<number | null>;
  comment: string;
  details: Detail[];
  submittedAt: string;
}
interface FeedbackData {
  classId: string;
  title: string;
  courseCode: string | null;
  startDate: string | null;
  endDate: string | null;
  trainer: string;
  namesShown: boolean;
  questions: string[];
  commentLabel: string;
  averages: Array<number | null>;
  overallAverage: number | null;
  responses: FeedbackResponse[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const fmtSubmitted = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' })
    .replace(' am', 'am').replace(' pm', 'pm');
const fmtScore = (v: number | null) => (v === null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)} / 5`);

const Stars: React.FC<{ value: number | null }> = ({ value }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={value === null ? 'No rating' : `${value} out of 5`}>
    {[1, 2, 3, 4, 5].map(n => (
      <svg key={n} viewBox="0 0 24 24" className={`w-4 h-4 ${value !== null && n <= value ? 'text-amber-400' : 'text-muted'}`} fill="currentColor" aria-hidden>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ))}
  </span>
);

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Post Course Feedback — every learner's feedback for one class, in full. Shown inside the trainer
 * layout (class page → Post Course Feedback Summary → View all feedback, with Back to Class) and as
 * the standalone /class-feedback/[runId] page. Signed-in trainers of the class and staff only (the
 * API enforces it); trainers see "Learner 1, 2, …", staff see names and emails.
 */
export const ClassFeedbackView: React.FC<{
  runId: string;
  /** Back to the class page (in-app). Shown top right, like E-Attendance. */
  onBack?: () => void;
  backTitle?: string;
  /** The router is ready (standalone page); in-app the run id is known up front. */
  ready?: boolean;
}> = ({ runId, onBack, backTitle, ready = true }) => {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  useEffect(() => {
    try { setSignedIn(!!window.localStorage.getItem('auth_token')); } catch { setSignedIn(false); }
  }, []);

  const load = useCallback(async () => {
    if (!UUID_RE.test(runId)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainer/class-feedback?courseRunUuid=${encodeURIComponent(runId)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the course feedback');
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the course feedback');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (ready && signedIn) load();
  }, [ready, signedIn, load]);

  // Keep each response's original number ("Learner 3") whatever the sort or search.
  const numbered = useMemo(() => (data?.responses || []).map((r, i) => ({ ...r, n: i + 1 })), [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? numbered.filter(r => [r.learner, r.email || '', r.comment, ...r.details.map(d => d.value)].join(' ').toLowerCase().includes(q))
      : numbered;
    return newestFirst ? [...list].reverse() : list;
  }, [numbered, search, newestFirst]);

  const exportCsv = () => {
    if (!data) return;
    const otherLabels = Array.from(new Set(data.responses.flatMap(r => r.details.filter(d => d.type !== 'rating1to5').map(d => d.label))));
    const header = ['#', 'Learner', ...(data.namesShown ? ['Email'] : []), ...data.questions, ...otherLabels, 'Submitted'];
    const lines = numbered.map(r => [
      String(r.n),
      r.learner,
      ...(data.namesShown ? [r.email || ''] : []),
      ...r.ratings.map(v => (v === null ? '' : String(v))),
      ...otherLabels.map(l => r.details.find(d => d.label === l)?.value || ''),
      fmtSubmitted(r.submittedAt),
    ]);
    const csv = [header, ...lines].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `course-feedback-${data.classId || runId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dates = data ? [fmtDay(data.startDate), fmtDay(data.endDate)].filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).join(' – ') : '';
  const pills: Array<[string, string]> = data ? ([
    ['Class', data.classId],
    ['Course Code', data.courseCode || ''],
    ['Dates', dates],
    ['Trainer', data.trainer],
    ['Responses', String(data.responses.length)],
    ['Overall', data.responses.length ? fmtScore(data.overallAverage) : ''],
  ] as Array<[string, string]>).filter(([, v]) => !!v) : [];

  const renderBody = () => {
    if (!ready || signedIn === null) return <p className="text-sm text-muted dark:text-gray-400">Loading…</p>;
    if (!UUID_RE.test(runId)) return <p className="text-sm text-red-500">This feedback link is not valid.</p>;
    if (!signedIn) {
      return (
        <Card className="p-6">
          <p className="text-gray-800 dark:text-gray-200">Please sign in to the LMS to view this class&apos;s course feedback.</p>
          <a href="/" className="inline-block mt-3 text-sm font-medium text-blue-600 hover:underline">Go to sign in</a>
        </Card>
      );
    }
    if (error) {
      return (
        <Card className="p-6 flex items-center gap-3">
          <p className="text-sm text-red-500">{error}</p>
          <button type="button" onClick={load} className="text-sm text-blue-600 hover:underline">Try again</button>
        </Card>
      );
    }
    if (!data) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading feedback…</p>;

    return (
      <>
        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-lg font-semibold text-on-surface flex items-center gap-2 min-w-0">
              <Icon name={IconName.BookOpen} className="w-5 h-5 text-blue-500 flex-shrink-0" />
              {data.title}
            </p>
            <button type="button" onClick={load} disabled={loading} className="text-sm text-blue-600 hover:underline disabled:opacity-50 print:hidden">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {pills.map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-default text-sm">
                <span className="text-gray-500 dark:text-gray-400">{k}</span>
                <span className="font-semibold text-gray-900 dark:text-white">{v}</span>
              </span>
            ))}
          </div>
        </Card>

        {data.responses.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-gray-500 italic">No feedback yet for this class.</p>
          </Card>
        ) : (
          <>
            <Card className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Average Ratings</h2>
              <div>
                {data.questions.map((q, i) => {
                  const v = data.averages[i];
                  return (
                    <div key={q} className="py-3 border-b border-default">
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm text-gray-800 dark:text-gray-200">{i + 1}. {q}</p>
                        <p className="text-sm font-bold text-gray-900 whitespace-nowrap">{fmtScore(v)}</p>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${v === null ? 0 : (v / 5) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-start justify-between gap-4 pt-3">
                  <p className="text-sm font-semibold text-on-surface dark:text-white">Overall average</p>
                  <p className="text-sm font-bold text-on-surface whitespace-nowrap">{fmtScore(data.overallAverage)}</p>
                </div>
              </div>
            </Card>

            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <div className="relative flex-1 min-w-[14rem]">
                <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={data.namesShown ? 'Search learner, email or answers…' : 'Search answers…'}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-strong bg-surface text-sm text-gray-900 dark:text-white"
                />
              </div>
              <select
                value={newestFirst ? 'newest' : 'oldest'}
                onChange={e => setNewestFirst(e.target.value === 'newest')}
                className="px-3 py-2 rounded-lg border border-strong bg-white text-sm text-gray-900 dark:text-white"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-strong text-sm text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700">
                <Icon name={IconName.Download} className="w-4 h-4" /> Export CSV
              </button>
              <button type="button" onClick={() => window.print()} className="px-3 py-2 rounded-lg border border-strong text-sm text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700">
                Print
              </button>
            </div>

            <p className="text-sm text-muted dark:text-gray-400">
              Showing {shown.length} of {data.responses.length} response{data.responses.length === 1 ? '' : 's'}
            </p>

            {shown.map(r => {
              const ratingDetails = r.details.filter(d => d.type === 'rating1to5');
              const otherDetails = r.details.filter(d => d.type !== 'rating1to5');
              return (
                <Card key={r.id} className="p-6 break-inside-avoid">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-default">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-info-bg text-primary text-xs font-bold">{r.n}</span>
                        {r.learner}
                      </p>
                      {r.email && <p className="text-sm text-gray-500 mt-0.5 ml-9">{r.email}</p>}
                    </div>
                    <p className="text-sm text-gray-500 whitespace-nowrap">{fmtSubmitted(r.submittedAt)}</p>
                  </div>

                  {ratingDetails.length > 0 && (
                    <div className="pt-1">
                      {ratingDetails.map((d, i) => {
                        const v = Number(d.value);
                        const val = Number.isFinite(v) && v >= 1 && v <= 5 ? v : null;
                        return (
                          <div key={`${d.label}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 border-b border-default last:border-0">
                            <p className="text-sm text-on-surface flex-1 min-w-[12rem]">{d.label}</p>
                            <span className="inline-flex items-center gap-2">
                              <Stars value={val} />
                              <span className="text-sm font-semibold text-on-surface w-10 text-right">{val === null ? '—' : `${val}/5`}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {otherDetails.length > 0 && (
                    <dl className="mt-3 space-y-3">
                      {otherDetails.map((d, i) => (
                        <div key={`${d.label}-${i}`} className="rounded-lg border border-default bg-surface-elevated px-4 py-3">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{d.label}</dt>
                          <dd className={`mt-1 text-sm whitespace-pre-line ${d.value ? 'text-on-surface' : 'text-muted italic'}`}>
                            {d.value || 'No answer'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Card>
              );
            })}
            {shown.length === 0 && <p className="text-sm text-muted italic">No responses match your search.</p>}
          </>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-on-surface">Post Course Feedback</h1>
          <p className="text-sm text-muted mt-1">
            Every learner&apos;s feedback for this class{data && !data.namesShown ? ' — learners are shown by number' : ''}.
          </p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            title={backTitle || 'Back to class'}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-default text-primary hover:bg-surface-elevated transition-colors flex-shrink-0 print:hidden"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Class
          </button>
        )}
      </div>
      {renderBody()}
    </div>
  );
};

export default ClassFeedbackView;
