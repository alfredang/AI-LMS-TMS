import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { getSSGCredentialsService } from '@lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '@lib/ssg/api/course-api';
import { RunTrainerEditInfo, TrainerType } from '@lib/ssg/models/course-runs';
import { classifySsgError } from '../external/sync-trainer-to-tpg';

/**
 * POST /api/admin/run-bulk-tpg-assign
 *
 * Assign local trainers to TPG (SSG) for selected course runs.
 * Body: { items: [{ courseRunUuid, trainerName, trainerEmail, nric }] }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items array is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);

    let sent = 0, skipped = 0, errors = 0;
    const results: any[] = [];

    for (const item of items) {
      const { courseRunUuid, trainerName, trainerEmail, nric, syncAction } = item;

      try {
        // Get course run details
        const crResult = await pool.query(
          `SELECT cr.course_run_id, c.course_code
           FROM course_run cr JOIN course c ON c.id = cr.course_id
           WHERE cr.id = $1`,
          [courseRunUuid]
        );
        if (!crResult.rows[0]) {
          results.push({ courseRunUuid, status: 'error', message: 'Course run not found' });
          errors++;
          continue;
        }

        const { course_run_id, course_code } = crResult.rows[0];

        // Handle clear action: no local trainer, remove stale TPG assignment
        if (syncAction === 'clear') {
          await pool.query(
            `UPDATE course_run
             SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL,
                 tpg_sync_status = NULL, updated_at = NOW()
             WHERE id = $1`,
            [courseRunUuid]
          );
          results.push({ courseRunUuid, courseRunId: course_run_id, status: 'cleared', message: 'Cleared stale TPG assignment (no local trainer)' });
          sent++;
          continue;
        }

        if (!nric || nric === 'NA' || !nric.trim()) {
          await pool.query(
            `UPDATE course_run SET tpg_sync_status = 'no_nric', updated_at = NOW() WHERE id = $1`,
            [courseRunUuid]
          );
          results.push({ courseRunUuid, courseRunId: course_run_id, trainerName, status: 'skipped', message: 'No valid NRIC' });
          skipped++;
          continue;
        }

        const trainerPayloads: RunTrainerEditInfo[] = [{
          trainerTypeCode: TrainerType.EXISTING,
          trainerTypeDescription: 'Existing',
          trainerIdNumber: nric.trim(),
        }];

        const editRes = await courseApi.editCourseRunTrainerOnly(
          course_run_id,
          {
            courseReferenceNumber: course_code,
            linkCourseRunTrainer: trainerPayloads,
          }
        );

        const hasEditError = editRes.error && (editRes.error.code || editRes.error.message);

        if (hasEditError) {
          // Check for Existing_Trainer_NotFound — save locally anyway per business rule
          const ssgErrorMsg = editRes.error?.message || '';
          const syncStatus = classifySsgError(ssgErrorMsg, editRes.status);
          if (syncStatus === 'no_tpg_profile') {
            await pool.query(
              `UPDATE course_run SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL, tpg_sync_status = 'no_tpg_profile', updated_at = NOW() WHERE id = $1`,
              [courseRunUuid]
            );
            results.push({ courseRunUuid, courseRunId: course_run_id, trainerName, status: 'partial', message: 'Trainer not registered in SSG TP Profile' });
            sent++;
          } else {
            await pool.query(
              `UPDATE course_run SET tpg_sync_status = $2, updated_at = NOW() WHERE id = $1`,
              [courseRunUuid, syncStatus]
            );
            results.push({ courseRunUuid, courseRunId: course_run_id, trainerName, status: 'error', message: ssgErrorMsg || 'SSG rejected' });
            errors++;
          }
          continue;
        }

        // Success — write TPG trainer locally
        await pool.query(
          `UPDATE course_run
           SET tpg_assigned_trainer_name = $2, tpg_assigned_trainer_email = $3,
               tpg_sync_status = 'synced',
               class_status = CASE
                 WHEN class_status = 'Pending'
                      AND EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = course_run.id)
                 THEN 'Confirmed' ELSE class_status END,
               updated_at = NOW()
           WHERE id = $1`,
          [courseRunUuid, trainerName, trainerEmail || null]
        );

        results.push({ courseRunUuid, courseRunId: course_run_id, trainerName, status: 'sent', message: 'Assigned to TPG' });
        sent++;
      } catch (err) {
        results.push({ courseRunUuid, trainerName, status: 'error', message: err instanceof Error ? err.message : String(err) });
        errors++;
      }
    }

    return res.status(200).json({ success: true, sent, skipped, errors, results });
  } catch (err) {
    console.error('run-bulk-tpg-assign error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
