import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
    getDriveClient,
    findSubfolder,
    findSessionFolderByStartDate,
    createSubfolder,
    findCourseFolderByTgsRef,
    buildSessionFolderName,
    buildStartDatePrefix,
} from '../../../lib/google-drive/drive-helpers';

/**
 * External API — Auto Create Assessment Records
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily at 2:00 PM SGT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Automatically creates assessment folders in Google Drive for all
 *   course runs starting TODAY. The trainer name is sourced from the local
 *   database — specifically the course_run_trainer junction table (same data
 *   shown under E-Attendance → Course Session Attendance), with fallback to
 *   assigned_trainer_name and trainer_profile.common_name.
 *
 * POST /api/external/auto-create-assessment-records
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body: (empty — no body required)
 *
 * What it does:
 *   1. Validates the API key
 *   2. Finds all course runs where start_date = TODAY
 *   3. For each course run:
 *      a. Resolves the trainer name from local DB (course_run_trainer →
 *         assigned_trainer_name → trainer_profile.common_name)
 *      b. Creates the folder: Course → Assessment Records → Session Folder
 *   4. Logs all results to auto_create_trainer_folder_log
 *
 * Notes:
 *   - No SSG API calls are made — all data is sourced from local DB
 *   - Results can be viewed in the Admin panel under "Automation Logging"
 */

// ── Ensure log table exists ───────────────────────────────────────────────────

