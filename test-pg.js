const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:112233@localhost:5432/ailmstms' });

async function run() {
  const isValidDate = (d) => typeof d === 'string' && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(d);
  const parseDDMMYYYY = (d) => { const p = d.split(/[\/\-]/); return `${p[2]}-${p[1]}-${p[0]}`; };

  let countQuery = "SELECT COUNT(DISTINCT cr.course_run_id) AS total_count FROM course_run cr JOIN course c ON cr.course_id = c.id LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email LEFT JOIN enrollment e ON e.course_run_id = cr.id WHERE cr.start_date > CURRENT_DATE";
  const countParams = [];
  let countParamIndex = 1;

  const trainer = "Tay Hoo Wee";
  const startDateFrom = "26/03/2026";

  if (trainer) {
    countQuery += ` AND au.full_name ILIKE $${countParamIndex}`;
    countParams.push(`%${trainer}%`);
    countParamIndex++;
  }
  if (isValidDate(startDateFrom)) {
    countQuery += ` AND cr.start_date >= $${countParamIndex}`;
    countParams.push(parseDDMMYYYY(startDateFrom));
    countParamIndex++;
  }

  try {
    const res = await pool.query(countQuery, countParams);
    console.log("Count Query Success:", res.rows);
  } catch (e) {
    console.error("Count Query Error:", e.message);
  }
  process.exit(0);
}
run();
