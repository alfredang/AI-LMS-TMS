import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { searchEnrolment, cancelEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { upsertSsgEnrolmentFromLocalEnrollment } from '../../../lib/services/billingSync';

/**
 * Build the search enrolment payload for a single DA application record.
 */
function buildEnrolmentPayload(record: Record<string, any>, tpUen: string, tpCode: string): Record<string, any> {
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
 * POST /api/admin/cancel-da-applications
 * Body: { applicationIds: string[] }
 *
 * Flow:
 * 1. Fetch full application data for the given IDs
 * 2. For each record: search SSG for the enrolment reference number
 * 3. For each record: cancel the enrolment via SSG
 * 4. Only update DB (application_status + enrolment_status) for records that succeeded
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { applicationIds } = req.body;

        if (!applicationIds || !Array.isArray(applicationIds) || applicationIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request body. Expected { applicationIds: [...] }'
            });
        }

        console.log(`🚫 Cancelling ${applicationIds.length} DA applications...`);

        // 1. Fetch full application data
        const fetchResult = await pool.query(
            `SELECT * FROM da_application WHERE application_id = ANY($1::text[])`,
            [applicationIds]
        );

        const applicationRows = fetchResult.rows;

        if (applicationRows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No matching applications found'
            });
        }

        // 2. Search then cancel each enrolment via SSG directly (sequential per record)
        const tp = await getTrainingPartnerIdentifiers();
        const records = applicationRows.map(row => buildEnrolmentPayload(row, tp.uen, tp.code));
        console.log(`📤 Processing ${records.length} record(s) — search then cancel via SSG...`);

        const succeeded: { application_id: string; enrolment_ref: string; enrolment_status: string }[] = [];
        const failed: { application_id: string; error: string }[] = [];

        for (const record of records) {
            const appId = record.application_id;

            try {
                // Step 1: Search for the enrolment reference number
                const searchResult = await searchEnrolment(record.ssgPayload as any);

                if (!searchResult.success || !searchResult.referenceNumber) {
                    const errMsg = searchResult.status === 'not_found'
                        ? 'Enrolment not found in SSG'
                        : (searchResult.error || 'Search failed');
                    failed.push({ application_id: appId, error: errMsg });
                    continue;
                }

                // Step 2: Cancel the enrolment using the reference number
                const cancelResult = await cancelEnrolment(
                    searchResult.referenceNumber,
                    record.ssgPayload.enrolment.course.run.id,
                );

                if (!cancelResult.success) {
                    failed.push({ application_id: appId, error: cancelResult.error || 'Cancel failed' });
                    continue;
                }

                succeeded.push({
                    application_id: appId,
                    enrolment_ref: cancelResult.referenceNumber || searchResult.referenceNumber,
                    enrolment_status: cancelResult.enrolmentStatus || 'Cancelled',
                });
            } catch (err) {
                failed.push({
                    application_id: appId,
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
            }
        }

        // 5. Update DB only for succeeded records
        let cancelledCount = 0;
        if (succeeded.length > 0) {
            const succeededIds = succeeded.map(s => s.application_id);
            const updateResult = await pool.query(
                `UPDATE da_application
                 SET application_status = 'Cancelled',
                     enrolment_status = 'Cancelled',
                     updated_at = NOW()
                 WHERE application_id = ANY($1::text[])
                 RETURNING application_id`,
                [succeededIds]
            );
            cancelledCount = updateResult.rows.length;
            console.log(`✅ Updated ${cancelledCount} applications to Cancelled in DB`);

            // Also update the enrollment table matching on enrolment_id
            const succeededRefs = succeeded.map(s => s.enrolment_ref).filter(Boolean);
            if (succeededRefs.length > 0) {
                const enrolmentUpdateResult = await pool.query(
                    `UPDATE enrollment
                     SET enrolment_status = 'Cancelled',
                         updated_at = NOW()
                     WHERE enrolment_id = ANY($1::text[])
                       AND enrolment_status != 'Cancelled'
                     RETURNING id`,
                    [succeededRefs]
                );
                console.log(`✅ Updated ${enrolmentUpdateResult.rows.length} enrollment record(s) to Cancelled`);
                for (const ref of succeededRefs) {
                    try {
                        await upsertSsgEnrolmentFromLocalEnrollment(String(ref));
                    } catch (e) {
                        console.warn('[cancel-da-applications] ssg_enrolments sync:', ref, e);
                    }
                }
            }
        }

        if (failed.length > 0) {
            console.log(`⚠️ ${failed.length} application(s) failed to cancel via SSG`);
        }

        return res.status(200).json({
            success: true,
            cancelled: cancelledCount,
            total: records.length,
            results: {
                succeeded: succeeded.map(s => ({
                    application_id: s.application_id,
                    enrolment_ref: s.enrolment_ref,
                    enrolment_status: s.enrolment_status,
                })),
                failed: failed.map(f => ({
                    application_id: f.application_id,
                    error: f.error,
                })),
            },
        });

    } catch (error) {
        console.error('❌ Error cancelling DA applications:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
