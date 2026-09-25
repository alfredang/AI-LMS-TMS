import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { upsertSsgEnrolmentFromLocalEnrollment } from '../../../lib/services/billingSync';
import { cancelInvoiceJobOnEnrolmentCancelled } from '../../../lib/services/invoiceJobs';
import { cleanupDaInvoicesForEnrolment } from '../../../lib/services/daInvoiceCleanup';
import { syncClassAttendees, type AttendeeSyncResult } from '../../../lib/calendar/ensureClassCalendarEvent';

function decryptSsgResponseBody(rawData: unknown, encKey: Buffer, iv: Buffer): any {
  const rawBody = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function ssgErrorMessage(parsed: any): string {
  return String(parsed?.error?.details?.[0]?.message || parsed?.error?.message || '');
}

function hasSsgError(parsed: any): boolean {
  if (parsed?.status && String(parsed.status) !== '200') return true;
  return !!(parsed?.error && (parsed.error.code || parsed.error.message || parsed.error.details?.length));
}

function isEmployerUenCancelValidation(parsed: any): boolean {
  const detailFields = Array.isArray(parsed?.error?.details)
    ? parsed.error.details.map((d: any) => String(d?.field || '').toLowerCase())
    : [];
  const message = ssgErrorMessage(parsed).toLowerCase();
  return detailFields.includes('employer.uen') || message.includes('invalid employer uen');
}

function buildEnrichedCancelPayload(enrolmentData: any, courseRunId: string) {
  const enrolment = enrolmentData?.enrolment ?? enrolmentData;
  const trainee = enrolment?.trainee ?? {};
  const course = enrolment?.course ?? {};
  const trainingPartner = enrolment?.trainingPartner ?? {};
  const employerUen = String(trainee?.employer?.uen || '').trim().toUpperCase();

  const payload: any = {
    enrolment: {
      action: 'Cancel',
      course: {
        run: { id: String(courseRunId) },
      },
    },
  };

  if (course?.referenceNumber) {
    payload.enrolment.course.referenceNumber = String(course.referenceNumber).trim();
  }

  if (trainee?.id || trainee?.idType || trainee?.sponsorshipType || employerUen) {
    payload.enrolment.trainee = {};
    if (trainee?.id) payload.enrolment.trainee.id = String(trainee.id).trim().toUpperCase();
    if (trainee?.idType) payload.enrolment.trainee.idType = trainee.idType;
    if (trainee?.sponsorshipType) payload.enrolment.trainee.sponsorshipType = trainee.sponsorshipType;
    if (employerUen) payload.enrolment.trainee.employer = { uen: employerUen };
  }

  if (trainingPartner?.uen || trainingPartner?.code) {
    payload.enrolment.trainingPartner = {};
    if (trainingPartner?.uen) payload.enrolment.trainingPartner.uen = String(trainingPartner.uen).trim().toUpperCase();
    if (trainingPartner?.code) payload.enrolment.trainingPartner.code = String(trainingPartner.code).trim();
  }

  return payload;
}

async function postEncryptedCancelPayload(opts: {
  ssgBaseUrl: string;
  enrolmentId: string;
  payload: any;
  encKey: Buffer;
  iv: Buffer;
  credentials: any;
}) {
  const { ssgBaseUrl, enrolmentId, payload, encKey, iv, credentials } = opts;
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, `/tpg/enrolments/details/${enrolmentId}`)
    .withMethod(HttpMethod.POST)
    .withBody(encryptedPayload);

  if (credentials?.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
  const httpResponse = await httpClient.request(builder.build());

  if (httpResponse.status !== 200) {
    return {
      ok: false,
      httpStatus: httpResponse.status,
      parsed: null,
      raw: httpResponse.data,
      message: `SSG error ${httpResponse.status}`,
    };
  }

  const parsed = decryptSsgResponseBody(httpResponse.data, encKey, iv);
  return {
    ok: !hasSsgError(parsed),
    httpStatus: httpResponse.status,
    parsed,
    raw: httpResponse.data,
    message: ssgErrorMessage(parsed) || `SSG status ${parsed?.status || httpResponse.status}`,
  };
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
async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const enrolmentRef = String(enrolmentId).trim();
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

    {
      let cancelResult = await postEncryptedCancelPayload({
        ssgBaseUrl,
        enrolmentId: enrolmentRef,
        payload,
        encKey,
        iv,
        credentials,
      });

      let parsed = cancelResult.parsed;
      console.log('Cancel enrolment SSG response:', JSON.stringify(parsed ?? cancelResult.raw));

      if (!cancelResult.ok && parsed && isEmployerUenCancelValidation(parsed)) {
        console.warn(`[enrolment/cancel] Employer.UEN validation failed for ${enrolmentRef}; retrying with enriched enrolment payload`);
        const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
        const view = await api.viewEnrolment(enrolmentRef);
        if (!view?.error && view?.data) {
          const enrichedPayload = buildEnrichedCancelPayload(view.data, String(courseRunId));
          cancelResult = await postEncryptedCancelPayload({
            ssgBaseUrl,
            enrolmentId: enrolmentRef,
            payload: enrichedPayload,
            encKey,
            iv,
            credentials,
          });
          parsed = cancelResult.parsed;
          console.log('Cancel enrolment enriched SSG response:', JSON.stringify(parsed ?? cancelResult.raw));
        } else {
          console.warn('[enrolment/cancel] Could not fetch enrolment for enriched retry:', view?.error);
        }
      }

      if (!cancelResult.ok) {
        if (cancelResult.httpStatus !== 200) {
          console.error(`SSG cancel error [${cancelResult.httpStatus}]:`, JSON.stringify(cancelResult.raw));
          return res.status(cancelResult.httpStatus || 400).json({ success: false, error: cancelResult.message, details: cancelResult.raw });
        }
        return res.status(Number(parsed?.status) || 400).json({ success: false, error: parsed?.error ?? cancelResult.message });
      }

      await pool.query(
        `UPDATE enrollment SET enrolment_status = 'Cancelled', updated_at = NOW() WHERE enrolment_id = $1`,
        [enrolmentRef]
      );

      try {
        await upsertSsgEnrolmentFromLocalEnrollment(enrolmentRef);
      } catch (e) {
        console.warn('[enrolment/cancel] ssg_enrolments sync:', e);
      }

      let qbResult: { qbDeleted: boolean; warnings: string[] } = { qbDeleted: false, warnings: [] };
      try {
        qbResult = await cancelInvoiceJobOnEnrolmentCancelled(enrolmentRef);
      } catch (e: unknown) {
        console.warn('[enrolment/cancel] invoice job cancel:', e instanceof Error ? e.message : e);
      }

      // Drop the cancelled learner from the live Google Calendar event's attendee list.
      // syncClassAttendees compares Confirmed enrolments (desired) against everyone ever
      // associated with the run (known) — now that the status flip above has taken effect,
      // this learner is known-but-no-longer-desired and gets removed. sendUpdates:'none',
      // best-effort — never fails the cancellation itself.
      let calendarResult: AttendeeSyncResult | { status: 'error' } = { status: 'skipped', added: 0, removed: 0, errors: 0 };
      try {
        calendarResult = await syncClassAttendees(courseRunId);
      } catch (e: unknown) {
        console.warn('[enrolment/cancel] calendar attendee sync:', e instanceof Error ? e.message : e);
        calendarResult = { status: 'error' };
      }

      void cleanupDaInvoicesForEnrolment(enrolmentRef)
        .then(({ found, warnings }) => {
          if (!found) return;
          if (warnings.length > 0) {
            console.warn(`[enrolment/cancel] ${enrolmentRef}: DA QB delete warnings: ${warnings.join('; ')}`);
          } else {
            console.log(`[enrolment/cancel] ${enrolmentRef}: DA QB invoices deleted (main/grant/sfc as applicable)`);
          }
        })
        .catch((e: unknown) =>
          console.warn('[enrolment/cancel] DA invoice cleanup:', e instanceof Error ? e.message : e)
        );

      return res.status(200).json({
        success: true,
        data: parsed?.data ?? parsed,
        qbInvoiceDeleted: qbResult.qbDeleted,
        qbWarnings: qbResult.warnings,
        calendarAttendeeRemoved: calendarResult,
      });
    }

    /*
     * Legacy path retained temporarily for reference. The scoped block above
     * now handles the cancel request, including the employer-sponsored retry,
     * and returns before this point.
     */
    /*
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

    let qbResult: { qbDeleted: boolean; warnings: string[] } = { qbDeleted: false, warnings: [] };
    try {
      qbResult = await cancelInvoiceJobOnEnrolmentCancelled(String(enrolmentId).trim());
    } catch (e: unknown) {
      console.warn('[enrolment/cancel] invoice job cancel:', e instanceof Error ? e.message : e);
    }

    void cleanupDaInvoicesForEnrolment(String(enrolmentId).trim())
      .then(({ found, warnings }) => {
        if (!found) return;
        if (warnings.length > 0) {
          console.warn(`⚠️ [enrolment/cancel] ${enrolmentId}: DA QB delete warnings: ${warnings.join('; ')}`);
        } else {
          console.log(`🗑️ [enrolment/cancel] ${enrolmentId}: DA QB invoices deleted (main/grant/sfc as applicable)`);
        }
      })
      .catch((e: unknown) =>
        console.warn('[enrolment/cancel] DA invoice cleanup:', e instanceof Error ? e.message : e)
      );

    return res.status(200).json({
      success: true,
      data: parsed?.data ?? parsed,
      qbInvoiceDeleted: qbResult.qbDeleted,
      qbWarnings: qbResult.warnings,
    });
    */

  } catch (error) {
    console.error('❌ Cancel enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

export default withAuth(handler);
