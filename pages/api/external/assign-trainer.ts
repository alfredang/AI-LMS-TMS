import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Assign Trainer to Course Run
 *
 * POST /api/external/assign-trainer
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body (JSON):
 *   {
 *     "course_run_id":    "1303232",
 *     "primary_email":    "trainer@email.com",
 *     "secondary_email":  "",             // empty string if none
 *     "course_code":      "TGS-...",      // required
 *     "course_title":     "...",          // mode derivation
 *     "start_date":       "12 Mar 2026",  // required
 *     "end_date":         "12 Mar 2026",  // required
 *     "ra_code":          "RA741642"      // optional
 *   }
 *
 * Flow:
 *   1. Validate API key
 *   2. Use data provided in request body directly
 *   3. Upsert course_run in DB (create if not exists, update if exists)
 *   4. Assign the trainer
 */

// ── Rate limiter (commented out — webhook disabled) ───────────────────────────
// let lastWebhookCallAt = 0;
// const RATE_LIMIT_MS   = 3000;
//
// async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
//   const now     = Date.now();
//   const elapsed = now - lastWebhookCallAt;
//   if (elapsed < RATE_LIMIT_MS) {
//     await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
//   }
//   lastWebhookCallAt = Date.now();
//   return fetch(url, options);
// }

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert various date formats → ISO string "YYYY-MM-DD"
// Handles: SSG integer 20260307, already-ISO "2026-03-07", human "12 Mar 2026"
function parseToISO(d: number | string | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  // SSG integer format: 20260307
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  // Already ISO: 2026-03-12
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Human readable: "12 Mar 2026"
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) return `${m[3]}-${months[m[2]] ?? '01'}-${m[1].padStart(2, '0')}`;
  return null;
}



