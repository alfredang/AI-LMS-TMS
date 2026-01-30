import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

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
    'Payable Fee': 'payable_fee',
    'Application Status': 'application_status',
    'Course Title': 'course_title',
    'Course Reference Number': 'course_reference_number',
    'Course Start Date': 'course_start_date',
    'Course End Date': 'course_end_date',
};

// Parse date from various formats
function parseDate(value: any): string | null {
    if (!value) return null;

    // If it's already a valid date string
    if (typeof value === 'string') {
        // Try DD/MM/YYYY or DD-MM-YYYY format
        const ddmmyyyy = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (ddmmyyyy) {
            const [, day, month, year] = ddmmyyyy;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        // Try YYYY-MM-DD format
        const yyyymmdd = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (yyyymmdd) {
            return value;
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

// Transform Excel row to database format
function transformRow(excelRow: Record<string, any>): Record<string, any> {
    const dbRow: Record<string, any> = {};

    for (const [excelKey, dbKey] of Object.entries(columnMapping)) {
        if (excelRow[excelKey] !== undefined && excelRow[excelKey] !== '') {
            let value = excelRow[excelKey];

            // Handle date fields
            if (dbKey.includes('date')) {
                value = parseDate(value);
            }

            // Handle numeric fields
            if (dbKey === 'payable_fee' && value) {
                value = parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
            }

            if (value !== null && value !== undefined) {
                dbRow[dbKey] = value;
            }
        }
    }

    // Also check for snake_case keys (in case data is already transformed)
    for (const key of Object.keys(excelRow)) {
        const snakeKey = key.toLowerCase().replace(/\s+/g, '_');
        if (Object.values(columnMapping).includes(snakeKey) && !dbRow[snakeKey]) {
            let value = excelRow[key];

            // Apply same transformations as above
            if (snakeKey.includes('date')) {
                value = parseDate(value);
            }
            if (snakeKey === 'payable_fee' && value) {
                value = parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
            }

            dbRow[snakeKey] = value;
        }
    }

    return dbRow;
}

// DA Search Enrolment Webhook URL
const DA_SEARCH_ENROLMENT_WEBHOOK = 'https://n8n.srv1231536.hstgr.cloud/webhook/4ac2fd52-7e73-493c-93a5-352295fc0d1c';

/**
 * Build the search enrolment payload for a single record.
 */
function buildEnrolmentPayload(record: Record<string, any>): Record<string, any> {
    const runId = String(record.course_run_id || '');
    const code = String(record.course_reference_number || '');
    const traineeId = String(record.trainee_id || '');
    const idTypeRaw = String(record.trainee_id_type || '').toUpperCase();
    const sponsorshipRaw = String(record.sponsorship_type || '').toUpperCase();

    // Convert ID Type: Singaporean/PR → NRIC, FIN → FIN, etc.
    let idType = 'NRIC';
    if (idTypeRaw.includes('FIN')) idType = 'FIN';
    if (idTypeRaw.includes('PASSPORT')) idType = 'PASSPORT';

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
        payload: {
            enrolment: {
                course: {
                    run: { id: runId },
                    referenceNumber: code
                },
                trainee: traineeJSON,
                trainingPartner: {
                    uen: '201200696W',
                    code: '201200696W-01'
                }
            },
            parameters: {
                page: 0,
                pageSize: 40
            }
        },
        trainee_email: record.trainee_email || '',
        application_id: record.application_id,
        source: record.source || 'unknown'
    };
}

/**
 * Call the webhook with ALL records in a single batch request.
 * Sends an array of enrolment payloads.
 * Parses the response and updates enrolment_status in database.
 * 
 * Expected n8n response format (per record):
 * Success: { result: { status: "200", data: { enrolment: { status: "Confirmed" } }, ... } }
 * Not Found: { result: { status: "404", data: [], error: { message: "Not Found", ... } } }
 */
async function callSearchEnrolmentWebhookBatch(records: Record<string, any>[]): Promise<{ success: boolean; count: number; results: any[]; error?: string }> {
    if (records.length === 0) {
        return { success: true, count: 0, results: [] };
    }

    try {
        // Build payloads for all records
        const payloads = records.map(record => buildEnrolmentPayload(record));

        console.log(`📤 Calling DA Search Enrolment webhook with ${payloads.length} records...`);

        const response = await fetch(DA_SEARCH_ENROLMENT_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: payloads }),
        });

        if (!response.ok) {
            console.error(`❌ Batch webhook failed: ${response.status}`);
            return { success: false, count: payloads.length, results: [], error: `Webhook returned ${response.status}` };
        }

        const responseBody = await response.json();
        const webhookResults = Array.isArray(responseBody) ? responseBody : [responseBody];

        console.log(`✅ Batch webhook responded with ${webhookResults.length} results`);

        // Process each result and update database
        const processedResults: any[] = [];

        for (let i = 0; i < webhookResults.length; i++) {
            const webhookResult = webhookResults[i];
            const originalRecord = records[i];
            const applicationId = originalRecord?.application_id;

            if (!applicationId) {
                processedResults.push({ application_id: null, status: 'error', message: 'Missing application_id' });
                continue;
            }

            // Parse the result - handle both string and object formats
            let parsedResult = webhookResult?.result;
            if (typeof parsedResult === 'string') {
                try {
                    parsedResult = JSON.parse(parsedResult);
                } catch (e) {
                    console.error(`Failed to parse result for ${applicationId}:`, e);
                    processedResults.push({ application_id: applicationId, status: 'error', message: 'Failed to parse response' });
                    continue;
                }
            }

            // Determine enrolment status based on SSG response
            let enrolmentStatus: string | null = null;
            const ssgStatus = parsedResult?.status;
            const ssgError = parsedResult?.error;

            if (ssgStatus === '404' || ssgStatus === 404 || ssgError?.message === 'Not Found') {
                // SSG returned 404 - No records found
                enrolmentStatus = 'Not Found';
            } else if (ssgStatus === '200' || ssgStatus === 200) {
                // SSG returned success - get the enrolment status
                const enrolmentData = parsedResult?.data?.enrolment || parsedResult?.data?.[0]?.enrolment;
                if (enrolmentData?.status) {
                    enrolmentStatus = enrolmentData.status; // "Confirmed", "Cancelled", etc.
                } else {
                    enrolmentStatus = 'Confirmed'; // Default to Confirmed if status not in response
                }
            } else {
                // Unknown response - log and skip
                console.warn(`⚠️ Unknown SSG response for ${applicationId}:`, parsedResult);
                processedResults.push({ application_id: applicationId, status: 'unknown', response: parsedResult });
                continue;
            }

            // Update database with enrolment_status
            try {
                await pool.query(
                    `UPDATE da_application SET enrolment_status = $1, updated_at = NOW() WHERE application_id = $2`,
                    [enrolmentStatus, applicationId]
                );
                console.log(`✅ Updated ${applicationId} enrolment_status to "${enrolmentStatus}"`);
                processedResults.push({ application_id: applicationId, enrolment_status: enrolmentStatus, success: true });
            } catch (dbError) {
                console.error(`❌ Failed to update ${applicationId}:`, dbError);
                processedResults.push({ application_id: applicationId, status: 'db_error', error: dbError instanceof Error ? dbError.message : 'DB update failed' });
            }
        }

        return { success: true, count: payloads.length, results: processedResults };
    } catch (error) {
        console.error(`❌ Batch webhook error:`, error);
        return { success: false, count: records.length, results: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
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

        // Get existing application IDs, their statuses, and enrolment status to check for duplicates
        const existingResult = await pool.query(
            `SELECT application_id, application_status, enrolment_status FROM da_application`
        );

        const existingApps = new Map<string, { application_status: string; enrolment_status: string | null }>(
            existingResult.rows.map(r => [r.application_id, {
                application_status: r.application_status,
                enrolment_status: r.enrolment_status,
            }])
        );

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
                    const shouldUpdate =
                        (isExistingConfirmApplication && (isUploadedConfirmed || isUploadedCancelled)) ||
                        (isExistingConfirmed && isUploadedCancelled) ||
                        (isExistingCancelled && isUploadedConfirmed);

                    if (shouldUpdate) {
                        // Webhook should be called for all updates EXCEPT "Confirm application" → "Confirmed"
                        // "Confirm application" → "Confirmed" is the default acceptance flow from TPG
                        const skipWebhook = isExistingConfirmApplication && isUploadedConfirmed;

                        toUpdate.push({
                            application_id: appId,
                            application_status: transformed.application_status,
                            old_status: existing.application_status,
                            old_enrolment_status: existing.enrolment_status,
                            shouldCallWebhook: !skipWebhook,
                            // Include all trainee info for webhook
                            ...transformed,
                        });
                    } else {
                        duplicates.push(appId);
                    }
                    continue;
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
                    `UPDATE da_application SET application_status = $1 WHERE application_id = $2 RETURNING *`,
                    [record.application_status, record.application_id]
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
                        payable_fee,
                        application_status,
                        course_title,
                        course_reference_number,
                        course_start_date,
                        course_end_date
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
                        record.payable_fee || null,
                        record.application_status || null,
                        record.course_title || null,
                        record.course_reference_number || null,
                        record.course_start_date || null,
                        record.course_end_date || null
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
            webhookResult = await callSearchEnrolmentWebhookBatch(webhookQueue);
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

