import { isServiceRequest } from '@lib/auth/serviceKey';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { CertificateIssueError, issueCertificate } from '../../../lib/services/certificateDelivery';

// Fail closed: accept server-side secrets only. NEXT_PUBLIC_* values are baked
// into the public JS bundle and must never act as an API key; with no key
// configured, a per-boot random UUID makes every comparison fail.
const SCHEDULER_SECRET =
  process.env.SCHEDULER_SECRET ||
  process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT ||
  globalThis.crypto.randomUUID();

// ── Global in-flight lock ─────────────────────────────────────────────────────
// Prevents two concurrent runAutomation() calls (e.g. cron + manual "Run Now",
// or two Turbopack module instances) from processing the same learners.
// Hoisted onto globalThis so all module instances share the same flag.
const g = globalThis as unknown as { __certAutomationRunning?: boolean };
if (g.__certAutomationRunning === undefined) g.__certAutomationRunning = false;

/**
 * Ensures the auto_create_certificates_log table exists.
 */
async function ensureLogTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_create_certificates_log (
            id SERIAL PRIMARY KEY,
            run_id TEXT NOT NULL,
            course_run_id TEXT,
            course_title TEXT,
            course_code TEXT,
            learner_name TEXT,
            learner_email TEXT,
            nric TEXT,
            certificate_url TEXT,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Ensure learner_email column exists for older tables
    await pool.query(`ALTER TABLE auto_create_certificates_log ADD COLUMN IF NOT EXISTS learner_email TEXT`);
}

/**
 * Logs an entry to the database.
 */
