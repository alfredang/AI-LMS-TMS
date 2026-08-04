import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { syncEnrolmentToDB } from '../../../lib/ssg/utils/sync-enrolment-to-db';
import pool from '../../../lib/db';

/**
 * GET /api/enrolment/view?enrolmentId=ENR-XXXX-XXXXXX
 * View a single enrolment record from SSG by its reference number.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { enrolmentId } = req.query;

  if (!enrolmentId || typeof enrolmentId !== 'string' || !enrolmentId.trim()) {
    return res.status(400).json({ success: false, error: 'enrolmentId query parameter is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found in database' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    console.log('🔐 Cert loaded:', !!credentials.certificateContent, '| Key loaded:', !!credentials.privateKeyContent);
    console.log('🔑 UEN:', credentials.uen, '| Encryption key set:', !!credentials.encryptionKey);
    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    const result = await api.viewEnrolment(enrolmentId.trim());
    console.log('📦 SSG result:', JSON.stringify(result, null, 2));

    if (result.error) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }

    // Sync into local DB (skip if enrolment_id already exists)
    if (result.data) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await syncEnrolmentToDB(client, result.data);
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error('⚠️ DB sync error (non-fatal):', dbErr);
      } finally {
        client.release();
      }
    }

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error viewing enrolment:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}

export default withAuth(handler);
