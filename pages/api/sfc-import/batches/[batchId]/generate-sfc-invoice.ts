import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { generateSfcInvoiceForRow } from '@/lib/services/sfcImport/generateSfcInvoiceForRow';

/**
 * DA-only counterpart to generate-invoice.ts: that route creates the main Consolidated-Finance
 * (TC) customer invoice, the wrong type for a Direct Application claim, which needs the SFC-CA
 * supplemental invoice instead. This calls the same creation path sfcImportApply.ts uses at
 * apply-time, exposed here so a DA row missing its SFC-CA invoice can get one without first
 * having to run (and possibly fail) a payment application.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = parseInt(String(req.query.batchId || ''), 10);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, error: 'batchId is required' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const { rowId, enrolmentId, claimId, applicationId, mainInvoiceDocNumber, fallbackAmount } = req.body as {
      rowId: number;
      enrolmentId: string;
      claimId: string;
      applicationId: string;
      mainInvoiceDocNumber?: string | null;
      fallbackAmount?: number;
    };
    if (!rowId || !String(enrolmentId || '').trim() || !String(claimId || '').trim() || !String(applicationId || '').trim()) {
      return res.status(400).json({ success: false, error: 'rowId, enrolmentId, claimId and applicationId are required' });
    }

    const result = await generateSfcInvoiceForRow({
      batchId,
      rowId,
      enrolmentId,
      claimId,
      applicationId,
      mainInvoiceDocNumber: mainInvoiceDocNumber ?? null,
      fallbackAmount: fallbackAmount ?? 0,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(422).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
