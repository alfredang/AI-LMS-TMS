import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Column mapping from Excel headers to database columns
const columnMapping: Record<string, string> = {
    'Trainee ID Type': 'trainee_id_type',
    'Trainee ID': 'trainee_id',
    'Date of Birth': 'date_of_birth',
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
    'Enrolment/Grant': 'enrolment_grant',
    'Enrolment Grant': 'enrolment_grant',
};

// Parse date from various formats
function parseDate(value: any): string | null {
    if (!value) return null;

    // If it's already a valid date string
    if (typeof value === 'string') {
        // Try DD/MM/YYYY format
        const ddmmyyyy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (ddmmyyyy) {
            const [, day, month, year] = ddmmyyyy;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        // Try YYYY-MM-DD format
        const yyyymmdd = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (yyyymmdd) {
            return value;
        }

        // Try parsing as date string
        const dateValue = new Date(value);
        if (!isNaN(dateValue.getTime())) {
            return dateValue.toISOString().split('T')[0];
        }
    }

    // If it's a number (Excel serial date)
    if (typeof value === 'number') {
        // Excel uses days since 1900-01-01 (with a bug treating 1900 as leap year)
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + value * 86400000);
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
            dbRow[snakeKey] = excelRow[key];
        }
    }

    return dbRow;
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

        // Get existing application IDs to check for duplicates
        const existingResult = await pool.query(
            `SELECT application_id FROM da_application`
        );

        const existingIds = new Set(existingResult.rows.map(r => r.application_id));

        // Transform and filter records
        const newRecords: Record<string, any>[] = [];
        const duplicates: string[] = [];
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

                if (existingIds.has(appId)) {
                    duplicates.push(appId);
                    continue;
                }

                newRecords.push(transformed);
                existingIds.add(appId);
            } catch (err) {
                errors.push({ row: i + 1, error: err instanceof Error ? err.message : 'Unknown error' });
            }
        }

        console.log(`✅ Found ${newRecords.length} new records, ${duplicates.length} duplicates`);

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
                        course_end_date,
                        enrolment_grant
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
                        record.course_end_date || null,
                        record.enrolment_grant || null
                    ]
                );

                if (result.rows.length > 0) {
                    insertedCount++;
                    if (insertedRecords.length < 10) {
                        insertedRecords.push(result.rows[0]);
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

        console.log(`✅ Successfully inserted ${insertedCount} records`);

        return res.status(200).json({
            success: true,
            inserted: insertedCount,
            duplicates: duplicates.length,
            duplicateIds: duplicates.slice(0, 10),
            errors,
            newRecords: insertedRecords
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
