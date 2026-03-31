import pool from './db';

export interface TrainingPartnerIdentifiers {
  uen: string;
  code: string;
  name: string;
  defaultPassword: string;
}

let cached: TrainingPartnerIdentifiers | null = null;

/**
 * Fetches the training partner UEN, code, and name from the database.
 * Falls back to env vars, then to empty strings.
 * Result is cached for the lifetime of the process.
 */
export async function getTrainingPartnerIdentifiers(): Promise<TrainingPartnerIdentifiers> {
  if (cached) return cached;

  try {
    const result = await pool.query(
      `SELECT uen, company_name, default_password FROM training_provider WHERE uen IS NOT NULL LIMIT 1`
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const uen = row.uen || process.env.TRAINING_PARTNER_UEN || '';
      cached = {
        uen,
        code: uen ? `${uen}-01` : (process.env.TRAINING_PARTNER_CODE || ''),
        name: row.company_name || process.env.TRAINING_PROVIDER_NAME || '',
        defaultPassword: row.default_password || process.env.DEFAULT_PASSWORD || 'changeme',
      };
      return cached;
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch training partner identifiers from DB:', error);
  }

  // Fallback to env vars
  const uen = process.env.TRAINING_PARTNER_UEN || '';
  cached = {
    uen,
    code: process.env.TRAINING_PARTNER_CODE || (uen ? `${uen}-01` : ''),
    name: process.env.TRAINING_PROVIDER_NAME || '',
    defaultPassword: process.env.DEFAULT_PASSWORD || 'changeme',
  };
  return cached;
}
