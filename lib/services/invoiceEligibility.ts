/**
 * Auto-invoice (QBO) only for active SSG confirmations — never for cancelled / admin-removed enrolments.
 */
export function isEnrolmentEligibleForAutoInvoice(enrolmentStatus: string | null | undefined): boolean {
  const s = (enrolmentStatus || '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'cancelled' || s === 'admin removed') return false;
  if (s.includes('cancel')) return false;
  return s === 'confirmed';
}

/** True when this status should block invoicing (local or SSG). Empty = not blocking. */
export function isEnrolmentBlockedFromAutoInvoice(enrolmentStatus: string | null | undefined): boolean {
  const s = (enrolmentStatus || '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'cancelled' || s === 'admin removed') return true;
  if (s.includes('cancel')) return true;
  return false;
}
