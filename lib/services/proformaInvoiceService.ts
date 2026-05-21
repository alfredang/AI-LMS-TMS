import { google, drive_v3 } from 'googleapis';
import PizZip from 'pizzip';
import { Readable } from 'stream';
import pool from '../db';
import { getDriveClient } from '../google-drive/drive-helpers';
import { getServiceAccountAuth } from '../google-auth/googleAuth';

const TEMPLATE_ID = '1KbvgGpNsirzmCvLZOuMv7SY5IWxX0XfTSbnNF_pjZYY';
const DRIVE_FOLDER_ID = '1cqA3G1c4Nez-9XKpUO2h31rBhkZhAfw3';

const SKIP_STATUSES = new Set(['admin removed', 'cancelled', 'withdrawn']);

export type ProformaResult =
    | { status: 'generated'; enrollmentId: string; invoiceNumber: string; driveUrl: string }
    | { status: 'skipped'; enrollmentId: string; reason: string }
    | { status: 'error'; enrollmentId: string; error: string };

export interface GenerateOptions {
    templateBuffer?: Buffer;
    uploadDrive?: drive_v3.Drive;
}

interface Grant {
    funding_scheme: string;
    estimated_amount: string;
    approved_amount: string;
    status: string;
}

export async function ensureProformaLogTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_generate_proforma_invoices_log (
            id SERIAL PRIMARY KEY,
            run_id TEXT NOT NULL,
            trigger_source TEXT NOT NULL,
            enrollment_id UUID,
            enrolment_id TEXT,
            learner_name TEXT,
            course_code TEXT,
            course_title TEXT,
            invoice_number TEXT,
            drive_url TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            error_message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

export async function logProformaResult(
    runId: string,
    triggerSource: 'scheduled' | 'event',
    result: ProformaResult,
    extras: { enrolmentId?: string | null; learnerName?: string | null; courseCode?: string | null; courseTitle?: string | null } = {}
): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO auto_generate_proforma_invoices_log
             (run_id, trigger_source, enrollment_id, enrolment_id, learner_name, course_code, course_title,
              invoice_number, drive_url, status, reason, error_message)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                runId,
                triggerSource,
                result.enrollmentId || null,
                extras.enrolmentId || null,
                extras.learnerName || null,
                extras.courseCode || null,
                extras.courseTitle || null,
                result.status === 'generated' ? result.invoiceNumber : null,
                result.status === 'generated' ? result.driveUrl : null,
                result.status,
                result.status === 'skipped' ? result.reason : null,
                result.status === 'error' ? result.error : null,
            ]
        );
    } catch (err) {
        console.error('[proformaInvoiceService] Failed to log result:', err);
    }
}

