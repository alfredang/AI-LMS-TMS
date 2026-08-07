/**
 * SSG grant eligibility by residency status.
 *
 * SSG course-fee funding (WSQ / SkillsFuture) is only available to Singapore
 * Citizens and Permanent Residents. Foreigners on a FIN / Work Permit / Employment
 * Pass — and anyone identified by passport — never receive a grant, no matter how
 * long the pipeline waits for one.
 *
 * This matters operationally because the employer invoice is generated per
 * (employer UEN + course run) GROUP and is withheld until every learner in the
 * group either has a grant or is marked `grant_ineligible`. Without this rule a
 * single foreign learner blocks the whole group's invoice indefinitely: the
 * background worker polls SSG for 15 minutes, gives up, and the invoice is never
 * generated. Classifying them up-front lets the group bill correctly — the
 * foreigner at full course fee, everyone else net of grant.
 *
 * Residency signals, in order of trust:
 *   1. The ID number's own format — NRIC (S/T prefix) is issued only to Citizens
 *      and PRs; FIN (F/G/M prefix) only to foreigners. This is the most reliable
 *      signal and beats the declared columns, which are frequently contradictory
 *      in the uploaded Excel (real rows exist declaring "Singapore Citizen" with
 *      an ID type of "FIN").
 *   2. The declared ID type / identity type text, used only when the number is
 *      not in a recognised format.
 *
 * Pink IC = Citizen, Blue IC = PR — both eligible, and both carry an NRIC.
 *
 * Deliberately conservative: an ID we cannot classify returns 'unknown', NOT
 * ineligible. Auto-marking a typo'd NRIC as ineligible would silently bill that
 * learner the full course fee, so unrecognised IDs are left for an admin to
 * resolve.
 */

export type GrantEligibility = 'eligible' | 'ineligible' | 'unknown';

export interface GrantEligibilityInput {
  /** The trainee's NRIC/FIN number as entered. */
  nric?: string | null;
  /** Declared ID type, e.g. "Singapore Pink Identification Card", "FIN/Work Permit". */
  idType?: string | null;
  /** Declared identity type, e.g. "NRIC", "FIN", "Singapore Citizen". */
  identityType?: string | null;
}

export interface GrantEligibilityResult {
  status: GrantEligibility;
  /** Human-readable justification, safe to show an admin or write to a log. */
  reason: string;
}

/** Issued only to Singapore Citizens and PRs. */
const NRIC_PATTERN = /^[ST]\d{7}[A-Z]$/;
/** Issued only to foreigners (Work Permit / EP / S Pass / LTVP holders). */
const FIN_PATTERN = /^[FGM]\d{7}[A-Z]$/;

const FOREIGN_TEXT_MARKERS = ['fin', 'work permit', 'employment pass', 'e-pass', 's pass', 'passport', 'foreigner'];
const LOCAL_TEXT_MARKERS = ['nric', 'pink', 'blue', 'citizen', 'permanent resident', 'singapore pr'];

export function assessGrantEligibility(input: GrantEligibilityInput): GrantEligibilityResult {
  const id = String(input.nric ?? '').trim().toUpperCase();

  if (NRIC_PATTERN.test(id)) {
    return { status: 'eligible', reason: 'NRIC (Singapore Citizen / PR)' };
  }
  if (FIN_PATTERN.test(id)) {
    return { status: 'ineligible', reason: 'FIN — not a Singapore Citizen or PR, so SSG grants do not apply' };
  }

  // The number isn't in a recognised format — fall back to the declared columns.
  const declared = `${input.idType ?? ''} ${input.identityType ?? ''}`.toLowerCase();
  if (FOREIGN_TEXT_MARKERS.some(marker => declared.includes(marker))) {
    return {
      status: 'ineligible',
      reason: 'Declared as a foreign ID type — not a Singapore Citizen or PR, so SSG grants do not apply',
    };
  }
  if (LOCAL_TEXT_MARKERS.some(marker => declared.includes(marker))) {
    // Declared local but the ID number doesn't parse — most likely a typo.
    // Never auto-bill at full fee on a guess; let an admin look at it.
    return { status: 'unknown', reason: 'Declared as Singapore Citizen / PR but the ID number is not a valid NRIC' };
  }

  return { status: 'unknown', reason: 'Residency status could not be determined from the ID number or declared ID type' };
}

/** Convenience predicate — true only when we are confident no grant will ever arrive. */
export function isDefinitelyGrantIneligible(input: GrantEligibilityInput): boolean {
  return assessGrantEligibility(input).status === 'ineligible';
}
