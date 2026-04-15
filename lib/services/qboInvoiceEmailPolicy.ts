/**
 * Controls whether QuickBooks should email the invoice to the customer when the
 * invoice job runs (QBO send API). PDF + Drive upload still run regardless.
 *
 * Default: do not email (review layout in QBO first).
 *
 * Opt in: set `QBO_SEND_INVOICE_EMAIL=true` (or `1`).
 *
 * Backward compatibility: `QBO_SKIP_SEND_INVOICE=false` still enables sending
 * (previous behaviour when that flag was explicitly cleared).
 */
export function shouldSendQboInvoiceEmailFromQuickBooks(): boolean {
  const send = process.env.QBO_SEND_INVOICE_EMAIL?.trim().toLowerCase();
  if (send === 'true' || send === '1' || send === 'yes') return true;

  const skip = process.env.QBO_SKIP_SEND_INVOICE?.trim().toLowerCase();
  if (skip === 'false' || skip === '0') return true;
  if (skip === 'true' || skip === '1' || skip === 'yes') return false;

  return false;
}
