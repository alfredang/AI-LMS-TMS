import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { ensureEmployerQboAliasTable } from '../../../lib/employerQboAliasTable';
import { qboQuery } from '../../../lib/services/qboInvoiceService';

/**
 * GET /api/admin/list-employers
 *
 * Employers for the Enroll Learners (Company Application) dropdown, merged from:
 *   1. QuickBooks customers — authoritative billing names (an employer MUST be
 *      a QBO customer for the CA invoice to succeed). QBO gives us name / email
 *      / phone, but NOT the UEN or contact designation (not QBO fields).
 *   2. Our own Company Application history — carries UEN + designation + contact.
 *   3. The employer_qbo_alias map (UEN ↔ QBO DisplayName) to link the two.
 *
 * Deduped by normalized organisation name. Picking a "both" or "history" entry
 * fully auto-fills; a QB-only entry auto-fills name/email/phone and the admin
 * types the UEN once. Read-only.
 */
export interface EmployerOption {
  id: string;
  employerUen: string;
  employerOrgName: string;
  employerContactName: string;
  employerContactDesignation: string;
  employerContactEmail: string;
  employerContactPhone: string;
  source: 'qb' | 'history' | 'both';
}

const norm = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    await ensureCompanyApplicationsTable();
    await ensureEmployerQboAliasTable();

    const byName = new Map<string, EmployerOption>();

    // 1. Company Application history — one row per organisation NAME (UEN may be
    //    blank on older rows, so we key on the name, not the UEN), freshest
    //    contact details win. Only columns the CA upload actually writes are
    //    referenced (employer_name / employer_phone don't exist on all DBs).
    const historyRes = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (LOWER(TRIM(employer_org_name)))
                COALESCE(TRIM(employer_uen), '')                      AS employer_uen,
                TRIM(employer_org_name)                               AS employer_org_name,
                COALESCE(TRIM(employer_contact_name), '')             AS employer_contact_name,
                COALESCE(TRIM(employer_contact_designation), '')      AS employer_contact_designation,
                COALESCE(TRIM(employer_contact_email), '')            AS employer_contact_email,
                COALESCE(TRIM(employer_contact_phone), '')            AS employer_contact_phone
           FROM public.company_application
          WHERE employer_org_name IS NOT NULL AND TRIM(employer_org_name) <> ''
          ORDER BY LOWER(TRIM(employer_org_name)), updated_at DESC NULLS LAST
       ) e`
    );
    for (const r of historyRes.rows as any[]) {
      const name = String(r.employer_org_name || '').trim();
      if (!name) continue;
      byName.set(norm(name), {
        id: norm(name),
        employerUen: r.employer_uen,
        employerOrgName: name,
        employerContactName: r.employer_contact_name,
        employerContactDesignation: r.employer_contact_designation,
        employerContactEmail: r.employer_contact_email,
        employerContactPhone: r.employer_contact_phone,
        source: 'history',
      });
    }

    // 2. UEN ↔ QBO DisplayName alias map (keyed by lowercased display name).
    const uenByDisplay = new Map<string, string>();
    try {
      const aliasRes = await pool.query(`SELECT employer_uen, qbo_display_name FROM public.employer_qbo_alias`);
      for (const a of aliasRes.rows as any[]) {
        const dn = norm(a.qbo_display_name);
        if (dn && a.employer_uen) uenByDisplay.set(dn, String(a.employer_uen).trim());
      }
    } catch { /* alias table optional */ }

    // 3. QuickBooks customers (best-effort — if QBO isn't configured, we still
    //    return the history list rather than failing the dropdown).
    //    QBO caps a single Customer query at 1000 rows and orders by Id ascending,
    //    so a realm with >1000 customers would silently drop the NEWEST ones
    //    (highest Id) — exactly the just-created employer an admin is looking for.
    //    Page through with STARTPOSITION until a short page comes back.
    try {
      const PAGE = 1000;
      const customers: any[] = [];
      let startPosition = 1;
      // Hard stop at 50k customers so a QBO quirk can never spin forever.
      for (let guard = 0; guard < 50; guard++) {
        const data = await qboQuery(
          undefined,
          `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${PAGE}`
        );
        const batch: any[] = data?.QueryResponse?.Customer || [];
        if (batch.length === 0) break;
        customers.push(...batch);
        if (batch.length < PAGE) break;
        startPosition += PAGE;
      }
      for (const c of customers) {
        const name = String(c.DisplayName || c.CompanyName || '').trim();
        if (!name) continue;
        const key = norm(name);
        const email = String(c.PrimaryEmailAddr?.Address || '').trim();
        const phone = String(c.PrimaryPhone?.FreeFormNumber || '').trim();
        const aliasUen = uenByDisplay.get(key) || '';

        const existing = byName.get(key);
        if (existing) {
          existing.source = 'both';
          existing.employerOrgName = name; // prefer QBO's exact DisplayName (what the invoice matches on)
          if (!existing.employerContactEmail) existing.employerContactEmail = email;
          if (!existing.employerContactPhone) existing.employerContactPhone = phone;
          if (!existing.employerUen && aliasUen) existing.employerUen = aliasUen;
        } else {
          byName.set(key, {
            id: key,
            employerUen: aliasUen,
            employerOrgName: name,
            employerContactName: '',
            employerContactDesignation: '',
            employerContactEmail: email,
            employerContactPhone: phone,
            source: 'qb',
          });
        }
      }
    } catch (qbErr: any) {
      console.warn('list-employers: QBO customer fetch skipped —', qbErr?.message || qbErr);
    }

    const employers = Array.from(byName.values()).sort((a, b) =>
      a.employerOrgName.toLowerCase().localeCompare(b.employerOrgName.toLowerCase())
    );

    return res.status(200).json({ success: true, employers });
  } catch (err: any) {
    console.error('list-employers error:', err);
    return res.status(500).json({ success: false, message: err?.message || 'Failed to load employers' });
  }
}
