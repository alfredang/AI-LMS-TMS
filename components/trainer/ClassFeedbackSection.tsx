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
  responses: Array<{ id: string; learner: string; ratings: Array<number | null>; comment: string; submittedAt: string }>;
}

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const fmtSubmitted = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' })
    .replace(' am', 'am').replace(' pm', 'pm');
const score = (v: number | null) => (v === null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)} / 5`);

/**
 * Class page → Course Feedback (after the Assessment Summary Record). Collapsed by default; when
 * opened it loads every learner's Course Feedback response for the class: the average per question
 * and each response (trainers see "Learner 1, 2, …", staff see names).
 */
export const ClassFeedbackSection: React.FC<{ courseRunUuid: string }> = ({ courseRunUuid }) => {
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
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Course Feedback</h3>
          <Icon
            name={IconName.ChevronDown}
            className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
          />
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {loading && !data && <p className="text-sm text-gray-500 dark:text-gray-400">Loading feedback…</p>}
          {error && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-500">{error}</p>
              <button type="button" onClick={load} className="text-sm text-blue-600 hover:underline">Try again</button>
            </div>
          )}
          {data && (
            <>
              <div className="rounded-xl border border-default p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <Icon name={IconName.BookOpen} className="w-5 h-5 text-blue-500 flex-shrink-0" />
                      {data.title}
                    </p>
                  </div>
                  <button type="button" onClick={load} disabled={loading} className="text-sm text-blue-600 hover:underline disabled:opacity-50">
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
              </div>

              {data.responses.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">No feedback yet for this class.</p>
              ) : (
                <>
                  <div className="rounded-xl border border-default px-5 py-2">
                    {data.questions.map((q, i) => (
                      <div key={q} className="flex items-start justify-between gap-4 py-3 border-b border-default">
                        <p className="text-sm text-gray-800 dark:text-gray-200">{i + 1}. {q}</p>
                        <p className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">{score(data.averages[i])}</p>
                      </div>
                    ))}
                    <div className="flex items-start justify-between gap-4 py-3">
                      <p className="text-sm text-gray-800 dark:text-gray-200">Overall average</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">{score(data.overallAverage)}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-default overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-default">
                        <tr className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          <th className="px-4 py-3 text-left font-semibold">Learner</th>
                          {data.questions.map((q, i) => (
                            <th key={q} className="px-4 py-3 text-left font-semibold" title={q}>Q{i + 1}</th>
                          ))}
                          <th className="px-4 py-3 text-left font-semibold">{data.commentLabel}</th>
                          <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Submitted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.responses.map(r => (
                          <tr key={r.id} className="border-b border-default last:border-0">
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">{r.learner}</td>
                            {r.ratings.map((v, i) => (
                              <td key={i} className="px-4 py-3 text-gray-800 dark:text-gray-200 whitespace-nowrap">{v === null ? '—' : `${v}/5`}</td>
                            ))}
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-pre-line min-w-[12rem]">{r.comment || '—'}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtSubmitted(r.submittedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
