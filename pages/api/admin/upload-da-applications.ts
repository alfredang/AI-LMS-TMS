import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { searchEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { inferIdType } from '../../../lib/utils/id-type';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { bulkProcessDirectApplications, createNativeEnrolmentFromDA, processDirectApplication } from '../../../lib/autoEnrolDirectApplications';
import { addDaLearnerToCalendar, removeDaLearnerFromCalendar } from '../../../lib/google-calendar/da-calendar-sync';
import { getLocalYMD } from '../../../lib/dateHelpers';

// Increase body size limit to 50MB (default is 1MB, which causes HTTP 413 for large Excel uploads)
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '50mb',
        },
    },
};

// Column mapping from Excel headers to database columns
const columnMapping: Record<string, string> = {
    'Trainee ID Type': 'trainee_id_type',
    'Trainee ID': 'trainee_id',
    'Date of Birth': 'date_of_birth',
    'Date of Birth (DD-MM-YYYY)': 'date_of_birth',
    'Trainee Name': 'trainee_name',
    'Course Run ID': 'course_run_id',
    'Trainee Email': 'trainee_email',
    'Trainee Phone Country Code': 'trainee_phone_country_code',
    'Phone Country Code': 'trainee_phone_country_code',
    'Trainee Phone': 'trainee_phone',
    'Sponsorship Type': 'sponsorship_type',
    'Application ID': 'application_id',
    'Application Date': 'application_date',
    'Application Cancelled By': 'application_cancelled_by',
    'Payable Fee': 'payable_fee',
    'Full course fee': 'full_course_fee',
    'Full Course Fee': 'full_course_fee',
    'GST': 'gst',
    'SkillsFuture subsidy': 'skillsfuture_subsidy',
    'SkillsFuture Subsidy': 'skillsfuture_subsidy',
    'SkillsFuture Credit': 'skillsfuture_credit',
    'SF Claim ID': 'skillsfuture_credit_claim_id',
    'SkillsFuture Credit claim ID': 'skillsfuture_credit_claim_id',
    'SkillsFuture Credit Claim ID': 'skillsfuture_credit_claim_id',
    'Grant ID': 'grant_id',
    'Grant ID (BL)': 'grant_id',
    'Application Status': 'application_status',
    'Course Title': 'course_title',
    'Course Reference Number': 'course_reference_number',
    'Course Start Date': 'course_start_date',
    'Course Run Start Date': 'course_start_date',
    'Course End Date': 'course_end_date',
    'Course Run End Date': 'course_end_date',
    'Highest Qualification': 'highest_qualification',
    'Highest Relevant Certification': 'highest_relevant_certification',
    'Enrol Status': 'enrolment_status',
    'Enrolment Status': 'enrolment_status',
    'Enrol ID': 'enrolment_id',
    'Enrolment ID': 'enrolment_id',
    'Status': 'application_status',
};

function hasRealEnrolmentId(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    const enrolmentId = String(value).trim();
    if (!enrolmentId) return false;
    const upper = enrolmentId.toUpperCase();
    return upper !== 'MANUAL' && upper !== 'N/A' && upper !== 'NA' && upper !== '-';
}

// Parse date from various formats
function parseDate(value: any): string | null {
    if (!value) return null;

    // If it's already a valid date string
    if (typeof value === 'string') {
        // Try DD/MM/YYYY or DD-MM-YYYY format (with optional time like "03-02-2026 15:18:00 PM")
        const ddmmyyyyWithTime = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+[\d:]+(?:\s*[APap][Mm])?)?$/);
        if (ddmmyyyyWithTime) {
            const [, day, month, year] = ddmmyyyyWithTime;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        // Try YYYY-MM-DD format (with optional time)
        const yyyymmdd = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+[\d:]+(?:\s*[APap][Mm])?)?$/);
        if (yyyymmdd) {
            const [, year, month, day] = yyyymmdd;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        // Try parsing as date string (extract components to avoid timezone shift)
        const dateValue = new Date(value);
        if (!isNaN(dateValue.getTime())) {
            const y = dateValue.getFullYear();
            const m = String(dateValue.getMonth() + 1).padStart(2, '0');
            const d = String(dateValue.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
    }

    // If it's a number (Excel serial date)
    if (typeof value === 'number') {
        // Excel uses days since 1900-01-01 (with a bug treating 1900 as leap year)
        // Use Date.UTC to avoid local timezone shifting the date back by one day
        const utcMs = Date.UTC(1899, 11, 30) + value * 86400000;
        const date = new Date(utcMs);
        return date.toISOString().split('T')[0];
    }

    return null;
}

// Normalize a header label so matching is tolerant of casing, leading/trailing
// whitespace, and collapsed internal spaces (e.g. "Application ID " or "application  id").
const normalizeHeader = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, ' ');

