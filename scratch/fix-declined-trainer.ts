/**
 * One-off fix: Clear trainer assignment for trainers who declined
 * but are still showing as assigned (due to the old code not cleaning up).
 *
 * Usage: npx ts-node scratch/fix-declined-trainer.ts
 *
 * What it does:
 *   1. Finds all trainer_invitation rows with status='declined'
 *   2. For each, checks if that trainer is still assigned (via course_run_trainer,
 *      tpg_assigned_trainer_name, or assigned_trainer_name)
 *   3. Clears the stale assignment
 *
 * Pass DRY_RUN=false to actually apply changes (default is dry run).
 */

import pool from '../lib/db';

const DRY_RUN = process.env.DRY_RUN !== 'false';

async function main() {
  console.log(`\n🔧 Fix Declined Trainer Assignments (${DRY_RUN ? 'DRY RUN' : '⚠️  LIVE MODE'})\n`);

  // Find all declined invitations
  const declined = await pool.query(`
    SELECT ti.course_run_id, ti.trainer_name, ti.trainer_email,
           cr.course_run_id AS external_course_run_id,
           cr.tpg_assigned_trainer_name, cr.tpg_assigned_trainer_email,
           cr.assigned_trainer_name, cr.assigned_trainer_email
    FROM trainer_invitation ti
    JOIN course_run cr ON cr.id = ti.course_run_id
    WHERE ti.status = 'declined'
    ORDER BY ti.responded_at DESC
  `);

  console.log(`Found ${declined.rows.length} declined invitation(s)\n`);

  let fixed = 0;

  for (const row of declined.rows) {
    const actions: string[] = [];

    // Check course_run_trainer junction
    const crt = await pool.query(
      `SELECT id FROM course_run_trainer
       WHERE course_run_id = $1 AND LOWER(trainer_email) = LOWER($2)`,
      [row.course_run_id, row.trainer_email]
    );
    if (crt.rows.length > 0) {
      actions.push(`DELETE course_run_trainer (${crt.rows.length} row(s))`);
      if (!DRY_RUN) {
        await pool.query(
          `DELETE FROM course_run_trainer WHERE course_run_id = $1 AND LOWER(trainer_email) = LOWER($2)`,
          [row.course_run_id, row.trainer_email]
        );
      }
    }

    // Check TPG assignment
    const tpgMatch =
      (row.tpg_assigned_trainer_email && row.trainer_email &&
        row.tpg_assigned_trainer_email.toLowerCase() === row.trainer_email.toLowerCase()) ||
      (row.tpg_assigned_trainer_name && row.trainer_name &&
        row.tpg_assigned_trainer_name.toLowerCase() === row.trainer_name.toLowerCase());
    if (tpgMatch) {
      actions.push(`CLEAR tpg_assigned_trainer (was "${row.tpg_assigned_trainer_name}")`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE course_run SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL,
                                tpg_sync_status = 'declined', updated_at = NOW()
           WHERE id = $1`,
          [row.course_run_id]
        );
      }
    }

    // Check legacy assignment
    const legacyMatch =
      (row.assigned_trainer_email && row.trainer_email &&
        row.assigned_trainer_email.toLowerCase() === row.trainer_email.toLowerCase()) ||
      (row.assigned_trainer_name && row.trainer_name &&
        row.assigned_trainer_name.toLowerCase() === row.trainer_name.toLowerCase());
    if (legacyMatch) {
      actions.push(`CLEAR assigned_trainer (was "${row.assigned_trainer_name}")`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE course_run SET assigned_trainer_name = NULL, assigned_trainer_email = NULL,
                                assigned_trainer_id = NULL, updated_at = NOW()
           WHERE id = $1`,
          [row.course_run_id]
        );
      }
    }

    if (actions.length > 0) {
      fixed++;
      console.log(`📌 ${row.external_course_run_id} | "${row.trainer_name}" (${row.trainer_email})`);
      for (const a of actions) {
        console.log(`   ${DRY_RUN ? '→ WOULD' : '✅ DID'}: ${a}`);
      }
    }
  }

  console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '✅ DONE'}: ${fixed} course run(s) need fixing out of ${declined.rows.length} declined invitation(s)`);
  if (DRY_RUN && fixed > 0) {
    console.log(`\nRun with DRY_RUN=false to apply:\n  DRY_RUN=false npx ts-node scratch/fix-declined-trainer.ts\n`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
