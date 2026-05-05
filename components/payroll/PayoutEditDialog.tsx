import React, { useState } from 'react';

export interface PayoutRow {
  id: string;
  course_run_id: string;
  course_run_code?: string | null;
  course_title?: string | null;
  course_code?: string | null;
  trainer_id: string;
  trainer_name?: string | null;
  num_learners: number;
  course_fee: number | string;
  tier_percent: number | string;
  estimated_payout: number | string;
  actual_payout: number | string | null;
  status: 'pending' | 'completed' | 'cancelled';
  payment_date: string | null;
  remark: string | null;
}

interface Props {
  row: PayoutRow;
  onClose: () => void;
  onSaved: (updated: PayoutRow) => void;
}

const PayoutEditDialog: React.FC<Props> = ({ row, onClose, onSaved }) => {
  const [actual, setActual] = useState<string>(
    row.actual_payout === null || row.actual_payout === undefined ? '' : String(row.actual_payout)
  );
  const [status, setStatus] = useState<PayoutRow['status']>(row.status);
  const [paymentDate, setPaymentDate] = useState<string>(row.payment_date || '');
  const [remark, setRemark] = useState<string>(row.remark || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/payroll/payouts/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actual_payout: actual === '' ? null : Number(actual),
          status,
          payment_date: paymentDate || null,
          remark: remark || null,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to save');
      onSaved(j.data);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-lg p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Edit Payout</h2>
            <p className="text-xs text-on-surface-secondary">
              {row.course_code} · Run {row.course_run_code} · {row.trainer_name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <div className="text-xs text-on-surface-secondary"># Learners</div>
            <div>{row.num_learners}</div>
          </div>
          <div>
            <div className="text-xs text-on-surface-secondary">Tier %</div>
            <div>{row.tier_percent}%</div>
          </div>
          <div>
            <div className="text-xs text-on-surface-secondary">Course Fee</div>
            <div>{Number(row.course_fee).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-on-surface-secondary">Estimated Payout</div>
            <div>{Number(row.estimated_payout).toFixed(2)}</div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Actual Payout (SGD)</div>
            <input
              type="number"
              step="0.01"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              className="w-full border rounded px-2 py-1 bg-white dark:bg-slate-700"
              placeholder="leave blank to clear"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PayoutRow['status'])}
              className="w-full border rounded px-2 py-1 bg-white dark:bg-slate-700"
            >
              <option value="pending">pending</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Payment Date</div>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full border rounded px-2 py-1 bg-white dark:bg-slate-700"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Remark</div>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
              className="w-full border rounded px-2 py-1 bg-white dark:bg-slate-700"
            />
          </label>
        </div>

        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 border rounded text-sm" disabled={saving}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1 bg-primary text-white rounded text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PayoutEditDialog;
