import { isServiceRequest } from '@lib/auth/serviceKey';
import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { autoShareLearnerMaterials } from '../../../lib/google-drive/drive-helpers';

// Fail closed: accept server-side secrets only. NEXT_PUBLIC_* values are baked
// into the public JS bundle and must never act as an API key; with no key
// configured, a per-boot random UUID makes every comparison fail.
const SCHEDULER_SECRET =
  process.env.SCHEDULER_SECRET ||
  process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT ||
  globalThis.crypto.randomUUID();

/**
 * External API — Auto Send Courseware and Attendance Taking Emails
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily at 7:00 AM SGT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Automatically sends Courseware and Attendance Taking emails to all learners
 *   enrolled in course runs starting TODAY. Uses the "Courseware and Attendance"
 *   email template configured in Company Settings.
 *
 * POST /api/external/auto-send-courseware-attendance
 *
 * What it does:
 *   1. Finds all course runs where start_date = CURRENT_DATE
 *   2. For each course run, fetches enrolled learners (status = 'confirmed')
 *   3. Fetches the Courseware and Attendance Email template from training_provider
 *   4. Replaces placeholders ({STUDENT_NAME}, {COURSE_NAME}, {DIGITAL_ATTENDANCE_ID}, etc.)
 *   5. Sends the email via Gmail API
 *   6. Logs all results to auto_send_courseware_attendance_log table
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Ensure log table exists ──────────────────────────────────────────────────

async function ensureLogTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_send_courseware_attendance_log (
            id SERIAL PRIMARY KEY,
            run_id TEXT NOT NULL,
            course_run_id TEXT,
            course_title TEXT,
            course_code TEXT,
            learner_name TEXT,
            learner_email TEXT,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

async function logResult(
    runId: string,
    status: 'sent' | 'skipped' | 'error',
    details: {
        courseRunId?: string;
        courseTitle?: string;
        courseCode?: string;
        learnerName?: string;
        learnerEmail?: string;
        errorMessage?: string;
    }
) {
    await pool.query(`
        INSERT INTO auto_send_courseware_attendance_log
        (run_id, course_run_id, course_title, course_code, learner_name, learner_email, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
        runId,
        details.courseRunId || null,
        details.courseTitle || null,
        details.courseCode || null,
        details.learnerName || null,
        details.learnerEmail || null,
        status,
        details.errorMessage || null,
    ]);
}

// ── Send courseware attendance email via Gmail API ────────────────────────────

async function sendCoursewareAttendanceEmail(opts: {
    studentName: string;
    studentEmail: string;
    courseName: string;
    courseCode: string;
    courseDates: string;
    courseStartDate: string;
    courseStartTime: string;
    courseVenue: string;
    digitalAttendanceId: string;
    emailSubject: string;
    emailBody: string;
    emailCc: string;
    tpRow: any;
    tp: any;
}): Promise<void> {
    const {
        studentName, studentEmail, courseName, courseCode, courseDates,
        courseStartDate, courseStartTime, courseVenue, digitalAttendanceId,
        emailSubject, emailBody, emailCc, tpRow, tp,
    } = opts;

    if (!tpRow.email_user || !tpRow.google_client_id || !tpRow.google_client_secret || !tpRow.google_refresh_token) {
        throw new Error('Google Integration settings incomplete — skipping email');
    }

    const oauth2Client = new google.auth.OAuth2(
        tpRow.google_client_id, tpRow.google_client_secret,
        'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: tpRow.google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const replacePlaceholders = (text: string) => text
        .replace(/\{STUDENT_NAME\}/g, studentName)
        .replace(/\{COURSE_NAME\}/g, courseName)
        .replace(/\{COURSE_CODE\}/g, courseCode)
        .replace(/\{COURSE_DATES\}/g, courseDates)
        .replace(/\{COURSE_START_DATE\}/g, courseStartDate)
        .replace(/\{COURSE_START_TIME\}/g, courseStartTime)
        .replace(/\{COURSE_VENUE\}/g, courseVenue)
        .replace(/\{DIGITAL_ATTENDANCE_ID\}/g, digitalAttendanceId)
        .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
        .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
        .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '')
        .replace(/\{COMPANY_EMAIL\}/g, tp.companyEmail || '')
        .replace(/\{COMPANY_PHONE\}/g, tpRow.company_phone || '');

    const subject = replacePlaceholders(emailSubject || 'Courseware and Attendance Taking for {COURSE_NAME}');
    const bodyText = replacePlaceholders(emailBody || `Dear {STUDENT_NAME},\n\nPlease access the courseware platform and complete e-attendance for {COURSE_NAME}.\n\nBest regards,\n{COMPANY_SHORT_NAME}`);

    const isHtml = /<[a-z][\s\S]*>/i.test(bodyText);
    const htmlBody = `<div style="font-family: Arial, sans-serif; color: #333;">${isHtml ? bodyText : bodyText.split('\n').map(line => line.trim() ? `<p style="margin:0 0 2px 0;">${line}</p>` : '<br/>').join('\n')}</div>`;

    const senderName = tpRow.contact_person_name || '';
    const emailUser = tpRow.email_user;

    const rawEmail = [
        `From: ${senderName ? `${senderName} <${emailUser}>` : emailUser}`,
        `To: ${studentEmail}`,
        ...(emailCc ? [`Cc: ${emailCc}`] : []),
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset="UTF-8"`,
        '',
        htmlBody,
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawEmail)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __coursewareAttendanceRunning?: boolean };
if (g.__coursewareAttendanceRunning === undefined) g.__coursewareAttendanceRunning = false;

// ── Main automation ──────────────────────────────────────────────────────────

export async function runAutomation() {
    if (g.__coursewareAttendanceRunning) {
        console.warn('[auto-send-courseware-attendance] Another run is already in progress — skipping');
        return { success: false, message: 'Skipped — another run is already in progress' };
    }
    g.__coursewareAttendanceRunning = true;
    try {
        return await _runAutomationInner();
    } finally {
        g.__coursewareAttendanceRunning = false;
    }
}

async function _runAutomationInner() {
    await ensureLogTable();

    const runId = crypto.randomUUID();
    console.log(`[auto-send-courseware-attendance] Starting run ${runId} at ${new Date().toISOString()}`);

    try {
        // 1. Fetch training provider settings + email template
        // Ensure columns exist (templates are added dynamically via ALTER TABLE)
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_subject TEXT`);
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_body TEXT`);
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_cc TEXT`);

        const tpResult = await pool.query(`
            SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
                   contact_person_name, company_tel AS company_phone, company_email,
                   courseware_attendance_email_subject as email_subject,
                   courseware_attendance_email_body as email_body,
                   courseware_attendance_email_cc as email_cc
            FROM training_provider LIMIT 1
        `);
        if (tpResult.rows.length === 0) {
            console.error('[auto-send-courseware-attendance] No training provider configured');
            return { success: false, error: 'No training provider configured' };
        }
        const tpRow = tpResult.rows[0];
        const tp = await getTrainingPartnerIdentifiers();

        const emailSubject = tpRow.email_subject || '';
        const emailBody = tpRow.email_body || '';
        const emailCc = tpRow.email_cc || '';

        if (!emailSubject && !emailBody) {
            console.warn(`[auto-send-courseware-attendance] No courseware_attendance email template configured — skipping`);
            return { success: false, error: `Email template "courseware_attendance" not configured` };
        }

        // 2. Find course runs starting TODAY
        const courseRunsRes = await pool.query(`
            SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                   TO_CHAR(cr.start_date, 'DD Mon YYYY') as start_date_display,
                   TO_CHAR(cr.end_date, 'DD Mon YYYY') as end_date_display,
                   TO_CHAR(cr.start_date, 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date, 'DD Mon YYYY') as course_dates
            FROM course_run cr
            JOIN course c ON cr.course_id = c.id
            WHERE cr.start_date = (NOW() AT TIME ZONE 'Asia/Singapore')::date
              AND (cr.class_status IS NULL OR cr.class_status::text NOT ILIKE 'cancelled')
              AND COALESCE(cr.courseware_email_disabled, false) = false
        `);

        const courseRuns = courseRunsRes.rows;
        console.log(`[auto-send-courseware-attendance] Found ${courseRuns.length} course runs starting TODAY.`);

        if (courseRuns.length === 0) {
            return { success: true, runId, stats: { totalSent: 0, totalSkipped: 0, totalErrors: 0 } };
        }

        let totalSent = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        for (const run of courseRuns) {
            const logContext = {
                courseRunId: run.course_run_id,
                courseTitle: run.course_title,
                courseCode: run.course_code,
            };

            try {
                // 3. Get first session details for venue/timing info
                const sessionRes = await pool.query(`
                    SELECT start_time, end_time, mode_of_training, venue
                    FROM course_session
                    WHERE course_run_id = $1 AND deleted = false
                    ORDER BY COALESCE(start_date, '9999-12-31') ASC, session_number ASC
                    LIMIT 1
                `, [run.db_uuid]);

                let courseStartTime = '';
                let courseVenue = '';
                if (sessionRes.rows.length > 0) {
                    const session = sessionRes.rows[0];
                    courseStartTime = session.start_time || '';
                    if (session.venue) {
                        const v = typeof session.venue === 'string' ? JSON.parse(session.venue) : session.venue;
                        courseVenue = v?.block ? `${v.block} ${v.street || ''} ${v.building || ''}, S${v.postalCode || ''}`.trim() : (v?.building || v?.street || '');
                    }
                }

                // 4. Fetch confirmed learners for this course run
                const learnersRes = await pool.query(`
                    SELECT
                        e.id as enrolment_id,
                        COALESCE(au.full_name, e.nric, 'Learner') as learner_name,
                        COALESCE(au.email, e.email) as learner_email
                    FROM enrollment e
                    LEFT JOIN app_user au ON e.user_id = au.id
                    WHERE e.course_run_id = $1
                      AND LOWER(e.enrolment_status) = 'confirmed'
                `, [run.db_uuid]);

                console.log(`[auto-send-courseware-attendance] ${run.course_run_id} (${run.course_title}): ${learnersRes.rows.length} confirmed learners`);

                for (const learner of learnersRes.rows) {
                    const traineeLogContext = {
                        ...logContext,
                        learnerName: learner.learner_name,
                        learnerEmail: learner.learner_email,
                    };

                    if (!learner.learner_email) {
                        console.warn(`[auto-send-courseware-attendance] No email for ${learner.learner_name} — skipping`);
                        await logResult(runId, 'skipped', { ...traineeLogContext, errorMessage: 'No email address' });
                        totalSkipped++;
                        continue;
                    }

                    try {
                        await sendCoursewareAttendanceEmail({
                            studentName: learner.learner_name,
                            studentEmail: learner.learner_email,
                            courseName: run.course_title,
                            courseCode: run.course_code,
                            courseDates: run.course_dates || '',
                            courseStartDate: run.start_date_display || '',
                            courseStartTime,
                            courseVenue,
                            digitalAttendanceId: run.course_run_id,
                            emailSubject,
                            emailBody,
                            emailCc,
                            tpRow,
                            tp,
                        });

                        console.log(`[auto-send-courseware-attendance] Email sent to ${learner.learner_email}`);
                        await logResult(runId, 'sent', traineeLogContext);
                        totalSent++;
                    } catch (emailErr: any) {
                        console.error(`[auto-send-courseware-attendance] Failed to email ${learner.learner_email}:`, emailErr.message);
                        await logResult(runId, 'error', { ...traineeLogContext, errorMessage: emailErr.message });
                        totalErrors++;
                    }

                    // Brief delay between emails to avoid rate limits
                    await sleep(1000);
                }

                // Make this course's learner materials (slides, learner guide, lesson plan) viewable by
                // "anyone with the link" so the Google links open for every learner — including those who
                // use a non-Google company email. Runs on the class start day, before the 08:30 LMS
                // materials unlock. Idempotent + non-blocking.
                try {
                    const shared = await autoShareLearnerMaterials(run.db_uuid);
                    console.log(`[auto-send-courseware-attendance] ${run.course_run_id}: set ${shared.files} material(s) to anyone-with-link`);
                } catch (shareErr: any) {
                    console.warn(`[auto-send-courseware-attendance] learner material share failed for ${run.course_run_id}: ${shareErr.message}`);
                }

            } catch (runErr: any) {
                console.error(`[auto-send-courseware-attendance] Error processing course run ${run.course_run_id}:`, runErr);
                await logResult(runId, 'error', { ...logContext, errorMessage: runErr.message });
                totalErrors++;
            }

            // Delay between course runs
            await sleep(2000);
        }

        console.log(`[auto-send-courseware-attendance] Run ${runId} completed. ${totalSent} sent, ${totalSkipped} skipped, ${totalErrors} errors.`);
        return {
            success: true,
            runId,
            stats: { totalSent, totalSkipped, totalErrors },
        };

    } catch (error: any) {
        console.error('[auto-send-courseware-attendance] Fatal Error:', error);
        return {
            success: false,
            message: 'Internal processing error',
            error: error.message,
        };
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { authKey } = req.body;
    if (authKey !== SCHEDULER_SECRET && !isServiceRequest(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await runAutomation();
    if (result.success) {
        return res.status(200).json(result);
    } else {
        return res.status(500).json(result);
    }
}