// Pre-build a normalized lookup: normalized Excel header -> db column.
const normalizedColumnMapping: Record<string, string> = Object.entries(columnMapping).reduce(
    (acc, [excelKey, dbKey]) => {
        acc[normalizeHeader(excelKey)] = dbKey;
        return acc;
    },
    {} as Record<string, string>
);

const NUMERIC_FIELDS = ['payable_fee', 'full_course_fee', 'gst', 'skillsfuture_subsidy', 'skillsfuture_credit'];

// Transform Excel row to database format
function transformRow(excelRow: Record<string, any>): Record<string, any> {
    const dbRow: Record<string, any> = {};

    for (const [excelKey, rawValue] of Object.entries(excelRow)) {
        if (rawValue === undefined || rawValue === '') continue;

        // Match the header (normalized) against the column mapping. Also accept a
        // snake_case key in case the data was already transformed upstream.
        const dbKey = normalizedColumnMapping[normalizeHeader(excelKey)]
            ?? (Object.values(columnMapping).includes(excelKey.toLowerCase().replace(/\s+/g, '_'))
                ? excelKey.toLowerCase().replace(/\s+/g, '_')
                : undefined);
        if (!dbKey || dbRow[dbKey] !== undefined) continue;

        let value: any = rawValue;

        // Handle date fields
        if (dbKey.includes('date')) {
            value = parseDate(value);
        }

        // Handle numeric fields
        if (NUMERIC_FIELDS.includes(dbKey) && value) {
            value = parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
        }

        if (value !== null && value !== undefined) {
            dbRow[dbKey] = value;
        }
    }

    return dbRow;
}

/**
 * Build the SSG search enrolment payload for a single record.
 */
function buildEnrolmentPayload(record: Record<string, any>, tpUen: string, tpCode: string): Record<string, any> {
    const runId = String(record.course_run_id || '');
    const code = String(record.course_reference_number || '');
    const traineeId = String(record.trainee_id || '');
    const idTypeRaw = String(record.trainee_id_type || '').toUpperCase();
    const sponsorshipRaw = String(record.sponsorship_type || '').toUpperCase();

    // Convert ID Type using inferIdType utility
    const idType = inferIdType(traineeId, idTypeRaw);

    // Sponsorship type mapping
    let sponsorshipType = 'INDIVIDUAL';
    if (sponsorshipRaw.includes('EMPLOYER')) sponsorshipType = 'EMPLOYER';

    // Build trainee object
    const traineeJSON: Record<string, any> = {
        id: traineeId,
        idType: { type: idType },
        sponsorshipType,
    };

    // Add employer if EMPLOYER sponsored
    if (sponsorshipType === 'EMPLOYER' && record.employer_uen) {
        traineeJSON.employer = { uen: String(record.employer_uen) };
    }

    return {
        ssgPayload: {
            enrolment: {
                course: {
                    run: { id: runId },
                    referenceNumber: code
                },
                trainee: traineeJSON,
                trainingPartner: {
                    uen: tpUen,
                    code: tpCode
                }
            },
            parameters: {
                page: 0,
                pageSize: 40
            }
        },
        application_id: record.application_id,
    };
}

/**
 * Search SSG enrolment status for each record and update the database.
 * Calls SSG POST /tpg/enrolments/search directly (one call per record).
 */
