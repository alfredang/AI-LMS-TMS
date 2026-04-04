import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { generateAndUploadCertificate } from '../../../lib/services/certificateService';

const SCHEDULER_SECRET = process.env.NEXT_PUBLIC_SCHEDULER_SECRET || 'local-dev-fallback';

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
            nric TEXT,
            certificate_url TEXT,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

/**
 * Logs an entry to the database.
 */
async function logResult(
    runId: string,
    status: 'created' | 'error',
    details: {
        courseRunId?: string;
        courseTitle?: string;
        courseCode?: string;
        learnerName?: string;
        nric?: string;
        certificateUrl?: string;
        errorMessage?: string;
    }
) {
    await pool.query(`
        INSERT INTO auto_create_certificates_log
        (run_id, course_run_id, course_title, course_code, learner_name, nric, certificate_url, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
        runId,
        details.courseRunId || null,
        details.courseTitle || null,
        details.courseCode || null,
        details.learnerName || null,
        details.nric || null,
        details.certificateUrl || null,
        status,
        details.errorMessage || null
    ]);
}

export async function runAutomation(targetDate?: string) {
    await ensureLogTable();

    // Use a unique UUID for this run batch
    const runId = crypto.randomUUID();
    const dateLabel = targetDate ? `for specific date ${targetDate}` : `for current window (last 2 days)`;
    console.log(`[auto-create-certificates] Starting run ${runId} ${dateLabel} at ${new Date().toISOString()}`);

    try {
        // 1. Find Course Runs Ending in the window (Last 2 days + Today)
        // This ensures timezone overlaps or previous day failures are caught.
        // If targetDate is provided, we only look at that specific date.
        const query = targetDate 
            ? `SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title
               FROM course_run cr
               JOIN course c ON cr.course_id = c.id
               WHERE DATE(cr.end_date) = $1`
            : `SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title
               FROM course_run cr
               JOIN course c ON cr.course_id = c.id
               WHERE DATE(cr.end_date) >= CURRENT_DATE - INTERVAL '2 days'
                 AND DATE(cr.end_date) <= CURRENT_DATE`;
        
        const params = targetDate ? [targetDate] : [];
        const endingRunsRes = await pool.query(query, params);

        const endingRuns = endingRunsRes.rows;
        console.log(`[auto-create-certificates] Found ${endingRuns.length} course runs ${dateLabel}.`);

        let totalGenerated = 0;
        let totalErrors = 0;

        for (const run of endingRuns) {
            const logContext = {
                courseRunId: run.course_run_id,
                courseTitle: run.course_title,
                courseCode: run.course_code
            };

            try {
                // 2. Count total sessions for this Course Run
                const totalSessionsRes = await pool.query(`
                    SELECT COUNT(*) as total
                    FROM course_session
                    WHERE course_run_id = $1
                      AND deleted = false
                `, [run.db_uuid]);

                const totalSessions = parseInt(totalSessionsRes.rows[0].total, 10);
                if (totalSessions === 0) {
                    throw new Error('No sessions found for this course run in local DB.');
                }

                // 3. Fetch attendance score per learner across ALL sessions
                // Only include learners with confirmed enrollment and ≥60% attendance
                const attendanceRes = await pool.query(`
                    SELECT 
                        e.id as enrolment_id,
                        e.nric,
                        COALESCE(au.full_name, e.nric, 'Unknown') as learner_name,
                        COUNT(DISTINCT CASE WHEN ca.is_present = true THEN ca.session_id END) as attended_count
                    FROM enrollment e
                    LEFT JOIN app_user au ON e.user_id = au.id
                    LEFT JOIN course_attendance ca ON ca.user_id = e.user_id AND ca.session_id IN (
                        SELECT id FROM course_session WHERE course_run_id = $1 AND deleted = false
                    )
                    WHERE e.course_run_id = $1
                      AND LOWER(e.enrolment_status) = 'confirmed'
                    GROUP BY e.id, e.nric, au.full_name
                    HAVING COUNT(DISTINCT CASE WHEN ca.is_present = true THEN ca.session_id END)::float / $2::float * 100 >= 60
                `, [run.db_uuid, totalSessions]);

                const eligibleTrainees = attendanceRes.rows;
                console.log(`[auto-create-certificates] ${run.course_run_id}: ${totalSessions} sessions, ${eligibleTrainees.length} learners with ≥60% attendance.`);

                for (const trainee of eligibleTrainees) {
                    const attendancePercent = Math.round((parseInt(trainee.attended_count, 10) / totalSessions) * 100);
                    const traineeLogContext = {
                        ...logContext,
                        nric: trainee.nric,
                        learnerName: trainee.learner_name
                    };

                    try {
                        // 4. Generate and Upload Certificate
                        console.log(`[auto-create-certificates] Generating cert for ${trainee.learner_name} (${attendancePercent}% attendance)`);
                        const certificateUrl = await generateAndUploadCertificate(trainee.enrolment_id, pool, trainee.learner_name);

                        await logResult(runId, 'created', { ...traineeLogContext, certificateUrl });
                        totalGenerated++;
                    } catch (traineeErr: any) {
                        console.error(`[auto-create-certificates] Error for trainee ${trainee.nric} in run ${run.course_run_id}: `, traineeErr);
                        await logResult(runId, 'error', { ...traineeLogContext, errorMessage: traineeErr.message });
                        totalErrors++;
                    }
                }

            } catch (runErr: any) {
                console.error(`[auto-create-certificates] Error processing course run ${run.course_run_id}: `, runErr);
                await logResult(runId, 'error', { ...logContext, errorMessage: runErr.message });
                totalErrors++;
            }
        }

        console.log(`[auto-create-certificates] Run ${runId} completed. ${totalGenerated} generated, ${totalErrors} errors.`);
        return { 
            success: true, 
            runId, 
            stats: { totalGenerated, totalErrors } 
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
    if (authKey !== SCHEDULER_SECRET) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await runAutomation(date);
    if (result.success) {
        return res.status(200).json(result);
    } else {
        return res.status(500).json(result);
    }
}
