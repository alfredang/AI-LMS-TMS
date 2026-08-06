import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

// Fail closed: accept server-side secrets only. NEXT_PUBLIC_* values are baked
// into the public JS bundle and must never act as an API key; with no key
// configured, a per-boot random UUID makes every comparison fail.
const SCHEDULER_SECRET =
  process.env.SCHEDULER_SECRET ||
  process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT ||
  globalThis.crypto.randomUUID();

/**
 * External API — Auto Send Final Course Confirmation Emails
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily at 9:00 AM SGT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Automatically sends Final Course Confirmation emails to all learners
 *   enrolled in course runs starting in 3 days. Uses the "Final Course
 *   Confirmation Email" template configured in Company Settings.
 *
 * POST /api/external/auto-send-course-confirmation
 *
 * What it does:
 *   1. Finds all course runs where start_date = CURRENT_DATE + 3 days
 *   2. For each course run, fetches enrolled learners (status = 'confirmed')
 *   3. Fetches the Final Course Confirmation Email template from training_provider
 *   4. Replaces placeholders ({STUDENT_NAME}, {COURSE_NAME}, etc.) for each learner
 *   5. Sends the email via Gmail API
 *   6. Logs all results to auto_send_confirmation_log table
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Ensure log table exists ──────────────────────────────────────────────────

async function ensureLogTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_send_confirmation_log (
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
    // task_id distinguishes the two crons sharing this table (3-day "final confirmation"
    // vs 7-day "class confirmation") so the dedupe check below doesn't mistake one
    // template's send for the other's and wrongly suppress it.
    await pool.query(`ALTER TABLE auto_send_confirmation_log ADD COLUMN IF NOT EXISTS task_id TEXT`);
}

async function logResult(
    runId: string,
    taskId: string,
    status: 'sent' | 'skipped' | 'error' | 'summary',
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
        INSERT INTO auto_send_confirmation_log
        (run_id, task_id, course_run_id, course_title, course_code, learner_name, learner_email, status, error_message)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
        runId,
        taskId,
        details.courseRunId || null,
        details.courseTitle || null,
        details.courseCode || null,
        details.learnerName || null,
        details.learnerEmail || null,
        status,
        details.errorMessage || null,
    ]);
}

/** Learner+course_run pairs already successfully emailed for this specific task
 * (template), so the new date WINDOW below doesn't re-send on every day a run
 * remains inside it. */
async function fetchAlreadySent(taskId: string, courseRunId: string): Promise<Set<string>> {
    // task_id IS NULL matches too: every row logged before this column existed has a null
    // task_id, and treating those as "not sent for this task" caused real duplicate sends
    // (confirmed live 2026-07-30 — the window fix's first production trigger re-emailed 2+
    // real trainees who'd already gotten their confirmation from this morning's run, because
    // `task_id = $1` never matches a NULL column value in SQL). Old rows predate the
    // two-task split entirely, so treating them as "already sent, regardless of task" is the
    // safe direction to err in.
    const res = await pool.query(
        `SELECT DISTINCT learner_email FROM auto_send_confirmation_log
         WHERE (task_id = $1 OR task_id IS NULL) AND course_run_id = $2 AND status = 'sent'`,
        [taskId, courseRunId]
    );
    return new Set(res.rows.map((r: any) => String(r.learner_email || '').toLowerCase()));
}

// ── Send confirmation email via Gmail API ────────────────────────────────────

