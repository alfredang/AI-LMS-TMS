import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Cancel Enrolment Webhook URL (n8n will search enrolment and cancel it)
const DA_CANCEL_ENROLMENT_WEBHOOK = 'https://n8n.srv1231536.hstgr.cloud/webhook/26e31541-ed6a-4450-bae7-bfae976b2aaf';

/**
 * Build the search enrolment payload for a single DA application record.
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
    };
}

/**
 * API endpoint to cancel multiple DA Applications by their IDs.
 *
 * POST /api/admin/cancel-da-applications
 * Body: { applicationIds: string[] }
 *
 * Flow:
 * 1. Fetch full application data for the given IDs
 * 2. Send to n8n cancel enrolment webhook and WAIT for response
 * 3. Parse per-record results from n8n (SSG response)
 * 4. Only update DB (application_status + enrolment_status) for records that succeeded
 *
 * n8n SSG success response per record:
 *   { status: 200, data: { enrolment: { referenceNumber, status } }, meta: {...}, error: {} }
 *
 * n8n SSG error response per record:
 *   { error: "Cannot read properties of undefined (reading 'ciphertext')" }
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

        // 1. Fetch full application data (needed for webhook payload)
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

        // 2. Send to n8n webhook and WAIT for response
        const records = applicationRows.map(row => buildEnrolmentPayload(row));
        console.log(`📤 Sending ${records.length} records to cancel enrolment webhook...`);

        let webhookResultItems: any[] = [];
        let webhookError: string | undefined;

        try {
            const webhookResponse = await fetch(DA_CANCEL_ENROLMENT_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records }),
            });

            if (!webhookResponse.ok) {
                webhookError = `Webhook returned status ${webhookResponse.status}`;
                console.error(`❌ Cancel enrolment webhook failed: ${webhookResponse.status}`);
            } else {
                const responseBody = await webhookResponse.json();
                // n8n returns: { results: [...] } or { result: [...] } or direct array
                if (responseBody.results && Array.isArray(responseBody.results)) {
                    webhookResultItems = responseBody.results;
                } else if (responseBody.result && Array.isArray(responseBody.result)) {
                    webhookResultItems = responseBody.result;
                } else if (Array.isArray(responseBody)) {
                    webhookResultItems = responseBody;
                } else {
                    webhookResultItems = [responseBody];
                }
                console.log(`✅ Webhook responded with ${webhookResultItems.length} results`);
            }
        } catch (err) {
            webhookError = err instanceof Error ? err.message : 'Unknown webhook error';
            console.error('❌ Cancel enrolment webhook error:', err);
        }

        // 3. Build a map of webhook results by application_id for reliable matching
        const resultsByAppId = new Map<string, any>();
        for (const item of webhookResultItems) {
            if (item.application_id) {
                resultsByAppId.set(item.application_id, item);
            }
        }

        // 4. Parse per-record results and update DB only for successful cancellations
        const succeeded: { application_id: string; enrolment_ref: string; enrolment_status: string }[] = [];
        const failed: { application_id: string; error: string }[] = [];

        for (const record of records) {
            const appId = record.application_id;
            const item = resultsByAppId.get(appId);

            if (!item) {
                failed.push({
                    application_id: appId,
                    error: webhookError || 'No response received from webhook',
                });
                continue;
            }

            // Parse the stringified SSG result
            let ssgResponse: any = null;
            try {
                ssgResponse = typeof item.result === 'string'
                    ? JSON.parse(item.result)
                    : item.result;
            } catch {
                failed.push({ application_id: appId, error: 'Failed to parse SSG response' });
                continue;
            }

            const ssgStatus = ssgResponse?.status;
            const enrolmentData = ssgResponse?.data?.enrolment;
            const ssgError = ssgResponse?.error;

            // Check for error response
            const hasError = ssgError && typeof ssgError === 'object'
                ? (ssgError.message || (ssgError.details && ssgError.details.length > 0))
                : (typeof ssgError === 'string' && ssgError.length > 0);

            if (hasError && (ssgStatus !== 200 && ssgStatus !== '200')) {
                let errorMsg = typeof ssgError === 'string' ? ssgError : (ssgError?.message || 'Unknown error');
                if (ssgError?.details && Array.isArray(ssgError.details)) {
                    const details = ssgError.details
                        .map((d: { message?: string; field?: string }) => d.message || d.field || '')
                        .filter(Boolean)
                        .join('; ');
                    if (details) errorMsg += ` (${details})`;
                }
                failed.push({ application_id: appId, error: errorMsg });
                continue;
            }

            if ((ssgStatus === 200 || ssgStatus === '200') && enrolmentData?.status === 'Cancelled') {
                succeeded.push({
                    application_id: appId,
                    enrolment_ref: enrolmentData.referenceNumber || '',
                    enrolment_status: enrolmentData.status,
                });
            } else {
                failed.push({
                    application_id: appId,
                    error: `Unexpected response: status=${ssgStatus}, enrolment status=${enrolmentData?.status || 'unknown'}`,
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
