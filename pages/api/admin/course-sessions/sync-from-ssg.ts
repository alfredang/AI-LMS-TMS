import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { syncAllDaApplicantsToCalendar } from '../../../../lib/google-calendar/da-calendar-sync';

// Upserts SSG session objects (as returned by /api/ssg/courses/runs/:runId/sessions)
// into the local `course_session` table. Soft-deletes local rows that are not
// present in the incoming list so SSG deletions propagate.
//
// Body: {
//   courseRunId: string   — SSG course_run_id (e.g. "1324510")
//   sessions:    SsgSession[]
// }
//
// SsgSession shape (per existing delete-body builder at
// components/admin/GrantManagementViews.tsx:4738):
//   { id, startDate, endDate, startTime, endTime, modeOfTraining, venue, deleted? }
//
// session_number is parsed from the suffix "-S{n}" of the SSG sessionId and
// stored with the "S" prefix (matches existing local convention).

interface SsgSessionInput {
  id?: string;
  startDate?: string | number;
  endDate?: string | number;
  startTime?: string;
  endTime?: string;
  modeOfTraining?: string;
  venue?: any;
  deleted?: boolean;
  [key: string]: any;
}

const parseSessionNumber = (ssgSessionId: string): string => {
  const m = ssgSessionId.match(/-S(\d+)$/i);
  return m ? `S${m[1]}` : '';
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { courseRunId, sessions } = req.body as {
      courseRunId?: string; sessions?: SsgSessionInput[];
    };

    if (!courseRunId || typeof courseRunId !== 'string') {
      return res.status(400).json({ success: false, error: 'courseRunId is required' });
    }
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ success: false, error: 'sessions must be an array' });
    }

    // Resolve local course_run UUID from SSG course_run_id string
    const runLookup = await pool.query(
      `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
      [courseRunId]
    );
    if (runLookup.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `course_run ${courseRunId} not found in local DB`,
      });
    }
    const courseRunUuid: string = runLookup.rows[0].id;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const seenSsgIds: string[] = [];

    for (const s of sessions) {
      const ssgSessionId = String(s?.id || '').trim();
      if (!ssgSessionId) {
        skipped++;
        continue;
      }
      seenSsgIds.push(ssgSessionId);

      const sessionNumber = parseSessionNumber(ssgSessionId);
      const startDate = String(s.startDate || '').trim();
      const endDate = String(s.endDate || '').trim();
      const startTime = (s.startTime || '').trim();
      const endTime = (s.endTime || '').trim();
      const modeOfTraining = String(s.modeOfTraining || '').trim();
      const venueJson = s.venue ? JSON.stringify(s.venue) : '{}';
      const deleted = s.deleted === true;

      const result = await pool.query(
        `
        INSERT INTO course_session (
          course_run_id, ssg_session_id, session_number,
          start_date, end_date, start_time, end_time,
          mode_of_training, venue, deleted
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
        ON CONFLICT (course_run_id, ssg_session_id)
        DO UPDATE SET
          session_number   = EXCLUDED.session_number,
          start_date       = EXCLUDED.start_date,
          end_date         = EXCLUDED.end_date,
          start_time       = EXCLUDED.start_time,
          end_time         = EXCLUDED.end_time,
          mode_of_training = EXCLUDED.mode_of_training,
          venue            = EXCLUDED.venue,
          deleted          = EXCLUDED.deleted,
          updated_at       = NOW()
        RETURNING (xmax = 0) AS was_insert
        `,
        [
          courseRunUuid, ssgSessionId, sessionNumber,
          startDate, endDate, startTime, endTime,
          modeOfTraining, venueJson, deleted,
        ]
      );

      if (result.rows[0]?.was_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    // Soft-delete any local rows not in the incoming list (SSG is source of truth).
    // Uses the seenSsgIds array as a dynamic IN clause.
    let softDeleted = 0;
    if (seenSsgIds.length > 0) {
      const placeholders = seenSsgIds.map((_, i) => `$${i + 2}`).join(',');
      const sd = await pool.query(
        `
        UPDATE course_session
        SET deleted = true, updated_at = NOW()
        WHERE course_run_id = $1
          AND deleted = false
          AND ssg_session_id NOT IN (${placeholders})
        `,
        [courseRunUuid, ...seenSsgIds]
      );
      softDeleted = sd.rowCount || 0;
    } else {
      // Empty SSG list → soft-delete everything locally (SSG says no sessions)
      const sd = await pool.query(
        `UPDATE course_session
         SET deleted = true, updated_at = NOW()
         WHERE course_run_id = $1 AND deleted = false`,
        [courseRunUuid]
      );
      softDeleted = sd.rowCount || 0;
    }

    // Re-derive the run window from the ACTIVE (non-deleted) sessions we just synced,
    // instead of reflecting SSG's course window. SSG only ever WIDENS its run window to
    // cover a moved session, so trusting it leaves course_run.start/end stale when the
    // first session moves later or the last moves earlier / is cancelled. The date-keyed
    // cron jobs + the courseware gate read these scalars, so we keep them equal to
    // MIN/MAX of the live session dates — matching the nightly upsertRunSessions heal
    // (lib/ssg/syncRunSessions.ts), so the reschedule path and the heal never disagree.
    // NOTE: course_session.start_date is stored raw from SSG as compact YYYYMMDD (e.g.
    // '20260421'), so we normalise each to a real date before MIN/MAX (dashed ISO is also
    // handled defensively). Skipped when a run has no parseable active sessions.
    await pool.query(
      `UPDATE course_run cr
       SET start_date = sub.min_start,
           end_date   = sub.max_start,
           updated_at = NOW()
       FROM (
         SELECT MIN(d) AS min_start, MAX(d) AS max_start
         FROM (
           SELECT CASE
                    WHEN start_date ~ '^[0-9]{8}$'                   THEN to_date(start_date, 'YYYYMMDD')
                    WHEN start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN start_date::date
                  END AS d
           FROM course_session
           WHERE course_run_id = $1 AND deleted = false
         ) t
         WHERE d IS NOT NULL
       ) sub
       WHERE cr.id = $1
         AND sub.min_start IS NOT NULL
         AND (cr.start_date IS DISTINCT FROM sub.min_start
              OR cr.end_date IS DISTINCT FROM sub.max_start)`,
      [courseRunUuid]
    );

    // Trigger DA applicant calendar sync (non-blocking background task)
    // Ensures any confirmed DA applicants are added to these new sessions.
    setImmediate(() => {
      syncAllDaApplicantsToCalendar(courseRunUuid).catch(err => {
        console.error('❌ [sync-from-ssg] background DA calendar sync failed:', err);
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        courseRunUuid,
        inserted,
        updated,
        softDeleted,
        skipped,
        total: inserted + updated,
      },
    });
  } catch (error) {
    console.error('[sync-from-ssg] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
