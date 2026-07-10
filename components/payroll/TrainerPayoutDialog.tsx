import React, { useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { PayoutRow } from './PayoutEditDialog';
import { authHeader } from '@lib/auth/authHeader';
import { fmtDate } from '@lib/payroll/formatDate';
import DateRangeCell from '../ui/DateRangeCell';
import { NonWsqTag, NON_WSQ_ROW, NON_WSQ_ACCENT } from './shared';

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const todayIso = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Native <option> elements ignore the parent theme; force matching colors.
const OPTION_CLASS = 'bg-white text-gray-900 dark:bg-slate-800 dark:text-white';

const SummaryCard: React.FC<{ label: string; value: string; tone?: 'amber' | 'green' | 'blue' }> = ({
  label,
  value,
  tone = 'blue',
}) => {
  const toneClasses =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'green'
      ? 'text-green-700 dark:text-green-300'
      : 'text-on-surface';
  return (
    <div className="bg-gray-50 dark:bg-slate-700/40 rounded-lg p-3 border border-default">
      <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium">{label}</div>
      <div className={`text-lg font-bold leading-tight mt-0.5 truncate ${toneClasses}`} title={value}>
        {value}
      </div>
    </div>
  );
};

type Draft = {
  learners: string;
  fee: string;
  tier: string;
  actual: string;
  status: PayoutRow['status'];
  payment_date: string;
  remark: string;
};

const buildDraft = (r: PayoutRow): Draft => ({
  learners: r.num_learners === null || r.num_learners === undefined ? '' : String(r.num_learners),
  fee: r.course_fee === null || r.course_fee === undefined ? '' : String(r.course_fee),
  tier: r.tier_percent === null || r.tier_percent === undefined ? '' : String(r.tier_percent),
  // Default the actual payout to the estimated amount for unpaid (non-cancelled) rows so
  // it comes pre-filled. This is the baseline too, so it doesn't read as an unsaved change
  // until the user edits it or marks the row paid.
  actual:
    r.actual_payout !== null && r.actual_payout !== undefined
      ? String(r.actual_payout)
      : r.status !== 'cancelled' && Number(r.estimated_payout) > 0
        ? Number(r.estimated_payout).toFixed(2)
        : '',
  status: r.status,
  payment_date: r.payment_date || '',
  remark: r.remark || '',
});

const draftsEqual = (a: Draft, b: Draft) =>
  a.learners === b.learners &&
  a.fee === b.fee &&
  a.tier === b.tier &&
  a.actual === b.actual &&
  a.status === b.status &&
  a.payment_date === b.payment_date &&
  a.remark === b.remark;

// Mirrors the server/single-dialog calc: fee × learners × tier%, rounded to cents.
const computeEstimated = (d: Draft) => {
  const num = Number(d.learners) || 0;
  const fee = Number(d.fee) || 0;
  const tier = Number(d.tier) || 0;
  if (num <= 0 || fee <= 0 || tier <= 0) return 0;
  return Math.round(fee * num * tier) / 100;
};

interface Props {
  trainerName: string;
  rows: PayoutRow[];
  onClose: () => void;
  /** Called for each row saved; parent updates its master list. */
  onSaved: (updated: PayoutRow) => void;
}

const TrainerPayoutDialog: React.FC<Props> = ({ trainerName, rows, onClose, onSaved }) => {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const d: Record<string, Draft> = {};
    rows.forEach((r) => { d[r.id] = buildDraft(r); });
    return d;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Seed drafts for any newly-appearing rows without clobbering in-progress edits.
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      rows.forEach((r) => {
        if (!next[r.id]) { next[r.id] = buildDraft(r); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [rows]);

  const setField = <K extends keyof Draft>(id: string, key: K, val: Draft[K]) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));

  const dirtyRows = useMemo(
    () => rows.filter((r) => drafts[r.id] && !draftsEqual(drafts[r.id], buildDraft(r))),
    [rows, drafts]
  );

  const totals = useMemo(() => {
    return {
      classes: rows.length,
      // Live projections from the current drafts.
      learners: rows.reduce((acc, r) => acc + (Number((drafts[r.id] || buildDraft(r)).learners) || 0), 0),
      estimated: rows.reduce((acc, r) => acc + computeEstimated(drafts[r.id] || buildDraft(r)), 0),
      // Realized (saved) amount.
      actual: rows.reduce((acc, r) => {
        const v = Number(r.actual_payout ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0),
      pending: rows.filter((r) => r.status === 'pending').length,
      completed: rows.filter((r) => r.status === 'completed').length,
    };
  }, [rows, drafts]);

  const requestClose = () => {
    if (saving) return;
    if (dirtyRows.length > 0) { setConfirmDiscard(true); return; }
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
  }, [dirtyRows.length, saving, confirmDiscard]);

  // Every row already marked Completed (in the current drafts)?
  const allCompleted = useMemo(
    () => rows.length > 0 && rows.every((r) => (drafts[r.id] || buildDraft(r)).status === 'completed'),
    [rows, drafts]
  );

  const markAllPaid = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        const cur = next[r.id] || buildDraft(r);
        if (cur.status === 'completed') return;
        const est = computeEstimated(cur);
        next[r.id] = {
          ...cur,
          actual: cur.actual !== '' ? cur.actual : (est > 0 ? est.toFixed(2) : ''),
          status: 'completed',
          payment_date: cur.payment_date || todayIso(),
        };
      });
      return next;
    });
  };

  // Reverse "mark all as paid": set every row back to Pending (amounts/dates kept).
  const unmarkAll = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        const cur = next[r.id] || buildDraft(r);
        if (cur.status !== 'completed') return;
        next[r.id] = { ...cur, status: 'pending' };
      });
      return next;
    });
  };

  const save = async () => {
    setError(null);
    // Block the whole save if any row has a negative/invalid actual payout.
    const bad = dirtyRows.find((r) => {
      const a = drafts[r.id].actual;
      return a !== '' && !(Number(a) >= 0);
    });
    if (bad) {
      setError(`Actual payout must be 0 or more (check "${bad.course_title || bad.course_code || 'a class'}").`);
      return;
    }
    setSaving(true);
    // Save each dirty row independently: one row failing must not silently abort the
    // rest. Successful rows are persisted/reset; failures are collected and reported.
    let savedCount = 0;
    const failed: string[] = [];
    for (const r of dirtyRows) {
      const d = drafts[r.id];
      try {
        // Route to the right table: non-WSQ rows live in payroll_manual_class.
        const endpoint =
          r.source === 'manual'
            ? `/api/payroll/manual-classes/${r.id}`
            : `/api/payroll/payouts/${r.id}`;
        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({
            num_learners: d.learners === '' ? null : Number(d.learners),
            course_fee: d.fee === '' ? null : Number(d.fee),
            tier_percent: d.tier === '' ? null : Number(d.tier),
            actual_payout: d.actual === '' ? null : Number(d.actual),
            status: d.status,
            payment_date: d.payment_date || null,
            remark: d.remark || null,
          }),
        });
        const j = await res.json();
        if (!j.success) throw new Error(j.error || 'save failed');
        onSaved(j.data);
        setDrafts((prev) => ({ ...prev, [r.id]: buildDraft(j.data) }));
        savedCount += 1;
      } catch {
        failed.push(r.course_title || r.course_code || 'a class');
      }
    }
    setSaving(false);
    if (failed.length > 0) {
      setError(
        `${savedCount} saved · ${failed.length} failed to save: ${failed.join(', ')}. Please try again.`
      );
    }
  };

  // "Ghost cell" inputs: read as plain text, reveal a border on hover, lift on focus.
  const cellBase =
    'w-full rounded-md px-2 py-1.5 text-sm bg-transparent border border-transparent transition-colors ' +
    'hover:border-default focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 ' +
    'focus:bg-white dark:focus:bg-slate-700';
  const numCell =
    `${cellBase} text-right tabular-nums [appearance:textfield] ` +
    '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  // Left-aligned numeric input, so a leading "$" can sit tight against the number.
  const numCellLeft =
    `${cellBase} text-left tabular-nums [appearance:textfield] ` +
    '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  const selectCell =
    'w-full rounded-md pl-2 pr-7 py-1.5 text-sm bg-transparent border border-transparent transition-colors ' +
    'hover:border-default focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 ' +
    'focus:bg-white dark:focus:bg-slate-700 cursor-pointer';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-default">
          <div className="min-w-0 pr-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon name={IconName.Users} className="w-5 h-5 text-primary" />
              <span className="uppercase truncate" title={trainerName}>{trainerName}</span>
            </h2>
            <p className="text-sm text-on-surface-secondary mt-1">
              Consolidated payouts across {totals.classes} class{totals.classes === 1 ? '' : 'es'}
              {totals.pending > 0 ? ` · ${totals.pending} pending` : ''}
              {totals.completed > 0 ? ` · ${totals.completed} completed` : ''}
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

        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Classes" value={String(totals.classes)} />
          <SummaryCard label="Learners" value={String(totals.learners)} />
          <SummaryCard label="Est. Payout" value={fmtCurrency(totals.estimated)} tone="amber" />
          <SummaryCard label="Actual Paid" value={fmtCurrency(totals.actual)} tone="green" />
        </div>

        <div className="px-5 pb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-on-surface-secondary">Edit the fields below, then save.</p>
          <button
            type="button"
            onClick={allCompleted ? unmarkAll : markAllPaid}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-default rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface"
          >
            {allCompleted ? (
              <>
                <Icon name={IconName.Clock} className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                Unmark all as paid
              </>
            ) : (
              <>
                <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                Mark all as paid
              </>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-auto mx-5 mb-2 border border-default rounded-lg">
          <table className="min-w-full text-sm">
              <thead className="bg-gray-100 dark:bg-slate-700 text-left text-xs uppercase tracking-wider text-on-surface-secondary sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-3 py-2 whitespace-nowrap">Course</th>
                  <th className="px-3 py-2 whitespace-nowrap">Start</th>
                  <th className="px-2 py-2 whitespace-nowrap text-right">Pax</th>
                  <th className="px-2 py-2 whitespace-nowrap text-right">Course Fee</th>
                  <th className="px-2 py-2 whitespace-nowrap text-right">Tier %</th>
                  <th className="px-2 py-2 whitespace-nowrap text-right">Est.</th>
                  <th className="px-2 py-2 whitespace-nowrap text-right">Actual Payout</th>
                  <th className="px-2 py-2 whitespace-nowrap">Status</th>
                  <th className="px-2 py-2 whitespace-nowrap">Payment Date</th>
                  <th className="px-2 py-2 whitespace-nowrap">Remark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = drafts[r.id] || buildDraft(r);
                  const est = computeEstimated(d);
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-default align-middle ${
                        r.source === 'manual'
                          ? NON_WSQ_ROW
                          : 'even:bg-gray-50/50 dark:even:bg-slate-700/20'
                      }`}
                    >
                      <td
                        className={`px-3 py-2 max-w-[15rem] ${
                          r.source === 'manual' ? `border-l-2 ${NON_WSQ_ACCENT}` : ''
                        }`}
                        title={r.course_title || ''}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate" title={r.course_title || ''}>{r.course_title || '-'}</span>
                          {r.source === 'manual' && <NonWsqTag />}
                        </div>
                        <div className="text-[11px] text-on-surface-secondary font-mono truncate">
                          {r.source === 'manual'
                            ? (r.course_code || 'Non-WSQ class')
                            : `${r.course_code || '-'} · ${r.course_run_code || '-'}`}
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-on-surface-secondary">{fmtDate(r.start_date)}</td>
                      <td className="px-1 py-1.5 w-16">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={d.learners}
                          onChange={(e) => setField(r.id, 'learners', e.target.value)}
                          className={numCell}
                        />
                      </td>
                      <td className="px-1 py-1.5 w-24">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={d.fee}
                          onChange={(e) => setField(r.id, 'fee', e.target.value)}
                          className={numCell}
                        />
                      </td>
                      <td className="px-1 py-1.5 w-16">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          inputMode="decimal"
                          value={d.tier}
                          onChange={(e) => setField(r.id, 'tier', e.target.value)}
                          className={numCell}
                        />
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap font-semibold tabular-nums">{fmtCurrency(est)}</td>
                      <td className="px-1 py-1.5 w-28">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={d.actual}
                            onChange={(e) => setField(r.id, 'actual', e.target.value)}
                            placeholder={est > 0 ? est.toFixed(2) : '0.00'}
                            className={`${numCellLeft} pl-5`}
                          />
                        </div>
                      </td>
                      <td className="px-1 py-1.5 w-32 min-w-[7.5rem]">
                        <select
                          value={d.status}
                          onChange={(e) => setField(r.id, 'status', e.target.value as PayoutRow['status'])}
                          className={selectCell}
                        >
                          <option className={OPTION_CLASS} value="pending">Pending</option>
                          <option className={OPTION_CLASS} value="completed">Completed</option>
                          <option className={OPTION_CLASS} value="cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5 w-40 text-center">
                        <DateRangeCell
                          singleDate
                          compact
                          value={d.payment_date}
                          onChange={(v) => setField(r.id, 'payment_date', v)}
                          placeholder="Select Date"
                        />
                      </td>
                      <td className="px-1 py-1.5 min-w-[10rem]">
                        <input
                          type="text"
                          value={d.remark}
                          onChange={(e) => setField(r.id, 'remark', e.target.value)}
                          placeholder="Add remarks…"
                          className={cellBase}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>

        {error && (
          <div className="mx-5 mb-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="px-5 py-3 border-t border-default flex items-center justify-between gap-2 bg-gray-50 dark:bg-slate-800/80 rounded-b-xl">
          <div className="text-xs text-on-surface-secondary">
            {dirtyRows.length > 0
              ? `${dirtyRows.length} unsaved change${dirtyRows.length === 1 ? '' : 's'}`
              : 'All changes saved'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={requestClose}
              disabled={saving}
              className="px-3 py-1.5 border border-default rounded-md text-sm hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={saving || dirtyRows.length === 0}
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
                  Save changes{dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ''}
                </>
              )}
            </button>
          </div>
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
                  {dirtyRows.length} class{dirtyRows.length === 1 ? '' : 'es'} have edits that will be lost.
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
                onClick={() => { setConfirmDiscard(false); onClose(); }}
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

export default TrainerPayoutDialog;
