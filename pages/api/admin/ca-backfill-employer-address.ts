import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { qboReadCustomer, qboSparseUpdateCustomer } from '../../../lib/services/qboInvoiceService';
import { lookupAcraEntity, acraAddressFields } from '../../../lib/services/acraEntityLookup';

/**
 * GET  /api/admin/ca-backfill-employer-address   -> preview, changes nothing
 * POST /api/admin/ca-backfill-employer-address   -> apply
 *
 * Fill in the billing address on QuickBooks customers that have none, using the
 * employer UEN already on their Company Application rows and ACRA's open
 * register.
 *
 * Newly created customers get an address at creation now, but every employer
 * created before that has a customer record with an empty address, so their
 * invoices print a company name over blank space. This is the catch-up.
 *
 * NEVER OVERWRITES. A customer with any street, city or postal code already set
 * is skipped outright — an address Finance corrected by hand must not be
 * replaced by a registered one, which is often less precise (ACRA publishes the
 * street and postal code but no block or unit number).
 *
 * GET looks, POST acts, same split as ca-merge-invoices: a preview can never be
 * one typo away from writing to every customer in the realm.
 *
 * Capped per call because each employer costs one ACRA lookup plus one or two
 * QuickBooks calls, run in sequence. Walk it in batches rather than raising the
 * cap — QuickBooks rate-limits, and a half-finished run is safe to repeat since
 * anything already filled in is skipped on the next pass.
 */

const MAX_PER_CALL = 40;

/**
 * Hard ceiling on how many employers are EXAMINED, separate from how many are
 * updated.
 *
 * Examining one costs two QuickBooks calls whether or not it needs anything, so
 * a cap on updates alone is no cap at all: once most employers already have an
 * address — the normal state after the first run — nothing would ever hit the
 * update limit and the loop would walk every employer in the database, hundreds
 * of QuickBooks calls deep, in a single request.
 */
const MAX_EXAMINED_PER_CALL = 25;

/**
 * Wall-clock budget for the whole request.
 *
 * The count caps bound how MANY employers are touched, not how LONG that takes:
 * a run where QuickBooks is slow and several ACRA lookups stall can still sit
 * for minutes. It did — one preview held a request for 5.2 minutes, and while
 * it ran, other pages started failing with 500s because every connection in the
 * pool was waiting behind it.
 *
 * A sweep that can safely be repeated has no business holding a request that
 * long. It stops at the budget, says so, and you run it again.
 */
const TIME_BUDGET_MS = 40_000;

/** Bulk lookups get a short budget and no retry — the sweep is repeatable. */
const BULK_ACRA_OPTS = { timeoutMs: 3_500, attempts: 1 };

type Skip =
  | 'already_has_address'
  | 'not_in_quickbooks'
  | 'no_acra_match'
  | 'no_address_in_acra'
  | 'no_uen';

interface Candidate {
  employerUen: string;
  employerName: string;
  customerId: string;
  customerName: string;
  learners: number;
  /** Set when nothing will be done, and why. */
  skip?: Skip;
  /** The address that would be written. */
  address?: Record<string, string>;
  /** ACRA registration status, when known — "Struck Off" is worth seeing. */
  acraStatus?: string;
  applied?: boolean;
  error?: string;
}

const SKIP_REASON: Record<Skip, string> = {
  already_has_address: 'Already has an address in QuickBooks — left alone',
  not_in_quickbooks: 'Customer could not be read from QuickBooks',
  no_acra_match: 'UEN not found in the ACRA register',
  no_address_in_acra: 'ACRA holds no street or postal code for this UEN',
  no_uen: 'No employer UEN recorded',
};

