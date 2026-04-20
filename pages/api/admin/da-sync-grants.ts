import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { upsertSsgGrant } from '../../../lib/services/billingSync';
import crypto from 'crypto';

const IV = Buffer.from('SSGAPIInitVector', 'utf8');

/**
 * POST /api/admin/da-sync-grants
 *
 * For every distinct course_run_id in da_application, searches SSG grants
 * by courseRunId (same approach as /api/grants/search) and upserts results
 * into ssg_grants so the DA Application table can display the full grant breakdown.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const tp = await getTrainingPartnerIdentifiers();
    const uen = credentials.uen || tp.uen;

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    // Get distinct course_run_ids for current/future courses only (same filter as the DA table)
    const runRes = await pool.query(
      `SELECT DISTINCT da.course_run_id
       FROM da_application da
       LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
       WHERE da.course_run_id IS NOT NULL
         AND da.course_run_id <> ''
         AND COALESCE(cr.start_date, da.course_start_date) >= CURRENT_DATE`
    );
    const courseRunIds: string[] = runRes.rows.map((r: any) => String(r.course_run_id));

    let totalGrants = 0;
    let runsProcessed = 0;
    const errors: string[] = [];

    for (const courseRunId of courseRunIds) {
      try {
        const ssgPayload = {
          grants: {
            course: { run: { id: courseRunId } },
            trainingPartner: { uen, code: tp.code },
          },
          parameters: { page: 0, pageSize: 100 },
        };

        const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
        let encrypted = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const builder = new HTTPRequestBuilder()
          .withEndpoint(ssgBaseUrl, '/tpg/grants/search')
          .withMethod(HttpMethod.POST)
          .withBody(encrypted);

        if (credentials.certificateContent && credentials.privateKeyContent) {
          builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
        }

        const httpResponse = await httpClient.request(builder.build());

        if (httpResponse.status !== 200) {
          errors.push(`Run ${courseRunId}: SSG returned ${httpResponse.status}`);
          continue;
        }

        const rawBody = typeof httpResponse.data === 'string'
          ? httpResponse.data
          : JSON.stringify(httpResponse.data);

        const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, IV);
        let decrypted = decipher.update(rawBody, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        const parsed = JSON.parse(decrypted);

        const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
        if (hasError) {
          errors.push(`Run ${courseRunId}: ${parsed.error.message || parsed.error.code}`);
          continue;
        }

        const grants: Record<string, unknown>[] = Array.isArray(parsed?.data) ? parsed.data : [];
        for (const grant of grants) {
          try {
            await upsertSsgGrant(grant);
            totalGrants++;
          } catch (e) {
            console.warn(`[da-sync-grants] Failed to upsert grant for run ${courseRunId}:`, e);
          }
        }

        runsProcessed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Run ${courseRunId}: ${msg}`);
      }
    }

    return res.status(200).json({
      success: true,
      runsProcessed,
      totalGrantsUpserted: totalGrants,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('❌ da-sync-grants error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
