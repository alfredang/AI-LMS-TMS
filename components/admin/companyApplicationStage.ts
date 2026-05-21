/**
 * Single source of truth for "what stage is this company_application row at
 * right now and what should the admin do next?"
 *
 * The auto-enrol pipeline has six distinct stages plus a failed state. Without
 * this helper, admins have to scan 7+ columns (ENROL / CAL / INV / GRANT /
 * DOC VERIFIED / EMAIL) and mentally combine flags to figure out where a row
 * is stuck. With it, every consumer (View page, Check Supporting Document
 * page, Pipeline Status view) can show one composite Stage label + one
 * obvious Next Action button.
 *
 * Decision order matters — earlier stages gate later ones, so we walk through
 * the pipeline top-down and stop at the first incomplete step.
 */
import type { CompanyApplicationRow } from './CompanyApplicationViews';

export type RowStage =
  | 'failed'
  | 'enrolling'
  | 'awaiting_grant'
  | 'awaiting_invoice'
  | 'awaiting_verification'
  | 'awaiting_email'
  | 'complete';

export interface StageInfo {
  stage: RowStage;
  /** Short human label for the Stage column / chip. */
  label: string;
  /** Tone hint for badge / chip coloring. */
  tone: 'red' | 'amber' | 'blue' | 'emerald' | 'gray';
  /**
   * What button to show next to this row, if any. Null = nothing for admin to
   * do (pipeline still running, or complete).
   */
  nextAction: NextAction | null;
}

export type NextAction =
  | { kind: 'retry'; label: string; tooltip: string }
  | { kind: 'sync_grants'; label: string; tooltip: string }
  | { kind: 'generate_invoice'; label: string; tooltip: string }
  | { kind: 'verify_doc'; label: string; tooltip: string }
  | { kind: 'send_email'; label: string; tooltip: string };

const hasValue = (v: unknown) => String(v ?? '').trim() !== '';
const isChecked = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 't';
};

export function getCompanyApplicationStage(row: CompanyApplicationRow): StageInfo {
  const autoEnrolStatus = String(row['Auto-Enrol Status'] || '').trim().toLowerCase();
  if (autoEnrolStatus === 'failed') {
    return {
      stage: 'failed',
      label: 'Failed',
      tone: 'red',
      nextAction: {
        kind: 'retry',
        label: 'Retry',
        tooltip: 'Re-run the auto-enrol pipeline for this row. Keeps the existing row and context.',
      },
    };
  }

  if (!hasValue(row['Enrolment ID'])) {
    return {
      stage: 'enrolling',
      label: 'Enrolling',
      tone: 'blue',
      // No admin action — pipeline still working. Will flip to failed if SSG rejects.
      nextAction: null,
    };
  }

  const hasGrant = hasValue(row['Grant ID']);
  const isIneligible = isChecked(row['Grant Ineligible']);
  if (!hasGrant && !isIneligible) {
    return {
      stage: 'awaiting_grant',
      label: 'Awaiting grant',
      tone: 'amber',
      nextAction: {
        kind: 'sync_grants',
        label: 'Sync grants',
        tooltip: 'Pull latest grant state from SSG. Use after stakeholders apply the grant in the SSG portal.',
      },
    };
  }

  if (!hasValue(row['Invoice ID'])) {
    return {
      stage: 'awaiting_invoice',
      label: 'Awaiting invoice',
      tone: 'amber',
      nextAction: {
        kind: 'generate_invoice',
        label: 'Generate invoice',
        tooltip: 'Generate the consolidated tax invoice for this row\'s (employer × course-run) group.',
      },
    };
  }

  const docStatus = String(row['Supporting Doc Verification Status'] || '').trim().toLowerCase();
  if (docStatus !== 'verified') {
    return {
      stage: 'awaiting_verification',
      label: 'Awaiting verification',
      tone: 'amber',
      nextAction: {
        kind: 'verify_doc',
        label: 'Verify document',
        tooltip: 'Open the Check Supporting Document flow for this learner.',
      },
    };
  }

  if (!hasValue(row['Invoice Sent At'])) {
    return {
      stage: 'awaiting_email',
      label: 'Awaiting email',
      tone: 'amber',
      nextAction: {
        kind: 'send_email',
        label: 'Send invoice',
        tooltip: 'Email the consolidated tax invoice to the employer contact. Idempotent — won\'t double-send.',
      },
    };
  }

  return {
    stage: 'complete',
    label: 'Complete',
    tone: 'emerald',
    nextAction: null,
  };
}
