import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * Fetch Upcoming Class Enrolments
 *
 * GET  /api/admin/fetch-upcoming-enrolments?limit=20
 *   Preview: returns upcoming course runs with enrollment count + date status
 *
 * POST /api/admin/fetch-upcoming-enrolments?limit=20
 *   Run: for each upcoming course run, call the SSG view-enrolment webhook,
 *        insert/upsert all returned enrollments, and fix mismatched start/end dates.
 */

const VIEW_ENROLMENT_WEBHOOK = 'https://n8n.srv1231536.hstgr.cloud/webhook/246caa5e-bd7e-42e8-82b1-cde2e05e5013';
const RATE_LIMIT_MS = 4000;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/** Convert SSG YYYYMMDD or ISO date string to YYYY-MM-DD */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapSponsorship(s: string | undefined): string | null {
  if (s === 'Individual' || s === 'Employer') return s;
  if (s === 'INDIVIDUAL') return 'Individual';
  if (s === 'EMPLOYER') return 'Employer';
  return null;
}

function mapPaymentStatus(s: string | undefined): string | null {
  if (!s) return null;
  const l = s.toLowerCase();
  return (l === 'paid' || l === 'full payment') ? 'Paid' : 'Unpaid';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);

  // ── GET: preview ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const result = await pool.query(
      `SELECT
         cr.id           AS uuid,
         cr.course_run_id AS ssg_run_id,
         c.title         AS course_title,
         c.course_code,
         cr.start_date,
         cr.end_date,
         cr.class_status,
         COUNT(e.id)     AS enrolment_count
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN enrollment e ON e.course_run_id = cr.id
       WHERE cr.start_date > CURRENT_DATE
       GROUP BY cr.id, cr.course_run_id, c.title, c.course_code, cr.start_date, cr.end_date, cr.class_status
       ORDER BY cr.start_date ASC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, total: result.rows.length, courseRuns: result.rows });
  }

  // ── POST: run ────────────────────────────────────────────────────────────
  const courseRunsResult = await pool.query(
    `SELECT
       cr.id           AS uuid,
       cr.course_run_id AS ssg_run_id,
       c.title         AS course_title,
       c.id            AS course_uuid,
       cr.start_date,
       cr.end_date
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE cr.start_date > CURRENT_DATE
     ORDER BY cr.start_date ASC
     LIMIT $1`,
    [limit]
  );

  const courseRuns = courseRunsResult.rows;
  if (courseRuns.length === 0) {
    return res.status(200).json({ success: true, message: 'No upcoming course runs found.', total: 0, results: [] });
  }

  const results: {
    ssgRunId: string;
    courseTitle: string;
    enrollmentsInserted: number;
    enrollmentsSkipped: number;
    dateFixed: boolean;
    dateMismatch?: string;
    error?: string;
  }[] = [];

  for (const cr of courseRuns) {
    const ssgRunId: string = cr.ssg_run_id;
    console.log(`📋 Fetching enrolments for course run ${ssgRunId} (${cr.course_title})…`);

    // ── 1. Call SSG view-enrolment webhook ──────────────────────────────────
    let enrolments: any[] = [];
    let ssgStartDate: string | null = null;
    let ssgEndDate: string | null = null;

    try {
      const webhookRes = await fetch(VIEW_ENROLMENT_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunId: ssgRunId }),
      });

      const text = await webhookRes.text();
      if (!text || !text.trim()) {
        results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: 0, enrollmentsSkipped: 0, dateFixed: false, error: 'Empty response from webhook' });
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      let raw: any;
      try { raw = JSON.parse(text); } catch {
        results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: 0, enrollmentsSkipped: 0, dateFixed: false, error: 'Non-JSON webhook response' });
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const parsed = typeof raw.result === 'string' ? JSON.parse(raw.result) : (raw.result ?? raw);
      const status = String(parsed?.status ?? '');

      if (status === '404') {
        // No enrolments on SSG for this run — not an error
        results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: 0, enrollmentsSkipped: 0, dateFixed: false });
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      if (status !== '200') {
        results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: 0, enrollmentsSkipped: 0, dateFixed: false, error: `SSG returned status ${status}` });
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      enrolments = Array.isArray(parsed?.data) ? parsed.data : [];

      // Grab start/end dates from the first enrollment record if available
      if (enrolments.length > 0) {
        const runInfo = enrolments[0]?.enrolment?.course?.run ?? {};
        ssgStartDate = parseDate(runInfo.startDate);
        ssgEndDate   = parseDate(runInfo.endDate);
      }
    } catch (err) {
      results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: 0, enrollmentsSkipped: 0, dateFixed: false, error: err instanceof Error ? err.message : 'Network error' });
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    // ── 2. Upsert enrollments ───────────────────────────────────────────────
    let inserted = 0, skipped = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const record of enrolments) {
        const enrolment = record?.enrolment ?? {};
        const trainee   = enrolment?.trainee ?? {};
        const email     = trainee?.email?.full ?? trainee?.emailAddress ?? null;
        const fullName  = trainee?.fullName ?? null;
        const nric      = trainee?.id ?? null;
        const enrolmentId = enrolment?.referenceNumber ?? null;
        const enrolStatus = enrolment?.status ?? null;
        const contactNum  = trainee?.contactNumber ?? {};
        const tel         = [contactNum.countryCode, contactNum.phoneNumber].filter(Boolean).join('') || '';

        if (!email) { skipped++; continue; }

        // Find or create app_user
        let userRow = await client.query(`SELECT id FROM app_user WHERE email = $1 LIMIT 1`, [email]);
        let userId: string;
        if (userRow.rows.length === 0) {
          const ins = await client.query(
            `INSERT INTO app_user (email, password, password_hash, full_name) VALUES ($1, 'password123', 'password123', $2) ON CONFLICT (email) DO NOTHING RETURNING id`,
            [email, fullName || email]
          );
          if (ins.rows.length > 0) {
            userId = ins.rows[0].id;
            await client.query(`INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`, [userId, nric, tel]);
            await client.query(`INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT (user_id, role) DO NOTHING`, [userId]);
          } else {
            const re = await client.query(`SELECT id FROM app_user WHERE email = $1 LIMIT 1`, [email]);
            userId = re.rows[0].id;
          }
        } else {
          userId = userRow.rows[0].id;
        }

        // Upsert enrollment
        const enrolDate  = parseDate(trainee?.enrolmentDate);
        const sponsorship = mapSponsorship(trainee?.sponsorshipType);
        const payStatus  = mapPaymentStatus(trainee?.fees?.collectionStatus);

        const upsertRes = await client.query(
          `INSERT INTO enrollment
             (user_id, course_id, course_run_id, enrolment_id, nric, email,
              enrolment_status, course_sponsorship, enrolment_date, payment_status, raw_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::public.course_sponsorship, $9::date, $10::public.learner_payment_status, $11::jsonb)
           ON CONFLICT (user_id, course_run_id) DO UPDATE SET
             enrolment_id     = COALESCE(EXCLUDED.enrolment_id,     enrollment.enrolment_id),
             nric             = COALESCE(EXCLUDED.nric,             enrollment.nric),
             email            = COALESCE(EXCLUDED.email,            enrollment.email),
             enrolment_status = COALESCE(EXCLUDED.enrolment_status, enrollment.enrolment_status),
             course_sponsorship = COALESCE(EXCLUDED.course_sponsorship, enrollment.course_sponsorship),
             enrolment_date   = COALESCE(EXCLUDED.enrolment_date,   enrollment.enrolment_date),
             payment_status   = COALESCE(EXCLUDED.payment_status,   enrollment.payment_status),
             raw_data         = COALESCE(EXCLUDED.raw_data,         enrollment.raw_data),
             updated_at       = NOW()
           RETURNING (xmax = 0) AS is_new`,
          [
            userId, cr.course_uuid, cr.uuid,
            enrolmentId, nric, email,
            enrolStatus, sponsorship, enrolDate || null,
            payStatus, JSON.stringify(enrolment),
          ]
        );
        upsertRes.rows[0]?.is_new ? inserted++ : skipped++;
      }

      // ── 3. Check and fix start/end dates ──────────────────────────────────
      let dateFixed = false;
      let dateMismatch: string | undefined;

      if (ssgStartDate || ssgEndDate) {
        const dbStart = cr.start_date ? new Date(cr.start_date).toISOString().slice(0, 10) : null;
        const dbEnd   = cr.end_date   ? new Date(cr.end_date).toISOString().slice(0, 10)   : null;

        const startMismatch = ssgStartDate && dbStart && ssgStartDate !== dbStart;
        const endMismatch   = ssgEndDate   && dbEnd   && ssgEndDate   !== dbEnd;
        const startMissing  = ssgStartDate && !dbStart;
        const endMissing    = ssgEndDate   && !dbEnd;

        if (startMismatch || endMismatch || startMissing || endMissing) {
          const parts: string[] = [];
          if (startMismatch) parts.push(`Start: DB ${dbStart} → SSG ${ssgStartDate}`);
          if (endMismatch)   parts.push(`End: DB ${dbEnd} → SSG ${ssgEndDate}`);
          if (startMissing)  parts.push(`Start missing in DB, SSG has ${ssgStartDate}`);
          if (endMissing)    parts.push(`End missing in DB, SSG has ${ssgEndDate}`);
          dateMismatch = parts.join(' | ');

          await client.query(
            `UPDATE course_run SET
               start_date = COALESCE($1::date, start_date),
               end_date   = COALESCE($2::date, end_date),
               updated_at = NOW()
             WHERE id = $3`,
            [ssgStartDate, ssgEndDate, cr.uuid]
          );
          dateFixed = true;
        }
      }

      await client.query('COMMIT');
      results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: inserted, enrollmentsSkipped: skipped, dateFixed, dateMismatch });
      console.log(`  ✅ ${ssgRunId}: inserted=${inserted} skipped=${skipped} dateFixed=${dateFixed}`);
    } catch (err) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : 'DB error';
      console.error(`  ❌ DB error for ${ssgRunId}: ${msg}`);
      results.push({ ssgRunId, courseTitle: cr.course_title, enrollmentsInserted: 0, enrollmentsSkipped: 0, dateFixed: false, error: msg });
    } finally {
      client.release();
    }

    await sleep(RATE_LIMIT_MS);
  }

  const totalInserted = results.reduce((s, r) => s + r.enrollmentsInserted, 0);
  const totalFixed    = results.filter(r => r.dateFixed).length;
  const totalErrors   = results.filter(r => r.error).length;

  return res.status(200).json({
    success: true,
    message: `Done. ${totalInserted} enrolment(s) added, ${totalFixed} date(s) corrected across ${courseRuns.length} course run(s).`,
    total: courseRuns.length,
    totalInserted,
    totalFixed,
    totalErrors,
    results,
  });
}