async function ensureLogTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_create_trainer_folder_log (
            id              SERIAL PRIMARY KEY,
            run_id          TEXT NOT NULL,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            course_run_id   TEXT,
            course_title    TEXT,
            course_code     TEXT,
            start_date      DATE,
            end_date        DATE,
            trainer_name    TEXT,
            trainer_source  TEXT,
            folder_name     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            error_message   TEXT
        )
    `);
}

// ── Main automation runner ────────────────────────────────────────────────────

export async function runAutomation() {
    await ensureLogTable();

    const runId = `trainer_folder_${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Ensure course_run_trainer junction table exists (same as ongoing-classes API)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS course_run_trainer (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
            trainer_id UUID,
            trainer_name VARCHAR(255) NOT NULL,
            trainer_email VARCHAR(255),
            assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(course_run_id, trainer_id)
        );
    `);

    // Find all course runs starting today
    // Trainer name priority: course_run_trainer → assigned_trainer_name → trainer_profile.common_name
    const runsResult = await pool.query<{
        db_id: string;
        course_run_id: string;
        course_title: string;
        course_code: string;
        start_date: string;
        end_date: string;
        trainer_name: string | null;
        trainer_source: string;
    }>(
        `SELECT cr.id AS db_id, cr.course_run_id,
                c.title AS course_title, c.course_code,
                cr.start_date, cr.end_date,
                COALESCE(
                    NULLIF((SELECT STRING_AGG(crt.trainer_name, ', ') FROM course_run_trainer crt WHERE crt.course_run_id = cr.id), ''),
                    cr.assigned_trainer_name,
                    tp.common_name
                ) AS trainer_name,
                CASE
                    WHEN (SELECT COUNT(*) FROM course_run_trainer crt WHERE crt.course_run_id = cr.id) > 0 THEN 'course_run_trainer'
                    WHEN cr.assigned_trainer_name IS NOT NULL THEN 'assigned_trainer_name'
                    WHEN tp.common_name IS NOT NULL THEN 'trainer_profile'
                    ELSE 'none'
                END AS trainer_source
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
         LEFT JOIN trainer_profile tp ON tp.user_id = cr.assigned_trainer_id
         WHERE DATE(cr.start_date) = CURRENT_DATE
           AND cr.course_run_id IS NOT NULL
           AND cr.course_run_id <> ''
           AND (cr.class_status IS NULL OR cr.class_status::text NOT ILIKE 'cancelled')
         ORDER BY cr.start_date ASC`
    );

    const runs = runsResult.rows;
    console.log(`📋 auto-create-assessment-records: ${runs.length} course run(s) starting today`);

    if (runs.length === 0) {
        return { runId, startedAt, processed: 0, created: 0, existing: 0, errors: 0, results: [] };
    }

    // Google Drive
    const drive = await getDriveClient();
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');

    let created = 0, existing = 0, errors = 0;
    const results: any[] = [];

    for (const run of runs) {
        console.log(`\n📋 Processing: "${run.course_title}" [${run.course_code}] | run: ${run.course_run_id}`);

        const logEntry: any = {
            runId,
            courseRunId: run.course_run_id,
            courseTitle: run.course_title,
            courseCode: run.course_code,
            startDate: run.start_date,
            endDate: run.end_date,
            trainerName: null,
            trainerSource: null,
            folderName: null,
            status: 'pending',
            errorMessage: null,
        };

        try {
            // Step 1: Resolve trainer name from local DB
            const trainerName = run.trainer_name;
            const trainerSource = run.trainer_source;

            if (!trainerName || trainerSource === 'none') {
                logEntry.status = 'skipped';
                logEntry.errorMessage = 'No trainer assigned in local DB (course_run_trainer / assigned_trainer_name / trainer_profile)';
                console.log(`  ⏭️ Skipping — no trainer name available`);
                results.push(logEntry);
                continue;
            }

            console.log(`  ✅ Trainer: "${trainerName}" (source: ${trainerSource})`);
            logEntry.trainerName = trainerName;
            logEntry.trainerSource = trainerSource;

            // Step 2: Build folder name using course run dates
            const startDate = new Date(run.start_date);
            const endDate = new Date(run.end_date);
            const sessionFolderName = buildSessionFolderName(startDate, endDate, trainerName);
            const startDatePrefix = buildStartDatePrefix(startDate);

            logEntry.folderName = sessionFolderName;
            console.log(`  📁 Target folder: "${sessionFolderName}"`);

            // Step 3: Find or create the Course folder
            const tgsRef = run.course_code || null;
            let courseFolderId = await findCourseFolderByTgsRef(
                drive, rootFolderId, tgsRef, run.course_code, run.course_title
            );

            if (!courseFolderId) {
                const expectedName = tgsRef && run.course_title && !run.course_title.includes(tgsRef)
                    ? `${tgsRef} ${run.course_title}`.trim()
                    : (`${run.course_code} ${run.course_title}`).trim() || 'Unknown Course';
                courseFolderId = await createSubfolder(drive, rootFolderId, expectedName);
                console.log(`  📁 Created course folder: "${expectedName}"`);
            }

            // Step 4: Find or create Assessment Records
            let assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
            if (!assessmentRecordsId) {
                assessmentRecordsId = await createSubfolder(drive, courseFolderId, 'Assessment Records');
                console.log(`  📁 Created 'Assessment Records' folder`);
            }

            // Step 5: Find or create the session/trainer folder
            let sessionFolderId = await findSessionFolderByStartDate(
                drive, assessmentRecordsId, startDatePrefix, trainerName
            );

            if (sessionFolderId) {
                logEntry.status = 'existing';
                existing++;
                console.log(`  ✔️ Session folder already exists (${sessionFolderId})`);
            } else {
                sessionFolderId = await createSubfolder(drive, assessmentRecordsId, sessionFolderName);
                logEntry.status = 'created';
                created++;
                console.log(`  ✅ Created session folder: "${sessionFolderName}" (${sessionFolderId})`);
            }

        } catch (err) {
            logEntry.status = 'error';
            logEntry.errorMessage = err instanceof Error ? err.message : String(err);
            errors++;
            console.error(`  ❌ Error processing run ${run.course_run_id}:`, err);
        }

        // Write log entry
        await pool.query(
            `INSERT INTO auto_create_trainer_folder_log
                (run_id, course_run_id, course_title, course_code,
                 start_date, end_date, trainer_name, trainer_source,
                 folder_name, status, error_message)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                runId,
                logEntry.courseRunId,
                logEntry.courseTitle,
                logEntry.courseCode,
                logEntry.startDate,
                logEntry.endDate,
                logEntry.trainerName,
                logEntry.trainerSource,
                logEntry.folderName,
                logEntry.status,
                logEntry.errorMessage,
            ]
        );

        results.push(logEntry);
    }

    console.log(`\n✅ auto-create-assessment-records done. runId=${runId}, processed=${runs.length}, created=${created}, existing=${existing}, errors=${errors}`);
    return { runId, startedAt, processed: runs.length, created, existing, errors, results };
}

// ── API Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

    if (!validKey) {
        console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
        return res.status(500).json({ success: false, error: 'API key not configured on server' });
    }
    if (!apiKey || apiKey !== validKey) {
        console.warn(`⚠️ Unauthorized attempt — key: ${apiKey ? '[wrong key]' : '[missing]'}`);
        return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
    }

    try {
        const result = await runAutomation();
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error('❌ auto-create-assessment-records error:', err);
        return res.status(500).json({
            success: false,
            error: err instanceof Error ? err.message : 'Internal server error',
        });
    }
}
