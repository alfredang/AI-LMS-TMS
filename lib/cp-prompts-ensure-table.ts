import pool from './db';

// Idempotent startup migration for the CP Generator prompt-template editor.
// Runs once from instrumentation.ts so deployments without a prior `npm run
// db:migrate` step still end up with the `cp_prompt_template` table and the
// editor works out of the box. Kept inline (rather than reading
// database/migrations/*.sql at runtime) so the Next.js standalone build
// doesn't need to ship the SQL file.

const DDL = `
CREATE TABLE IF NOT EXISTS public.cp_prompt_template (
  section       text PRIMARY KEY,
  template      text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_by    uuid REFERENCES public.app_user(id) ON DELETE SET NULL
);
`;

export async function ensureCpPromptTemplateTable(): Promise<void> {
  try {
    await pool.query(DDL);
    console.log('[CP] cp_prompt_template table ensured');
  } catch (err: any) {
    console.error('[CP] Failed to ensure cp_prompt_template table:', err?.message ?? err);
  }
}
