import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  try {
    const res = await pool.query(`SELECT id, title, course_reference_number FROM course WHERE course_reference_number = 'TGS-2020504518' LIMIT 1`);
    console.log("COURSE TABLE:", res.rows);
  } finally {
    await pool.end();
  }
}
run();
