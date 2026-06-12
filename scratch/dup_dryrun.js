require('dotenv').config({ path: '/Users/alfredang/projects/tertiary/ai-lms-tms/.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PRIVILEGED = ['Admin', 'TrainingProvider', 'Finance', 'Payroll', 'Trainer', 'Developer'];
const toArr = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v.startsWith('{') ? v.slice(1,-1).split(',').filter(Boolean) : []);
const isPriv = (roles) => toArr(roles).some((x) => PRIVILEGED.includes(x));

(async () => {
  const dups = await p.query(`
    SELECT LOWER(email) AS lem, array_agg(id ORDER BY id) AS ids
    FROM app_user GROUP BY LOWER(email) HAVING COUNT(*)>1
  `);

  const rows = [];
  for (const g of dups.rows) {
    const detail = await p.query(
      `
      SELECT u.id, u.email, u.secondary_email, u.account_status, u.updated_at,
        COALESCE((SELECT array_agg(role) FROM user_role_map WHERE user_id = u.id), '{}') AS roles,
        (SELECT COUNT(*) FROM enrollment WHERE user_id = u.id)::int AS enr,
        (SELECT COUNT(*) FROM course_attendance WHERE user_id = u.id)::int AS att,
        (SELECT COUNT(*) FROM quiz_attempt WHERE user_id = u.id)::int AS quiz,
        (SELECT COUNT(*) FROM trainer_profile WHERE user_id = u.id)::int AS tp,
        (SELECT COUNT(*) FROM admin_profile WHERE user_id = u.id)::int AS ap,
        (SELECT COUNT(*) FROM finance_profile WHERE user_id = u.id)::int AS fp,
        (SELECT COUNT(*) FROM developer_profile WHERE user_id = u.id)::int AS dp,
        (SELECT COUNT(*) FROM learner_profile WHERE user_id = u.id)::int AS lp
      FROM app_user u WHERE u.id = ANY($1)
    `,
      [g.ids]
    );

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

    const s = detail.rows[0];
    const l = detail.rows[1];
    const conflict =
      !!s.secondary_email && s.secondary_email.toLowerCase() !== l.email.toLowerCase();

    rows.push({
      email_lower: g.lem,
      survivor_id: s.id,
      survivor_email: s.email,
      survivor_roles: toArr(s.roles).join('|'),
      survivor_activity: s.enr + s.att + s.quiz + s.tp + s.ap + s.fp + s.dp + s.lp,
      survivor_secondary: s.secondary_email || '',
      loser_id: l.id,
      loser_email: l.email,
      loser_roles: toArr(l.roles).join('|'),
      loser_activity: l.enr + l.att + l.quiz + l.tp + l.ap + l.fp + l.dp + l.lp,
      conflict_existing_secondary: conflict ? 'YES' : ''
    });
  }

  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? '')).join(',')))
    .join('\n');
  fs.writeFileSync('/tmp/dup_merge_dryrun.csv', csv);

  const conflicts = rows.filter((r) => r.conflict_existing_secondary === 'YES');
  const survPriv = rows.filter((r) => isPriv(r.survivor_roles.split('|'))).length;
  const losPriv = rows.filter((r) => isPriv(r.loser_roles.split('|'))).length;
  console.log('Total pairs:', rows.length);
  console.log('Survivor has privileged role:', survPriv);
  console.log('Loser has privileged role (would be deleted!):', losPriv);
  console.log('Conflicts (survivor already has different secondary_email):', conflicts.length);
  console.log('Report: /tmp/dup_merge_dryrun.csv');
  console.log('\n--- first 10 rows ---');
  console.table(rows.slice(0, 10));
  if (conflicts.length) {
    console.log('\n--- conflicts ---');
    console.table(conflicts);
  }
  await p.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
