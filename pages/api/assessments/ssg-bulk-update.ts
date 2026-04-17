import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

interface BulkItem {
  enrolmentReferenceNumber: string;
  courseRunId: string;
  courseReferenceNumber: string;
  traineeFullName: string;
  traineeId: string;
  action: string;
  result: string;
  assessmentDate: string;
  skillCode: string;
}

interface BulkResult {
  enrolmentReferenceNumber: string;
  traineeFullName: string;
  status: 'success' | 'error';
  assessmentReferenceNumber?: string;
  createdOn?: string;
  updatedOn?: string;
  error?: string;
}

/**
 * POST /api/assessments/ssg-bulk-update
 * Bulk create/update assessment records via SSG TPG API.
 * Body: { items: BulkItem[], action, result, skillCode, assessmentDate }
 *
 * Processes items sequentially with a 2s delay between calls to avoid SSG rate limits.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items array is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(
      undefined,
      (req.headers['x-ssg-app'] as string) || undefined
    );
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const uen = '201509271W';
    const tpCode = 'T08GB0001K';

    const results: BulkResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item: BulkItem = items[i];

      // Add delay between requests (skip first)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      try {
        // Determine trainee ID type from first character
        const firstChar = (item.traineeId || '').charAt(0).toUpperCase();
        let traineeIdType = 'OTHERS';
        if (firstChar === 'S' || firstChar === 'T') traineeIdType = 'NRIC';
        else if (firstChar === 'F' || firstChar === 'G' || firstChar === 'M') traineeIdType = 'FIN';

        const ssgPayload: Record<string, unknown> = {
          assessment: {
            course: {
              run: { id: String(item.courseRunId) },
              referenceNumber: String(item.courseReferenceNumber),
            },
            result: item.result,
            trainee: {
              id: item.traineeId,
              idType: traineeIdType,
              fullName: item.traineeFullName,
            },
            skillCode: item.skillCode,
            assessmentDate: item.assessmentDate,
            trainingPartner: {
              uen,
              code: tpCode,
            },
            enrolment: { referenceNumber: item.enrolmentReferenceNumber },
            action: item.action,
          },
        };

        // Encrypt payload
        const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
        let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
        encryptedPayload += cipher.final('base64');

        const builder = new HTTPRequestBuilder()
          .withEndpoint(ssgBaseUrl, '/tpg/assessments')
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
          console.error(`❌ SSG bulk assessment error [${httpResponse.status}] for ${item.enrolmentReferenceNumber}:`, JSON.stringify(httpResponse.data));
          results.push({
            enrolmentReferenceNumber: item.enrolmentReferenceNumber,
            traineeFullName: item.traineeFullName,
            status: 'error',
            error: `SSG HTTP ${httpResponse.status}`,
          });
          continue;
        }

        // Decrypt response
        const rawBody = typeof httpResponse.data === 'string'
          ? httpResponse.data
          : JSON.stringify(httpResponse.data);

        const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
        let decrypted = decipher.update(rawBody, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        const parsed = JSON.parse(decrypted);

        // Check for SSG error in body
        const hasError = parsed?.error && (parsed.error.code || parsed.error.message ||
          (parsed.error.details && parsed.error.details.length > 0));

        if (hasError) {
          const errMsg = parsed.error.details?.[0]?.message || parsed.error.message || 'Unknown SSG error';
          console.error(`❌ SSG assessment error for ${item.enrolmentReferenceNumber}:`, errMsg);
          results.push({
            enrolmentReferenceNumber: item.enrolmentReferenceNumber,
            traineeFullName: item.traineeFullName,
            status: 'error',
            error: errMsg,
          });
          continue;
        }

        const assessment = parsed?.data?.assessment || {};
        const meta = parsed?.meta || {};

        const formatDate = (isoString: string) => {
          if (!isoString) return '';
          const d = new Date(isoString);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        results.push({
          enrolmentReferenceNumber: item.enrolmentReferenceNumber,
          traineeFullName: item.traineeFullName,
          status: 'success',
          assessmentReferenceNumber: assessment.referenceNumber || '',
          createdOn: formatDate(meta.createdOn),
          updatedOn: formatDate(meta.updatedOn),
        });

        console.log(`✅ Assessment created for ${item.enrolmentReferenceNumber}: ${assessment.referenceNumber}`);

      } catch (err) {
        console.error(`❌ Error processing ${item.enrolmentReferenceNumber}:`, err);
        results.push({
          enrolmentReferenceNumber: item.enrolmentReferenceNumber,
          traineeFullName: item.traineeFullName,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return res.status(200).json({
      success: true,
      summary: { total: items.length, success: successCount, error: errorCount },
      results,
    });

  } catch (error) {
    console.error('❌ Bulk assessment error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
