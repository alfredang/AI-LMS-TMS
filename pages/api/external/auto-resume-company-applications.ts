import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import {
  finaliseAutoEnrolStatus,
  processCompanyApplication,
  sweepGrantsByCourseRunForApplications,
} from '../../../lib/autoEnrolCompanyApplications';
import { generateInvoicesForApplications } from '../../../lib/quickbooks/createCompanyApplicationInvoice';
import { sendCompanyApplicationInvoiceEmails } from '../../../lib/quickbooks/sendCompanyApplicationInvoiceEmails';

export const config = {
  maxDuration: 300,
  api: { responseLimit: false },
};

const DEFAULT_LIMIT = 25;
const STALE_AFTER_MINUTES = 30;
const LOCK_KEY = 'auto-resume-company-applications';

type ResumeResult = {
  success: boolean;
  considered: number;
  processed: number;
  enroled: number;
  granted: number;
  failed: number;
  invoice: {
    generated: number;
    skippedAlreadyInvoiced: number;
    skippedNotEnrolled: number;
    skippedAwaitingGrants: number;
    failed: number;
  } | null;
  email: {
    sent: number;
    skippedAlreadySent: number;
    skippedMissingEmail: number;
    skippedNoInvoice: number;
    skippedNotVerified: number;
    failed: number;
    toggleDisabled?: boolean;
  } | null;
  message?: string;
  errors: Array<{ id: string; error: string }>;
};

const globals = globalThis as unknown as { __caResumeRunning?: boolean };
if (globals.__caResumeRunning === undefined) globals.__caResumeRunning = false;

async function findStaleCompanyApplicationIds(limit: number): Promise<string[]> {
  await ensureCompanyApplicationsTable();

  const result = await pool.query(
    `SELECT id::text
      FROM public.company_application
      WHERE updated_at < now() - ($1::int * interval '1 minute')
        AND ca_cancelled_at IS NULL
        AND (
             LOWER(COALESCE(auto_enrol_status, '')) IN ('pending', 'enroled', 'grant_found')
          OR (LOWER(COALESCE(auto_enrol_status, '')) = 'failed' AND COALESCE(enrolment_id, '') <> '')
        )
        AND (
             COALESCE(enrolment_id, '') = ''
          OR COALESCE(calendar_added, false) = false
          OR (
               COALESCE(enrolment_id, '') <> ''
           AND COALESCE(grant_id, '') = ''
           AND COALESCE(grant_ineligible, false) = false
             )
          OR COALESCE(invoice_id, '') = ''
          OR LOWER(COALESCE(auto_enrol_status, '')) IN ('pending', 'failed')
        )
      ORDER BY updated_at ASC
      LIMIT $2`,
    [STALE_AFTER_MINUTES, limit]
  );

  return result.rows.map((r: any) => String(r.id));
}

async function withResumeLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lockRes = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [LOCK_KEY]
    );
    locked = !!lockRes.rows[0]?.locked;
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]).catch(() => {});
    }
    client.release();
  }
}

export async function runAutomation(limit = DEFAULT_LIMIT): Promise<ResumeResult> {
  if (globals.__caResumeRunning) {
    return {
      success: false,
      considered: 0,
      processed: 0,
      enroled: 0,
      granted: 0,
      failed: 0,
      invoice: null,
      email: null,
      message: 'Skipped: another company application resume run is already in progress.',
      errors: [],
    };
  }

  globals.__caResumeRunning = true;
  try {
    const result = await withResumeLock(async (): Promise<ResumeResult> => {
      const ids = await findStaleCompanyApplicationIds(Math.max(1, Math.min(limit, 100)));
      if (ids.length === 0) {
        return {
          success: true,
          considered: 0,
          processed: 0,
          enroled: 0,
          granted: 0,
          failed: 0,
          invoice: null,
          email: null,
          message: 'No stale company application rows found.',
          errors: [],
        };
      }

      console.log(`[ca-resume] Resuming ${ids.length} stale company application row(s): ${ids.join(', ')}`);

      const rowResults: Awaited<ReturnType<typeof processCompanyApplication>>[] = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const id of ids) {
        try {
          rowResults.push(await processCompanyApplication(id));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ id, error: message });
          rowResults.push({
            id,
            success: false,
            finalStatus: 'failed',
            error: message,
          });
        }
      }

      try {
        await sweepGrantsByCourseRunForApplications(ids);
      } catch (err) {
        console.warn('[ca-resume] Grant sweep failed after resume:', err instanceof Error ? err.message : err);
      }

      let invoice: ResumeResult['invoice'] = null;
      try {
        const summary = await generateInvoicesForApplications(ids);
        invoice = {
          generated: summary.generated,
          skippedAlreadyInvoiced: summary.skippedAlreadyInvoiced,
          skippedNotEnrolled: summary.skippedNotEnrolled,
          skippedAwaitingGrants: summary.skippedAwaitingGrants,
          failed: summary.failed,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ca-resume] Invoice sweep crashed:', err);
        errors.push({ id: 'invoice_sweep', error: message });
      }

      let email: ResumeResult['email'] = null;
      try {
        const emailSummary = await sendCompanyApplicationInvoiceEmails(ids);
        email = {
          sent: emailSummary.sent,
          skippedAlreadySent: emailSummary.skippedAlreadySent,
          skippedMissingEmail: emailSummary.skippedMissingEmail,
          skippedNoInvoice: emailSummary.skippedNoInvoice,
          skippedNotVerified: emailSummary.skippedNotVerified,
          failed: emailSummary.failed,
          toggleDisabled: emailSummary.toggleDisabled,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ca-resume] Invoice email sweep crashed:', err);
        errors.push({ id: 'email_sweep', error: message });
      }

      await finaliseAutoEnrolStatus(ids);

      const enroled = rowResults.filter(r => !!r.enrolmentId).length;
      const granted = rowResults.filter(r => !!r.grantId).length;
      const failed = rowResults.filter(r => !r.success).length + errors.filter(e => !ids.includes(e.id)).length;

      return {
        success: true,
        considered: ids.length,
        processed: rowResults.length,
        enroled,
        granted,
        failed,
        invoice,
        email,
        errors,
      };
    });

    if (result) return result;
    return {
      success: false,
      considered: 0,
      processed: 0,
      enroled: 0,
      granted: 0,
      failed: 0,
      invoice: null,
      email: null,
      message: 'Skipped: another process is already resuming company applications.',
      errors: [],
    };
  } finally {
    globals.__caResumeRunning = false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const expectedKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.body?.authKey;
  if (expectedKey && apiKey !== expectedKey && !req.headers['x-internal-scheduler']) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const limit = Number(req.body?.limit ?? req.query.limit ?? DEFAULT_LIMIT);
    const result = await runAutomation(Number.isFinite(limit) ? limit : DEFAULT_LIMIT);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[ca-resume] Fatal error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