async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assign_trainer_log (
      id             SERIAL PRIMARY KEY,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      course_run_id  TEXT,
      course_code    TEXT,
      course_title   TEXT,
      start_date     TEXT,
      end_date       TEXT,
      ra_code        TEXT,
      trainer_name   TEXT,
      trainer_email  TEXT,
      action         TEXT,
      status         TEXT NOT NULL DEFAULT 'success',
      error_message  TEXT
    )
  `);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── API Key Authentication ──────────────────────────────────────────────────
  const apiKey   = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    console.warn(`⚠️ Unauthorized attempt — key: ${apiKey ? '[wrong key]' : '[missing]'}`);
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  // ── Input Validation ────────────────────────────────────────────────────────
  const {
    course_run_id,
    primary_email,
    secondary_email,
    course_code,
    start_date,
    end_date,
    ra_code,
    course_title,
  } = req.body ?? {};

  await ensureLogTable();

  if (!course_run_id || !primary_email || !course_code) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: course_run_id, primary_email, course_code',
    });
  }

  // ── Use request body data directly ──────────────────────────────────────────
  const courseCode    = course_code;
  const startDateISO  = parseToISO(start_date);
  const endDateISO    = parseToISO(end_date);
  const raCode        = ra_code ?? null;
  const courseTitle   = course_title ?? '';

  const client = await pool.connect();
  try {
    // ── Look up trainer by primary_email, then secondary_email ─────────────
    const lookupEmail   = primary_email.trim().toLowerCase();
    const lookupEmail2  = secondary_email?.trim().toLowerCase() || null;
    const trainerResult = await client.query(
      `SELECT au.id, au.full_name, au.email, au.secondary_email
       FROM app_user au
       JOIN trainer_profile tp ON tp.user_id = au.id
       WHERE LOWER(au.email)           = $1
          OR LOWER(au.secondary_email) = $1
          OR ($2::text IS NOT NULL AND (
                LOWER(au.email)           = $2
             OR LOWER(au.secondary_email) = $2
          ))
       LIMIT 1`,
      [lookupEmail, lookupEmail2]
    );

    if (trainerResult.rows.length === 0) {
      console.warn(`⚠️ assign-trainer 404: trainer not found — primary=${primary_email}, secondary=${secondary_email ?? 'none'}, run=${course_run_id}`);
      return res.status(404).json({
        success: false,
        error: `Trainer not found or has no trainer profile: ${primary_email}`,
      });
    }

    const trainer = trainerResult.rows[0];

    // ── Sync secondary_email into DB if not already set ─────────────────────
    if (lookupEmail2 && !trainer.secondary_email) {
      await client.query(
        `UPDATE app_user SET secondary_email = $1 WHERE id = $2`,
        [lookupEmail2, trainer.id]
      );
      console.log(`📧 Saved secondary_email for ${trainer.email}: ${lookupEmail2}`);
    }

    await client.query('BEGIN');

    // ── Resolve mode of learning from course title ──────────────────────────
    const titleLower = courseTitle.toLowerCase();
    let mode_of_learning: string;
    if (titleLower.includes('virtual'))        mode_of_learning = 'Virtual';
    else if (titleLower.includes('external'))  mode_of_learning = 'External';
    else if (titleLower.includes('hybrid'))    mode_of_learning = 'Hybrid';
    else mode_of_learning = 'Physical';

    // ── Check if course run already exists in DB ────────────────────────────
    const existingRun = await client.query(
      `SELECT cr.id AS uuid, c.id AS course_id, cr.digital_attendance_id
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.course_run_id = $1`,
      [String(course_run_id)]
    );

    let courseRunUuid: string;
    let courseId: string;
    let action: 'created' | 'updated' | 'skipped';

    if (existingRun.rows.length > 0) {
      courseRunUuid = existingRun.rows[0].uuid;
      courseId      = existingRun.rows[0].course_id;
      const existingDaId = existingRun.rows[0].digital_attendance_id;

      if (existingDaId) {
        // ── Already has digital_attendance_id — skip update, only assign trainer
        action = 'skipped';
        console.log(`ℹ️ Course run ${course_run_id} already has digital_attendance_id (${existingDaId}), skipping data update`);
      } else {
        // ── Exists but no digital_attendance_id — update with latest data ────
        action = 'updated';
        await client.query(
          `UPDATE course_run
           SET start_date            = COALESCE($1, start_date),
               end_date              = COALESCE($2, end_date),
               mode_of_learning      = COALESCE($3, mode_of_learning),
               digital_attendance_id = COALESCE($4, digital_attendance_id),
               class_status          = 'Confirmed',
               updated_at            = NOW()
           WHERE id = $5`,
          [startDateISO, endDateISO, mode_of_learning, raCode, courseRunUuid]
        );
        console.log(`✏️ Updated course run ${course_run_id} data`);
      }

    } else {
      // ── Does not exist — find course and create the run ───────────────────
      const courseResult = await client.query(
        `SELECT id FROM course WHERE LOWER(course_code) = LOWER($1) LIMIT 1`,
        [courseCode]
      );

      if (courseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        console.warn(`⚠️ assign-trainer 400: course not found — course_code=${courseCode}, run=${course_run_id}`);
        return res.status(400).json({
          success: false,
          error: `Course run ${course_run_id} does not exist in the database yet. To fix this:\n1. Log in with an Admin account.\n2. Go to Class Management > Upcoming Classes.\n3. Click "Import Course Run" and enter Course Run ID: ${course_run_id}.\n4. Once imported successfully, retry assigning the trainer.`,
        });
      }

      courseId = courseResult.rows[0].id;
      action   = 'created';

      const insertResult = await client.query(
        `INSERT INTO course_run
           (course_id, course_run_id, start_date, end_date, mode_of_learning, digital_attendance_id, class_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'Confirmed', NOW(), NOW())
         RETURNING id`,
        [courseId, String(course_run_id), startDateISO, endDateISO, mode_of_learning, raCode]
      );

      courseRunUuid = insertResult.rows[0].id;
    }

    // ── Assign trainer ──────────────────────────────────────────────────────
    // Legacy columns (backward compat)
    await client.query(
      `UPDATE course_run
       SET assigned_trainer_id    = $1,
           assigned_trainer_name  = $2,
           assigned_trainer_email = $3,
           updated_at             = NOW()
       WHERE id = $4`,
      [trainer.id, trainer.full_name, trainer.email, courseRunUuid]
    );

    // ── Multi-trainer: insert into junction table (additive) ────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS course_run_trainer (
        id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
        trainer_id    UUID,
        trainer_name  TEXT NOT NULL,
        trainer_email TEXT,
        assigned_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
        ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
    `);
    await client.query(
      `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
       DO UPDATE SET trainer_name = EXCLUDED.trainer_name, trainer_email = EXCLUDED.trainer_email`,
      [courseRunUuid, trainer.id, trainer.full_name, trainer.email]
    );

    await client.query('COMMIT');

    console.log(`✅ [${action}] ${trainer.email} → run ${course_run_id}${raCode ? ` (RA: ${raCode})` : ''}`);

    await pool.query(
      `INSERT INTO assign_trainer_log
         (course_run_id, course_code, course_title, start_date, end_date, ra_code, trainer_name, trainer_email, action, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'success')`,
      [String(course_run_id), courseCode, courseTitle, startDateISO, endDateISO, raCode, trainer.full_name, trainer.email, action],
    );

    return res.status(200).json({
      success: true,
      message: `Trainer assigned successfully (course run ${action === 'skipped' ? 'exists — data unchanged' : action})`,
      action,
      data: {
        courseRunId:  String(course_run_id),
        courseCode,
        courseTitle,
        startDate:    startDateISO,
        endDate:      endDateISO,
        raCode,
        trainerId:    trainer.id,
        trainerName:  trainer.full_name,
        trainerEmail: trainer.email,
      },
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ assign-trainer error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    await pool.query(
      `INSERT INTO assign_trainer_log
         (course_run_id, course_code, course_title, start_date, end_date, ra_code, trainer_email, action, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'error','error',$8)`,
      [String(course_run_id), courseCode ?? null, courseTitle ?? null, startDateISO ?? null, endDateISO ?? null, raCode ?? null, primary_email ?? null, errorMsg],
    ).catch(() => {});
    return res.status(500).json({
      success: false,
      error: errorMsg,
    });
  } finally {
    client.release();
  }
}
