import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';

const RATE_LIMIT_MS = 4000; // 4 seconds between SSG API calls

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function mapPaymentStatus(collectionStatus: string | undefined): string | null {
  if (!collectionStatus) return null;
  const s = collectionStatus.toLowerCase();
  if (s === 'paid' || s === 'full payment') return 'Paid';
  return 'Unpaid';
}

function mapSponsorshipType(sponsorshipType: string | undefined): string | null {
  if (!sponsorshipType) return null;
  if (sponsorshipType === 'Individual') return 'Individual';
  if (sponsorshipType === 'Employer') return 'Employer';
  return null;
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── API Key auth ──────────────────────────────────────────────────────────
  const apiKey   = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

  if (!validKey) {
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  // ── GET: preview only — return list without calling webhook ───────────────
  if (req.method === 'GET') {
    const previewResult = await pool.query(
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
    return res.status(200).json({
      success: true,
      total: previewResult.rows.length,
      enrollments: previewResult.rows,
    });
  }

  // ── Find enrollments missing raw_data ─────────────────────────────────────
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
  console.log(`📋 Found ${rows.length} enrollments to backfill (limit=${limit})`);

  if (rows.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'No enrollments need backfilling.',
      total: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      results: [],
    });
  }

  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) {
    return res.status(500).json({ success: false, error: 'SSG credentials not found' });
  }
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const enrolmentAPI = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

  const results: { enrolmentId: string; status: string; result: string; detail?: string }[] = [];
  let updated = 0;
  let skipped = 0;
  let errors  = 0;

  for (const row of rows) {
    const enrolmentId = row.enrolment_id as string;
    console.log(`🔍 Fetching enrolment ${enrolmentId}…`);

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
      console.warn(`  ⚠️ ${isForbidden ? 'Forbidden' : 'Error'} for ${enrolmentId}: ${fetched.error}`);
      results.push({ enrolmentId, status: fetched.status, result: isForbidden ? 'skipped' : 'error', detail: fetched.error });
      isForbidden ? skipped++ : errors++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    // ── Parse the enrolment object ─────────────────────────────────────────
    const e         = fetched.enrolment;
    const trainee   = e?.trainee ?? {};
    const course    = e?.course ?? {};
    const tp        = e?.trainingPartner ?? {};

    const enrolmentStatus   = e?.status ?? null;
    const nric              = trainee?.id ?? null;
    const email             = trainee?.email?.full ?? trainee?.emailAddress ?? null;
    const fullName          = trainee?.fullName ?? null;
    const enrolmentDate     = trainee?.enrolmentDate ?? null;
    const sponsorshipType   = mapSponsorshipType(trainee?.sponsorshipType);
    const paymentStatus     = mapPaymentStatus(trainee?.fees?.collectionStatus);
    const courseReference   = course?.referenceNumber ?? null;
    const tpCode            = tp?.code ?? null;

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
          enrolmentStatus,
          nric,
          email,
          enrolmentDate,
          courseReference,
          tpCode,
          sponsorshipType,
          paymentStatus,
          row.id,
        ]
      );

      console.log(`  ✅ Updated ${enrolmentId} — ${fullName ?? email ?? nric}`);
      results.push({ enrolmentId, status: '200', result: 'updated', detail: fullName ?? email ?? nric ?? undefined });
      updated++;
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : 'DB error';
      console.error(`  ❌ DB update failed for ${enrolmentId}: ${msg}`);
      results.push({ enrolmentId, status: 'db_error', result: 'error', detail: msg });
      errors++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log(`✅ Backfill complete — updated: ${updated}, skipped: ${skipped}, errors: ${errors}`);

  return res.status(200).json({
    success: true,
    message: `Backfill complete. Updated ${updated} of ${rows.length} enrollments.`,
    total:   rows.length,
    updated,
    skipped,
    errors,
    results,
  });
}
