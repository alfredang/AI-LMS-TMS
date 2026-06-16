/**
 * ClassPeopleModal — on-demand view of a course run's assigned trainer(s) and
 * enrolled learners, opened from the Reschedule & Cancel page. Read-only.
 *
 * Reuses GET /api/admin/class-details (one call returns trainers + learners +
 * operational summary). Learner/trainer data is LOCAL enrolment (same source as
 * the rest of the class views).
 */
import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { getApiUrl } from '@/lib/urlHelpers';

interface Props {
  run: { courseRunId: string; courseTitle: string; courseCode: string };
  onClose: () => void;
}

interface Trainer { trainerId: string | null; trainerName: string; trainerEmail: string | null; }
interface Learner {
  learnerName: string; learnerEmail: string; company: string; sponsorship: string;
  assessment: string; paymentDetails: string;
}

const ClassPeopleModal: React.FC<Props> = ({ run, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainerSummary, setTrainerSummary] = useState('');
  const [learners, setLearners] = useState<Learner[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(getApiUrl(`/api/admin/class-details?courseRunId=${encodeURIComponent(run.courseRunId)}`));
        const data = await res.json();
        if (cancelled) return;
        if (!data?.success) throw new Error(data?.error || 'Failed to load class details');
        setTrainers(data.data?.trainers || []);
        setTrainerSummary(data.data?.operationalSummary?.trainer || '');
        setLearners(data.data?.enrolledLearners || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load class details');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [run.courseRunId]);

  const summaryHasTrainer = trainerSummary && !/^n\/?a$/i.test(trainerSummary.trim());

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full border dark:border-gray-700 max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Trainer &amp; Learners</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{run.courseTitle} · {run.courseCode} · run {run.courseRunId}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {loading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Loading…</div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : (
            <>
              {/* Trainers */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Trainer{trainers.length === 1 ? '' : 's'} ({trainers.length})</h4>
                {trainers.length > 0 ? (
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
                    {trainers.map((t, i) => (
                      <li key={t.trainerId || i} className="px-3 py-2 text-sm flex items-center justify-between">
                        <span className="text-gray-800 dark:text-gray-200">{t.trainerName}</span>
                        <span className="text-gray-500 dark:text-gray-400">{t.trainerEmail || '—'}</span>
                      </li>
                    ))}
                  </ul>
                ) : summaryHasTrainer ? (
                  <div className="text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2">{trainerSummary}</div>
                ) : (
                  <div className="text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-md px-3 py-2">No trainer assigned.</div>
                )}
              </div>

              {/* Learners */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Learners ({learners.length})</h4>
                {learners.length > 0 ? (
                  <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-md">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2">Company</th>
                          <th className="px-3 py-2">Sponsorship</th>
                          <th className="px-3 py-2">Assessment</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {learners.map((l, i) => (
                          <tr key={(l.learnerEmail || '') + i}>
                            <td className="px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-nowrap">{l.learnerName || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{l.learnerEmail || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{l.company || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{l.sponsorship || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{l.assessment || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-md px-3 py-2">No learners enrolled.</div>
                )}
                <p className="text-xs text-gray-400 mt-2">Shows the LMS (local) trainer assignment and enrolment — not SSG/TPGateway enrolment.</p>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};

export default ClassPeopleModal;
