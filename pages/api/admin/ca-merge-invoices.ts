import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { mergeGroupInvoices, previewMergedInvoice } from '../../../lib/quickbooks/createCompanyApplicationInvoice';
import { previewGroupInvoiceMerge } from '../../../lib/services/caExistingInvoice';

/**
 * POST /api/admin/ca-merge-invoices
 *
 * Body: { employerUen: string, courseRunId: string }
 *
 * Collapses the several invoices one employer holds for one course run into a
 * single invoice covering everyone. Driven by the "more than one invoice for
 * the same class" banner on View Company Application, which is what surfaces
 * these groups in the first place.
 *
 * Destructive in QuickBooks — it deletes the old invoices — so it refuses
 * unless all three hold:
 *   1. every learner is enroled with SSG
 *   2. every learner's grant has settled (or they are marked Not Grant Eligible)
 *   3. NO invoice in the group has been emailed or paid
 *
 * Rule 3 is the important one: once the employer holds a document, replacing it
 * behind their back is not ours to do — that is a credit note, decided by a
 * person in QuickBooks. A refusal returns 200 with `merged: false` and a reason
 * to show the admin, because "we correctly declined" is not an error.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // GET looks, POST acts. Splitting them on the verb rather than a `preview`
  // flag means a preview can never be one typo away from deleting invoices.
  const isPreview = req.method === 'GET';
  const employerUen = String((isPreview ? req.query.employerUen : req.body?.employerUen) || '').trim();
  const courseRunId = String((isPreview ? req.query.courseRunId : req.body?.courseRunId) || '').trim();

  if (!employerUen || !courseRunId) {
    return res.status(400).json({
      success: false,
      error: 'employerUen and courseRunId are both required',
    });
  }

  try {
    await ensureCompanyApplicationsTable();
    if (isPreview) {
      // Two halves of the same question: what goes away, and what replaces it.
      const [preview, projected] = await Promise.all([
        previewGroupInvoiceMerge(employerUen, courseRunId),
        previewMergedInvoice(employerUen, courseRunId),
      ]);
      return res.status(200).json({ success: true, ...preview, projected });
    }
    const result = await mergeGroupInvoices(employerUen, courseRunId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[ca-merge-invoices] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