async function sendConfirmationEmail(opts: {
    studentName: string;
    studentEmail: string;
    courseName: string;
    courseDates: string;
    courseStartDate: string;
    courseStartTime: string;
    courseVenue: string;
    emailSubject: string;
    emailBody: string;
    emailCc: string;
    tpRow: any;
    tp: any;
}): Promise<void> {
    const {
        studentName, studentEmail, courseName, courseDates,
        courseStartDate, courseStartTime, courseVenue,
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
        .replace(/\{COURSE_DATES\}/g, courseDates)
        .replace(/\{COURSE_START_DATE\}/g, courseStartDate)
        .replace(/\{COURSE_START_TIME\}/g, courseStartTime)
        .replace(/\{COURSE_VENUE\}/g, courseVenue)
        .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
        .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
        .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '')
        .replace(/\{COMPANY_EMAIL\}/g, tp.companyEmail || '')
        .replace(/\{COMPANY_PHONE\}/g, tpRow.company_tel || '');

    const subject = replacePlaceholders(emailSubject || 'Final Course Confirmation — {COURSE_NAME}');
    const bodyText = replacePlaceholders(emailBody || `Dear {STUDENT_NAME},\n\nThis is to confirm your enrolment in {COURSE_NAME} starting on {COURSE_START_DATE}.\n\nPlease ensure you arrive on time.\n\nBest regards,\n{COMPANY_SHORT_NAME}`);

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
const g = globalThis as unknown as { __confirmationEmailRunning?: boolean };
if (g.__confirmationEmailRunning === undefined) g.__confirmationEmailRunning = false;

// ── Main automation ──────────────────────────────────────────────────────────

export async function runAutomation(taskId: string = 'auto_send_course_confirmation') {
    if (g.__confirmationEmailRunning) {
        console.warn('[auto-send-confirmation] Another run is already in progress — skipping');
        return { success: false, message: 'Skipped — another run is already in progress' };
    }
    g.__confirmationEmailRunning = true;
    try {
        return await _runAutomationInner(taskId);
    } finally {
        g.__confirmationEmailRunning = false;
    }
}

async function _runAutomationInner(taskId: string = 'auto_send_course_confirmation') {
    await ensureLogTable();

    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    console.log(`[auto-send-confirmation] Starting run ${runId} (task: ${taskId}) at ${new Date(startedAt).toISOString()}`);

    let totalSent = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let courseRunsProcessed = 0;
    let daysInAdvance = 3;
    let fatalError: string | null = null;

    try {
        // 0. Read scheduler config for email template and days in advance
        let templatePrefix = 'final_course_confirmation';
        try {
            const configRes = await pool.query(
                `SELECT email_template, days_in_advance FROM scheduler_config WHERE id = $1`,
                [taskId]
            );
            if (configRes.rows[0]?.email_template) {
                templatePrefix = configRes.rows[0].email_template;
            }
            if (configRes.rows[0]?.days_in_advance != null) {
                daysInAdvance = configRes.rows[0].days_in_advance;
            }
        } catch { /* use default */ }
        console.log(`[auto-send-confirmation] Using email template: ${templatePrefix}, days in advance: ${daysInAdvance}`);

        const subjectCol = `${templatePrefix}_email_subject`;
        const bodyCol = `${templatePrefix}_email_body`;
        const ccCol = `${templatePrefix}_email_cc`;

        // 1. Fetch training provider settings + email template
        // Ensure columns exist (templates are added dynamically via ALTER TABLE)
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS ${subjectCol} TEXT`);
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS ${bodyCol} TEXT`);
        await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS ${ccCol} TEXT`);

        const tpResult = await pool.query(`
            SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
                   contact_person_name, company_tel, company_email,
                   ${subjectCol} as email_subject,
                   ${bodyCol} as email_body,
                   ${ccCol} as email_cc
            FROM training_provider LIMIT 1
        `);
        if (tpResult.rows.length === 0) {
            throw new Error('No training provider configured');
        }
        const tpRow = tpResult.rows[0];
        const tp = await getTrainingPartnerIdentifiers();

        const emailSubject = tpRow.email_subject || '';
        const emailBody = tpRow.email_body || '';
        const emailCc = tpRow.email_cc || '';

        if (!emailSubject && !emailBody) {
            throw new Error(`Email template "${templatePrefix}" not configured`);
        }

        // 2. Find course runs starting within the next N days (a WINDOW, not an exact-day
        // match — a run whose start_date is still inside the window keeps getting picked
        // up on every subsequent day's run until a learner is actually sent to, via the
        // dedupe check below. This fixes a real bug: with an exact match, a learner who
        // enrolled AFTER today's run had already fired (e.g. mid-morning, after the 9am/
        // 10am cron) would never be reconsidered — tomorrow's run checks a different
        // start_date entirely, so that day's window was permanently, silently missed.
        // Confirmed 2026-07-30: two real "Confirmed" enrolments created ~2.5h after the
        // day's run, for a course_run whose start_date only matched that one exact day.
        const courseRunsRes = await pool.query(`
            SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                   TO_CHAR(cr.start_date, 'DD Mon YYYY') as start_date_display,
                   TO_CHAR(cr.end_date, 'DD Mon YYYY') as end_date_display,
                   TO_CHAR(cr.start_date, 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date, 'DD Mon YYYY') as course_dates
            FROM course_run cr
            JOIN course c ON cr.course_id = c.id
            WHERE cr.start_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
              AND cr.start_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date + $1 * INTERVAL '1 day'
        `, [daysInAdvance]);

        const courseRuns = courseRunsRes.rows;
        courseRunsProcessed = courseRuns.length;
        console.log(`[auto-send-confirmation] Found ${courseRuns.length} course runs starting in ${daysInAdvance} days.`);

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

                console.log(`[auto-send-confirmation] ${run.course_run_id} (${run.course_title}): ${learnersRes.rows.length} confirmed learners`);

                // Now that a run can be matched on multiple consecutive days (window, not
                // exact-day), skip anyone already successfully emailed for THIS task/template
                // on a prior day's run — otherwise they'd get the same confirmation email
                // once per day until their start date arrives.
                const alreadySent = await fetchAlreadySent(taskId, run.course_run_id);

                for (const learner of learnersRes.rows) {
                    const traineeLogContext = {
                        ...logContext,
                        learnerName: learner.learner_name,
                        learnerEmail: learner.learner_email,
                    };

                    if (!learner.learner_email) {
                        console.warn(`[auto-send-confirmation] No email for ${learner.learner_name} — skipping`);
                        await logResult(runId, taskId, 'skipped', { ...traineeLogContext, errorMessage: 'No email address' });
                        totalSkipped++;
                        continue;
                    }

                    if (alreadySent.has(learner.learner_email.toLowerCase())) {
                        console.log(`[auto-send-confirmation] Already sent to ${learner.learner_email} for this task — skipping`);
                        await logResult(runId, taskId, 'skipped', { ...traineeLogContext, errorMessage: 'Already sent for this task' });
                        totalSkipped++;
                        continue;
                    }

                    try {
                        await sendConfirmationEmail({
                            studentName: learner.learner_name,
                            studentEmail: learner.learner_email,
                            courseName: run.course_title,
                            courseDates: run.course_dates || '',
                            courseStartDate: run.start_date_display || '',
                            courseStartTime,
                            courseVenue,
                            emailSubject,
                            emailBody,
                            emailCc,
                            tpRow,
                            tp,
                        });

                        console.log(`[auto-send-confirmation] Confirmation email sent to ${learner.learner_email}`);
                        await logResult(runId, taskId, 'sent', traineeLogContext);
                        totalSent++;
                    } catch (emailErr: any) {
                        console.error(`[auto-send-confirmation] Failed to email ${learner.learner_email}:`, emailErr.message);
                        await logResult(runId, taskId, 'error', { ...traineeLogContext, errorMessage: emailErr.message });
                        totalErrors++;
                    }

                    // Brief delay between emails to avoid rate limits
                    await sleep(1000);
                }

            } catch (runErr: any) {
                console.error(`[auto-send-confirmation] Error processing course run ${run.course_run_id}:`, runErr);
                await logResult(runId, taskId, 'error', { ...logContext, errorMessage: runErr.message });
                totalErrors++;
            }

            // Delay between course runs
            await sleep(2000);
        }

        console.log(`[auto-send-confirmation] Run ${runId} completed. ${totalSent} sent, ${totalSkipped} skipped, ${totalErrors} errors.`);
    } catch (error: any) {
        console.error('[auto-send-confirmation] Fatal Error:', error);
        fatalError = error?.message || String(error);
    }

    // Always write a single summary row so the log viewer shows every run,
    // including zero-match days and fatal-error runs.
    const durationMs = Date.now() - startedAt;
    const summaryLine = `${courseRunsProcessed} course run(s) processed, ${totalSent} sent, ${totalSkipped} skipped, ${totalErrors} error(s) (days_in_advance=${daysInAdvance}, duration=${durationMs}ms)`;
    try {
        await logResult(runId, taskId, fatalError ? 'error' : 'summary', {
            errorMessage: fatalError ? `${fatalError} — ${summaryLine}` : summaryLine,
        });
    } catch (logErr: any) {
        console.error('[auto-send-confirmation] Failed to write summary log row:', logErr?.message || logErr);
    }

    if (fatalError) {
        return {
            success: false,
            runId,
            message: 'Internal processing error',
            error: fatalError,
            stats: { totalSent, totalSkipped, totalErrors },
        };
    }
    return {
        success: true,
        runId,
        stats: { totalSent, totalSkipped, totalErrors },
    };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    // Two accepted auth methods: the original scheduler secret (body authKey, used by the
    // in-app scheduler trigger UI), or the standard external API key header (matching every
    // other /api/external/* route) — added so this can be triggered on demand for testing
    // without needing the scheduler secret, which isn't available outside prod's runtime env.
    const { authKey } = req.body || {};
    const apiKeyHeader = req.headers['x-api-key'];
    const validExternalKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
    const authorized =
        authKey === SCHEDULER_SECRET ||
        (validExternalKey && apiKeyHeader === validExternalKey);
    if (!authorized) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Optional taskId so both crons sharing this handler ('auto_send_course_confirmation'
    // 3-day / 'auto_send_class_confirmation' 7-day) can be manually triggered and tested —
    // defaults to the original hardcoded task to keep existing scheduler behavior unchanged.
    const taskId = typeof req.body?.taskId === 'string' && req.body.taskId
        ? req.body.taskId
        : 'auto_send_course_confirmation';

    const result = await runAutomation(taskId);
    if (result.success) {
        return res.status(200).json(result);
    } else {
        return res.status(500).json(result);
    }
}
