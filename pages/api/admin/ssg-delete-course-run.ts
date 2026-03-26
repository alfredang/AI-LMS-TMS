import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HTTPRequestBuilder, HttpMethod, handleRequest } from '../../../lib/ssg/utils/http-utils';
import { Cryptography } from '../../../lib/ssg/utils/cryptography';
import { HttpClient } from '../../../lib/ssg/utils/http-utils';
import pool from '../../../lib/db';

/**
 * POST /api/admin/ssg-delete-course-run
 * Delete a course run from SSG and mark it as deleted in local DB.
 * Body: { courseReferenceNumber, courseRunId }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseReferenceNumber, courseRunId } = req.body;

  if (!courseReferenceNumber || !courseRunId) {
    return res.status(400).json({ error: 'courseReferenceNumber and courseRunId are required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ error: 'SSG credentials not found' });
    }

    if (!credentials.encryptionKey) {
      return res.status(400).json({ error: 'Encryption key is required' });
    }

    if (!credentials.certificateContent || !credentials.privateKeyContent) {
      return res.status(400).json({ error: 'Certificate and private key are required' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    const runId = String(courseRunId).trim();

    // Payload matches Python DeleteRunInfo.payload() — run ID goes in the URL path, not the body
    const payload = {
      course: {
        courseReferenceNumber: String(courseReferenceNumber).trim(),
        trainingProvider: { uen: credentials.uen },
        run: {
          action: 'delete',
        },
      },
    };

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/courses/courseRuns/edit/${runId}`)
      .withMethod(HttpMethod.POST)
      .withHeader('Content-Type', 'application/json')
      .withCertificate(credentials.certificateContent, credentials.privateKeyContent);

    const encryptedPayload = Cryptography.encryptJSON(credentials.encryptionKey, payload);
    builder.withBody(encryptedPayload);

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const result = await handleRequest(httpClient, builder.build());

    const isRecordNotFound = result.error?.details?.some(
      (d: any) => d.message?.toLowerCase().includes('record not found')
    ) || result.error?.message?.toLowerCase().includes('record not found');

    const hasError = result.error && (
      result.error.code ||
      result.error.message ||
      (result.error.details && result.error.details.length > 0)
    );

    if (hasError && !isRecordNotFound) {
      const errMsg = result.error?.details?.[0]?.message || result.error?.message || 'Failed to delete course run';
      return res.status(result.status || 400).json({ error: errMsg });
    }

    // Success or record not found — mark as deleted in local DB
    try {
      await pool.query(`ALTER TABLE public.course_run ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false`);
      await pool.query(
        `UPDATE course_run SET is_deleted = true, updated_at = NOW() WHERE course_run_id = $1`,
        [runId]
      );
    } catch (dbErr) {
      console.error('DB update failed after SSG delete:', dbErr);
    }

    return res.status(200).json({ success: true, isRecordNotFound });

  } catch (error) {
    console.error('SSG delete course run error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
