import React, { useEffect, useState } from 'react';
import { Card } from '../ui/Card';

interface ResponseRow {
  id: string;
  course_run_code?: string;
  course_title?: string;
  course_code?: string;
  learner_name?: string;
  learner_email?: string;
  answers: Record<string, string | number>;
  submitted_at: string;
}

export const FeedbackFormResponsesView: React.FC = () => {
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courseRunId, setCourseRunId] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = courseRunId ? `?course_run_id=${encodeURIComponent(courseRunId)}` : '';
      const r = await fetch(`/api/feedback-form/responses${qs}`);
      const j = await r.json();
      if (j.success) setRows(j.data);
      else setError(j.error || 'Failed to load');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const COLUMNS: Array<{ key: string; label: string; get: (r: ResponseRow) => any }> = [
    { key: 'course_title', label: 'Course Title', get: r => r.course_title },
    { key: 'course_code', label: 'Course Code', get: r => r.course_code },
    { key: 'course_run_code', label: 'Run ID', get: r => r.course_run_code },
    { key: 'learner_name', label: 'Learner Name', get: r => r.learner_name || r.answers?.learner_name },
    { key: 'training_outcome', label: 'Training Outcome', get: r => r.answers?.rate_learning_objectives },
    { key: 'trainer_quality', label: 'Trainer Quality', get: r => r.answers?.rate_trainer_knowledge },
    { key: 'environment', label: 'Environment', get: r => r.answers?.rate_training_environment },
    { key: 'message', label: 'Message', get: r => r.answers?.message },
    { key: 'submitted_at', label: 'Submitted On', get: r => new Date(r.submitted_at).toLocaleString() },
  ];

  const exportCsv = () => {
    const header = [...COLUMNS.map(c => c.label), 'JSON Output'];
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      header.join(','),
      ...rows.map(r => [...COLUMNS.map(c => c.get(r)), JSON.stringify(r.answers)].map(escape).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `feedback-responses-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-2 dark:text-white">Feedback Responses</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Public read-only API: <code>/api/feedback-form/responses?course_run_id=…</code>
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs text-gray-500 mb-1">Filter by Course Run UUID</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              value={courseRunId}
              onChange={e => setCourseRunId(e.target.value)}
              placeholder="leave blank for all"
            />
          </div>
          <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Reload</button>
          <button onClick={exportCsv} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm" disabled={!rows.length}>Export CSV</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No responses yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  {COLUMNS.map(c => (
                    <th key={c.key} className="text-left px-3 py-2 whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="text-left px-3 py-2 whitespace-nowrap">JSON Output</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-gray-200 dark:border-gray-700 align-top">
                    {COLUMNS.map(c => (
                      <td key={c.key} className="px-3 py-2 whitespace-nowrap">{String(c.get(r) ?? '')}</td>
                    ))}
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer text-blue-600">View</summary>
                        <pre className="text-xs whitespace-pre-wrap mt-1 max-w-md">{JSON.stringify(r.answers, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default FeedbackFormResponsesView;
