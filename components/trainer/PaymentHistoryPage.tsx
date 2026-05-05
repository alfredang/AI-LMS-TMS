import React, { useEffect, useState } from 'react';
import { useLms } from '@contexts/LmsContext';

interface PayoutHistoryRow {
  id: string;
  course_run_code: string | null;
  course_title: string | null;
  course_code: string | null;
  num_learners: number;
  actual_payout: string | number | null;
  payment_date: string | null;
  start_date: string | null;
  end_date: string | null;
}

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const fmtCourseDate = (start: string | null, end: string | null) => {
  if (!start && !end) return '-';
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end || '-';
};

const PaymentHistoryPage: React.FC = () => {
  const { currentUser } = useLms();
  const trainerUserId = currentUser?.id;

  const [rows, setRows] = useState<PayoutHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trainerUserId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/trainer/${trainerUserId}/payout-history`);
        const j = await r.json();
        if (cancelled) return;
        if (!j.success) throw new Error(j.error || 'Failed');
        setRows(j.data || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trainerUserId]);

  if (!trainerUserId) {
    return <p className="text-sm text-on-surface-secondary">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Trainer Payout History</h1>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border border-default">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-700 text-left text-xs uppercase tracking-wider text-on-surface-secondary">
            <tr>
              <th className="px-3 py-2">Course Date</th>
              <th className="px-3 py-2">Course Title</th>
              <th className="px-3 py-2">Course Code</th>
              <th className="px-3 py-2">Course Run ID</th>
              <th className="px-3 py-2 text-right">No of Pax</th>
              <th className="px-3 py-2 text-right">Trainer Fee</th>
              <th className="px-3 py-2">Payment Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-on-surface-secondary">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-on-surface-secondary">No completed payouts yet.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-default">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtCourseDate(r.start_date, r.end_date)}</td>
                  <td className="px-3 py-2">{r.course_title || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.course_code || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.course_run_code || '-'}</td>
                  <td className="px-3 py-2 text-right">{r.num_learners ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.actual_payout)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.payment_date || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PaymentHistoryPage;
