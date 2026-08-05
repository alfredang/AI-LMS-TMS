/**
 * Direct-application status helpers.
 *
 * A Direct Application is an *enrollable / active* application when it is
 * confirmed by the training provider. TPGateway represents this as either
 * "Confirm application" (confirmed, nothing outstanding to action) or a
 * "Confirmed…" status. Crucially, a paid course lands on
 * "Confirmed (Pending payment)" — that is only a FEE-COLLECTION state, not an
 * enrolment state: the learner is genuinely enrolled and the outstanding fee is
 * chased by the invoice. So it must be treated exactly like "Confirmed" for
 * auto-enrolment, calendar sync and invoicing.
 *
 * We match "confirm application" OR anything starting with "confirmed" so the
 * rule is robust regardless of the exact "(Pending payment)" wording TPGateway
 * writes into the export.
 */
export function isEnrollableDaStatus(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'confirm application' || s.startsWith('confirmed');
}

/**
 * SQL predicate fragment mirroring isEnrollableDaStatus() for use in queries.
 * Pass the already-qualified column expression, e.g.
 *   enrollableDaStatusSql("LOWER(application_status)")
 *   enrollableDaStatusSql("LOWER(COALESCE(da.application_status, ''))")
 */
export function enrollableDaStatusSql(loweredColumnExpr: string): string {
  return `(${loweredColumnExpr} = 'confirm application' OR ${loweredColumnExpr} LIKE 'confirmed%')`;
}
