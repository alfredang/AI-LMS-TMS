import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

// Admin → Sign-in Requests: login-page submissions (Name, Email, Course Run ID).
// Most are fixed automatically ("Auto-enrolled"); "Needs attention" ones need staff —
// usually a wrong Course Run ID, which can be corrected here before one-click enrol.

interface SigninRequest {
  id: string;
  created_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  course_run_id: string;
  status: 'open' | 'auto_enrolled' | 'resolved' | 'dismissed';
  reason: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  course_title: string | null;
  start_date: string | null;
  resolved_by_name: string | null;
}

const TABS: { key: SigninRequest['status']; label: string }[] = [
  { key: 'open', label: 'Needs attention' },
  { key: 'auto_enrolled', label: 'Auto-enrolled' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
];

const formatDateTime = (s: string) =>
  new Date(s).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const SigninRequestsView: React.FC = () => {
  const [tab, setTab] = useState<SigninRequest['status']>('open');
  const [requests, setRequests] = useState<SigninRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [runIdEdits, setRunIdEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/signin-requests?status=${tab}`);
      const data = await res.json();
      if (data.success) {
        setRequests(data.data);
        setCounts(data.counts);
      }
    } catch (err) {
      console.error('Error fetching sign-in requests:', err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const act = async (r: SigninRequest, action: 'enrol' | 'dismiss') => {
    if (action === 'dismiss' && !window.confirm(`Dismiss the request from ${r.full_name}?`)) return;
    setBusyId(r.id);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/signin-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: r.id, courseRunId: runIdEdits[r.id]?.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: data.emailSent === false ? 'error' : 'success', text: action === 'enrol' ? `${r.full_name}: ${data.message}` : `Dismissed ${r.full_name}.` });
        fetchRequests();
      } else {
        setMessage({ type: 'error', text: `${r.full_name}: ${data.error}` });
      }
    } catch {
      setMessage({ type: 'error', text: 'Request failed. Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-default pb-5">
        <h3 className="text-2xl font-bold leading-6 text-on-surface flex items-center gap-2">
          <Icon name={IconName.Help} className="w-7 h-7" />
          Sign-in Requests
        </h3>
        <p className="mt-2 max-w-4xl text-sm text-muted">
          Learners who couldn&apos;t get their OTP or see their class fill in Name, Email and Course Run ID on the login page.
          Most are enrolled automatically and emailed a welcome. The ones under <strong>Needs attention</strong> couldn&apos;t be
          fixed automatically. Correct the Course Run ID if needed, then click <strong>Enrol &amp; notify</strong>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium border ${tab === t.key
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-surface border-strong text-on-surface-secondary hover:bg-surface-hover'}`}
          >
            {t.label}
            <span className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs ${tab === t.key ? 'bg-white/25' : 'bg-surface-elevated'}`}>
              {counts[t.key] ?? 0}
            </span>
          </button>
        ))}
        <Button variant="secondary" onClick={fetchRequests} className="ml-auto">Refresh</Button>
      </div>

      {message && (
        <div className={`p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
          {message.text}
        </div>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-muted">Loading requests...</span>
          </div>
        ) : requests.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            {tab === 'open' ? 'Nothing needs attention — every learner was enrolled automatically.' : 'No requests here.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-default text-sm">
              <thead className="bg-surface-elevated">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Learner</th>
                  <th className="px-4 py-3">Course Run ID</th>
                  <th className="px-4 py-3">{tab === 'open' ? 'Why it needs you' : 'Class / outcome'}</th>
                  {tab === 'open' && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {requests.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-on-surface">{r.full_name}</div>
                      <a href={`mailto:${r.email}`} className="text-primary hover:underline">{r.email}</a>
                      {r.phone && <div className="text-muted">{r.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {tab === 'open' ? (
                        <input
                          type="text"
                          value={runIdEdits[r.id] ?? r.course_run_id}
                          onChange={(e) => setRunIdEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          className="w-32 px-2 py-1.5 font-mono text-sm border border-strong rounded-md bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label={`Course Run ID for ${r.full_name}`}
                        />
                      ) : (
                        <span className="font-mono">{r.course_run_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-on-surface-secondary max-w-md">
                      {tab === 'open' ? r.reason : (
                        <>
                          {r.course_title && <div className="font-medium">{r.course_title}</div>}
                          <div className="text-muted">
                            {r.resolution_note || r.reason || 'Enrolled automatically'}
                            {r.resolved_by_name && ` · by ${r.resolved_by_name}`}
                          </div>
                        </>
                      )}
                    </td>
                    {tab === 'open' && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex gap-2">
                          <Button size="sm" onClick={() => act(r, 'enrol')} disabled={busyId === r.id}>
                            {busyId === r.id ? 'Working...' : 'Enrol & notify'}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => act(r, 'dismiss')} disabled={busyId === r.id}>
                            Dismiss
                          </Button>
                        </div>
                      </td>
                    )}
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

export default SigninRequestsView;