/** True when the customer already has something worth keeping in BillAddr. */
function hasUsableAddress(raw: any): boolean {
  const a = raw?.BillAddr;
  if (!a) return false;
  const meaningful = [a.Line2, a.Line3, a.Line4, a.Line5, a.City, a.PostalCode]
    .map((v: unknown) => String(v ?? '').trim())
    .filter(Boolean);
  return meaningful.length > 0;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const isPreview = req.method === 'GET';
  const limitRaw = Number(isPreview ? req.query.limit : req.body?.limit);
  const limit = Math.min(MAX_PER_CALL, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : MAX_PER_CALL));

  try {
    await ensureCompanyApplicationsTable();

    // One row per employer that has actually been invoiced — the customer must
    // already exist in QuickBooks for there to be anything to fill in. The
    // QuickBooks id is not stored on the application, so it is resolved from
    // the invoice that was raised against it.
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(ca.employer_uen)))
              TRIM(ca.employer_uen)        AS employer_uen,
              ca.employer_org_name         AS employer_name,
              ca.invoice_id                AS invoice_id,
              COUNT(*) OVER (PARTITION BY LOWER(TRIM(ca.employer_uen))) AS learners
         FROM public.company_application ca
        WHERE COALESCE(ca.employer_uen, '') <> ''
          AND COALESCE(ca.invoice_id, '')   <> ''
        ORDER BY LOWER(TRIM(ca.employer_uen)), ca.created_at DESC`
    );

    const candidates: Candidate[] = [];
    let actionableSoFar = 0;
    let examined = 0;
    let stoppedEarly = false;
    const deadline = Date.now() + TIME_BUDGET_MS;

    for (const row of rows) {
      if (actionableSoFar >= limit) { stoppedEarly = true; break; }
      if (examined >= MAX_EXAMINED_PER_CALL) { stoppedEarly = true; break; }
      if (Date.now() > deadline) { stoppedEarly = true; break; }
      examined++;

      const employerUen = String(row.employer_uen || '').trim();
      const employerName = String(row.employer_name || '').trim();
      const base: Candidate = {
        employerUen,
        employerName,
        customerId: '',
        customerName: '',
        learners: Number(row.learners) || 0,
      };

      if (!employerUen) {
        candidates.push({ ...base, skip: 'no_uen' });
        continue;
      }

      // The customer id lives on the invoice this employer was billed through.
      let customerId = '';
      let customerRaw: any = null;
      try {
        const { qboReadInvoice } = await import('../../../lib/services/qboInvoiceService');
        const inv = await qboReadInvoice(undefined, String(row.invoice_id));
        customerId = String((inv?.raw as any)?.CustomerRef?.value || '').trim();
        if (customerId) {
          const cust = await qboReadCustomer(undefined, customerId);
          customerRaw = cust?.raw ?? null;
          base.customerId = customerId;
          base.customerName = String(customerRaw?.DisplayName || '').trim();
        }
      } catch (err) {
        candidates.push({ ...base, skip: 'not_in_quickbooks', error: err instanceof Error ? err.message : String(err) });
        continue;
      }

      if (!customerRaw) {
        candidates.push({ ...base, skip: 'not_in_quickbooks' });
        continue;
      }
      if (hasUsableAddress(customerRaw)) {
        candidates.push({ ...base, skip: 'already_has_address' });
        continue;
      }

      const entity = await lookupAcraEntity(employerUen, BULK_ACRA_OPTS);
      if (!entity) {
        candidates.push({ ...base, skip: 'no_acra_match' });
        continue;
      }
      const address = acraAddressFields(entity);
      if (!address) {
        candidates.push({ ...base, skip: 'no_address_in_acra', acraStatus: entity.status });
        continue;
      }

      candidates.push({ ...base, address, acraStatus: entity.status });
      actionableSoFar++;
    }

    const actionable = candidates.filter(c => !c.skip && c.address);

    if (isPreview) {
      return res.status(200).json({
        success: true,
        preview: true,
        wouldUpdate: actionable.length,
        examined,
        totalEmployers: rows.length,
        stoppedEarly,
        candidates,
        skippedCounts: Object.fromEntries(
          (Object.keys(SKIP_REASON) as Skip[]).map(k => [k, candidates.filter(c => c.skip === k).length])
        ),
        skipReasons: SKIP_REASON,
      });
    }

    let updated = 0;
    let failed = 0;
    const applyDeadline = Date.now() + TIME_BUDGET_MS;
    for (const c of actionable) {
      if (Date.now() > applyDeadline) { stoppedEarly = true; break; }
      try {
        const cust = await qboReadCustomer(undefined, c.customerId);
        if (!cust?.syncToken) {
          c.error = 'QuickBooks returned no sync token';
          failed++;
          continue;
        }
        // Re-check under the token we are about to write with: another process
        // may have set an address since the preview, and this must not be the
        // thing that overwrites it.
        if (hasUsableAddress(cust.raw)) {
          c.skip = 'already_has_address';
          continue;
        }
        await qboSparseUpdateCustomer(undefined, c.customerId, cust.syncToken, {
          BillAddr: { ...c.address },
        });
        c.applied = true;
        updated++;
        console.log(`[ca-address-backfill] ${c.customerName || c.employerName} (UEN ${c.employerUen}) -> ${c.address?.Line2 || ''} ${c.address?.PostalCode || ''}`.trim());
      } catch (err) {
        c.error = err instanceof Error ? err.message : String(err);
        failed++;
      }
    }

    return res.status(200).json({
      success: true,
      preview: false,
      updated,
      failed,
      stoppedEarly,
      candidates,
      message:
        `${updated} customer${updated === 1 ? '' : 's'} given an address` +
        (failed ? `, ${failed} failed` : '') +
        (stoppedEarly ? '. Stopped early to keep the request short — run again to continue.' : '.'),
    });
  } catch (err) {
    console.error('[ca-backfill-employer-address] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
