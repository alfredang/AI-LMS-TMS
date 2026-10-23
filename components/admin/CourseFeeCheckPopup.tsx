/**
 * Course-fee pre-flight popup for Company Application.
 *
 * `confirmCourseFees(items)` asks the server whether each course's LMS fee is
 * set and agrees with its QuickBooks product. All clear → resolves true with no
 * popup. Otherwise it lists the problem courses, each with a box to enter the
 * correct fee. Saving writes it to the course (so this and every later
 * enrolment / invoice uses it) and, if ticked, sets the QuickBooks product
 * price to match. The admin then continues, or goes back.
 *
 * Continuing with an unfixed course is allowed because SSG enrolment does not
 * depend on our fee — but its invoice will refuse to generate until the fees
 * agree, and the popup says so. If the check itself fails it never blocks.
 */
import { useCallback, useRef, useState } from 'react';
import { ConfirmPopup } from './ConfirmPopup';
import { IconName } from '../ui/Icon';

export interface CourseFeeCheckItem {
  courseRunId?: string;
  courseReferenceNumber?: string;
  courseTitle?: string;
}

interface CourseFeeIssue {
  courseId: string;
  courseTitle: string;
  courseReferenceNumber: string;
  lmsFee: number | null;
  qboPrice: number | null;
  problem: 'no_lms_fee' | 'no_qbo_product' | 'mismatch';
}

interface RowState {
  input: string;
  updateQuickBooks: boolean;
  saving: boolean;
  /** Message after a save attempt; `ok` decides its colour. */
  result?: { ok: boolean; text: string };
  fixed: boolean;
}

const money = (n: number | null) => (n == null ? 'not set' : `$${n.toFixed(2)}`);

function describe(issue: CourseFeeIssue): string {
  switch (issue.problem) {
    case 'no_lms_fee':
      return 'Course fee is not set in the LMS.';
    case 'no_qbo_product':
      return `No QuickBooks product with SKU ${issue.courseReferenceNumber || '(no code)'} — create it in QuickBooks before invoicing.`;
    case 'mismatch':
      return `LMS fee ${money(issue.lmsFee)} but QuickBooks price ${money(issue.qboPrice)}.`;
  }
}

const keyOf = (i: CourseFeeIssue) => `${i.courseId}|${i.courseReferenceNumber}`;

