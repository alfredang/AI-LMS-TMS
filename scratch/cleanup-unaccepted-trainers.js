require('dotenv').config({ path: '.env.local' });
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.env.DRY_RUN !== 'false';

async function main() {
  console.log(`\n🧹 Cleanup Unaccepted Trainers (${DRY_RUN ? 'DRY RUN' : '⚠️  LIVE MODE'})\n`);

  // Find all course runs where the current "assigned" trainers (TPG or Local)
  // actually have a pending or declined invitation.
  const unaccepted = await pool.query(`
    SELECT cr.id AS course_run_uuid, cr.course_run_id, c.title,
           cr.tpg_assigned_trainer_name, cr.tpg_assigned_trainer_email,
           cr.assigned_trainer_name, cr.assigned_trainer_email,
           ti.trainer_name, ti.trainer_email, ti.status
    FROM trainer_invitation ti
    JOIN course_run cr ON cr.id = ti.course_run_id
    JOIN course c ON c.id = cr.course_id
    WHERE ti.status IN ('pending', 'declined')
  `);

  let fixed = 0;

  for (const row of unaccepted.rows) {
    const actions = [];
    const trainerNameLower = (row.trainer_name || '').toLowerCase().trim();
    const trainerEmailLower = (row.trainer_email || '').toLowerCase().trim();

    // 1. Check if they are in course_run_trainer
    const crt = await pool.query(
      `SELECT id, trainer_name, trainer_email FROM course_run_trainer WHERE course_run_id = $1`,
      [row.course_run_uuid]
    );
    for (const t of crt.rows) {
      if ((t.trainer_name || '').toLowerCase().trim() === trainerNameLower ||
          (t.trainer_email || '').toLowerCase().trim() === trainerEmailLower) {
        actions.push(`DELETE course_run_trainer for "${t.trainer_name}"`);
        if (!DRY_RUN) {
          await pool.query(`DELETE FROM course_run_trainer WHERE id = $1`, [t.id]);
        }
      }
    }

    // 2. Check Legacy Local Trainer
    const legacyName = (row.assigned_trainer_name || '').toLowerCase().trim();
    const legacyEmail = (row.assigned_trainer_email || '').toLowerCase().trim();
    if ((legacyName && legacyName === trainerNameLower) || (legacyEmail && legacyEmail === trainerEmailLower)) {
      actions.push(`CLEAR legacy assigned_trainer (was "${row.assigned_trainer_name}")`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE course_run SET assigned_trainer_name = NULL, assigned_trainer_email = NULL, assigned_trainer_id = NULL, updated_at = NOW() WHERE id = $1`,
          [row.course_run_uuid]
        );
      }
    }

    // 3. Check TPG Trainer
    const tpgName = (row.tpg_assigned_trainer_name || '').toLowerCase().trim();
    const tpgEmail = (row.tpg_assigned_trainer_email || '').toLowerCase().trim();
    if ((tpgName && tpgName === trainerNameLower) || (tpgEmail && tpgEmail === trainerEmailLower)) {
      actions.push(`CLEAR TPG assigned_trainer (was "${row.tpg_assigned_trainer_name}")`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE course_run SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
          [row.course_run_uuid]
        );
      }
    }

    if (actions.length > 0) {
      fixed++;
      console.log(`📌 ${row.course_run_id} | "${row.title}"`);
      console.log(`   Trainer: "${row.trainer_name}" (Status: ${row.status})`);
      for (const a of actions) {
        console.log(`   ${DRY_RUN ? '→ WOULD' : '✅ DID'}: ${a}`);
      }
      console.log('');
    }
  }

  console.log(`${DRY_RUN ? '🔍 DRY RUN' : '✅ DONE'}: ${fixed} course run(s) need fixing.`);
  if (DRY_RUN && fixed > 0) {
    console.log(`\nRun with DRY_RUN=false to apply:\n  DRY_RUN=false node scratch/cleanup-unaccepted-trainers.js\n`);
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
