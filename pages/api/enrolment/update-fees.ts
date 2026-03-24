import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import pool from '../../../lib/db';

/**
 * POST /api/enrolment/update-fees
 * Update the fee collection status of an enrolment.
 *
 * Body: { referenceNumber: string, collectionStatus: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { referenceNumber, collectionStatus } = req.body;

  if (!referenceNumber?.trim()) {
    return res.status(400).json({ success: false, error: 'referenceNumber is required' });
  }
  if (!collectionStatus?.trim()) {
    return res.status(400).json({ success: false, error: 'collectionStatus is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found in database' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    const result = await api.updateFeeCollection(referenceNumber.trim(), {
      enrolment: {
        fees: { collectionStatus }
      }
    });

    if (result.error) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }

    // Map SSG collection status → local payment_status enum (Paid / Unpaid)
    const localPaymentStatus = collectionStatus === 'Full Payment' ? 'Paid' : 'Unpaid';

    await pool.query(
      `UPDATE enrollment
          SET payment_status = $1::public.learner_payment_status,
              updated_at     = NOW()
        WHERE enrolment_id = $2`,
      [localPaymentStatus, referenceNumber.trim()]
    );

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error updating enrolment fees:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
