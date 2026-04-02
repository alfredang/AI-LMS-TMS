const fs = require('fs');
const envStr = fs.readFileSync('.env.local', 'utf8');
const dbUrl = envStr.split('\n').find(l => l.startsWith('DATABASE_URL')).split('=')[1].replace(/"/g, '').trim();

const { Pool } = require('pg');
const pool = new Pool({ connectionString: dbUrl });

async function run() {
    try {
        const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'course_attendance'`);
        console.log('Columns in course_attendance:', res.rows.map(r => r.column_name));

        const dataRes = await pool.query(`SELECT * FROM course_attendance LIMIT 1`);
        console.log('Sample Data:', dataRes.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
