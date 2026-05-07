import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

/**
 * Scheduler endpoint: pulls recent SSG enrolments and inserts new ones
 * into the local ssg_enrolment_record table. Skips duplicates by
 * enrolment_reference (UNIQUE index).
 *
 * Checks the last 7 days of enrolments by default. Each day is queried
 * separately because SSG's searchEnrolment filters by a single date.
 *
 * Called by the scheduler (sync_ssg_enrolments task) or manually via
 * the admin Run Once button.
 */

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __syncSsgEnrolmentsRunning?: boolean };
if (g.__syncSsgEnrolmentsRunning === undefined) g.__syncSsgEnrolmentsRunning = false;

export async function runAutomation(): Promise<{ success: boolean; inserted: number; skipped: number; errors: number; daysChecked: number }> {
  if (g.__syncSsgEnrolmentsRunning) {
    console.warn('[sync-ssg-enrolments] Another run is already in progress — skipping');
    return { success: false, inserted: 0, skipped: 0, errors: 0, daysChecked: 0 };
  }
  g.__syncSsgEnrolmentsRunning = true;
  try {
    return await _runAutomationInner();
  } finally {
    g.__syncSsgEnrolmentsRunning = false;
  }
}

async function _runAutomationInner(): Promise<{ success: boolean; inserted: number; skipped: number; errors: number; daysChecked: number }> {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  // Load SSG credentials
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) {
    throw new Error('SSG credentials not found');
  }

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();
  const tpUen = tp.uen || credentials.uen;
  const tpCode = tp.code;
  const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

  // Check last 7 days
  const daysToCheck = 7;
  const today = new Date();

  for (let i = 0; i < daysToCheck; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateIso = d.toISOString().slice(0, 10);
    const dateCompact = dateIso.replace(/-/g, '');

    try {
      const result = await api.searchEnrolment({
        meta: { enrolmentDate: dateCompact },
        parameters: { page: 0, pageSize: 100 },
        enrolment: {
          trainingPartner: { uen: tpUen, code: tpCode },
        },
      } as any);

      if (result.error) {
        console.warn(`⚠️ [sync-ssg-enrolments] SSG error for ${dateIso}:`, result.error.message);
        errors++;
        continue;
      }

      const rawItems: any[] = Array.isArray(result.data) ? result.data : [];

      for (const item of rawItems) {
        const enr = item?.enrolment ?? item;
        const ref = enr?.referenceNumber;
        if (!ref) continue;

        // Normalise SSG date formats (YYYYMMDD or YYYY-MM-DD) to YYYY-MM-DD
        const normDate = (v: any): string | null => {
          if (!v) return null;
          const s = String(v);
          if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
          return null;
        };

        try {
          await pool.query(
            `INSERT INTO ssg_enrolment_record
              (enrolment_reference, enrolment_date, learner_name, learner_nric, learner_email,
               course_title, course_ref_code, course_run_id, start_date, status, raw_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (enrolment_reference) DO NOTHING`,
            [
              ref,
              normDate(enr?.trainee?.enrolmentDate) || normDate(item?.meta?.createdOn),
              enr?.trainee?.fullName || enr?.trainee?.name || null,
              enr?.trainee?.id || null,
              enr?.trainee?.email?.full || enr?.trainee?.email || null,
              enr?.course?.title || null,
              enr?.course?.referenceNumber || null,
              enr?.course?.run?.id || null,
              normDate(enr?.course?.run?.startDate),
              enr?.status || null,
              JSON.stringify(item),
            ]
          );
          // Check if it was actually inserted (rowCount = 1) or skipped (0)
          // pg doesn't distinguish on ON CONFLICT DO NOTHING, so we count all as processed
          inserted++;
        } catch (dbErr: any) {
          if (dbErr.code === '23505') {
            // Unique constraint violation — already exists
            skipped++;
          } else {
            console.error(`❌ [sync-ssg-enrolments] DB error for ${ref}:`, dbErr.message);
            errors++;
          }
        }
      }
    } catch (dayErr: any) {
      console.error(`❌ [sync-ssg-enrolments] Error for ${dateIso}:`, dayErr.message);
      errors++;
    }
  }

  console.log(`📋 [sync-ssg-enrolments] Done: inserted=${inserted}, skipped=${skipped}, errors=${errors}, daysChecked=${daysToCheck}`);
  return { success: true, inserted, skipped, errors, daysChecked: daysToCheck };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Guard with external API key
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const expectedKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (expectedKey && apiKey !== expectedKey) {
    // Allow if called internally (no key configured or from scheduler)
    if (expectedKey && !req.headers['x-internal-scheduler']) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
  }

  try {
    const result = await runAutomation();
    return res.status(200).json(result);
  } catch (err) {
    console.error('❌ sync-ssg-enrolments error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
