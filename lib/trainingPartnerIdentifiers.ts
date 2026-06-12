import pool from './db';

export interface TrainingPartnerIdentifiers {
  uen: string;
  code: string;
  name: string;
  companyShortname: string;
  defaultPassword: string;
  companyWebsite: string;
  companyEmail: string;
  supportEmail: string;
  contactTel: string;
  companyAddress: string;
  siteUrl: string;
}

let cached: TrainingPartnerIdentifiers | null = null;

/** Clear the cached identifiers so the next call re-fetches from DB. */
export function clearTrainingPartnerCache() {
  cached = null;
}

/**
 * Fetches the training partner UEN, code, name, and contact details from the
 * training_provider table. UEN is the source of truth; code is auto-derived
 * as `${uen}-01`. Result is cached for the lifetime of the process.
 */
export async function getTrainingPartnerIdentifiers(): Promise<TrainingPartnerIdentifiers> {
  if (cached) return cached;

  try {
    const result = await pool.query(
      `SELECT uen, company_name, company_shortname, default_password, company_website,
              company_email, support_email, contact_tel, company_tel, company_address
       FROM training_provider WHERE uen IS NOT NULL LIMIT 1`
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const uen = row.uen || '';
      cached = {
        uen,
        code: uen ? `${uen}-01` : '',
        name: row.company_name || '',
        companyShortname: row.company_shortname || row.company_name || '',
        defaultPassword: row.default_password || 'changeme',
        companyWebsite: row.company_website || '',
        companyEmail: row.company_email || '',
        supportEmail: row.support_email || row.company_email || '',
        contactTel: row.contact_tel || row.company_tel || '',
        companyAddress: row.company_address || '',
        siteUrl: process.env.NEXT_PUBLIC_BASE_URL || '',
      };
      return cached;
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch training partner identifiers from DB:', error);
  }

  // DB has no rows (or query failed) — return empty identifiers so callers
  // can degrade gracefully instead of throwing.
  cached = {
    uen: '',
    code: '',
    name: '',
    companyShortname: '',
    defaultPassword: 'changeme',
    companyWebsite: '',
    companyEmail: '',
    supportEmail: '',
    contactTel: '',
    companyAddress: '',
    siteUrl: process.env.NEXT_PUBLIC_BASE_URL || '',
  };
  return cached;
}
