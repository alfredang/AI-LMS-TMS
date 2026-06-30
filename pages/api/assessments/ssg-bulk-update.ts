import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { checkAssessmentEligibility } from '../../../lib/services/enrolmentEligibility';
import { refreshSkillCode } from '../../../lib/ssg/courseSkillCode';
import { pushFeeCollectionToTpg } from '../../../lib/ssg/pushFeeCollectionToTpg';
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
  status: 'success' | 'error' | 'skipped';
  assessmentReferenceNumber?: string;
  createdOn?: string;
  updatedOn?: string;
  error?: string;
  paymentWarning?: string;
}

interface SubmitCtx {
  credentials: any;
  encKey: Buffer;
  iv: Buffer;
  uen: string;
  tpCode: string;
  ssgBaseUrl: string;
}

interface SubmitOutcome {
  status: 'success' | 'error';
  assessmentReferenceNumber?: string;
  createdOn?: string;
  updatedOn?: string;
  error?: string;
}

const formatDate = (isoString: string) => {
  if (!isoString) return '';
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Whether an SSG error is about the skill code (so the self-repair pass can re-resolve it).
const isSkillCodeError = (msg?: string) => !!msg && (/TGS-?425/i.test(msg) || /skill code/i.test(msg));

/** Submit ONE assessment to SSG with the given skillCode. Pure SSG call — no DB/eligibility. */
async function submitAssessment(item: BulkItem, skillCode: string, ctx: SubmitCtx): Promise<SubmitOutcome> {
  const { credentials, encKey, iv, uen, tpCode, ssgBaseUrl } = ctx;
  const firstChar = (item.traineeId || '').charAt(0).toUpperCase();
  let traineeIdType = 'OTHERS';
  if (firstChar === 'S' || firstChar === 'T') traineeIdType = 'NRIC';
  else if (firstChar === 'F' || firstChar === 'G' || firstChar === 'M') traineeIdType = 'FIN';

  const ssgPayload = {
    assessment: {
      course: { run: { id: String(item.courseRunId) }, referenceNumber: String(item.courseReferenceNumber) },
      result: item.result,
      trainee: { id: item.traineeId, idType: traineeIdType, fullName: item.traineeFullName },
      skillCode,
      assessmentDate: item.assessmentDate,
      trainingPartner: { uen, code: tpCode },
      enrolment: { referenceNumber: item.enrolmentReferenceNumber },
      action: item.action,
    },
  };

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
  const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
  const httpResponse = await httpClient.request(builder.build());

  if (httpResponse.status !== 200) {
    return { status: 'error', error: `SSG HTTP ${httpResponse.status}` };
  }
  const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  const parsed = JSON.parse(decrypted);

  const hasError = parsed?.error && (parsed.error.code || parsed.error.message || (parsed.error.details && parsed.error.details.length > 0));
  if (hasError) {
    return { status: 'error', error: parsed.error.details?.[0]?.message || parsed.error.message || 'Unknown SSG error' };
  }
  const assessment = parsed?.data?.assessment || {};
  const meta = parsed?.meta || {};
  return {
    status: 'success',
    assessmentReferenceNumber: assessment.referenceNumber || '',
    createdOn: formatDate(meta.createdOn),
    updatedOn: formatDate(meta.updatedOn),
  };
}

/**
 * POST /api/assessments/ssg-bulk-update
 * Bulk create/update assessment records via SSG TPG API (sequential, 2s spacing).
 *
 * Silent self-repair: any row that fails on a skill-code error (TGS-425) triggers a fresh live
 * lookup of that course's skill code (correcting a stale/corrupt cache), and is re-submitted with
 * the corrected code. The caller only sees the FINAL result — a repaired-then-resubmitted row
 * shows success.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items } = req.body as { items: BulkItem[] };
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items array is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }
    const tpIdentifiers = await getTrainingPartnerIdentifiers();
    const ctx: SubmitCtx = {
      credentials,
      encKey: Buffer.from(credentials.encryptionKey, 'base64'),
      iv: Buffer.from('SSGAPIInitVector', 'utf8'),
      uen: tpIdentifiers.uen,
      tpCode: tpIdentifiers.code,
      ssgBaseUrl: process.env.SSG_API_URL || 'https://api.ssg-wsg.sg',
    };

    const results: BulkResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Guard: silently skip cancelled classes / cancelled enrolments (never blocks the batch).
      const eligibility = await checkAssessmentEligibility({
        ssgCourseRunId: String(item.courseRunId),
        enrolmentReferenceNumber: item.enrolmentReferenceNumber,
        traineeId: String(item.traineeId || ''),
      });
      if (!eligibility.eligible) {
        results.push({ enrolmentReferenceNumber: item.enrolmentReferenceNumber, traineeFullName: item.traineeFullName, status: 'skipped', error: `Skipped — ${eligibility.reason}` });
        continue;
      }

      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 2000));  // rate-limit spacing

      try {
        const o = await submitAssessment(item, item.skillCode, ctx);
        const bulkResult: BulkResult = {
          enrolmentReferenceNumber: item.enrolmentReferenceNumber,
          traineeFullName: item.traineeFullName,
          status: o.status,
          assessmentReferenceNumber: o.assessmentReferenceNumber,
          createdOn: o.createdOn,
          updatedOn: o.updatedOn,
          error: o.error,
        };
        if (o.status === 'success') {
          console.log(`✅ Assessment for ${item.enrolmentReferenceNumber}: ${o.assessmentReferenceNumber}`);
          // On Pass, best-effort set Full Payment on TPGateway (7-day window).
          if (item.result === 'Pass' && item.enrolmentReferenceNumber) {
            const feeResult = await pushFeeCollectionToTpg(item.enrolmentReferenceNumber);
            if (feeResult.status === 'error') {
              bulkResult.paymentWarning = `TPG payment status could not be updated: ${feeResult.message}`;
            }
          }
        } else {
          console.error(`❌ Assessment error for ${item.enrolmentReferenceNumber}: ${o.error}`);
        }
        results.push(bulkResult);
      } catch (err) {
        results.push({ enrolmentReferenceNumber: item.enrolmentReferenceNumber, traineeFullName: item.traineeFullName, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    // ── Silent self-repair: rows that failed on a skill-code error get a fresh live code + retry ──
    const toRepair = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ idx }) => results[idx]?.status === 'error' && isSkillCodeError(results[idx]?.error));
    if (toRepair.length > 0) {
      const courseCodes = Array.from(new Set(toRepair.map(({ it }) => String(it.courseReferenceNumber).trim())));
      const fresh: Record<string, string | null> = {};
      for (const cc of courseCodes) { try { fresh[cc] = await refreshSkillCode(cc); } catch { fresh[cc] = null; } }

      for (const { it, idx } of toRepair) {
        const newCode = fresh[String(it.courseReferenceNumber).trim()];
        if (!newCode || newCode === it.skillCode) continue;   // no better code found — leave the failure as-is
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const retry = await submitAssessment(it, newCode, ctx);
          if (retry.status === 'success') {
            const repairedResult: BulkResult = {
              enrolmentReferenceNumber: it.enrolmentReferenceNumber,
              traineeFullName: it.traineeFullName,
              status: 'success',
              assessmentReferenceNumber: retry.assessmentReferenceNumber,
              createdOn: retry.createdOn,
              updatedOn: retry.updatedOn,
            };
            console.log(`🔧 Self-repaired ${it.enrolmentReferenceNumber} with skill code ${newCode}`);
            if (it.result === 'Pass' && it.enrolmentReferenceNumber) {
              const feeResult = await pushFeeCollectionToTpg(it.enrolmentReferenceNumber);
              if (feeResult.status === 'error') {
                repairedResult.paymentWarning = `TPG payment status could not be updated: ${feeResult.message}`;
              }
            }
            results[idx] = repairedResult;
          } else if (retry.error) {
            results[idx].error = retry.error;   // surface the post-repair error instead of the stale one
          }
        } catch { /* keep original failure */ }
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;

    return res.status(200).json({
      success: true,
      summary: { total: items.length, success: successCount, error: errorCount, skipped: skippedCount },
      results,
    });
  } catch (error) {
    console.error('❌ Bulk assessment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
