import React, { useCallback, useState } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

interface FeedbackData {
  classId: string;
  title: string;
  courseCode: string | null;
  startDate: string | null;
  endDate: string | null;
  trainer: string;
  questions: string[];
  commentLabel: string;
  averages: Array<number | null>;
  overallAverage: number | null;
  responses: Array<{ id: string }>;
}

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const score = (v: number | null) => (v === null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)} / 5`);

/**
 * Class page → Post Course Feedback Summary (after the Assessment Summary Record). Collapsed by
 * default; when opened it loads the class's Course Feedback summary: the class details and the
 * average per question. "View all feedback" lists every response in full: trainers get the in-app
 * page (trainer menu on the left, Back to Class); staff views open /class-feedback/[runId] in a new
 * tab (trainers see "Learner 1, 2, …", staff see names).
 */
export const ClassFeedbackSection: React.FC<{
  courseRunUuid: string;
  /** Trainer: open the full feedback page inside the app (with Back to Class) instead of a new tab. */
  onViewAll?: () => void;
}> = ({ courseRunUuid, onViewAll }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!courseRunUuid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainer/class-feedback?courseRunUuid=${encodeURIComponent(courseRunUuid)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the course feedback');
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the course feedback');
    } finally {
      setLoading(false);
    }
  }, [courseRunUuid]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) load();
  };

  const dates = data ? [fmtDay(data.startDate), fmtDay(data.endDate)].filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).join(' – ') : '';
  const pageHref = `/class-feedback/${encodeURIComponent(courseRunUuid)}`;
  const pills: Array<[string, string]> = data ? ([
    ['Class', data.classId],
    ['Course Code', data.courseCode || ''],
    ['Dates', dates],
    ['Trainer', data.trainer],
    ['Responses', String(data.responses.length)],
  ] as Array<[string, string]>).filter(([, v]) => !!v) : [];

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} className="flex-1 min-w-0 flex items-center justify-between text-left" aria-expanded={open}>
          <h3 className="text-xl font-bold text-on-surface">Post Course Feedback Summary</h3>
        </button>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-primary hover:bg-blue-50 dark:hover:bg-blue-900/30 whitespace-nowrap"
          >
            View all feedback
            <Icon name={IconName.ChevronDown} className="w-4 h-4 -rotate-90" />
          </button>
        ) : (
          <a
            href={pageHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-primary hover:bg-blue-50 dark:hover:bg-blue-900/30 whitespace-nowrap"
          >
            View all feedback
            <Icon name={IconName.ExternalLink} className="w-4 h-4" />
          </a>
        )}
        <button type="button" onClick={toggle} aria-label={open ? 'Collapse' : 'Expand'} className="p-1">
          <Icon
            name={IconName.ChevronDown}
            className={`w-5 h-5 text-muted transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
          />
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {loading && !data && <p className="text-sm text-muted">Loading feedback…</p>}
          {error && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-danger">{error}</p>
              <button type="button" onClick={load} className="text-sm text-primary hover:underline">Try again</button>
            </div>
          )}
          {data && (
            <>
              <div className="rounded-xl border border-default p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-on-surface flex items-center gap-2">
                      <Icon name={IconName.BookOpen} className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      {data.title}
                    </p>
                  </div>
                  <button type="button" onClick={load} disabled={loading} className="text-sm text-primary hover:underline disabled:opacity-50">
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pills.map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-default text-sm">
                      <span className="text-muted">{k}</span>
                      <span className="font-semibold text-on-surface">{v}</span>
                    </span>
                  ))}
                </div>
              </div>

              {data.responses.length === 0 ? (
                <p className="text-sm text-muted italic">No feedback yet for this class.</p>
              ) : (
                <>
                  <div className="rounded-xl border border-default px-5 py-2">
                    {data.questions.map((q, i) => (
                      <div key={q} className="flex items-start justify-between gap-4 py-3 border-b border-default">
                        <p className="text-sm text-on-surface">{i + 1}. {q}</p>
                        <p className="text-sm font-bold text-on-surface whitespace-nowrap">{score(data.averages[i])}</p>
                      </div>
                    ))}
                    <div className="flex items-start justify-between gap-4 py-3">
                      <p className="text-sm text-on-surface">Overall average</p>
                      <p className="text-sm font-bold text-on-surface whitespace-nowrap">{score(data.overallAverage)}</p>
                    </div>
                  </div>

                  {(() => {
                    const cls = 'w-full text-left flex items-center justify-between gap-3 rounded-xl border border-default px-5 py-4 hover:bg-surface-hover transition-colors';
                    const inner = (
                      <>
                        <span className="text-sm text-on-surface">
                          See all {data.responses.length} response{data.responses.length === 1 ? '' : 's'} in full — every rating and comment
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary whitespace-nowrap">
                          Open feedback page <Icon name={onViewAll ? IconName.ChevronDown : IconName.ExternalLink} className={`w-4 h-4 ${onViewAll ? '-rotate-90' : ''}`} />
                        </span>
                      </>
                    );
                    return onViewAll
                      ? <button type="button" onClick={onViewAll} className={cls}>{inner}</button>
                      : <a href={pageHref} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>;
                  })()}
                </>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
};

export default ClassFeedbackSection;
