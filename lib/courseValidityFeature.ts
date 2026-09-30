import pool from '@lib/db';

/** Missing flag/row or a database error leaves the enhanced view disabled. */
export async function isCourseValidityTpgEnabled(): Promise<boolean> {
  try {
    // Reading the row as JSON also works on customer schemas that predate the flag.
    const result = await pool.query(`
      SELECT COALESCE(to_jsonb(tp)->>'course_validity_tpg_enabled', 'false') = 'true' AS enabled
      FROM training_provider tp
      ORDER BY id
      LIMIT 1
    `);
    return result.rows[0]?.enabled === true;
  } catch (error) {
    console.warn('[course-validity] could not read feature flag:', error instanceof Error ? error.message : error);
    return false;
  }
}
