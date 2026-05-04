import React, { useEffect, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { UserRole } from '@app-types';

interface PayoutHistoryRow {
  id: string;
  course_run_id: string;
  course_run_code: string | null;
  course_title: string | null;
  course_code: string | null;
  num_learners: number;
  actual_payout: string | number | null;
  payment_date: string | null;
  remark: string | null;
}

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const TrainerPayoutHistory: React.FC<{ trainerUserId: string }> = ({ trainerUserId }) => {
  const { role, currentUser } = useLms();
  const isOwnProfile = currentUser?.id === trainerUserId;
  const isPayrollUser = role === UserRole.Payroll;
  const visible = isOwnProfile || isPayrollUser;

  const [rows, setRows] = useState<PayoutHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !trainerUserId) return;
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
  }, [visible, trainerUserId]);

  if (!visible) return null;

  return (
    <section>
      <h2 className="text-xl font-bold mb-4">History of Payout</h2>
      {loading ? (
        <p className="text-sm text-on-surface-secondary">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-on-surface-secondary">No completed payouts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-default">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-700 text-left text-xs uppercase tracking-wider text-on-surface-secondary">
              <tr>
                <th className="px-3 py-2">Course Code</th>
                <th className="px-3 py-2">Course Title</th>
                <th className="px-3 py-2">Run ID</th>
                <th className="px-3 py-2">Payment Date</th>
                <th className="px-3 py-2 text-right">Actual Payout</th>
                <th className="px-3 py-2">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-default">
                  <td className="px-3 py-2 font-mono text-xs">{r.course_code || '-'}</td>
                  <td className="px-3 py-2">{r.course_title || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.course_run_code || '-'}</td>
                  <td className="px-3 py-2">{r.payment_date || '-'}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.actual_payout)}</td>
                  <td className="px-3 py-2 max-w-[16rem] truncate" title={r.remark || ''}>
                    {r.remark || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default TrainerPayoutHistory;
