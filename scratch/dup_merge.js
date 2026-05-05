require('dotenv').config({ path: '/Users/alfredang/projects/tertiary/ai-lms-tms/.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, keepAlive: true, statement_timeout: 30000, query_timeout: 30000 });
p.on('error', (err) => { console.error('Pool error (non-fatal):', err.message); });

const PRIVILEGED = ['Admin', 'TrainingProvider', 'Finance', 'Payroll', 'Trainer', 'Developer'];
const toArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v.startsWith('{') ? v.slice(1,-1).split(',').filter(Boolean) : []);
const isPriv = (roles) => toArr(roles).some((x) => PRIVILEGED.includes(x));

// Tables with FK to app_user.id and the column they use.
// For tables with a unique constraint that includes the user-fk column, we list the OTHER key columns
// so we can delete loser-side conflicts before reassigning.
const FK_TABLES = [
  // (table, fk_col, conflict_key_extra_cols_or_null)
  ['admin_profile',           'user_id',  []], // PK = user_id alone
  ['developer_profile',       'user_id',  []],
  ['finance_profile',         'user_id',  []],
  ['learner_profile',         'user_id',  []],
  ['trainer_profile',         'user_id',  []],
  ['enrollment',              'user_id',  ['course_run_id']],
  ['provider_admin_user',     'user_id',  ['provider_id']],
  ['training_provider_member','user_id',  ['provider_id']],
  ['user_role_map',           'user_id',  ['role']],
  ['user_saved_job',          'user_id',  ['job_posting_id']],
  ['user_subtopic_bookmark',  'user_id',  ['subtopic_id','course_run_id']],
  // No conflict-prone unique key on user_id:
  ['course_attendance',       'user_id',  null],
  ['quiz_attempt',            'user_id',  null],
  ['link_assessment_submission','user_id',null],
  ['support_ticket',          'user_id',  null],
  ['support_ticket_reply',    'user_id',  null],
  ['chat_conversation',       'user_id',  null],
  ['cp_prompt_template',      'updated_by', null],
  ['trainer_payout',          'updated_by', null],
];

async function pickSurvivor(client, ids) {
  const detail = await client.query(`
    SELECT u.id, u.email, u.secondary_email, u.updated_at,
      COALESCE((SELECT array_agg(role::text) FROM user_role_map WHERE user_id = u.id), ARRAY[]::text[]) AS roles,
      (SELECT COUNT(*) FROM enrollment WHERE user_id = u.id)::int AS enr,
      (SELECT COUNT(*) FROM course_attendance WHERE user_id = u.id)::int AS att,
      (SELECT COUNT(*) FROM quiz_attempt WHERE user_id = u.id)::int AS quiz,
      (SELECT COUNT(*) FROM trainer_profile WHERE user_id = u.id)::int AS tp,
      (SELECT COUNT(*) FROM admin_profile WHERE user_id = u.id)::int AS ap,
      (SELECT COUNT(*) FROM finance_profile WHERE user_id = u.id)::int AS fp,
      (SELECT COUNT(*) FROM developer_profile WHERE user_id = u.id)::int AS dp,
      (SELECT COUNT(*) FROM learner_profile WHERE user_id = u.id)::int AS lp
    FROM app_user u WHERE u.id = ANY($1)
  `, [ids]);
  detail.rows.sort((a, b) => {
    const aPriv = isPriv(a.roles) ? 1 : 0;
    const bPriv = isPriv(b.roles) ? 1 : 0;
    if (aPriv !== bPriv) return bPriv - aPriv;
    const aAct = a.enr + a.att + a.quiz + a.tp + a.ap + a.fp + a.dp + a.lp;
    const bAct = b.enr + b.att + b.quiz + b.tp + b.ap + b.fp + b.dp + b.lp;
    if (aAct !== bAct) return bAct - aAct;
    const aT = new Date(a.updated_at).getTime();
    const bT = new Date(b.updated_at).getTime();
    if (aT !== bT) return bT - aT;
    return a.id < b.id ? -1 : 1;
  });
  return { survivor: detail.rows[0], loser: detail.rows[1] };
}

(async () => {
  const c = await p.connect();
  try {
    // ---- 1. BACKUP (skip on resume — log table presence indicates prior run) ----
    const resumeCheck = await c.query(`SELECT to_regclass('public.merged_user_log') IS NOT NULL AS exists`);
    const logExists = resumeCheck.rows[0].exists;
    if (logExists) {
      const existing = await c.query(`SELECT COUNT(*) FROM merged_user_log`);
      if (parseInt(existing.rows[0].count) > 0) {
        console.log(`[1/3] Resume mode — skipping backup (${existing.rows[0].count} prior merges in log)`);
      }
    }
    if (!logExists || parseInt((await c.query(`SELECT COUNT(*) FROM merged_user_log WHERE 1=1`).catch(()=>({rows:[{count:'0'}]}))).rows[0].count) === 0) {
    console.log('[1/3] Creating backup tables...');
    await c.query(`CREATE SCHEMA IF NOT EXISTS dup_merge_backup_20260505`);
    await c.query(`CREATE TABLE IF NOT EXISTS dup_merge_backup_20260505.app_user_snapshot AS SELECT * FROM public.app_user WHERE 1=0`);
    // Snapshot only rows involved in any duplicate group
    await c.query(`
      INSERT INTO dup_merge_backup_20260505.app_user_snapshot
      SELECT * FROM public.app_user WHERE LOWER(email) IN (
        SELECT LOWER(email) FROM public.app_user GROUP BY LOWER(email) HAVING COUNT(*)>1
      )
      ON CONFLICT DO NOTHING
    `);
    const snap = await c.query(`SELECT COUNT(*) FROM dup_merge_backup_20260505.app_user_snapshot`);
    console.log(`  Snapshot rows: ${snap.rows[0].count}`);

    // Backup rows from each FK table that belong to any user in a duplicate group
    for (const [tbl, col] of FK_TABLES) {
      await c.query(`CREATE TABLE IF NOT EXISTS dup_merge_backup_20260505.${tbl} AS SELECT * FROM public.${tbl} WHERE 1=0`);
      await c.query(`
        INSERT INTO dup_merge_backup_20260505.${tbl}
        SELECT * FROM public.${tbl} WHERE ${col} IN (
          SELECT id FROM public.app_user WHERE LOWER(email) IN (
            SELECT LOWER(email) FROM public.app_user GROUP BY LOWER(email) HAVING COUNT(*)>1
          )
        )
      `);
    }
    console.log('  Backup complete.');
    } // end resume guard

    // ---- 2. AUDIT LOG TABLE ----
    await c.query(`
      CREATE TABLE IF NOT EXISTS public.merged_user_log (
        id serial PRIMARY KEY,
        survivor_id uuid NOT NULL,
        survivor_email_before text,
        survivor_email_after text,
        loser_id uuid NOT NULL,
        loser_email text,
        fk_moves jsonb,
        merged_at timestamptz DEFAULT now()
      )
    `);

    // ---- 3. MERGE PAIRS ----
    const dups = await c.query(`
      SELECT LOWER(email) AS lem, array_agg(id ORDER BY id) AS ids
      FROM app_user GROUP BY LOWER(email) HAVING COUNT(*)>1
    `);
    console.log(`[2/3] Merging ${dups.rows.length} pairs...`);

    let merged = 0, skipped = 0;
    const errors = [];

    for (const g of dups.rows) {
      try {
        await c.query('BEGIN');
        const { survivor, loser } = await pickSurvivor(c, g.ids);

        // Skip if survivor has a different secondary_email already (manual review)
        if (survivor.secondary_email && survivor.secondary_email.toLowerCase() !== loser.email.toLowerCase()) {
          await c.query('ROLLBACK');
          skipped++;
          errors.push({ email: g.lem, reason: 'survivor has conflicting secondary_email', survivor: survivor.email, loser: loser.email });
          continue;
        }

        const fkMoves = {};

        for (const [tbl, col, conflictKeys] of FK_TABLES) {
          if (conflictKeys && conflictKeys.length === 0) {
            // user_id is the entire unique key — keep survivor's row, delete loser's
            const r = await c.query(`DELETE FROM public.${tbl} WHERE ${col} = $1 RETURNING 1`, [loser.id]);
            if (r.rowCount) fkMoves[tbl] = { deleted_loser: r.rowCount };
          } else if (conflictKeys && conflictKeys.length > 0) {
            // delete loser-side rows that would conflict on the unique key
            const keyExpr = conflictKeys.join(', ');
            const del = await c.query(`
              DELETE FROM public.${tbl}
              WHERE ${col} = $1
                AND (${keyExpr}) IN (SELECT ${keyExpr} FROM public.${tbl} WHERE ${col} = $2)
              RETURNING 1
            `, [loser.id, survivor.id]);
            const upd = await c.query(`UPDATE public.${tbl} SET ${col} = $1 WHERE ${col} = $2 RETURNING 1`, [survivor.id, loser.id]);
            if (del.rowCount || upd.rowCount) fkMoves[tbl] = { deleted_dup: del.rowCount, reassigned: upd.rowCount };
          } else {
            // no unique conflict possible
            const r = await c.query(`UPDATE public.${tbl} SET ${col} = $1 WHERE ${col} = $2 RETURNING 1`, [survivor.id, loser.id]);
            if (r.rowCount) fkMoves[tbl] = { reassigned: r.rowCount };
          }
        }

        const survivorEmailBefore = survivor.email;
        const survivorEmailAfter = survivor.email.toLowerCase();
        const loserEmailCaptured = loser.email;

        // Delete loser FIRST so its email doesn't collide when we lowercase the survivor's
        await c.query(`DELETE FROM public.app_user WHERE id = $1`, [loser.id]);

        // Then update survivor: lowercase email + record loser's casing as secondary
        await c.query(`
          UPDATE public.app_user
          SET secondary_email = COALESCE(secondary_email, $1),
              email = $2,
              updated_at = now()
          WHERE id = $3
        `, [loserEmailCaptured, survivorEmailAfter, survivor.id]);

        // Audit log
        await c.query(`
          INSERT INTO public.merged_user_log
            (survivor_id, survivor_email_before, survivor_email_after, loser_id, loser_email, fk_moves)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [survivor.id, survivorEmailBefore, survivorEmailAfter, loser.id, loser.email, fkMoves]);

        await c.query('COMMIT');
        merged++;
        if (merged % 25 === 0) console.log(`  merged ${merged}/${dups.rows.length}`);
      } catch (e) {
        await c.query('ROLLBACK').catch(()=>{});
        skipped++;
        errors.push({ email: g.lem, reason: e.message });
      }
    }

    console.log(`[3/3] Done. merged=${merged}, skipped=${skipped}`);
    if (errors.length) {
      console.log('--- skipped/errored pairs ---');
      console.table(errors);
      fs.writeFileSync('/tmp/dup_merge_errors.json', JSON.stringify(errors, null, 2));
      console.log('Errors saved to /tmp/dup_merge_errors.json');
    }

    // Verify no remaining duplicates
    const left = await c.query(`SELECT COUNT(*) FROM (SELECT 1 FROM app_user GROUP BY LOWER(email) HAVING COUNT(*)>1) x`);
    console.log(`Remaining case-insensitive duplicate groups: ${left.rows[0].count}`);
  } finally {
    c.release();
    await p.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