async function callSearchEnrolmentSSGBatch(records: Record<string, any>[], tpUen: string, tpCode: string): Promise<{ success: boolean; count: number; results: any[]; error?: string }> {
    if (records.length === 0) {
        return { success: true, count: 0, results: [] };
    }

    const processedResults: any[] = [];

    for (const record of records) {
        const built = buildEnrolmentPayload(record, tpUen, tpCode);
        const applicationId = built.application_id;

        if (!applicationId) {
            processedResults.push({ application_id: null, status: 'error', message: 'Missing application_id' });
            continue;
        }

        try {
            const result = await searchEnrolment(built.ssgPayload as any);

            let enrolmentStatus: string | null = null;
            if (result.status === 'not_found') {
                enrolmentStatus = 'Not Found';
            } else if (result.success) {
                enrolmentStatus = result.enrolmentStatus || 'Confirmed';
            } else {
                console.warn(`⚠️ Unknown SSG response for ${applicationId}:`, result.error);
                processedResults.push({ application_id: applicationId, status: 'unknown', error: result.error });
                continue;
            }

            await pool.query(
                `UPDATE da_application SET enrolment_status = $1, updated_at = NOW() WHERE application_id = $2`,
                [enrolmentStatus, applicationId]
            );
            console.log(`✅ Updated ${applicationId} enrolment_status to "${enrolmentStatus}"`);
            processedResults.push({ application_id: applicationId, enrolment_status: enrolmentStatus, success: true });
        } catch (err) {
            console.error(`❌ Failed to search/update ${applicationId}:`, err);
            processedResults.push({ application_id: applicationId, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
        }
    }

    return { success: true, count: records.length, results: processedResults };
}


/**
 * API endpoint to upload DA Application data to the database.
 * Handles deduplication based on application_id.
 * 
 * POST /api/admin/upload-da-applications
 * Body: { data: [...Excel rows...] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { data } = req.body;

        if (!data || !Array.isArray(data)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request body. Expected { data: [...] }'
            });
        }

        console.log(`📊 Processing ${data.length} DA application records...`);

        const tp = await getTrainingPartnerIdentifiers();

        // Get existing application IDs, their statuses, and enrolment status to check for duplicates
        const existingResult = await pool.query(
            `SELECT application_id, application_status, enrolment_status, trainee_id, course_run_id FROM da_application`
        );

        const existingApps = new Map<string, { application_status: string; enrolment_status: string | null }>(
            existingResult.rows.map(r => [r.application_id, {
                application_status: r.application_status,
                enrolment_status: r.enrolment_status,
            }])
        );

        // Build a map of trainee_id + course_run_id → application_status for same-person-same-course duplicate detection
        // Key format: "TRAINEE_ID||COURSE_RUN_ID" (lowercased, trimmed)
        const existingTraineeCourseMap = new Map<string, { application_id: string; application_status: string }>();
        for (const r of existingResult.rows) {
            const tid = (r.trainee_id || '').toString().trim().toLowerCase();
            const crid = (r.course_run_id || '').toString().trim().toLowerCase();
            if (tid && crid) {
                const key = `${tid}||${crid}`;
                // Keep the most relevant (non-cancelled) entry; if multiple exist, prefer active ones
                const existing = existingTraineeCourseMap.get(key);
                const status = (r.application_status || '').toLowerCase();
                if (!existing || status !== 'cancelled') {
                    existingTraineeCourseMap.set(key, {
                        application_id: r.application_id,
                        application_status: r.application_status,
                    });
                }
            }
        }

        // Transform and filter records
        const newRecords: Record<string, any>[] = [];
        const duplicates: string[] = [];
        const toUpdate: Record<string, any>[] = [];
        const errors: { row: number; error: string }[] = [];

        for (let i = 0; i < data.length; i++) {
            try {
                const row = data[i];
                const transformed = transformRow(row);

                const appId = transformed.application_id;
                if (!appId) {
                    errors.push({ row: i + 1, error: 'Missing Application ID' });
                    continue;
                }

                if (existingApps.has(appId)) {
                    const existing = existingApps.get(appId)!;
                    const existingStatus = (existing.application_status || '').toLowerCase();
                    const uploadedStatus = (transformed.application_status || '').toLowerCase();

                    // Check application status transitions
                    const isExistingConfirmApplication = existingStatus === 'confirm application';
                    const isExistingConfirmed = existingStatus === 'confirmed';
                    const isExistingCancelled = existingStatus === 'cancelled';
                    const isUploadedConfirmed = uploadedStatus === 'confirmed';
                    const isUploadedCancelled = uploadedStatus === 'cancelled';

                    // Valid status updates (not back to "Confirm application"):
                    // 1. "Confirm application" → "Confirmed" or "Cancelled"
                    // 2. "Confirmed" → "Cancelled"
                    // 3. "Cancelled" → "Confirmed"
                    const shouldUpdateStatus =
                        (isExistingConfirmApplication && (isUploadedConfirmed || isUploadedCancelled)) ||
                        (isExistingConfirmed && isUploadedCancelled) ||
                        (isExistingCancelled && isUploadedConfirmed);

                    // Webhook should be called for all updates EXCEPT "Confirm application" → "Confirmed"
                    const skipWebhook = isExistingConfirmApplication && isUploadedConfirmed;

                    toUpdate.push({
                        ...transformed,
                        old_status: existing.application_status,
                        old_enrolment_status: existing.enrolment_status,
                        shouldCallWebhook: shouldUpdateStatus && !skipWebhook,
                        // Override application_status to the existing one if the transition is invalid
                        application_status: shouldUpdateStatus ? transformed.application_status : existing.application_status,
                    });

                    // If status didn't change, we still consider it a duplicate for reporting purposes
                    if (!shouldUpdateStatus) {
                        duplicates.push(appId);
                    }
                    continue;
                }

                // Check for same trainee + course run duplicate (different application_id but same person+course)
                const tid = (transformed.trainee_id || '').toString().trim().toLowerCase();
                const crid = (transformed.course_run_id || '').toString().trim().toLowerCase();
                if (tid && crid) {
                    const tcKey = `${tid}||${crid}`;
                    const existingTC = existingTraineeCourseMap.get(tcKey);
                    if (existingTC) {
                        const existingTCStatus = (existingTC.application_status || '').toLowerCase();
                        // Only block if the existing row is still active (not cancelled)
                        if (existingTCStatus !== 'cancelled') {
                            console.log(`⚠️ Duplicate trainee+course: ${appId} — same trainee ${tid} already has active application ${existingTC.application_id} for course run ${crid}`);
                            errors.push({
                                row: i + 1,
                                error: `Duplicate: ${transformed.trainee_name || tid} already has an active application (${existingTC.application_id}) for this course run`,
                            });
                            continue;
                        }
                    }
                    // Track this new record for intra-batch duplicate detection
                    existingTraineeCourseMap.set(tcKey, {
                        application_id: appId,
                        application_status: transformed.application_status || '',
                    });
                }

                newRecords.push(transformed);
                existingApps.set(appId, {
                    application_status: transformed.application_status || '',
                    enrolment_status: null,
                });
            } catch (err) {
                errors.push({ row: i + 1, error: err instanceof Error ? err.message : 'Unknown error' });
            }
        }

        console.log(`✅ Found ${newRecords.length} new records, ${duplicates.length} duplicates, ${toUpdate.length} to update`);

        // Collect records that need webhook calls
        const webhookQueue: Record<string, any>[] = [];

        // Update status for existing records
        let updatedCount = 0;
        const updatedRecords: any[] = [];
        for (const record of toUpdate) {
            try {
                const result = await pool.query(
                    `UPDATE da_application SET
                        trainee_id_type = COALESCE($1, trainee_id_type),
                        trainee_id = COALESCE($2, trainee_id),
                        date_of_birth = COALESCE($3, date_of_birth),
                        trainee_name = COALESCE($4, trainee_name),
                        course_run_id = COALESCE($5, course_run_id),
                        trainee_email = COALESCE($6, trainee_email),
                        trainee_phone_country_code = COALESCE($7, trainee_phone_country_code),
                        trainee_phone = COALESCE($8, trainee_phone),
                        sponsorship_type = COALESCE($9, sponsorship_type),
                        application_date = COALESCE($10, application_date),
                        application_cancelled_by = COALESCE($11, application_cancelled_by),
                        payable_fee = COALESCE($12, payable_fee),
                        full_course_fee = COALESCE($13, full_course_fee),
                        gst = COALESCE($14, gst),
                        skillsfuture_subsidy = COALESCE($15, skillsfuture_subsidy),
                        skillsfuture_credit = COALESCE($16, skillsfuture_credit),
                        skillsfuture_credit_claim_id = COALESCE($17, skillsfuture_credit_claim_id),
                        grant_id = COALESCE($18, grant_id),
                        application_status = COALESCE($19, application_status),
                        enrolment_status = COALESCE($20, enrolment_status),
                        enrolment_id = COALESCE($21, enrolment_id),
                        course_title = COALESCE($22, course_title),
                        course_reference_number = COALESCE($23, course_reference_number),
                        course_start_date = COALESCE($24, course_start_date),
                        course_end_date = COALESCE($25, course_end_date),
                        highest_qualification = COALESCE($26, highest_qualification),
                        highest_relevant_certification = COALESCE($27, highest_relevant_certification),
                        updated_at = NOW()
                      WHERE application_id = $28
                      RETURNING *`,
                    [
                        record.trainee_id_type ?? null,
                        record.trainee_id ?? null,
                        record.date_of_birth ?? null,
                        record.trainee_name ?? null,
                        record.course_run_id ?? null,
                        record.trainee_email ?? null,
                        record.trainee_phone_country_code ?? null,
                        record.trainee_phone ?? null,
                        record.sponsorship_type ?? null,
                        record.application_date ?? null,
                        record.application_cancelled_by ?? null,
                        record.payable_fee ?? null,
                        record.full_course_fee ?? null,
                        record.gst ?? null,
                        record.skillsfuture_subsidy ?? null,
                        record.skillsfuture_credit ?? null,
                        record.skillsfuture_credit_claim_id ?? null,
                        record.grant_id ?? null,
                        record.application_status ?? null,
                        record.enrolment_status ?? null,
                        record.enrolment_id ?? null,
                        record.course_title ?? null,
                        record.course_reference_number ?? null,
                        record.course_start_date ?? null,
                        record.course_end_date ?? null,
                        record.highest_qualification ?? null,
                        record.highest_relevant_certification ?? null,
                        record.application_id
                    ]
                );
                if (result.rows.length > 0) {
                    updatedCount++;
                    updatedRecords.push({
                        ...result.rows[0],
                        old_status: record.old_status,
                    });

                    // Queue for webhook if needed (skip for "Confirm application" → "Confirmed")
                    if (record.shouldCallWebhook) {
                        webhookQueue.push({ ...record, source: 'update' });
                    }
                }
            } catch (err) {
                console.error('Error updating record:', record.application_id, err);
                errors.push({
                    row: 0,
                    error: `Failed to update status for ${record.application_id}: ${err instanceof Error ? err.message : 'Update failed'}`
                });
            }
        }

        console.log(`✅ Updated ${updatedCount} existing records`);

        // Insert new records using SQL
        let insertedCount = 0;
        const insertedRecords: any[] = [];

        for (const record of newRecords) {
            try {
                const result = await pool.query(
                    `INSERT INTO da_application (
                        trainee_id_type,
                        trainee_id,
                        date_of_birth,
                        trainee_name,
                        course_run_id,
                        trainee_email,
                        trainee_phone_country_code,
                        trainee_phone,
                        sponsorship_type,
                        application_id,
                        application_date,
                        application_cancelled_by,
                        payable_fee,
                        full_course_fee,
                        gst,
                        skillsfuture_subsidy,
                        skillsfuture_credit,
                        skillsfuture_credit_claim_id,
                        grant_id,
                        application_status,
                        enrolment_status,
                        enrolment_id,
                        course_title,
                        course_reference_number,
                        course_start_date,
                        course_end_date,
                        highest_qualification,
                        highest_relevant_certification
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
                    RETURNING *`,
                    [
                        record.trainee_id_type || null,
                        record.trainee_id || null,
                        record.date_of_birth || null,
                        record.trainee_name || null,
                        record.course_run_id || null,
                        record.trainee_email || null,
                        record.trainee_phone_country_code || null,
                        record.trainee_phone || null,
                        record.sponsorship_type || null,
                        record.application_id,
                        record.application_date || null,
                        record.application_cancelled_by || null,
                        record.payable_fee || null,
                        record.full_course_fee || null,
                        record.gst || null,
                        record.skillsfuture_subsidy || null,
                        record.skillsfuture_credit || null,
                        record.skillsfuture_credit_claim_id || null,
                        record.grant_id || null,
                        record.application_status || null,
                        record.enrolment_status || null,
                        record.enrolment_id || null,
                        record.course_title || null,
                        record.course_reference_number || null,
                        record.course_start_date || null,
                        record.course_end_date || null,
                        record.highest_qualification || null,
                        record.highest_relevant_certification || null
                    ]
                );

                if (result.rows.length > 0) {
                    insertedCount++;
                    insertedRecords.push(result.rows[0]);

                    // Queue for webhook if new record has "Cancelled" status
                    if ((record.application_status || '').toLowerCase() === 'cancelled') {
                        webhookQueue.push({ ...record, source: 'insert' });
                    }
                }
            } catch (err) {
                console.error('Error inserting record:', record.application_id, err);
                errors.push({
                    row: newRecords.indexOf(record) + 1,
                    error: err instanceof Error ? err.message : 'Insert failed'
                });
            }
        }

        console.log(`✅ Successfully inserted ${insertedCount} records, updated ${updatedCount} records`);

        // Process webhook queue (single batch call)
        let webhookResult: { success: boolean; count: number; results: any[]; error?: string } = { success: true, count: 0, results: [] };

        if (webhookQueue.length > 0) {
            webhookResult = await callSearchEnrolmentSSGBatch(webhookQueue, tp.uen, tp.code);
        }

        // Fire-and-forget auto-enrol pipeline for all eligible records:
        //   - Newly inserted records
        //   - Updated records (status transitions)
        //   - Duplicate records that already exist but were never auto-enrolled
        try {
            // Helper: only real SSG enrolment references (ENR-...) count as "already enrolled"
            const isRealSsgEnrolmentId = (value: unknown): boolean =>
                /^ENR-/i.test(String(value || '').trim());

            // Collect IDs from inserted + updated records
            const processedIds = [...insertedRecords, ...updatedRecords]
                .filter(r => {
                    if (!r?.id) return false;
                    const status = (r.application_status || '').toLowerCase();
                    const autoStatus = String(r.auto_enrol_status || '').toLowerCase();
                    const hasTraineeId = String(r.trainee_id || '').trim() !== '';
                    const alreadyEnrolled = autoStatus && !['failed'].includes(autoStatus) && !(autoStatus === 'pending_identity' && hasTraineeId);
                    // Only skip if the row already has a real SSG enrolment reference (ENR-...)
                    // Placeholder values like "N/A", "-", "MANUAL", or empty are NOT real enrolments
                    return (status === 'confirmed' || status === 'confirm application') && !alreadyEnrolled && !isRealSsgEnrolmentId(r.enrolment_id);
                })
                .map(r => r.id as string);

            const allEligibleIds = [...new Set(processedIds)];

            if (allEligibleIds.length > 0) {
                // Pre-mark as 'pending' so we can distinguish "never triggered" from "triggered but failed"
                await pool.query(
                    `UPDATE da_application SET auto_enrol_status = 'pending', auto_enrol_error = NULL
                     WHERE id = ANY($1) AND (auto_enrol_status IS NULL OR auto_enrol_status = 'failed')`,
                    [allEligibleIds]
                );

                console.log(`🚀 auto-enrol: queuing ${allEligibleIds.length} applications for background processing`);
                setImmediate(() => {
                    bulkProcessDirectApplications(allEligibleIds).catch(err => {
                        console.error('❌ Background auto-enrol failed:', err);
                    });
                });
            }
        } catch (err) {
            // Never fail the upload response because of auto-enrol setup errors.
            console.error('⚠️  auto-enrol kickoff setup failed (non-fatal):', err);
        }

        // ---- DIRECT APPLICATION AUTOMATIONS ----
        // Fire-and-forget sync for Calendar, Native Enrolments, and DA invoice generation.
        try {
            const allProcessedRecords = [...insertedRecords, ...updatedRecords];
            const insertedDbIdSet = new Set(
                insertedRecords
                    .map(r => r?.id)
                    .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
            );
            const daInvoiceTriggerIds: string[] = [];
            
            // Background async processing to avoid blocking UI response
            setImmediate(async () => {
                for (const record of allProcessedRecords) {
                    const appStatus = String(record.application_status || '').toLowerCase();
                    const oldStatus = String(record.old_status || '').toLowerCase();

                    // Automation 1a: Add to Calendar (triggers if application_status is Confirmed)
                    if (appStatus === 'confirmed' && record.trainee_email) {
                        try {
                            // Resolve course_run UUID and check if course run is in the future
                            const crRes = await pool.query(
                                `SELECT id, start_date FROM course_run WHERE course_run_id = $1 LIMIT 1`,
                                [record.course_run_id]
                            );
                            const courseRunUuid = crRes.rows[0]?.id || record.course_run_id;
                            const startDate = crRes.rows[0]?.start_date;

                            // Skip calendar add for past course runs
                            if (startDate && new Date(startDate) < getLocalYMD(new Date(new Date()))) {
                                console.log(`⏭️ Skipping calendar add for ${record.trainee_email} — course run ${record.course_run_id} already started`);
                            } else {
                                const calResult = await addDaLearnerToCalendar(
                                    record.trainee_email,
                                    courseRunUuid,
                                    record.course_title,
                                    record.course_start_date
                                );
                                if (calResult.addedTo > 0) {
                                    console.log(`📅 Added ${record.trainee_email} to ${calResult.addedTo} calendar event(s)`);
                                    await pool.query(
                                        `UPDATE da_application SET calendar_added = true WHERE application_id = $1`,
                                        [record.application_id]
                                    );
                                }
                            }
                        } catch (calErr) {
                            console.error('Failed to sync to Calendar:', calErr);
                        }
                    }

                    // Automation 1b: Remove from Calendar (triggers if status changed TO Cancelled)
                    if (appStatus === 'cancelled' && oldStatus && oldStatus !== 'cancelled' && record.trainee_email) {
                        try {
                            const crRes = await pool.query(
                                `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
                                [record.course_run_id]
                            );
                            const courseRunUuid = crRes.rows[0]?.id || record.course_run_id;

                            const removeResult = await removeDaLearnerFromCalendar(
                                record.trainee_email,
                                courseRunUuid,
                                record.course_title,
                                record.course_start_date
                            );
                            if (removeResult.removedFrom > 0) {
                                console.log(`🗑️ Removed ${record.trainee_email} from ${removeResult.removedFrom} calendar event(s)`);
                            }
                            // Untick the CAL column
                            await pool.query(
                                `UPDATE da_application SET calendar_added = false WHERE application_id = $1`,
                                [record.application_id]
                            );
                        } catch (calErr) {
                            console.error('Failed to remove from Calendar:', calErr);
                        }
                    }

                    // Automation 2: Native Enrolment Creation (triggers if Enrol Status/enrolment_status is Confirmed)
                    const isEnrolConfirmed = String(record.enrolment_status || '').toLowerCase() === 'confirmed';
                    const wasEnrolAlreadyConfirmed = String(record.old_enrolment_status || '').toLowerCase() === 'confirmed';

                    if (isEnrolConfirmed && (!wasEnrolAlreadyConfirmed || !record.old_enrolment_status)) {
                        await createNativeEnrolmentFromDA(record, pool);
                        console.log(`✅ Automatically created native enrolment for DA ${record.application_id}`);
                    }

                    // Automation 3: DA invoice auto-generation trigger
                    // Fires when enrol is effectively ticked (Confirmed) and there is a real enrolment_id.
                    const shouldTriggerDaInvoice =
                        insertedDbIdSet.has(record.id) &&
                        isEnrolConfirmed &&
                        hasRealEnrolmentId(record.enrolment_id) &&
                        !record.invoice_id;

                    if (shouldTriggerDaInvoice && typeof record.id === 'string' && record.id.length > 0) {
                        daInvoiceTriggerIds.push(record.id);
                    }
                }

                for (const applicationDbId of daInvoiceTriggerIds) {
                    try {
                        await processDirectApplication(applicationDbId, undefined, {
                            forceInvoice: true,
                            sendInvoiceEmail: true,
                        });
                        console.log(`Auto-triggered DA invoice generation + email for application ${applicationDbId}`);
                    } catch (invoiceErr) {
                        console.error(`Failed auto-triggered DA invoice generation for ${applicationDbId}:`, invoiceErr);
                    }
                }
            });
        } catch (autoErr) {
            console.error('Error triggering new DA automations', autoErr);
        }

        return res.status(200).json({
            success: true,
            inserted: insertedCount,
            updated: updatedCount,
            duplicates: duplicates.length,
            duplicateIds: duplicates.slice(0, 10),
            errors,
            newRecords: insertedRecords,
            updatedRecords,
            webhookSummary: webhookQueue.length > 0 ? {
                total: webhookQueue.length,
                success: webhookResult.success,
                count: webhookResult.count,
                results: webhookResult.results,
                error: webhookResult.error,
            } : undefined,
        });

    } catch (error) {
        console.error('❌ Error in upload-da-applications:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
