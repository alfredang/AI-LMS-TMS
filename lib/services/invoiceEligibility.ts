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
