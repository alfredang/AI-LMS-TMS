import pool from './db';

export const DEFAULT_DIRECT_APPLICATION_INTAKE_SIZE = 50;
export const DEFAULT_DIRECT_APPLICATION_THRESHOLD = 20;

export type DirectApplicationInstantConfirmSettings = {
  intakeSize: number;
  threshold: number;
};

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function normalizeDirectApplicationInstantConfirmSettings(settings?: any): DirectApplicationInstantConfirmSettings {
  return {
    intakeSize: positiveInt(settings?.directApplicationIntakeSize, DEFAULT_DIRECT_APPLICATION_INTAKE_SIZE),
    threshold: positiveInt(settings?.directApplicationThreshold, DEFAULT_DIRECT_APPLICATION_THRESHOLD),
  };
}

export async function getDirectApplicationInstantConfirmSettings(): Promise<DirectApplicationInstantConfirmSettings> {
  const result = await pool.query(
    `SELECT admin_settings
       FROM training_provider
      LIMIT 1`
  );
  return normalizeDirectApplicationInstantConfirmSettings(result.rows[0]?.admin_settings);
}
