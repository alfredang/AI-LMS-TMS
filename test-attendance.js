require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool();

async function run() {
    try {
        const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'course_session_attendance'`);
        console.log('Columns in course_session_attendance:', res.rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
