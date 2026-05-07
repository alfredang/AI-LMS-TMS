import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import {
    ensureProformaLogTable,
    logProformaResult,
    downloadTemplateBuffer,
    generateProformaForEnrollment,
} from '../../../lib/services/proformaInvoiceService';

export const config = {
    maxDuration: 300,
    api: { responseLimit: false },
};

const SCHEDULER_SECRET = process.env.NEXT_PUBLIC_SCHEDULER_SECRET || 'local-dev-fallback';

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __proformaInvoicesRunning?: boolean };
if (g.__proformaInvoicesRunning === undefined) g.__proformaInvoicesRunning = false;

/**
 * Scheduled sweep — finds every active enrollment still missing a pro_forma_url
 * and generates one. Runs daily at 04:00 SGT (see lib/scheduler/scheduler.ts).
 *
 * Safety net for any enrollment whose event-triggered generation failed or was
 * skipped. Idempotent: enrollments with pro_forma_url already set are skipped.
 */
export async function runAutomation() {
    if (g.__proformaInvoicesRunning) {
        console.warn('[auto-generate-proforma-invoices] Another run is already in progress — skipping');
        return { success: false, message: 'Skipped — another run is already in progress' };
    }
    g.__proformaInvoicesRunning = true;
    try {
        return await _runAutomationInner();
    } finally {
        g.__proformaInvoicesRunning = false;
    }
}

async function _runAutomationInner() {
    await ensureProformaLogTable();
    await pool.query('ALTER TABLE enrollment ADD COLUMN IF NOT EXISTS pro_forma_url TEXT');
    await pool.query('ALTER TABLE enrollment ADD COLUMN IF NOT EXISTS proforma_invoice_number TEXT');

    const runId = crypto.randomUUID();
    const startedAt = new Date();
    console.log(`[auto-generate-proforma-invoices] Starting run ${runId} at ${startedAt.toISOString()}`);

    try {
        const result = await pool.query(
            `SELECT
                e.id AS enrollment_id,
                e.enrolment_id,
                u.full_name,
                c.title AS course_title,
                c.course_code
             FROM enrollment e
             JOIN app_user u ON u.id = e.user_id
             JOIN course_run cr ON cr.id = e.course_run_id
             JOIN course c ON c.id = e.course_id
             WHERE e.pro_forma_url IS NULL
               AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
             ORDER BY e.enrolment_date DESC NULLS LAST`
        );

        const targets = result.rows;
        console.log(`[auto-generate-proforma-invoices] Found ${targets.length} enrollment(s) needing proforma.`);

        if (targets.length === 0) {
            return { success: true, runId, stats: { totalGenerated: 0, totalSkipped: 0, totalErrors: 0, totalCandidates: 0 } };
        }

        // Pre-load template + Drive client once to avoid per-row overhead
        const templateBuffer = await downloadTemplateBuffer();
        const uploadDrive = await getDriveClient();

        let totalGenerated = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        for (const row of targets) {
            const res = await generateProformaForEnrollment(row.enrollment_id, { templateBuffer, uploadDrive });

            await logProformaResult(runId, 'scheduled', res, {
                enrolmentId: row.enrolment_id,
                learnerName: row.full_name,
                courseCode: row.course_code,
                courseTitle: row.course_title,
            });

            if (res.status === 'generated') totalGenerated++;
            else if (res.status === 'skipped') totalSkipped++;
            else totalErrors++;
        }

        const elapsedMs = Date.now() - startedAt.getTime();
        console.log(
            `[auto-generate-proforma-invoices] Run ${runId} completed in ${elapsedMs}ms. ` +
            `${totalGenerated} generated, ${totalSkipped} skipped, ${totalErrors} errors.`
        );

        return {
            success: true,
            runId,
            stats: { totalGenerated, totalSkipped, totalErrors, totalCandidates: targets.length },
        };
    } catch (error: any) {
        console.error('[auto-generate-proforma-invoices] Fatal error:', error);
        return { success: false, runId, error: error?.message || 'Internal processing error' };
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { authKey } = req.body || {};
    const headerKey = req.headers['x-api-key'];
    const externalKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

    const authorised =
        authKey === SCHEDULER_SECRET ||
        (externalKey && headerKey === externalKey);

    if (!authorised) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await runAutomation();
    return res.status(result.success ? 200 : 500).json(result);
}
