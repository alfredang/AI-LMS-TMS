import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { upsertSsgEnrolmentFromLocalEnrollment } from '../../../lib/services/billingSync';
import { cancelInvoiceJobOnEnrolmentCancelled } from '../../../lib/services/invoiceJobs';

/**
 * POST /api/enrolments/cancel
 * Body: { enrolmentId: string }
 *
 * Updates enrollment.enrolment_status = 'Cancelled' where enrolment_id matches.
 * Called after a successful SSG cancellation from CancelEnrolmentView.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { enrolmentId } = req.body;

  if (!enrolmentId || typeof enrolmentId !== 'string') {
    return res.status(400).json({ error: 'enrolmentId is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE enrollment
       SET enrolment_status = 'Cancelled',
           updated_at = NOW()
       WHERE enrolment_id = $1
         AND enrolment_status != 'Cancelled'
       RETURNING id`,
      [enrolmentId.trim()]
    );

    if (result.rows.length === 0) {
      console.warn(`⚠️ No enrollment found with enrolment_id: ${enrolmentId} (SSG cancel succeeded, but no local record to update)`);
    } else {
      console.log(`✅ Cancelled ${result.rows.length} enrollment row(s) for enrolment_id: ${enrolmentId}`);
      try {
        await upsertSsgEnrolmentFromLocalEnrollment(enrolmentId.trim());
      } catch (e) {
        console.warn('[enrolments/cancel] ssg_enrolments sync:', e);
      }
    }

    void cancelInvoiceJobOnEnrolmentCancelled(enrolmentId.trim()).catch((e: unknown) =>
      console.warn('[enrolments/cancel] invoice job cancel:', e instanceof Error ? e.message : e)
    );

    return res.status(200).json({
      success: true,
      updated: result.rows.length,
      enrolmentId,
      message: result.rows.length === 0
        ? 'SSG cancellation succeeded but no matching local enrollment record was found'
        : `${result.rows.length} enrollment record(s) updated to Cancelled`,
    });
  } catch (error) {
    console.error('❌ Error cancelling enrollment in DB:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
