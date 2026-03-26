import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';

/**
 * Admin proxy for the backfill-enrollments operation.
 * No API key required — accessible to logged-in admins via the UI.
 *
 * GET  /api/admin/backfill-enrollments?limit=50   — preview missing raw_data
 * POST /api/admin/backfill-enrollments?limit=50   — run backfill
 */

const RATE_LIMIT_MS = 4000;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function mapPaymentStatus(s: string | undefined): string | null {
  if (!s) return null;
  return s.toLowerCase() === 'paid' || s.toLowerCase() === 'full payment' ? 'Paid' : 'Unpaid';
}

function mapSponsorshipType(s: string | undefined): string | null {
  if (s === 'Individual' || s === 'Employer') return s;
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  // ── GET: preview ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const result = await pool.query(
      `SELECT e.id, e.enrolment_id, e.enrolment_status, e.email, e.nric,
              e.created_at, cr.course_run_id AS ssg_run_id, c.title AS course_title, c.course_code
       FROM enrollment e
       LEFT JOIN course_run cr ON cr.id = e.course_run_id
       LEFT JOIN course c ON c.id = e.course_id
       WHERE e.enrolment_id IS NOT NULL
         AND (e.raw_data IS NULL OR e.raw_data = '{}'::jsonb)
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, total: result.rows.length, enrollments: result.rows });
  }

  // ── POST: run backfill ────────────────────────────────────────────────────
  const findResult = await pool.query(
    `SELECT id, enrolment_id
     FROM enrollment
     WHERE enrolment_id IS NOT NULL
       AND (raw_data IS NULL OR raw_data = '{}'::jsonb)
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  const rows = findResult.rows;
  console.log(`📋 Backfill: ${rows.length} enrollment(s) to process`);

  if (rows.length === 0) {
    return res.status(200).json({ success: true, message: 'No enrollments need backfilling.', total: 0, updated: 0, skipped: 0, errors: 0, results: [] });
  }

  const results: { enrolmentId: string; status: string; result: string; detail?: string }[] = [];
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) {
    return res.status(500).json({ success: false, error: 'SSG credentials not found' });
  }
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const enrolmentAPI = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

  let updated = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    const enrolmentId = row.enrolment_id as string;
    console.log(`🔍 Fetching ${enrolmentId}…`);

    let fetched: { success: boolean; status: string; enrolment?: any; error?: string };
    try {
      const result = await enrolmentAPI.viewEnrolment(enrolmentId);
      if (result.error) {
        const status = String(result.status || '');
        fetched = { success: false, status: status || 'error', error: result.error?.message ?? String(result.error) };
      } else {
        const raw: any = result.data;
        const enrolment = raw?.enrolment ?? raw;
        fetched = enrolment ? { success: true, status: '200', enrolment } : { success: false, status: '200_no_data', error: 'No enrolment object' };
      }
    } catch (err) {
      fetched = { success: false, status: 'network_error', error: err instanceof Error ? err.message : 'Unknown' };
    }

    if (!fetched.success) {
      const isForbidden = fetched.status === '403';
      results.push({ enrolmentId, status: fetched.status, result: isForbidden ? 'skipped' : 'error', detail: fetched.error });
      isForbidden ? skipped++ : errors++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    const e       = fetched.enrolment;
    const trainee = e?.trainee ?? {};
    const course  = e?.course ?? {};
    const tp      = e?.trainingPartner ?? {};

    try {
      await pool.query(
        `UPDATE enrollment
         SET raw_data              = $1,
             enrolment_status      = COALESCE($2, enrolment_status),
             nric                  = COALESCE($3, nric),
             email                 = COALESCE($4, email),
             enrolment_date        = COALESCE($5::date, enrolment_date),
             course_reference      = COALESCE($6, course_reference),
             training_partner_code = COALESCE($7, training_partner_code),
             course_sponsorship    = COALESCE($8::public.course_sponsorship, course_sponsorship),
             payment_status        = COALESCE($9::public.learner_payment_status, payment_status),
             updated_at            = NOW()
         WHERE id = $10`,
        [
          JSON.stringify(e),
          e?.status ?? null,
          trainee?.id ?? null,
          trainee?.email?.full ?? trainee?.emailAddress ?? null,
          trainee?.enrolmentDate ?? null,
          course?.referenceNumber ?? null,
          tp?.code ?? null,
          mapSponsorshipType(trainee?.sponsorshipType),
          mapPaymentStatus(trainee?.fees?.collectionStatus),
          row.id,
        ]
      );
      const label = trainee?.fullName ?? trainee?.email?.full ?? trainee?.id ?? enrolmentId;
      console.log(`  ✅ Updated ${enrolmentId} — ${label}`);
      results.push({ enrolmentId, status: '200', result: 'updated', detail: label });
      updated++;
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : 'DB error';
      console.error(`  ❌ DB error for ${enrolmentId}: ${msg}`);
      results.push({ enrolmentId, status: 'db_error', result: 'error', detail: msg });
      errors++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  return res.status(200).json({
    success: true,
    message: `Backfill complete. Updated ${updated} of ${rows.length} enrollment(s).`,
    total: rows.length, updated, skipped, errors, results,
  });
}
