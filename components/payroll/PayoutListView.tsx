import React, { useEffect, useState, useCallback } from 'react';
import PayoutEditDialog, { PayoutRow } from './PayoutEditDialog';

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cls =
    status === 'completed'
      ? 'bg-green-100 text-green-800'
      : status === 'cancelled'
      ? 'bg-gray-200 text-gray-700'
      : 'bg-yellow-100 text-yellow-800';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
};

const PayoutListView: React.FC = () => {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayoutRow | null>(null);
  const [months, setMonths] = useState(2);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/payroll/payouts?months=${months}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to load payouts');
      setRows(j.data.payouts || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trainer Payouts</h1>
          <p className="text-sm text-on-surface-secondary">
            Completed classes in the last {months} month{months === 1 ? '' : 's'} with estimated and actual trainer payout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">Window:</label>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="border rounded px-2 py-1 text-sm bg-white dark:bg-slate-800"
          >
            <option value={1}>1 month</option>
            <option value={2}>2 months</option>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </select>
          <button
            onClick={load}
            className="px-3 py-1 text-sm bg-primary text-white rounded hover:opacity-90"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-sm">{error}</div>
      )}

      <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-default">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-700 text-left text-xs uppercase tracking-wider text-on-surface-secondary">
            <tr>
              <th className="px-3 py-2">Course Title</th>
              <th className="px-3 py-2">Course Code</th>
              <th className="px-3 py-2">Run ID</th>
              <th className="px-3 py-2">Trainer</th>
              <th className="px-3 py-2 text-right"># Learners</th>
              <th className="px-3 py-2 text-right">Course Fee</th>
              <th className="px-3 py-2 text-right">Est. Payout</th>
              <th className="px-3 py-2 text-right">Actual Payout</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Payment Date</th>
              <th className="px-3 py-2">Remark</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-on-surface-secondary">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-on-surface-secondary">
                  No completed classes in window.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-t border-default hover:bg-gray-50 dark:hover:bg-slate-700/50">
                  <td className="px-3 py-2">{r.course_title || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.course_code || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.course_run_code || '-'}</td>
                  <td className="px-3 py-2">{r.trainer_name || '-'}</td>
                  <td className="px-3 py-2 text-right">{r.num_learners}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.course_fee)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.estimated_payout)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtCurrency(r.actual_payout)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">{r.payment_date || '-'}</td>
                  <td className="px-3 py-2 max-w-[14rem] truncate" title={r.remark || ''}>
                    {r.remark || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setEditing(r)}
                      className="px-2 py-1 text-xs border rounded hover:bg-gray-100 dark:hover:bg-slate-700"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <PayoutEditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
};

export default PayoutListView;
