const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres' });
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'da_application'").then(res => { console.log(res.rows); process.exit(0); });