export async function downloadTemplateBuffer(): Promise<Buffer> {
    const auth = await getServiceAccountAuth(pool, ['https://www.googleapis.com/auth/drive.readonly']);
    const serviceDrive = google.drive({ version: 'v3', auth });
    const exportRes = await serviceDrive.files.export(
        { fileId: TEMPLATE_ID, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(exportRes.data as ArrayBuffer);
}

async function fetchGrants(enrolmentRef: string | null): Promise<Grant[]> {
    if (!enrolmentRef) return [];
    const res = await pool.query(
        `SELECT
            funding_scheme_description AS funding_scheme,
            estimated_grant_amount AS estimated_amount,
            approved_grant_amount AS approved_amount,
            status
         FROM ssg_grants
         WHERE enrollment_id = $1`,
        [enrolmentRef]
    );
    return res.rows as Grant[];
}

function buildPlaceholders(enr: {
    enrolment_id: string | null;
    full_name: string;
    course_title: string;
    course_code: string | null;
    course_fees_exclude_gst: string | null;
    start_date: string | null;
}, grants: Grant[]) {
    const order = (enr.enrolment_id ?? '').replace('#', '');
    const amount1 = parseFloat((enr.course_fees_exclude_gst ?? '0').toString().replace(/,/g, ''));

    let subTotal = amount1;
    const amount2 = amount1 * -0.5;
    subTotal += amount2;

    let amount3: number | string = '';
    let mces = '';
    let qty = '';

    const enhancedGrant = grants.find(g =>
        g.funding_scheme === 'Mid-Career Enhanced Subsidy' ||
        g.funding_scheme === 'Enhanced Training Support for SMEs' ||
        g.funding_scheme === 'IBF STS'
    );
    const enhancedAmt = enhancedGrant
        ? parseFloat(enhancedGrant.approved_amount !== '0.00' ? enhancedGrant.approved_amount : enhancedGrant.estimated_amount)
        : 0;

    if (enhancedAmt > 0) {
        mces = enhancedGrant!.funding_scheme;
        qty = '1';
        amount3 = -enhancedAmt;
        subTotal += amount3;
    }

    const gst = amount1 * 0.09;
    const total = subTotal + gst;
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 25);
    const fmtDate = (d: Date) => d.toLocaleDateString('en-SG', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const courseDate = enr.start_date
        ? new Date(enr.start_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';

    return {
        '{{order}}': order,
        '{{date}}': fmtDate(today),
        '{{due_date}}': fmtDate(dueDate),
        '{{course_start}}': courseDate,
        '{{name}}': enr.full_name,
        '{{course_name}}': enr.course_title,
        '{{code}}': enr.course_code ?? '',
        '{{amount1}}': amount1.toFixed(2),
        '{{amount2}}': amount2 !== 0 ? amount2.toFixed(2) : '',
        '{{mces}}': mces,
        '{{qty}}': qty,
        '{{amount3}}': typeof amount3 === 'number' ? amount3.toFixed(2) : '',
        '{{sub_total}}': subTotal.toFixed(2),
        '{{gst}}': gst.toFixed(2),
        '{{total}}': total.toFixed(2),
    } as Record<string, string>;
}

function fillTemplate(templateBuffer: Buffer, replacements: Record<string, string>): Buffer {
    const zip = new PizZip(templateBuffer);
    const xmlFiles = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml'];
    for (const xmlFile of xmlFiles) {
        if (zip.files[xmlFile]) {
            let xml = zip.files[xmlFile].asText();
            for (const [placeholder, value] of Object.entries(replacements)) {
                const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                xml = xml.replace(new RegExp(escaped, 'g'), value);
            }
            zip.file(xmlFile, xml);
        }
    }
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function docxToPdfAndUpload(
    uploadDrive: drive_v3.Drive,
    filledDocx: Buffer,
    invoiceNumber: string
): Promise<string> {
    // Upload filled docx to Drive as a Google Doc (Drive converts it automatically)
    const tempDocRes = await uploadDrive.files.create({
        requestBody: {
            name: `_temp_${invoiceNumber}`,
            mimeType: 'application/vnd.google-apps.document',
        },
        media: {
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            body: Readable.from(filledDocx),
        },
        fields: 'id',
    });
    const tempDocId = tempDocRes.data.id!;

    try {
        // Export the Google Doc as PDF
        const pdfExport = await uploadDrive.files.export(
            { fileId: tempDocId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdfExport.data as ArrayBuffer);

        // Upload final PDF to the proforma folder
        const uploadRes = await uploadDrive.files.create({
            requestBody: {
                name: `${invoiceNumber}.pdf`,
                parents: [DRIVE_FOLDER_ID],
                mimeType: 'application/pdf',
            },
            media: {
                mimeType: 'application/pdf',
                body: Readable.from(pdfBuffer),
            },
            fields: 'id, webViewLink',
        });

        return uploadRes.data.webViewLink ?? '';
    } finally {
        await uploadDrive.files.delete({ fileId: tempDocId }).catch((e: any) => {
            console.warn(`[proformaInvoiceService] Failed to delete temp doc ${tempDocId}: ${e?.message}`);
        });
    }
}

/**
 * Idempotent, race-safe proforma invoice generator for a single enrollment.
 *
 * Flow:
 *   1. SELECT ... FOR UPDATE to lock the enrollment row
 *   2. Skip if pro_forma_url already set, or if enrolment_status is cancelled/withdrawn/admin-removed
 *   3. Generate PDF, upload to Drive
 *   4. UPDATE enrollment.pro_forma_url + proforma_invoice_number, COMMIT
 *
 * Safe to call from scheduled cron, enrollment-creation event hooks, or manual admin flows.
 */
export async function generateProformaForEnrollment(
    enrollmentId: string,
    opts: GenerateOptions = {}
): Promise<ProformaResult> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const lookup = await client.query(
            `SELECT
                e.id AS enrollment_id,
                e.enrolment_id,
                e.enrolment_status,
                e.pro_forma_url,
                u.full_name,
                c.title AS course_title,
                c.course_code,
                c.course_fees_exclude_gst,
                cr.start_date::text
             FROM enrollment e
             JOIN app_user u ON u.id = e.user_id
             JOIN course_run cr ON cr.id = e.course_run_id
             JOIN course c ON c.id = e.course_id
             WHERE e.id = $1
             FOR UPDATE OF e`,
            [enrollmentId]
        );

        if (lookup.rows.length === 0) {
            await client.query('ROLLBACK');
            return { status: 'skipped', enrollmentId, reason: 'enrollment not found' };
        }

        const enr = lookup.rows[0];

        if (enr.pro_forma_url) {
            await client.query('ROLLBACK');
            return { status: 'skipped', enrollmentId, reason: 'already has pro_forma_url' };
        }

        const statusLower = (enr.enrolment_status || '').trim().toLowerCase();
        if (SKIP_STATUSES.has(statusLower)) {
            await client.query('ROLLBACK');
            return { status: 'skipped', enrollmentId, reason: `enrolment_status is ${enr.enrolment_status}` };
        }

        // Fetch grants (read-only, safe to do inside txn)
        const grants = await fetchGrants(enr.enrolment_id);

        // Ensure invoice number column exists (cheap, idempotent)
        await client.query('ALTER TABLE enrollment ADD COLUMN IF NOT EXISTS proforma_invoice_number TEXT');

        const templateBuffer = opts.templateBuffer ?? (await downloadTemplateBuffer());
        const uploadDrive = opts.uploadDrive ?? (await getDriveClient());

        const replacements = buildPlaceholders(enr, grants);
        const filledDocx = fillTemplate(templateBuffer, replacements);

        // PF-{enrolment_id}_{learner_name}. Strip leading '#' and any existing 'PF-' prefix
        // (defensive against dirty data) so the filename doesn't end up as PF-PF-...
        const enrolmentRef = (enr.enrolment_id ?? '').replace('#', '').replace(/^PF-/i, '').trim();
        const safeRef = (enrolmentRef || enr.course_code || 'invoice').replace(/[^a-zA-Z0-9-]/g, '_');
        const safeName = enr.full_name.replace(/[^a-zA-Z0-9]/g, '_');
        const invoiceNumber = `PF-${safeRef}_${safeName}`;

        const driveUrl = await docxToPdfAndUpload(uploadDrive, filledDocx, invoiceNumber);

        if (!driveUrl) {
            await client.query('ROLLBACK');
            return { status: 'error', enrollmentId, error: 'Drive upload returned empty webViewLink' };
        }

        await client.query(
            'UPDATE enrollment SET pro_forma_url = $1, proforma_invoice_number = $2 WHERE id = $3',
            [driveUrl, invoiceNumber, enrollmentId]
        );

        await client.query('COMMIT');
        return { status: 'generated', enrollmentId, invoiceNumber, driveUrl };
    } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        const message = err?.message || String(err);
        console.error(`[proformaInvoiceService] Error for enrollment ${enrollmentId}:`, err);
        return { status: 'error', enrollmentId, error: message };
    } finally {
        client.release();
    }
}

/**
 * Fire-and-forget wrapper for the event-trigger path. Never throws.
 * Logs result to auto_generate_proforma_invoices_log.
 */
export function triggerProformaGeneration(enrollmentId: string, runId?: string): void {
    const rid = runId || `event_${Date.now()}_${enrollmentId.slice(0, 8)}`;
    setImmediate(async () => {
        try {
            await ensureProformaLogTable();
            const result = await generateProformaForEnrollment(enrollmentId);
            await logProformaResult(rid, 'event', result);
        } catch (err) {
            console.error(`[proformaInvoiceService] triggerProformaGeneration failed for ${enrollmentId}:`, err);
        }
    });
}
