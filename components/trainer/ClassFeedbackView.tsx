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

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Course Feedback — one class's feedback in full, laid out like the ai-mms class reviews page: a
 * header card (course, class pills, Back to Class), the average per question, then one table row
 * per learner (Q1…Qn, written answers, submitted time). Shown inside the trainer
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

  // Written (non-rating) questions asked across the responses: one table column each.
  const writtenLabels = useMemo(() => {
    const labels = Array.from(new Set((data?.responses || []).flatMap(r => r.details.filter(d => d.type !== 'rating1to5').map(d => d.label))));
    return labels.length ? labels : (data ? [data.commentLabel] : []);
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const otherLabels = Array.from(new Set(data.responses.flatMap(r => r.details.filter(d => d.type !== 'rating1to5').map(d => d.label))));
    const header = ['#', 'Learner', ...(data.namesShown ? ['Email'] : []), ...data.questions, ...otherLabels, 'Submitted'];
    const lines = data.responses.map((r, i) => [
      String(i + 1),
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
  ] as Array<[string, string]>).filter(([, v]) => !!v) : [];

  const backButton = onBack && (
    <button type="button" onClick={onBack} title={backTitle || 'Back to class'} className="btn btn-secondary flex-shrink-0 print:hidden">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      Back to Class
    </button>
  );

  // Header card: title, course, class pills and Back to Class (same as the ai-mms class reviews page)
  const header = (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
            <Icon name={IconName.BookOpen} className="w-5 h-5 text-primary flex-shrink-0" />
            Course Feedback
          </h1>
          {data && <p className="text-sm text-on-surface-secondary mt-2">{data.title}</p>}
          {pills.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {pills.map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-default text-sm">
                  <span className="text-muted">{k}</span>
                  <span className="font-semibold text-on-surface">{v}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {backButton}
      </div>
    </Card>
  );

  const renderBody = () => {
    if (!ready || signedIn === null) return <p className="text-sm text-muted">Loading…</p>;
    if (!UUID_RE.test(runId)) return <p className="text-sm text-danger">This feedback link is not valid.</p>;
    if (!signedIn) {
      return (
        <Card className="p-6">
          <p className="text-on-surface">Please sign in to the LMS to view this class&apos;s course feedback.</p>
          <a href="/" className="inline-block mt-3 text-sm font-medium text-primary hover:underline">Go to sign in</a>
        </Card>
      );
    }
    if (error) {
      return (
        <Card className="p-6 flex items-center gap-3">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" onClick={load} className="text-sm text-primary hover:underline">Try again</button>
        </Card>
      );
    }
    if (!data) return <p className="text-sm text-muted">Loading feedback…</p>;

    if (data.responses.length === 0) {
      return (
        <Card className="p-6">
          <p className="text-sm text-muted">
            No feedback has been submitted for this class yet. Responses appear here as soon as a learner submits the form from the class&apos;s feedback QR or link.
          </p>
        </Card>
      );
    }

    return (
      <>
        {/* Average per question */}
        <Card className="px-6 py-3">
          {data.questions.map((q, i) => (
            <div key={`${q}-${i}`} className="flex items-start justify-between gap-4 py-3 border-b border-default">
              <p className="text-sm text-on-surface">{i + 1}. {q}</p>
              <p className="text-sm font-bold text-on-surface whitespace-nowrap tabular-nums">{fmtScore(data.averages[i])}</p>
            </div>
          ))}
          <div className="flex items-start justify-between gap-4 py-3">
            <p className="text-sm text-on-surface">Overall average</p>
            <p className="text-sm font-bold text-on-surface whitespace-nowrap tabular-nums">{fmtScore(data.overallAverage)}</p>
          </div>
        </Card>

        {/* Every response, one row per learner */}
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-end gap-2 mb-3 print:hidden">
            <button type="button" onClick={load} disabled={loading} className="btn btn-ghost">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" onClick={exportCsv} className="btn btn-secondary">
              <Icon name={IconName.Download} className="w-4 h-4" /> Export CSV
            </button>
            <button type="button" onClick={() => window.print()} className="btn btn-secondary">Print</button>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Learner</th>
                  {data.questions.map((q, i) => (
                    <th key={`${q}-${i}`} title={q} className="!text-center whitespace-nowrap">Q{i + 1}</th>
                  ))}
                  {writtenLabels.map(l => <th key={l}>{l}</th>)}
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.responses.map(r => (
                  <tr key={r.id} className="align-top break-inside-avoid">
                    <td className="whitespace-nowrap">
                      <span className="font-medium">{r.learner}</span>
                      {r.email && <span className="block text-xs text-muted">{r.email}</span>}
                    </td>
                    {data.questions.map((q, i) => (
                      <td key={`${q}-${i}`} className="text-center whitespace-nowrap tabular-nums">
                        {r.ratings[i] === null || r.ratings[i] === undefined ? '—' : `${r.ratings[i]}/5`}
                      </td>
                    ))}
                    {writtenLabels.map(l => {
                      const fromForm = r.details.find(d => d.type !== 'rating1to5' && d.label === l)?.value;
                      const text = fromForm ?? (l === data.commentLabel ? r.comment : '');
                      return <td key={l} className="whitespace-pre-line min-w-[10rem]">{text || '—'}</td>;
                    })}
                    <td className="whitespace-nowrap text-muted">{fmtSubmitted(r.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {header}
      {renderBody()}
    </div>
  );
};

export default ClassFeedbackView;
