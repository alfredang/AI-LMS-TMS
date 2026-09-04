import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { lookupExistingGroupInvoices } from '../../../lib/services/caExistingInvoice';

/**
 * GET /api/admin/ca-existing-invoice?employerUen=...&courseRunId=...
 *
 * Does this employer already have an invoice for this course run, and is it
 * still ours to take back? Called when the Enrol Learners confirmation popup
 * opens (and from the Company Application Generate Invoice popup), so the admin
 * finds out BEFORE a second invoice is cut rather than after.
 *
 * Read-only. The reply drives which buttons the popup offers:
 *   invoices: []                 → nothing to warn about, normal enrolment
 *   canReplace: true             → offer Replace (once the grant lands), or a second invoice
 *   canReplace: false            → offer Enrol only, or a second invoice
 *
 * `blockedReason` says why a replacement is off the table: 'sent' (the employer
 * has it), 'paid' (a payment is applied, and QuickBooks would refuse the delete
 * anyway) or 'qbo-unreachable' (we could not check, so we do not risk it).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const employerUen = String(req.query.employerUen || '').trim();
  const courseRunId = String(req.query.courseRunId || '').trim();

  if (!employerUen || !courseRunId) {
    return res.status(400).json({
      success: false,
      error: 'employerUen and courseRunId are both required',
    });
  }

  try {
    await ensureCompanyApplicationsTable();
    const lookup = await lookupExistingGroupInvoices(employerUen, courseRunId);
    return res.status(200).json({ success: true, ...lookup });
  } catch (err) {
    console.error('[ca-existing-invoice] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
