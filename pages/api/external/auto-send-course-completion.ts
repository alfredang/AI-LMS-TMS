import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

const SCHEDULER_SECRET = process.env.NEXT_PUBLIC_SCHEDULER_SECRET || 'local-dev-fallback';

/**
 * External API — Auto Send Course Completion and Thank You Emails
 *
 * SCHEDULE: Run daily at 8:00 PM SGT (after certificates at 6:30 PM).
 *
 * PURPOSE:
 *   Sends the "Course Completion and Thank You" email to all confirmed learners
 *   enrolled in course runs ending TODAY. Uses the template configured in
 *   Training Provider → Templates → Course Completion and Thank You.
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ensureLogTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_send_course_completion_log (
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
        INSERT INTO auto_send_course_completion_log
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

async function sendCourseCompletionEmail(opts: {
    studentName: string;
    studentEmail: string;
    courseName: string;
    courseCode: string;
    courseDates: string;
    emailSubject: string;
    emailBody: string;
    emailCc: string;
    tpRow: any;
    tp: any;
}): Promise<void> {
    const {
        studentName, studentEmail, courseName, courseCode, courseDates,
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
        .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
        .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
        .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '')
        .replace(/\{COMPANY_EMAIL\}/g, tp.companyEmail || '')
        .replace(/\{COMPANY_PHONE\}/g, tpRow.company_phone || '');

    const subject = replacePlaceholders(emailSubject || 'Course Completion for {COURSE_NAME}');
    const bodyText = replacePlaceholders(emailBody || `Dear {STUDENT_NAME},\n\nThank you for attending {COURSE_NAME}.\n\nBest regards,\n{COMPANY_SHORT_NAME}`);

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

export async function runAutomation() {
    await ensureLogTable();

    const runId = crypto.randomUUID();
    console.log(`[auto-send-course-completion] Starting run ${runId} at ${new Date().toISOString()}`);

    try {
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_subject TEXT`);
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_body TEXT`);
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_cc TEXT`);

        const tpResult = await pool.query(`
            SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
                   contact_person_name, company_tel AS company_phone, company_email,
                   course_completion_email_subject as email_subject,
                   course_completion_email_body as email_body,
                   course_completion_email_cc as email_cc
            FROM training_provider LIMIT 1
        `);
        if (tpResult.rows.length === 0) {
            console.error('[auto-send-course-completion] No training provider configured');
            return { success: false, error: 'No training provider configured' };
        }
        const tpRow = tpResult.rows[0];
        const tp = await getTrainingPartnerIdentifiers();

        const emailSubject = tpRow.email_subject || '';
        const emailBody = tpRow.email_body || '';
        const emailCc = tpRow.email_cc || '';

        if (!emailSubject && !emailBody) {
            console.warn(`[auto-send-course-completion] No course_completion email template configured — skipping`);
            return { success: false, error: `Email template "course_completion" not configured` };
        }

        const courseRunsRes = await pool.query(`
            SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                   TO_CHAR(cr.start_date, 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date, 'DD Mon YYYY') as course_dates
            FROM course_run cr
            JOIN course c ON cr.course_id = c.id
            WHERE DATE(cr.end_date) = CURRENT_DATE
        `);

        const courseRuns = courseRunsRes.rows;
        console.log(`[auto-send-course-completion] Found ${courseRuns.length} course runs ending TODAY.`);

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

                console.log(`[auto-send-course-completion] ${run.course_run_id} (${run.course_title}): ${learnersRes.rows.length} confirmed learners`);

                for (const learner of learnersRes.rows) {
                    const traineeLogContext = {
                        ...logContext,
                        learnerName: learner.learner_name,
                        learnerEmail: learner.learner_email,
                    };

                    if (!learner.learner_email) {
                        console.warn(`[auto-send-course-completion] No email for ${learner.learner_name} — skipping`);
                        await logResult(runId, 'skipped', { ...traineeLogContext, errorMessage: 'No email address' });
                        totalSkipped++;
                        continue;
                    }

                    try {
                        await sendCourseCompletionEmail({
                            studentName: learner.learner_name,
                            studentEmail: learner.learner_email,
                            courseName: run.course_title,
                            courseCode: run.course_code,
                            courseDates: run.course_dates || '',
                            emailSubject,
                            emailBody,
                            emailCc,
                            tpRow,
                            tp,
                        });

                        console.log(`[auto-send-course-completion] Email sent to ${learner.learner_email}`);
                        await logResult(runId, 'sent', traineeLogContext);
                        totalSent++;
                    } catch (emailErr: any) {
                        console.error(`[auto-send-course-completion] Failed to email ${learner.learner_email}:`, emailErr.message);
                        await logResult(runId, 'error', { ...traineeLogContext, errorMessage: emailErr.message });
                        totalErrors++;
                    }

                    await sleep(1000);
                }

            } catch (runErr: any) {
                console.error(`[auto-send-course-completion] Error processing course run ${run.course_run_id}:`, runErr);
                await logResult(runId, 'error', { ...logContext, errorMessage: runErr.message });
                totalErrors++;
            }

            await sleep(2000);
        }

        console.log(`[auto-send-course-completion] Run ${runId} completed. ${totalSent} sent, ${totalSkipped} skipped, ${totalErrors} errors.`);
        return {
            success: true,
            runId,
            stats: { totalSent, totalSkipped, totalErrors },
        };

    } catch (error: any) {
        console.error('[auto-send-course-completion] Fatal Error:', error);
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
    if (authKey !== SCHEDULER_SECRET) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await runAutomation();
    if (result.success) {
        return res.status(200).json(result);
    } else {
        return res.status(500).json(result);
    }
}