async function logResult(
    runId: string,
    status: 'created' | 'skipped' | 'error',
    details: {
        courseRunId?: string;
        courseTitle?: string;
        courseCode?: string;
        learnerName?: string;
        learnerEmail?: string;
        nric?: string;
        certificateUrl?: string;
        errorMessage?: string;
    }
) {
    await pool.query(`
        INSERT INTO auto_create_certificates_log
        (run_id, course_run_id, course_title, course_code, learner_name, learner_email, nric, certificate_url, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
        runId,
        details.courseRunId || null,
        details.courseTitle || null,
        details.courseCode || null,
        details.learnerName || null,
        details.learnerEmail || null,
        details.nric || null,
        details.certificateUrl || null,
        status,
        details.errorMessage || null
    ]);
}

export async function runAutomation(targetDate?: string) {
    // ── Duplicate-run guard ────────────────────────────────────────────────
    // If another invocation is already in progress, bail out immediately.
    if (g.__certAutomationRunning) {
        console.warn('[auto-create-certificates] Another run is already in progress — skipping this invocation to prevent duplicate emails.');
        return { success: false, message: 'Skipped — another run is already in progress' };
    }
    g.__certAutomationRunning = true;

    try {
    return await _runAutomationInner(targetDate);
    } finally {
        g.__certAutomationRunning = false;
    }
}

async function _runAutomationInner(targetDate?: string) {
    await ensureLogTable();

    // Use a unique UUID for this run batch
    const runId = crypto.randomUUID();
    const dateLabel = targetDate ? `for specific date ${targetDate}` : `for current window (last 7 days)`;
    console.log(`[auto-create-certificates] Starting run ${runId} ${dateLabel} at ${new Date().toISOString()}`);

    try {
        // 0. Read attendance threshold from admin settings (default 60%)
        let attendanceThreshold = 60;
        try {
            const tpRes = await pool.query(`SELECT admin_settings FROM training_provider LIMIT 1`);
            const adminSettings = tpRes.rows[0]?.admin_settings;
            if (adminSettings?.certificateAttendanceThreshold) {
                attendanceThreshold = parseInt(adminSettings.certificateAttendanceThreshold, 10) || 60;
            }
        } catch { /* use default */ }
        console.log(`[auto-create-certificates] Attendance threshold: ${attendanceThreshold}%`);

        // 1. Find Course Runs that ended within the last 7 days AND still have
        //    confirmed learners without a certificate.
        //    This self-healing query means already-processed runs are automatically skipped.
        const query = targetDate
            ? `SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                      TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') as course_dates
               FROM course_run cr
               JOIN course c ON cr.course_id = c.id
               WHERE cr.end_date = $1::date
                 AND (cr.class_status IS NULL OR cr.class_status::text NOT ILIKE 'cancelled')
                 AND EXISTS (
                     SELECT 1 FROM enrollment e
                     WHERE e.course_run_id = cr.id
                       AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
                       AND (e.certificate IS NULL OR e.certificate = '')
                 )`
            : `SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                      TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') as course_dates
               FROM course_run cr
               JOIN course c ON cr.course_id = c.id
               WHERE cr.end_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date - INTERVAL '7 days'
                 AND cr.end_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date
                 AND (cr.class_status IS NULL OR cr.class_status::text NOT ILIKE 'cancelled')
                 AND EXISTS (
                     SELECT 1 FROM enrollment e
                     WHERE e.course_run_id = cr.id
                       AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
                       AND (e.certificate IS NULL OR e.certificate = '')
                 )`;
        
        const params = targetDate ? [targetDate] : [];
        const endingRunsRes = await pool.query(query, params);

        const endingRuns = endingRunsRes.rows;
        console.log(`[auto-create-certificates] Found ${endingRuns.length} course runs ${dateLabel}.`);

        let totalGenerated = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        for (const run of endingRuns) {
            const logContext = {
                courseRunId: run.course_run_id,
                courseTitle: run.course_title,
                courseCode: run.course_code
            };

            try {
                // 2. Count sessions where attendance was actually taken (at least one
                //    course_attendance row exists for that session). This avoids penalising
                //    learners when the trainer only takes attendance once for a multi-session
                //    day — e.g. a 1-day course with 3 sessions but QR attendance taken once.
                const sessionsWithAttendanceRes = await pool.query(`
                    SELECT COUNT(DISTINCT cs.id) as total
                    FROM course_session cs
                    WHERE cs.course_run_id = $1
                      AND cs.deleted = false
                      AND EXISTS (
                          SELECT 1 FROM course_attendance ca
                          WHERE ca.session_id = cs.id
                      )
                `, [run.db_uuid]);

                const sessionsWithAttendance = parseInt(sessionsWithAttendanceRes.rows[0].total, 10);

                if (sessionsWithAttendance === 0) {
                    // No attendance taken for any session — skip certificate generation.
                    console.log(`[auto-create-certificates] ${run.course_run_id}: No attendance taken for any session — skipping automated certificate generation.`);
                } else {
                    // Sessions with attendance exist — use local DB attendance to determine eligibility
                    // 3. Fetch ALL confirmed learners with their attendance from sessions where attendance was taken
                    const allLearnersRes = await pool.query(`
                        SELECT
                            e.id as enrolment_id,
                            e.nric,
                            COALESCE(au.full_name, e.nric, 'Unknown') as learner_name,
                            COALESCE(au.email, e.email) as learner_email,
                            COUNT(DISTINCT CASE WHEN ca.is_present = true THEN ca.session_id END) as attended_count
                        FROM enrollment e
                        LEFT JOIN app_user au ON e.user_id = au.id
                        LEFT JOIN course_attendance ca ON (ca.nric = e.nric OR ca.user_id = e.user_id) AND ca.session_id IN (
                            SELECT id FROM course_session WHERE course_run_id = $1 AND deleted = false
                              AND EXISTS (SELECT 1 FROM course_attendance ca2 WHERE ca2.session_id = course_session.id)
                        )
                        WHERE e.course_run_id = $1
                          AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
                          AND (e.certificate IS NULL OR e.certificate = '')
                        GROUP BY e.id, e.nric, au.full_name, au.email, e.email
                    `, [run.db_uuid]);

                    // 4. Filter learners who meet the attendance threshold (based on sessions where attendance was taken)
                    const eligibleTrainees = allLearnersRes.rows.filter(trainee => {
                        const attendedCount = parseInt(trainee.attended_count, 10) || 0;
                        const percent = (attendedCount / sessionsWithAttendance) * 100;
                        return percent >= attendanceThreshold;
                    });

                    console.log(`[auto-create-certificates] ${run.course_run_id}: ${sessionsWithAttendance} sessions with attendance taken, ${allLearnersRes.rows.length} enrolled, ${eligibleTrainees.length} learners with ≥${attendanceThreshold}% attendance.`);

                    for (const trainee of eligibleTrainees) {
                        const attendancePercent = Math.round((parseInt(trainee.attended_count, 10) / sessionsWithAttendance) * 100);
                        const traineeLogContext = {
                            ...logContext,
                            nric: trainee.nric,
                            learnerName: trainee.learner_name,
                            learnerEmail: trainee.learner_email || undefined,
                        };

                        try {
                            console.log(`[auto-create-certificates] Generating cert for ${trainee.learner_name} (${attendancePercent}% attendance)`);
                            const outcome = await issueCertificate({
                                enrollmentId: trainee.enrolment_id,
                                courseRunId: run.db_uuid,
                                sendEmail: Boolean(trainee.learner_email),
                                resend: false,
                                dryRun: false,
                                eligibilityMode: 'standard',
                                requestSource: 'scheduler:auto-create-certificates',
                                requestReason: `Automatic issue after ${attendancePercent}% recorded attendance`,
                            });

                            if (outcome.status === 'already_sent') {
                                await logResult(runId, 'skipped', {
                                    ...traineeLogContext,
                                    certificateUrl: outcome.certificateUrl || undefined,
                                    errorMessage: 'Certificate email already sent',
                                });
                                totalSkipped++;
                                continue;
                            }
                            if (outcome.status === 'email_failed') {
                                await logResult(runId, 'error', {
                                    ...traineeLogContext,
                                    certificateUrl: outcome.certificateUrl || undefined,
                                    errorMessage: outcome.error || 'Certificate generated but email delivery failed',
                                });
                                totalErrors++;
                                continue;
                            }

                            await logResult(runId, 'created', {
                                ...traineeLogContext,
                                certificateUrl: outcome.certificateUrl || undefined,
                            });
                            totalGenerated++;
                        } catch (traineeErr: any) {
                            console.error(`[auto-create-certificates] Error for trainee ${trainee.nric} in run ${run.course_run_id}: `, traineeErr);
                            if (traineeErr instanceof CertificateIssueError
                                && ['ineligible', 'class_not_ended', 'attendance_not_met', 'generation_in_progress', 'delivery_in_progress'].includes(traineeErr.code)) {
                                await logResult(runId, 'skipped', { ...traineeLogContext, errorMessage: traineeErr.message });
                                totalSkipped++;
                            } else {
                                await logResult(runId, 'error', { ...traineeLogContext, errorMessage: traineeErr.message });
                                totalErrors++;
                            }
                        }
                    }
                }

            } catch (runErr: any) {
                console.error(`[auto-create-certificates] Error processing course run ${run.course_run_id}: `, runErr);
                await logResult(runId, 'error', { ...logContext, errorMessage: runErr.message });
                totalErrors++;
            }
        }

        console.log(`[auto-create-certificates] Run ${runId} completed. ${totalGenerated} generated, ${totalSkipped} skipped, ${totalErrors} errors.`);
        return { 
            success: true, 
            runId, 
            stats: { totalGenerated, totalSkipped, totalErrors } 
        };

    } catch (error: any) {
        console.error('[auto-create-certificates] Fatal Error:', error);
        return { 
            success: false, 
            message: 'Internal processing error', 
            error: error.message 
        };
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { authKey, date } = req.body;
    if (authKey !== SCHEDULER_SECRET && !isServiceRequest(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await runAutomation(date);
    if (result.success) {
        return res.status(200).json(result);
    } else {
        return res.status(500).json(result);
    }
}
