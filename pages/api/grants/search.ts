import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import pool from '../../../lib/db';

function summarizeSsgHttpError(status: number, data: unknown): string {
  let base = `SSG error ${status}`;
  if (data == null || data === '') return `${base} (no response body — often a transient SSG gateway issue; retry in a minute)`;
  if (typeof data === 'string') {
    const t = data.trim();
    return t ? `${base}: ${t.slice(0, 800)}` : base;
  }
  try {
    const o = data as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return `${base}: ${o.message}`;
    const err = o.error;
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e.message === 'string' && e.message.trim()) return `${base}: ${e.message}`;
      if (typeof e.code === 'string' && e.code.trim()) return `${base}: ${e.code}`;
    }
    const s = JSON.stringify(data);
    return s.length > 2 ? `${base}: ${s.slice(0, 800)}` : base;
  } catch {
    return base;
  }
}

function getGrantEnrolmentRef(item: any): string {
  return String(item?.enrolment?.referenceNumber || '').trim();
}

async function enrichGrantRowsWithLearnerNames(rows: any[]): Promise<any[]> {
  const enrolmentRefs = Array.from(new Set(rows.map(getGrantEnrolmentRef).filter(Boolean)));
  if (enrolmentRefs.length === 0) return rows;

  try {
    const nameRes = await pool.query(
      `
      WITH refs AS (
        SELECT unnest($1::text[]) AS enrolment_id
      ),
      names AS (
        SELECT
          LOWER(TRIM(e.enrolment_id)) AS enrolment_key,
          NULLIF(TRIM(COALESCE(u.full_name, '')), '') AS learner_name,
          1 AS priority
        FROM refs r
        JOIN enrollment e
          ON LOWER(TRIM(e.enrolment_id)) = LOWER(TRIM(r.enrolment_id))
        LEFT JOIN app_user u ON u.id = e.user_id

        UNION ALL

        SELECT
          LOWER(TRIM(se.enrolment_id)) AS enrolment_key,
          NULLIF(TRIM(COALESCE(se.trainee_name, '')), '') AS learner_name,
          2 AS priority
        FROM refs r
        JOIN ssg_enrolments se
          ON LOWER(TRIM(se.enrolment_id)) = LOWER(TRIM(r.enrolment_id))

        UNION ALL

        SELECT
          LOWER(TRIM(da.enrolment_id)) AS enrolment_key,
          NULLIF(TRIM(COALESCE(da.trainee_name, '')), '') AS learner_name,
          3 AS priority
        FROM refs r
        JOIN da_application da
          ON LOWER(TRIM(da.enrolment_id)) = LOWER(TRIM(r.enrolment_id))
      )
      SELECT DISTINCT ON (enrolment_key)
        enrolment_key,
        learner_name
      FROM names
      WHERE learner_name IS NOT NULL
      ORDER BY enrolment_key, priority
      `,
      [enrolmentRefs]
    );

    const nameByEnrolment = new Map<string, string>();
    for (const row of nameRes.rows) {
      if (row.enrolment_key && row.learner_name) {
        nameByEnrolment.set(String(row.enrolment_key), String(row.learner_name));
      }
    }

    return rows.map((item) => {
      const enrolmentKey = getGrantEnrolmentRef(item).toLowerCase();
      const learnerName = nameByEnrolment.get(enrolmentKey);
      return learnerName ? { ...item, learnerName } : item;
    });
  } catch (error) {
    console.warn('Unable to enrich grant search results with learner names:', error);
    return rows;
  }
}

/**
 * POST /api/grants/search
 * Search grants by course run ID via SSG TPG API.
 * Body: { courseRunId, page?, pageSize? }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunId } = req.body;

  if (!courseRunId) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const tp = await getTrainingPartnerIdentifiers();

    const ssgPayload = {
      grants: {
        course: {
          run: {
            id: String(courseRunId)
          }
        },
        trainingPartner: {
          uen: credentials.uen || tp.uen,
          code: tp.code
        }
      },
      parameters: {
        page: 0,
        pageSize: 100
      }
    };

    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/tpg/grants/search')
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG search grants error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      const friendly = summarizeSsgHttpError(httpResponse.status, httpResponse.data);
      return res.status(httpResponse.status).json({
        success: false,
        error: friendly,
        details: httpResponse.data,
      });
    }

    // Decrypt SSG response
    const rawBody = typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data);

    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);

    console.log('📦 SSG search grants response:', JSON.stringify(parsed));

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
    if (hasError) {
      const decryptedStatus = Number(parsed.status) || 400;
      if (decryptedStatus === 403 || decryptedStatus === 404) {
        return res.status(404).json({ success: false, error: 'No grants found for this Course Run ID.' });
      }
      return res.status(decryptedStatus).json({ success: false, error: parsed.error.message });
    }

    const data = Array.isArray(parsed?.data)
      ? await enrichGrantRowsWithLearnerNames(parsed.data)
      : [];

    return res.status(200).json({ success: true, data, meta: parsed?.meta ?? {} });

  } catch (error) {
    console.error('❌ Search grants error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
