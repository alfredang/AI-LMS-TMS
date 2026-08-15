/**
 * `da_application.application_id` — real MySkillsFuture ids vs. our placeholder.
 *
 * A learner enrolled through TPG Management → Enrolment → Enrol Learners has no
 * MySkillsFuture Direct Application, so there is no `CA-…` id for them. To reuse
 * the DA pipeline (calendar + the full invoice set + the nightly sweep) we still
 * need a row in `da_application`, and `application_id` is that table's unique
 * key — so we mint a synthetic `MANUAL-<enrolment id>` value to fill it.
 *
 * That value is an INTERNAL KEY ONLY. It is not an Application ID, and printing
 * it as one is wrong: it reached learner-facing QuickBooks tax invoices as
 * "Application ID: MANUAL-ENR-2608-079037", and produced `SFC-MANUAL-ENR-…`
 * SFC DocNumbers that finance's `SFC-CA-…` convention does not match.
 *
 * Anything that shows an application id to a human — a UI column, an invoice
 * line, a QuickBooks DocNumber — must go through the helpers here, never read
 * `application_id` raw. The placeholder is replaced with the genuine `CA-…` id
 * in place when the MySkillsFuture export is uploaded
 * (`pages/api/admin/upload-da-applications.ts`, "Adopted placeholder …").
 *
 * Deliberately free of DB/server imports so React components can use it too.
 */

const SYNTHETIC_APPLICATION_ID_PREFIX = 'MANUAL-';

export function buildSyntheticDaApplicationId(enrolmentId: string): string {
  return `${SYNTHETIC_APPLICATION_ID_PREFIX}${String(enrolmentId).trim().toUpperCase()}`;
}

export function isSyntheticDaApplicationId(value: unknown): boolean {
  return String(value || '')
    .trim()
    .toUpperCase()
    .startsWith(SYNTHETIC_APPLICATION_ID_PREFIX);
}

/**
 * The genuine MySkillsFuture application id, or null when the row only carries
 * our placeholder. Use this wherever an "Application ID" is displayed or used
 * to build a document number.
 */
export function realApplicationId(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || isSyntheticDaApplicationId(trimmed)) return null;
  return trimmed;
}

/** The SSG enrolment reference a placeholder was minted from, if it is one. */
export function enrolmentIdFromSyntheticApplicationId(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  if (!isSyntheticDaApplicationId(trimmed)) return null;
  const enrolmentId = trimmed.slice(SYNTHETIC_APPLICATION_ID_PREFIX.length).trim();
  return enrolmentId || null;
}

/**
 * What to show in an "Application ID" column. Placeholder rows fall back to the
 * SSG enrolment reference — a real identifier the admin can act on — rather than
 * exposing the internal `MANUAL-…` key.
 */
export function displayApplicationId(
  applicationId: unknown,
  enrolmentId?: unknown
): { label: string; isPlaceholder: boolean } {
  const real = realApplicationId(applicationId);
  if (real) return { label: real, isPlaceholder: false };

  const fallback =
    String(enrolmentId ?? '').trim() ||
    enrolmentIdFromSyntheticApplicationId(applicationId) ||
    '';
  return { label: fallback || 'N/A', isPlaceholder: true };
}

/**
 * Description for the "SkillsFuture Credit Usage/Claim" line on DA invoices.
 *
 * With a real application it reads as it always has. Without one there is no
 * application to cite, so the line carries the SSG enrolment reference instead
 * — never the `MANUAL-…` placeholder.
 */
export function buildSfcCreditLineDescription(
  applicationId: unknown,
  enrolmentId?: unknown
): string {
  const real = realApplicationId(applicationId);
  if (real) return `SkillsFuture Credit Usage/Claim:\nApplication ID: ${real}`;

  const enrolRef =
    String(enrolmentId ?? '').trim() ||
    enrolmentIdFromSyntheticApplicationId(applicationId) ||
    '';
  return enrolRef
    ? `SkillsFuture Credit Usage/Claim:\nEnrolment ID: ${enrolRef}`
    : 'SkillsFuture Credit Usage/Claim:';
}
