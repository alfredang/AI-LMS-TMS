/**
 * Learner attendance for a course run, from the LOCAL `course_attendance` table.
 *
 * Why LMS, not TPG: the LMS pulls TPG's QR/Singpass digital attendance down AND also holds manual
 * (signed-paper) attendance that trainers mark in the LMS — manual marks never reach TPG. So the LMS
 * is the MORE COMPLETE/accurate record (QR + manual); TPG alone under-reports (can show 25%/50% when
 * manual attendance isn't reflected). Assessment view + gate therefore use the LMS figure.
 *
 * Denominator = sessions where attendance was taken for anyone (matches the auto-create-certificates
 * cron), so not-yet-held / no-attendance sessions don't drag the % down.
 */
import pool from '../db';

export interface SessionAttendance {
  sessionId: string;
  date: string | null;
  present: boolean;
  status: string | null;     // 'Present' | 'Absent' | null (no attendance taken for the session)
  hadAttendance: boolean;
}

export interface AttendanceResult {
  available: boolean;            // false = can't determine (run not found / no attendance taken yet)
  reason?: string;
  sessions: SessionAttendance[];
  present: number;
  totalWithAttendance: number;
  totalSessions: number;
  percent: number;
}

export async function getLearnerAttendance(courseRunId: string, traineeNric: string): Promise<AttendanceResult> {
  const empty = (reason: string): AttendanceResult =>
    ({ available: false, reason, sessions: [], present: 0, totalWithAttendance: 0, totalSessions: 0, percent: 0 });

  const runId = String(courseRunId || '').trim();
  const nric = String(traineeNric || '').trim();
  if (!runId || !nric) return empty('Course Run ID and Trainee ID are required');

  const run = (await pool.query<{ id: string }>(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [runId])).rows[0];
  if (!run) return empty('Course run not found locally');

  const userId = (await pool.query<{ user_id: string | null }>(
    `SELECT user_id FROM enrollment WHERE course_run_id = $1 AND upper(btrim(nric)) = upper($2) LIMIT 1`,
    [run.id, nric]
  )).rows[0]?.user_id ?? null;

  const rows = (await pool.query<{ id: string; ssg_session_id: string | null; session_number: string | null; start_date: string | null; had_attendance: boolean; present: boolean }>(
    `SELECT cs.id, cs.ssg_session_id, cs.session_number, cs.start_date::text AS start_date,
            EXISTS(SELECT 1 FROM course_attendance ca WHERE ca.session_id = cs.id) AS had_attendance,
            EXISTS(SELECT 1 FROM course_attendance ca
                     WHERE ca.session_id = cs.id AND ca.is_present = true
                       AND (upper(btrim(ca.nric)) = upper($2) OR ($3::uuid IS NOT NULL AND ca.user_id = $3))) AS present
       FROM course_session cs
      WHERE cs.course_run_id = $1 AND cs.deleted IS NOT TRUE
      ORDER BY cs.start_date, cs.session_number`,
    [run.id, nric, userId]
  )).rows;

  const sessions: SessionAttendance[] = rows.map((r) => ({
    sessionId: r.ssg_session_id || (r.session_number != null ? `Session ${r.session_number}` : r.id),
    date: r.start_date,
    present: !!r.present,
    status: r.had_attendance ? (r.present ? 'Present' : 'Absent') : null,
    hadAttendance: !!r.had_attendance,
  }));

  const totalWithAttendance = sessions.filter((s) => s.hadAttendance).length;
  const present = sessions.filter((s) => s.present).length;
  if (totalWithAttendance === 0) {
    return { available: false, reason: 'No attendance recorded yet for this run', sessions, present: 0, totalWithAttendance: 0, totalSessions: rows.length, percent: 0 };
  }
  const percent = Math.round((present / totalWithAttendance) * 1000) / 10;
  return { available: true, sessions, present, totalWithAttendance, totalSessions: rows.length, percent };
}

/** The configured attendance requirement (%) from Company Settings (`certificate_attendance_threshold`). */
export async function getConfiguredAttendanceThreshold(): Promise<number> {
  const t = (await pool.query<{ t: string | null }>(
    `SELECT certificate_attendance_threshold AS t FROM training_provider LIMIT 1`
  )).rows[0]?.t;
  return parseFloat(String(t ?? '').replace('%', '')) || 0;
}

export interface AttendanceGate { blocked: boolean; available: boolean; percent: number; threshold: number; }

/**
 * Gate decision for pushing an assessment: blocked only when attendance is AVAILABLE and below the
 * configured threshold. FAIL-OPEN when attendance can't be determined yet (never block on missing data).
 */
export async function checkAttendanceGate(courseRunId: string, traineeNric: string): Promise<AttendanceGate> {
  const att = await getLearnerAttendance(courseRunId, traineeNric);
  const threshold = await getConfiguredAttendanceThreshold();
  return { blocked: att.available && att.percent < threshold, available: att.available, percent: att.percent, threshold };
}
