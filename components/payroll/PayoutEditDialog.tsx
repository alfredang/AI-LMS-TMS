import React, { useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { authHeader } from '@lib/auth/authHeader';
import { findTier, PayoutTier } from '@lib/payroll/calculate';

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
  tiers?: PayoutTier[];
  onClose: () => void;
  onSaved: (updated: PayoutRow) => void;
}

const computeEstimated = (numLearners: number, courseFee: number, tierPercent: number) => {
  if (numLearners <= 0 || courseFee <= 0 || tierPercent <= 0) return 0;
  return Math.round(courseFee * numLearners * tierPercent) / 100;
};

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

const PayoutEditDialog: React.FC<Props> = ({ row, tiers, onClose, onSaved }) => {
  const [numLearners, setNumLearners] = useState<string>(String(row.num_learners ?? ''));
  const [courseFee, setCourseFee] = useState<string>(String(row.course_fee ?? ''));
  const [tierPercent, setTierPercent] = useState<string>(String(row.tier_percent ?? ''));
  const [actual, setActual] = useState<string>(
    row.actual_payout === null || row.actual_payout === undefined ? '' : String(row.actual_payout)
  );
  const [status, setStatus] = useState<PayoutRow['status']>(row.status);
  const [paymentDate, setPaymentDate] = useState<string>(row.payment_date || '');
  const [remark, setRemark] = useState<string>(row.remark || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const estimatedNum = useMemo(
    () => computeEstimated(Number(numLearners) || 0, Number(courseFee) || 0, Number(tierPercent) || 0),
    [numLearners, courseFee, tierPercent]
  );

  // Tier % suggested by the configured tiers for the current learner count.
  const suggestedTier = useMemo(() => {
    if (!tiers || tiers.length === 0) return null;
    const t = findTier(Number(numLearners) || 0, tiers);
    return t ? t.percent : null;
  }, [tiers, numLearners]);

  const dirty = useMemo(() => {
    const origActual = row.actual_payout === null || row.actual_payout === undefined ? '' : String(row.actual_payout);
    return (
      numLearners !== String(row.num_learners ?? '') ||
      courseFee !== String(row.course_fee ?? '') ||
      tierPercent !== String(row.tier_percent ?? '') ||
      actual !== origActual ||
      status !== row.status ||
      paymentDate !== (row.payment_date || '') ||
      remark !== (row.remark || '')
    );
  }, [numLearners, courseFee, tierPercent, actual, status, paymentDate, remark, row]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, confirmDiscard]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/payroll/payouts/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          num_learners: numLearners === '' ? null : Number(numLearners),
          course_fee: courseFee === '' ? null : Number(courseFee),
          tier_percent: tierPercent === '' ? null : Number(tierPercent),
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
              <label htmlFor="payout-learners" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                # Learners
              </label>
              <input
                id="payout-learners"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={numLearners}
                onChange={(e) => setNumLearners(e.target.value)}
                className="w-full border border-default rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="payout-tier" className="text-[11px] uppercase tracking-wider text-on-surface-secondary">
                  Tier %
                </label>
                {suggestedTier !== null && Number(tierPercent) !== suggestedTier && (
                  <button
                    type="button"
                    onClick={() => setTierPercent(String(suggestedTier))}
                    className="text-[11px] text-primary hover:underline normal-case"
                  >
                    Use {suggestedTier}%
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="payout-tier"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={tierPercent}
                  onChange={(e) => setTierPercent(e.target.value)}
                  className="w-full border border-default rounded-md pl-2 pr-7 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                  %
                </span>
              </div>
            </div>
            <div>
              <label htmlFor="payout-fee" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                Course Fee
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                  S$
                </span>
                <input
                  id="payout-fee"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={courseFee}
                  onChange={(e) => setCourseFee(e.target.value)}
                  className="w-full border border-default rounded-md pl-9 pr-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">Estimated Payout</div>
              <div className="font-semibold text-primary py-1.5">{fmtCurrency(estimatedNum)}</div>
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

      {confirmDiscard && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDiscard(false);
          }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-default w-full max-w-xs p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                <Icon name={IconName.Warning} className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Discard unsaved changes?</h3>
                <p className="text-xs text-on-surface-secondary mt-0.5">
                  Your edits to this payout will be lost.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="px-3 py-1.5 border border-default rounded-md text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
                className="px-3 py-1.5 bg-red-600 text-white rounded-md text-sm hover:bg-red-700"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayoutEditDialog;
