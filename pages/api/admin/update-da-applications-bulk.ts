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
    'Application Date': 'application_date',
    'Application Cancelled By': 'application_cancelled_by',
    'Payable Fee': 'payable_fee',
    'Full course fee': 'full_course_fee',
    'Full Course Fee': 'full_course_fee',
    'GST': 'gst',
    'SkillsFuture subsidy': 'skillsfuture_subsidy',
    'SkillsFuture Subsidy': 'skillsfuture_subsidy',
    'SkillsFuture Credit': 'skillsfuture_credit',
    'SkillsFuture Credit claim ID': 'skillsfuture_credit_claim_id',
    'SkillsFuture Credit Claim ID': 'skillsfuture_credit_claim_id',
    'Application Status': 'application_status',
    'Course Title': 'course_title',
    'Course Reference Number': 'course_reference_number',
    'Course Start Date': 'course_start_date',
    'Course Run Start Date': 'course_start_date',
    'Course End Date': 'course_end_date',
    'Course Run End Date': 'course_end_date',
    'Highest Qualification': 'highest_qualification',
    'Highest Relevant Certification': 'highest_relevant_certification',
};

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
            if (['payable_fee', 'full_course_fee', 'gst', 'skillsfuture_subsidy', 'skillsfuture_credit'].includes(dbKey) && value) {
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
            if (['payable_fee', 'full_course_fee', 'gst', 'skillsfuture_subsidy', 'skillsfuture_credit'].includes(snakeKey) && value) {
                value = parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
            }

            dbRow[snakeKey] = value;
        }
    }

    return dbRow;
}

/**
 * API endpoint to bulk update DA Application data in the database.
 * Updates all fields based on Application ID but PRESERVES the enrolment_status.
 * 
 * POST /api/admin/update-da-applications-bulk
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

        console.log(`📊 Processing bulk update for ${data.length} DA application records...`);

        // Get existing application IDs and their current enrolment_status
        const existingResult = await pool.query(
            `SELECT application_id, enrolment_status FROM da_application`
        );

        const existingApps = new Map<string, string | null>(
            existingResult.rows.map(r => [r.application_id, r.enrolment_status])
        );

        // Transform and filter records
        const toUpdate: Record<string, any>[] = [];
        const notFound: string[] = [];
        const errors: { row: number; error: string; application_id?: string }[] = [];

        for (let i = 0; i < data.length; i++) {
            try {
                const row = data[i];
                const transformed = transformRow(row);

                const appId = transformed.application_id;
                if (!appId) {
                    errors.push({ row: i + 1, error: 'Missing Application ID' });
                    continue;
                }

                if (!existingApps.has(appId)) {
                    notFound.push(appId);
                    continue;
                }

                // Store the current enrolment_status to preserve it
                toUpdate.push({
                    ...transformed,
                    current_enrolment_status: existingApps.get(appId),
                });
            } catch (err) {
                errors.push({ 
                    row: i + 1, 
                    error: err instanceof Error ? err.message : 'Unknown error' 
                });
            }
        }

        console.log(`✅ Found ${toUpdate.length} records to update, ${notFound.length} not found in database`);

        // Update records one by one (preserving enrolment_status)
        let updatedCount = 0;
        const updatedRecords: any[] = [];

        for (const record of toUpdate) {
            try {
                // Build the UPDATE query dynamically, excluding enrolment_status
                const updateFields: string[] = [];
                const updateValues: any[] = [];
                let paramIndex = 1;

                // Add all fields except application_id and current_enrolment_status
                const fieldsToUpdate = [
                    'trainee_id_type',
                    'trainee_id',
                    'date_of_birth',
                    'trainee_name',
                    'course_run_id',
                    'trainee_email',
                    'trainee_phone_country_code',
                    'trainee_phone',
                    'sponsorship_type',
                    'application_date',
                    'application_cancelled_by',
                    'payable_fee',
                    'full_course_fee',
                    'gst',
                    'skillsfuture_subsidy',
                    'skillsfuture_credit',
                    'skillsfuture_credit_claim_id',
                    'application_status',
                    'course_title',
                    'course_reference_number',
                    'course_start_date',
                    'course_end_date',
                    'highest_qualification',
                    'highest_relevant_certification',
                ];

                // Numeric fields that should be converted to null if empty
                const numericFields = ['payable_fee', 'full_course_fee', 'gst', 'skillsfuture_subsidy', 'skillsfuture_credit'];

                for (const field of fieldsToUpdate) {
                    if (record[field] !== undefined) {
                        let value = record[field];
                        
                        // Convert empty strings to null for all fields
                        if (value === '' || value === null) {
                            value = null;
                        }
                        
                        // For numeric fields, also handle zero/invalid values
                        if (numericFields.includes(field) && (value === '' || value === null || value === undefined)) {
                            value = null;
                        }
                        
                        updateFields.push(`${field} = $${paramIndex}`);
                        updateValues.push(value);
                        paramIndex++;
                    }
                }

                // Add updated_at timestamp
                updateFields.push(`updated_at = NOW()`);

                // Add application_id as the WHERE condition
                updateValues.push(record.application_id);

                const updateQuery = `
                    UPDATE da_application 
                    SET ${updateFields.join(', ')}
                    WHERE application_id = $${paramIndex}
                    RETURNING *
                `;

                const result = await pool.query(updateQuery, updateValues);

                if (result.rows.length > 0) {
                    updatedCount++;
                    updatedRecords.push(result.rows[0]);
                }
            } catch (err) {
                console.error('Error updating record:', record.application_id, err);
                errors.push({
                    row: 0,
                    application_id: record.application_id,
                    error: `Failed to update ${record.application_id}: ${err instanceof Error ? err.message : 'Update failed'}`
                });
            }
        }

        console.log(`✅ Successfully updated ${updatedCount} records`);

        return res.status(200).json({
            success: true,
            updated: updatedCount,
            notFound: notFound.length,
            notFoundIds: notFound.slice(0, 10),
            errors,
            updatedRecords,
        });

    } catch (error) {
        console.error('❌ Error in update-da-applications-bulk:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
