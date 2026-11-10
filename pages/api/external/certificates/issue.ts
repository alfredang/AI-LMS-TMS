import { withServiceAuth } from '@lib/auth/withAuth';
import {
  CertificateIssueError,
  issueCertificate,
} from '@lib/services/certificateDelivery';
import {
  CertificateRequestError,
  normalizeCertificateIssueInput,
} from '@lib/services/certificateDeliveryRules';
import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const input = normalizeCertificateIssueInput(req.body);
    const result = await issueCertificate({
      ...input,
      requestSource: 'orion:external-api',
    });
    return res.status(result.status === 'email_failed' ? 502 : 200).json(result);
  } catch (error) {
    if (error instanceof CertificateRequestError || error instanceof CertificateIssueError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        error: error.message,
        ...(error instanceof CertificateIssueError && error.details ? { details: error.details } : {}),
      });
    }
    console.error('[external/certificates/issue] unexpected error:', error);
    return res.status(500).json({ success: false, code: 'internal_error', error: 'Certificate processing failed.' });
  }
}

export default withServiceAuth(handler);
