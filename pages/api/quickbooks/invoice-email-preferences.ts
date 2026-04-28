import type { NextApiRequest, NextApiResponse } from 'next';
import {
  qboGetDefaultInvoiceEmailFields,
  qboReadPreferences,
} from '../../../lib/services/qboInvoiceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const app = typeof req.query.app === 'string' ? req.query.app : undefined;
    const preferences = await qboReadPreferences(app);
    const emailFields = await qboGetDefaultInvoiceEmailFields(app);

    return res.status(200).json({
      success: true,
      cc: emailFields.BillEmailCc?.Address || '',
      bcc: emailFields.BillEmailBcc?.Address || '',
      hasSalesEmailCcField: JSON.stringify(preferences).includes('SalesEmailCc'),
      hasSalesEmailBccField: JSON.stringify(preferences).includes('SalesEmailBcc'),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to read QuickBooks invoice email preferences',
    });
  }
}
