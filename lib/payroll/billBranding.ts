/**
 * Company branding for the trainer bill PDF, read from `training_provider`.
 *
 * Deliberately sourced from the tenant's own row rather than hardcoded or read
 * from QuickBooks CompanyInfo:
 *  - it is per-tenant, so a second deployment brands its own documents;
 *  - it already backs the certificate/notification emails, so the letterhead
 *    stays consistent across everything the Academy sends out;
 *  - it matches what QuickBooks prints. The registration number in particular
 *    (`uen`) is NOT exposed anywhere in the QBO Accounting API — CompanyInfo's
 *    NameValue list does not carry it — so the DB is the only programmatic
 *    source for the "Company Registration No." line QBO shows on a bill.
 */

import fs from 'fs/promises';
import path from 'path';
import pool from '../db';

export interface BillBranding {
  companyName: string;
  addressLines: string[];
  tel: string | null;
  email: string | null;
  website: string | null;
  registrationNo: string | null;
  /** PNG/JPG bytes for the letterhead logo, when one could be loaded. */
  logo: { bytes: Buffer; kind: 'png' | 'jpg' } | null;
}

/**
 * Resolve `company_logo_url` to bytes. Handles the stored form
 * ("/uploads/training_provider/company_logo/x.png" → public/…) and absolute
 * URLs. Best-effort: a missing or unreadable logo just means a text-only
 * letterhead, never a failed bill.
 */
async function loadLogo(rawUrl: string | null): Promise<BillBranding['logo']> {
  const url = (rawUrl || '').trim();
  if (!url) return null;

  const kindOf = (s: string): 'png' | 'jpg' | null =>
    /\.png(\?|$)/i.test(s) ? 'png' : /\.jpe?g(\?|$)/i.test(s) ? 'jpg' : null;
  const kind = kindOf(url);
  if (!kind) return null; // pdf-lib embeds PNG and JPEG only

  try {
    if (/^https?:\/\//i.test(url)) {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return { bytes: Buffer.from(await resp.arrayBuffer()), kind };
    }
    // Stored as a site-root path; the files live under public/.
    const rel = url.replace(/^\/+/, '');
    const file = path.join(process.cwd(), 'public', rel);
    return { bytes: await fs.readFile(file), kind };
  } catch (e) {
    console.warn('[payroll] bill logo could not be loaded:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Split a free-text address into printable lines (commas or newlines). */
function addressToLines(raw: string | null): string[] {
  return String(raw || '')
    .split(/\r?\n|,(?=\s*[^,]{3,})/)
    .map((s) => s.trim().replace(/,$/, ''))
    .filter(Boolean)
    .slice(0, 5);
}

export async function loadBillBranding(): Promise<BillBranding> {
  try {
    const r = await pool.query(
      `SELECT company_name, company_address, company_tel, contact_tel,
              company_email, support_email, company_website, uen, company_logo_url
         FROM training_provider ORDER BY id LIMIT 1`
    );
    const tp = r.rows[0] || {};
    return {
      companyName: (tp.company_name || '').trim() || 'Training Provider',
      addressLines: addressToLines(tp.company_address),
      tel: (tp.company_tel || tp.contact_tel || '').trim() || null,
      email: (tp.company_email || tp.support_email || '').trim() || null,
      website: (tp.company_website || '').trim() || null,
      registrationNo: (tp.uen || '').trim() || null,
      logo: await loadLogo(tp.company_logo_url),
    };
  } catch (e) {
    console.warn('[payroll] bill branding unavailable:', e instanceof Error ? e.message : e);
    return {
      companyName: 'Training Provider',
      addressLines: [],
      tel: null,
      email: null,
      website: null,
      registrationNo: null,
      logo: null,
    };
  }
}
