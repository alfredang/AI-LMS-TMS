import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { upsertSsgEnrolmentFromLocalEnrollment } from '../../../lib/services/billingSync';
import { cancelInvoiceJobOnEnrolmentCancelled } from '../../../lib/services/invoiceJobs';
import { qboReadInvoice, qboDeleteInvoice } from '../../../lib/services/qboInvoiceService';

/**
 * Best-effort delete of a QBO invoice. Returns a warning string when the
 * deletion failed for a real reason, or `null` when the invoice was deleted
 * (or was already gone — QBO error 610 = Object Not Found).
 */
async function deleteQboInvoiceIfPresent(
  invoiceId: string | null | undefined,
  label: string,
): Promise<string | null> {
  const id = (invoiceId || '').trim();
  if (!id) return null;
  try {
    const inv = await qboReadInvoice(undefined, id);
    if (inv?.syncToken) {
      await qboDeleteInvoice(undefined, id, inv.syncToken);
    }
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (msg.includes('610') || lower.includes('not found') || lower.includes('object not found')) {
      return null;
    }
    return `${label}: ${msg}`;
  }
}

/**
 * If this enrolment belongs to a Direct Application, delete the three QBO
 * invoices (main / grant / SFC) attached to the DA row and null out the
 * invoice columns. Best-effort — failures are logged but never block the
 * cancellation itself.
 */
async function cleanupDaInvoicesForEnrolment(enrolmentId: string): Promise<void> {
  const r = await pool.query(
    `SELECT application_id, invoice_id, grant_invoice_id, sfc_invoice_id
     FROM da_application
     WHERE enrolment_id = $1
     LIMIT 1`,
    [enrolmentId]
  );
  const da = r.rows[0] as
    | { application_id: string; invoice_id: string | null; grant_invoice_id: string | null; sfc_invoice_id: string | null }
    | undefined;
  if (!da) return;

  const [mainW, grantW, sfcW] = await Promise.all([
    deleteQboInvoiceIfPresent(da.invoice_id, 'main'),
    deleteQboInvoiceIfPresent(da.grant_invoice_id, 'grant'),
    deleteQboInvoiceIfPresent(da.sfc_invoice_id, 'sfc'),
  ]);
  const warnings = [mainW, grantW, sfcW].filter((w): w is string => !!w);
  if (warnings.length > 0) {
    console.warn(`⚠️ [enrolment/cancel] ${enrolmentId}: DA QB delete warnings: ${warnings.join('; ')}`);
  } else {
    console.log(`🗑️ [enrolment/cancel] ${enrolmentId}: DA QB invoices deleted (main/grant/sfc as applicable)`);
  }

  await pool.query(
    `UPDATE da_application
     SET application_status = 'Cancelled',
         enrolment_status = 'Cancelled',
         invoice_id = NULL,
         invoice_doc_number = NULL,
         invoice_no = NULL,
         invoice_drive_file_id = NULL,
         invoice_drive_web_view_link = NULL,
         grant_invoice_id = NULL,
         grant_invoice_drive_file_id = NULL,
         grant_invoice_drive_web_view_link = NULL,
         sfc_invoice_id = NULL,
         sfc_invoice_drive_file_id = NULL,
         sfc_invoice_drive_web_view_link = NULL,
         updated_at = NOW()
     WHERE application_id = $1`,
    [da.application_id]
  );
}

/**
 * POST /api/enrolment/cancel
 * Cancel an enrolment via SSG API.
 * Body: { enrolmentId, courseRunId? }
 *
 * If courseRunId is not provided, it is resolved from the local
 * ssg_enrolments cache, then by calling SSG view-enrolment as a fallback.
 *
 * SSG payload:
 * { "enrolment": { "course": { "run": { "id": "<courseRunId>" } } } }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { enrolmentId, courseRunId: courseRunIdInput } = req.body;
  if (!enrolmentId) {
    return res.status(400).json({ success: false, error: 'enrolmentId is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    // Resolve courseRunId: prefer the value posted by the caller; otherwise look it up.
    let courseRunId: string | undefined = courseRunIdInput ? String(courseRunIdInput).trim() : undefined;
    if (!courseRunId) {
      const cached = await pool.query<{ course_run_id: string | null }>(
        `SELECT course_run_id FROM ssg_enrolments
         WHERE enrolment_id = $1 AND course_run_id IS NOT NULL AND course_run_id <> ''
         ORDER BY imported_at DESC LIMIT 1`,
        [String(enrolmentId).trim()]
      );
      courseRunId = cached.rows[0]?.course_run_id ?? undefined;
    }
    if (!courseRunId) {
      const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
      const view = await api.viewEnrolment(String(enrolmentId).trim());
      const ssgRunId = (view?.data as any)?.enrolment?.course?.run?.id ?? (view?.data as any)?.course?.run?.id;
      if (view?.error || !ssgRunId) {
        const msg = (view?.error as any)?.message ?? 'Unable to resolve courseRunId from SSG for this enrolmentId';
        return res.status(view?.status || 400).json({ success: false, error: msg });
      }
      courseRunId = String(ssgRunId);
    }

    const payload = {
      enrolment: {
        action: 'Cancel',
        course: {
          run: { id: String(courseRunId) }
        }
      }
    };

    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/tpg/enrolments/details/${enrolmentId}`)
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG cancel error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);
    console.log('📦 Cancel enrolment SSG response:', JSON.stringify(parsed));

    if (parsed?.status && String(parsed.status) !== '200') {
      return res.status(Number(parsed.status) || 400).json({ success: false, error: parsed?.error ?? `SSG status ${parsed.status}` });
    }

    // Update local DB if the record exists
    await pool.query(
      `UPDATE enrollment SET enrolment_status = 'Cancelled', updated_at = NOW() WHERE enrolment_id = $1`,
      [enrolmentId]
    );

    try {
      await upsertSsgEnrolmentFromLocalEnrollment(String(enrolmentId).trim());
    } catch (e) {
      console.warn('[enrolment/cancel] ssg_enrolments sync:', e);
    }

    void cancelInvoiceJobOnEnrolmentCancelled(String(enrolmentId).trim()).catch((e: unknown) =>
      console.warn('[enrolment/cancel] invoice job cancel:', e instanceof Error ? e.message : e)
    );

    void cleanupDaInvoicesForEnrolment(String(enrolmentId).trim()).catch((e: unknown) =>
      console.warn('[enrolment/cancel] DA invoice cleanup:', e instanceof Error ? e.message : e)
    );

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed });

  } catch (error) {
    console.error('❌ Cancel enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
