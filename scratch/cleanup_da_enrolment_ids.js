const { Client } = require('pg');

const connectionString = 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable';

async function cleanup() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('🔄 Starting cleanup of UUID enrolment IDs in da_application...');

    // 1. Identify records with UUIDs
    const uuidRegex = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    
    const countRes = await client.query(`SELECT count(*) FROM da_application WHERE enrolment_id ~ $1`, [uuidRegex]);
    console.log(`📊 Found ${countRes.rows[0].count} records with UUIDs as enrolment_id.`);

    if (parseInt(countRes.rows[0].count) === 0) {
      console.log('✅ No records to clean up.');
      return;
    }

    // 2. Perform the update
    // We replace UUIDs with 'MANUAL' and ensure enrolment_status is 'Confirmed'
    const updateRes = await client.query(`
      UPDATE da_application
      SET 
        enrolment_id = 'MANUAL',
        enrolment_status = 'Confirmed',
        updated_at = NOW()
      WHERE enrolment_id ~ $1
      RETURNING application_id
    `, [uuidRegex]);

    console.log(`✅ Successfully updated ${updateRes.rows.length} records to 'MANUAL'.`);

  } catch (err) {
    console.error('❌ Cleanup failed:', err);
  } finally {
    await client.end();
  }
}

cleanup();
