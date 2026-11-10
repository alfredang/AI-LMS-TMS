import pool from './db';

let ensurePromise: Promise<void> | null = null;

/**
 * Idempotent startup DDL — adds `course.casl_skills` on tenants that have not
 * yet run database/migrations/add_course_casl_skills.sql, so the read endpoints
 * that select it never fail on an older schema.
 */
export function ensureCaslSkillsColumn(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        // Check first: ALTER TABLE takes an exclusive lock on course even when
        // the column already exists, which would queue behind every open query.
        const { rowCount } = await pool.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'course' AND column_name = 'casl_skills'`
        );
        if (rowCount) return;
        await pool.query(`ALTER TABLE public.course ADD COLUMN IF NOT EXISTS casl_skills TEXT`);
      } catch (err: any) {
        console.error('[CASL] Failed to ensure course.casl_skills column:', err?.message ?? err);
        ensurePromise = null;
        throw err;
      }
    })();
  }
  return ensurePromise;
}
