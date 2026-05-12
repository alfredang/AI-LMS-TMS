import React, { useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { authHeader } from '@lib/auth/authHeader';

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

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const STATUS_OPTIONS: { value: PayoutRow['status']; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const todayIso = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const PayoutEditDialog: React.FC<Props> = ({ row, onClose, onSaved }) => {
  const [actual, setActual] = useState<string>(
    row.actual_payout === null || row.actual_payout === undefined ? '' : String(row.actual_payout)
  );
  const [status, setStatus] = useState<PayoutRow['status']>(row.status);
  const [paymentDate, setPaymentDate] = useState<string>(row.payment_date || '');
  const [remark, setRemark] = useState<string>(row.remark || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimatedNum = Number(row.estimated_payout) || 0;

  const dirty = useMemo(() => {
    const origActual = row.actual_payout === null || row.actual_payout === undefined ? '' : String(row.actual_payout);
    return (
      actual !== origActual ||
      status !== row.status ||
      paymentDate !== (row.payment_date || '') ||
      remark !== (row.remark || '')
    );
  }, [actual, status, paymentDate, remark, row]);

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/payroll/payouts/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-default">
          <div className="min-w-0 pr-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon name={IconName.DollarSign} className="w-5 h-5 text-primary" />
              Edit Payout
            </h2>
            <p className="text-sm font-medium mt-1 truncate" title={row.course_title || ''}>
              {row.course_title || '-'}
            </p>
            <p className="text-xs text-on-surface-secondary mt-0.5 truncate">
              {row.course_code || '-'} · {row.course_run_code || '-'} · {row.trainer_name || 'Trainer'}
            </p>
          </div>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-slate-700"
          >
            <Icon name={IconName.X} className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-700/40 rounded-lg p-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary"># Learners</div>
              <div className="font-medium">{row.num_learners}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary">Tier %</div>
              <div className="font-medium">{row.tier_percent}%</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary">Course Fee</div>
              <div className="font-medium">{fmtCurrency(row.course_fee)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary">Estimated Payout</div>
              <div className="font-semibold text-primary">{fmtCurrency(row.estimated_payout)}</div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="payout-actual" className="text-xs font-medium">Actual Payout</label>
                {estimatedNum > 0 && (
                  <button
                    type="button"
                    onClick={() => setActual(estimatedNum.toFixed(2))}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Use estimated ({fmtCurrency(estimatedNum)})
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                  S$
                </span>
                <input
                  id="payout-actual"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  className="w-full border border-default rounded-md pl-9 pr-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label htmlFor="payout-status" className="block text-xs font-medium mb-1">Status</label>
              <select
                id="payout-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as PayoutRow['status'])}
                className="w-full border border-default rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {status === 'pending' && (
                <p className="mt-1 text-[11px] text-on-surface-secondary">
                  Trainer will only see this payout once status is set to Completed.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="payout-date" className="text-xs font-medium">Payment Date</label>
                <button
                  type="button"
                  onClick={() => setPaymentDate(todayIso())}
                  className="text-[11px] text-primary hover:underline"
                >
                  Today
                </button>
              </div>
              <input
                id="payout-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full border border-default rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label htmlFor="payout-remark" className="block text-xs font-medium mb-1">Remark</label>
              <textarea
                id="payout-remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={3}
                placeholder="Optional note (e.g. PayNow ref, adjustment reason)…"
                className="w-full border border-default rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-default flex justify-end gap-2 bg-gray-50 dark:bg-slate-800/80 rounded-b-xl">
          <button
            onClick={requestClose}
            className="px-3 py-1.5 border border-default rounded-md text-sm hover:bg-white dark:hover:bg-slate-700"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Icon name={IconName.Save} className="w-4 h-4" />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PayoutEditDialog;
