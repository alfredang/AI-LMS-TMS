import React, { useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { findTier, payoutAmount, PayoutTier } from '@lib/payroll/calculate';
import { authHeader } from '@lib/auth/authHeader';
import { fmtCurrency } from './shared';
import DateRangeCell from '../ui/DateRangeCell';

export interface ManualClass {
  id: string;
  class_title: string;
  course_code: string | null;
  trainer_id: string | null;
  trainer_name: string;
  start_date: string | null;
  end_date: string | null;
  num_learners: number;
  course_fee: number | string;
  tier_percent: number | string;
  estimated_payout: number | string;
  actual_payout: number | string | null;
  status: 'pending' | 'completed' | 'cancelled';
  payment_date: string | null;
  remark: string | null;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  initial?: ManualClass | null;
  tiers?: PayoutTier[];
  onClose: () => void;
  onSaved: (row: ManualClass) => void;
  onDeleted?: (id: string) => void;
}

const STATUS_OPTIONS: {
  value: ManualClass['status'];
  label: string;
  dot: string;
  active: string;
}[] = [
  {
    value: 'pending',
    label: 'Pending',
    dot: 'bg-amber-500',
    active: 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-900/30 dark:text-amber-200',
  },
  {
    value: 'completed',
    label: 'Completed',
    dot: 'bg-emerald-500',
    active: 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-200',
  },
  {
    value: 'cancelled',
    label: 'Cancelled',
    dot: 'bg-red-500',
    active: 'border-red-400 bg-red-50 text-red-700 dark:border-red-500/60 dark:bg-red-900/30 dark:text-red-200',
  },
];

const todayIso = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const inputCls =
  'w-full border border-default rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30';

const ManualClassDialog: React.FC<Props> = ({ initial, tiers, onClose, onSaved, onDeleted }) => {
  const isEdit = !!initial;

  const [classTitle, setClassTitle] = useState(initial?.class_title ?? '');
  const [courseCode, setCourseCode] = useState(initial?.course_code ?? '');
  const [trainerName, setTrainerName] = useState(initial?.trainer_name ?? '');
  const [startDate, setStartDate] = useState(initial?.start_date ?? '');
  const [endDate, setEndDate] = useState(initial?.end_date ?? '');
  const [numLearners, setNumLearners] = useState<string>(
    initial ? String(initial.num_learners ?? '') : ''
  );
  const [courseFee, setCourseFee] = useState<string>(initial ? String(initial.course_fee ?? '') : '');
  const [tierPercent, setTierPercent] = useState<string>(initial ? String(initial.tier_percent ?? '') : '');
  const [actual, setActual] = useState<string>(
    initial?.actual_payout === null || initial?.actual_payout === undefined ? '' : String(initial.actual_payout)
  );
  const [status, setStatus] = useState<ManualClass['status']>(initial?.status ?? 'pending');
  const [paymentDate, setPaymentDate] = useState<string>(initial?.payment_date ?? '');
  const [remark, setRemark] = useState<string>(initial?.remark ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const estimatedNum = useMemo(
    () => payoutAmount(Number(numLearners) || 0, Number(courseFee) || 0, Number(tierPercent) || 0),
    [numLearners, courseFee, tierPercent]
  );

  const suggestedTier = useMemo(() => {
    if (!tiers || tiers.length === 0) return null;
    const t = findTier(Number(numLearners) || 0, tiers);
    return t ? t.percent : null;
  }, [tiers, numLearners]);

  const dirty = useMemo(() => {
    const orig = {
      classTitle: initial?.class_title ?? '',
      courseCode: initial?.course_code ?? '',
      trainerName: initial?.trainer_name ?? '',
      startDate: initial?.start_date ?? '',
      endDate: initial?.end_date ?? '',
      numLearners: initial ? String(initial.num_learners ?? '') : '',
      courseFee: initial ? String(initial.course_fee ?? '') : '',
      tierPercent: initial ? String(initial.tier_percent ?? '') : '',
      actual: initial?.actual_payout === null || initial?.actual_payout === undefined ? '' : String(initial.actual_payout),
      status: initial?.status ?? 'pending',
      paymentDate: initial?.payment_date ?? '',
      remark: initial?.remark ?? '',
    };
    return (
      classTitle !== orig.classTitle ||
      courseCode !== orig.courseCode ||
      trainerName !== orig.trainerName ||
      startDate !== orig.startDate ||
      endDate !== orig.endDate ||
      numLearners !== orig.numLearners ||
      courseFee !== orig.courseFee ||
      tierPercent !== orig.tierPercent ||
      actual !== orig.actual ||
      status !== orig.status ||
      paymentDate !== orig.paymentDate ||
      remark !== orig.remark
    );
  }, [classTitle, courseCode, trainerName, startDate, endDate, numLearners, courseFee, tierPercent, actual, status, paymentDate, remark, initial]);

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
    setError(null);
    if (!classTitle.trim()) return setError('Class title is required.');
    if (!trainerName.trim()) return setError('Trainer name is required.');
    if (Number(tierPercent) < 0 || Number(tierPercent) > 100) return setError('Tier % must be between 0 and 100.');
    if (actual !== '' && !(Number(actual) >= 0)) return setError('Actual payout must be 0 or more.');
    if (startDate && endDate && endDate < startDate) return setError('End date must be on or after the start date.');

    setSaving(true);
    const body = {
      class_title: classTitle.trim(),
      course_code: courseCode.trim() || null,
      trainer_name: trainerName.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      num_learners: numLearners === '' ? 0 : Number(numLearners),
      course_fee: courseFee === '' ? 0 : Number(courseFee),
      tier_percent: tierPercent === '' ? 0 : Number(tierPercent),
      actual_payout: actual === '' ? null : Number(actual),
      status,
      payment_date: paymentDate || null,
      remark: remark.trim() || null,
    };
    try {
      const url = isEdit ? `/api/payroll/manual-classes/${initial!.id}` : '/api/payroll/manual-classes';
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to save');
      onSaved(j.data as ManualClass);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!initial) return;
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/payroll/manual-classes/${initial.id}`, {
        method: 'DELETE',
        headers: { ...authHeader() },
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to delete');
      onDeleted?.(initial.id);
    } catch (e: any) {
      setError(e?.message || 'Failed to delete');
      setDeleting(false);
      setConfirmDelete(false);
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
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-default bg-primary/[0.03] dark:bg-primary/[0.06]">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
              <Icon name={IconName.BookOpen} className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">
                {isEdit ? 'Edit Non-WSQ Class' : 'Add Non-WSQ Class'}
              </h2>
              <p className="text-xs text-on-surface-secondary mt-1">
                Non-funded class — payroll-only, never shown in Admin class management.
              </p>
            </div>
          </div>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-slate-700 flex-shrink-0"
          >
            <Icon name={IconName.X} className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Class details */}
          <div className="space-y-3">
            <div>
              <label htmlFor="mc-title" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                Class Title *
              </label>
              <input
                id="mc-title"
                type="text"
                value={classTitle}
                onChange={(e) => setClassTitle(e.target.value)}
                placeholder="e.g. Corporate Python Bootcamp"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mc-code" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                  Course Code
                </label>
                <input
                  id="mc-code"
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="Optional"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="mc-trainer" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                  Trainer Name *
                </label>
                <input
                  id="mc-trainer"
                  type="text"
                  value={trainerName}
                  onChange={(e) => setTrainerName(e.target.value)}
                  placeholder="e.g. Jane Tan"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                  Start Date
                </label>
                <DateRangeCell singleDate standalone value={startDate} onChange={setStartDate} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                  End Date
                </label>
                <DateRangeCell singleDate standalone value={endDate} onChange={setEndDate} />
              </div>
            </div>
          </div>

          {/* Calculation inputs + live estimate */}
          <div className="rounded-lg border border-default overflow-hidden">
            <div className="grid grid-cols-3 gap-3 p-3">
              <div>
                <label htmlFor="mc-learners" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                  # Learners
                </label>
                <input
                  id="mc-learners"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={numLearners}
                  onChange={(e) => setNumLearners(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="mc-fee" className="block text-[11px] uppercase tracking-wider text-on-surface-secondary mb-1">
                  Course Fee
                </label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                    S$
                  </span>
                  <input
                    id="mc-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={courseFee}
                    onChange={(e) => setCourseFee(e.target.value)}
                    className={`${inputCls} pl-7`}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1 gap-1">
                  <label htmlFor="mc-tier" className="text-[11px] uppercase tracking-wider text-on-surface-secondary">
                    Tier %
                  </label>
                  {suggestedTier !== null && Number(tierPercent) !== suggestedTier && (
                    <button
                      type="button"
                      onClick={() => setTierPercent(String(suggestedTier))}
                      className="text-[11px] text-primary hover:underline normal-case whitespace-nowrap"
                    >
                      Use {suggestedTier}%
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="mc-tier"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    inputMode="decimal"
                    value={tierPercent}
                    onChange={(e) => setTierPercent(e.target.value)}
                    className={`${inputCls} pr-7`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                    %
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between gap-3 px-3 py-2.5 bg-primary/5 dark:bg-primary/10 border-t border-primary/20">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider font-medium text-primary/80">Estimated Payout</div>
                {estimatedNum > 0 && (
                  <div className="text-[11px] text-on-surface-secondary mt-0.5 truncate">
                    {Number(numLearners) || 0} learner{(Number(numLearners) || 0) === 1 ? '' : 's'} × {fmtCurrency(courseFee)} × {Number(tierPercent) || 0}%
                  </div>
                )}
              </div>
              <div className="text-xl font-bold text-primary leading-none">{fmtCurrency(estimatedNum)}</div>
            </div>
          </div>

          {/* Actual payout — primary field */}
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 dark:bg-primary/10 p-3">
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <label htmlFor="mc-actual" className="text-sm font-semibold">Actual Payout</label>
              {estimatedNum > 0 && (
                <button
                  type="button"
                  onClick={() => setActual(estimatedNum.toFixed(2))}
                  className="text-[11px] text-primary hover:underline whitespace-nowrap"
                >
                  Use estimated ({fmtCurrency(estimatedNum)})
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-medium text-on-surface-secondary pointer-events-none">
                S$
              </span>
              <input
                id="mc-actual"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                className="w-full border border-default rounded-md pl-10 pr-3 py-2.5 text-lg font-semibold bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Status + payment */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1.5">Status</label>
              <div className="grid grid-cols-3 gap-2">
                {STATUS_OPTIONS.map((o) => {
                  const active = status === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setStatus(o.value)}
                      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? o.active
                          : 'border-default text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${active ? o.dot : 'bg-gray-300 dark:bg-slate-500'}`} />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="mc-date" className="text-xs font-medium">Payment Date</label>
                <button
                  type="button"
                  onClick={() => setPaymentDate(todayIso())}
                  className="text-[11px] text-primary hover:underline"
                >
                  Today
                </button>
              </div>
              <DateRangeCell singleDate standalone value={paymentDate} onChange={setPaymentDate} />
            </div>

            <div>
              <label htmlFor="mc-remark" className="block text-xs font-medium mb-1">Remark</label>
              <textarea
                id="mc-remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={2}
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

        {/* Footer */}
        <div className="px-5 py-3 border-t border-default flex justify-end items-center gap-2 bg-gray-50 dark:bg-slate-800/80 rounded-b-xl">
          {isEdit && onDeleted && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300 dark:border-red-800/60 text-red-700 dark:text-red-300 rounded-md text-sm hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              <Icon name={IconName.Delete} className="w-4 h-4" />
              Delete
            </button>
          )}
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
                {isEdit ? 'Save changes' : 'Add class'}
              </>
            )}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleting) setConfirmDelete(false);
          }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-default w-full max-w-xs p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                <Icon name={IconName.Delete} className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Delete this class?</h3>
                <p className="text-xs text-on-surface-secondary mt-0.5">
                  {initial?.class_title} and its payout record will be permanently removed. This
                  cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-1.5 border border-default rounded-md text-sm hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  Your edits to this class will be lost.
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

export default ManualClassDialog;