export function useCourseFeeCheck(actionLabel = 'Continue anyway') {
  const [issues, setIssues] = useState<CourseFeeIssue[] | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const resolver = useRef<((proceed: boolean) => void) | null>(null);

  const confirmCourseFees = useCallback(async (items: CourseFeeCheckItem[]): Promise<boolean> => {
    const useful = items.filter(i => i.courseRunId || i.courseReferenceNumber || i.courseTitle);
    if (useful.length === 0) return true;
    let found: CourseFeeIssue[] = [];
    try {
      const res = await fetch('/api/admin/ca-course-fee-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: useful }),
      });
      const data = await res.json().catch(() => null);
      found = res.ok && Array.isArray(data?.issues) ? data.issues : [];
    } catch {
      return true; // a failed pre-check must never stop an enrolment
    }
    if (found.length === 0) return true;
    setRowState(
      Object.fromEntries(
        found.map(i => [
          keyOf(i),
          {
            // Start from the number we have; the admin confirms it against SSG.
            input: i.problem === 'mismatch' && i.qboPrice != null ? String(i.qboPrice) : i.lmsFee != null ? String(i.lmsFee) : '',
            updateQuickBooks: i.problem !== 'no_qbo_product',
            saving: false,
            fixed: false,
          },
        ]),
      ),
    );
    setIssues(found);
    return new Promise<boolean>(resolve => {
      resolver.current = resolve;
    });
  }, []);

  const close = (proceed: boolean) => {
    setIssues(null);
    resolver.current?.(proceed);
    resolver.current = null;
  };

  const patchRow = (key: string, patch: Partial<RowState>) =>
    setRowState(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const saveFee = async (issue: CourseFeeIssue) => {
    const key = keyOf(issue);
    const state = rowState[key];
    const fee = Number(String(state?.input ?? '').replace(/[$,\s]/g, ''));
    if (!Number.isFinite(fee) || fee <= 0) {
      patchRow(key, { result: { ok: false, text: 'Enter the course fee before GST, e.g. 720.' } });
      return;
    }
    patchRow(key, { saving: true, result: undefined });
    try {
      const res = await fetch('/api/admin/ca-course-fee-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: issue.courseId,
          courseReferenceNumber: issue.courseReferenceNumber,
          fee,
          updateQuickBooks: state.updateQuickBooks,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `Save failed (${res.status})`);
      // Fixed once QuickBooks agrees too: either we set it, or it already had
      // this price. (Unknown QuickBooks price + not ticked → the invoice guard
      // still checks it at invoice time.)
      const qbAgrees = state.updateQuickBooks
        ? !data.qboError
        : issue.qboPrice == null || Math.abs(issue.qboPrice - fee) < 0.005;
      const parts = [`Saved — this course now uses $${fee.toFixed(2)}.`];
      if (data.qboUpdated) parts.push('QuickBooks product price updated to match.');
      if (data.qboError) parts.push(data.qboError);
      if (!state.updateQuickBooks && !qbAgrees) parts.push(`QuickBooks still says ${money(issue.qboPrice)} — tick "Also set the QuickBooks price" or fix it there.`);
      patchRow(key, { saving: false, fixed: qbAgrees, result: { ok: qbAgrees, text: parts.join(' ') } });
    } catch (err) {
      patchRow(key, { saving: false, result: { ok: false, text: err instanceof Error ? err.message : 'Save failed' } });
    }
  };

  const allFixed = !!issues && issues.every(i => rowState[keyOf(i)]?.fixed);
  const anySaving = !!issues && issues.some(i => rowState[keyOf(i)]?.saving);

  const courseFeePopup = issues ? (
    <ConfirmPopup
      tone={allFixed ? 'success' : 'warning'}
      icon={allFixed ? IconName.CheckCircle : IconName.Warning}
      title={allFixed ? 'Course fees fixed' : 'Course fee needs checking'}
      subtitle={
        allFixed
          ? 'Every course below now has a confirmed fee'
          : `${issues.length} course${issues.length === 1 ? '' : 's'} could be invoiced at the wrong amount`
      }
      confirmLabel={allFixed ? 'Continue' : actionLabel}
      disableConfirm={anySaving}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    >
      <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
        {issues.map(issue => {
          const key = keyOf(issue);
          const s = rowState[key];
          return (
            <li
              key={key}
              className={`rounded-md border px-3 py-2 ${s?.fixed ? 'border-emerald-300 dark:border-emerald-700' : 'border-orange-200 dark:border-orange-800/60'}`}
            >
              <div className="font-semibold">{issue.courseTitle || issue.courseReferenceNumber}</div>
              {issue.courseReferenceNumber && <div className="text-xs text-gray-500 dark:text-gray-400">{issue.courseReferenceNumber}</div>}
              <div className="mt-1">{describe(issue)}</div>

              {!s?.fixed && issue.problem !== 'no_qbo_product' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 dark:text-gray-300">Correct fee (before GST) $</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={s?.input ?? ''}
                      onChange={e => patchRow(key, { input: e.target.value, result: undefined })}
                      className="w-28 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                      disabled={s?.saving}
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={!!s?.updateQuickBooks}
                      onChange={e => patchRow(key, { updateQuickBooks: e.target.checked })}
                      disabled={s?.saving}
                    />
                    Also set the QuickBooks price
                  </label>
                  <button
                    type="button"
                    onClick={() => saveFee(issue)}
                    disabled={s?.saving}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {s?.saving ? 'Saving…' : 'Save fee'}
                  </button>
                </div>
              )}
              {s?.result && (
                <div className={`mt-1 text-xs ${s.result.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
                  {s.result.text}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!allFixed && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">
          Check the fee on SSG, enter it and save — the course then uses it for every future enrolment and invoice.
          You can also continue without fixing it: enrolment is not affected, but the invoice for that course will not
          generate until the fees agree.
        </p>
      )}
    </ConfirmPopup>
  ) : null;

  return { confirmCourseFees, courseFeePopup };
}
