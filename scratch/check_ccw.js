require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const res = await pool.query(`
    SELECT id, application_id, trainee_name, trainee_id, trainee_id_type, 
           course_run_id, course_reference_number, course_title,
           application_status, enrolment_status, enrolment_id,
           sponsorship_type, auto_enrol_status, auto_enrol_error
    FROM da_application 
    WHERE trainee_name ILIKE '%CHUA CHOON WEE%'
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
