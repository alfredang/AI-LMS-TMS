import { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { generateAndUploadCertificate } from '../../../lib/services/certificateService';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

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

/**
 * Sends a certificate email with PDF attachment via Gmail API.
 */
async function sendCertificateEmail(opts: {
    studentName: string;
    studentEmail: string;
    courseName: string;
    courseDates: string;
}): Promise<void> {
    const { studentName, studentEmail, courseName, courseDates } = opts;
    const tp = await getTrainingPartnerIdentifiers();

    // Get training provider Google credentials
    const result = await pool.query(`
        SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
               google_slides_template_id, contact_person_name, company_email,
               certificate_email_subject, certificate_email_body
        FROM training_provider LIMIT 1
    `);
    if (result.rows.length === 0) throw new Error('Training provider not found');
    const tpRow = result.rows[0];

    if (!tpRow.email_user || !tpRow.google_client_id || !tpRow.google_client_secret || !tpRow.google_refresh_token || !tpRow.google_slides_template_id) {
        throw new Error('Google Integration settings incomplete — skipping email');
    }

    const oauth2Client = new google.auth.OAuth2(tpRow.google_client_id, tpRow.google_client_secret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: tpRow.google_refresh_token });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const slides = google.slides({ version: 'v1', auth: oauth2Client });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    let tempFileId: string | null = null;

    try {
        // Generate PDF from Google Slides template
        const copyResponse = await drive.files.copy({
            fileId: tpRow.google_slides_template_id,
            requestBody: { name: `Certificate - ${studentName}` },
        });
        tempFileId = copyResponse.data.id!;

        await slides.presentations.batchUpdate({
            presentationId: tempFileId,
            requestBody: {
                requests: [
                    { replaceAllText: { containsText: { text: '[Student Name]', matchCase: true }, replaceText: studentName } },
                    { replaceAllText: { containsText: { text: '[Course Name]', matchCase: true }, replaceText: courseName } },
                    { replaceAllText: { containsText: { text: '[Course Dates]', matchCase: true }, replaceText: courseDates } },
                ],
            },
        });

        const pdfResponse = await drive.files.export(
            { fileId: tempFileId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdfResponse.data as ArrayBuffer);

        await drive.files.delete({ fileId: tempFileId });
        tempFileId = null;

        // Compose and send email
        const sanitizedName = studentName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
        const fileName = `${sanitizedName}-Certificate-of-Achievement.pdf`;
        const boundary = '----CertBoundary' + Date.now();
        const senderName = tpRow.contact_person_name || '';
        const emailUser = tpRow.email_user;

        const subject = (tpRow.certificate_email_subject || 'Certificate for Completing {COURSE_NAME}')
            .replace(/\{STUDENT_NAME\}/g, studentName)
            .replace(/\{COURSE_NAME\}/g, courseName)
            .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
            .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
            .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '');

        const defaultBody = `Hello {STUDENT_NAME},\n\nCongratulations on successfully completing the course {COURSE_NAME}! We are truly proud of your perseverance, dedication, and motivation throughout the program.\n\nPlease find attached your Certificate of Achievement in recognition of your accomplishment.\n\nYour commitment to learning and professional growth is commendable, and we wish you continued success in applying your new skills.\n\nFor learners who have achieved at least 75% attendance and passed their assessment for WSQ courses, they can view and download their WSQ SOA (Statement of Attainment) through http://www.MySkillsFuture.gov.sg.\n\nPlease note that SkillsFuture Singapore uses OpenCerts certificates to issue the WSQ Statements of Attainment (SOA). The OpenCerts will be ready for viewing/downloading 4-5 weeks upon completion of WSQ courses.\n\nFeel free to let me know if you need anything else. Thank you.\n\nBest regards,\nSupport Team\n{COMPANY_SHORT_NAME}\nTel: 61000613 | Email: support@tertiaryinfotech.com | WhatsApp: https://wa.me/6561000613`;
        const bodyText = (tpRow.certificate_email_body || defaultBody)
            .replace(/\{STUDENT_NAME\}/g, studentName)
            .replace(/\{COURSE_NAME\}/g, courseName)
            .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
            .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
            .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '');

        const htmlBody = `<div style="font-family: Arial, sans-serif; color: #333;">${bodyText.split('\n').map(line => line.trim() ? `<p>${line}</p>` : '<br/>').join('\n')}</div>`;

        const rawEmail = [
            `From: ${senderName ? `${senderName} <${emailUser}>` : emailUser}`,
            `To: ${studentEmail}`,
            `Subject: ${subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            `Content-Type: text/html; charset="UTF-8"`,
            '',
            htmlBody,
            '',
            `--${boundary}`,
            `Content-Type: application/pdf; name="${fileName}"`,
            `Content-Disposition: attachment; filename="${fileName}"`,
            `Content-Transfer-Encoding: base64`,
            '',
            pdfBuffer.toString('base64'),
            '',
            `--${boundary}--`,
        ].join('\r\n');

        const encodedMessage = Buffer.from(rawEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
        console.log(`[auto-create-certificates] Email sent to ${studentEmail}`);
    } finally {
        if (tempFileId) {
            try { await drive.files.delete({ fileId: tempFileId }); } catch {}
        }
    }
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
            ? `SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                      TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') as course_dates
               FROM course_run cr
               JOIN course c ON cr.course_id = c.id
               WHERE DATE(cr.end_date) = $1`
            : `SELECT cr.id as db_uuid, cr.course_run_id, c.course_code, c.title as course_title,
                      TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') as course_dates
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
                        COALESCE(au.email, e.email) as learner_email,
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

                        // 5. Send certificate email to learner
                        if (trainee.learner_email) {
                            try {
                                await sendCertificateEmail({
                                    studentName: trainee.learner_name,
                                    studentEmail: trainee.learner_email,
                                    courseName: run.course_title,
                                    courseDates: run.course_dates || '',
                                });
                                console.log(`[auto-create-certificates] Certificate emailed to ${trainee.learner_email}`);
                            } catch (emailErr: any) {
                                console.error(`[auto-create-certificates] Failed to email cert to ${trainee.learner_email}:`, emailErr.message);
                                // Don't fail the whole process if email fails — cert is already generated
                            }
                        } else {
                            console.warn(`[auto-create-certificates] No email for ${trainee.learner_name} — certificate generated but not emailed`);
                        }

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
