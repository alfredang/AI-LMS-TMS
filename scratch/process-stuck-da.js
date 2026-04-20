require('dotenv').config({ path: '.env.local' });
const pool = require('../lib/db').default;
const { bulkProcessDirectApplications } = require('../lib/autoEnrolDirectApplications');

async function sync() {
  try {
    console.log('🚀 Searching for stuck Direct Applications (Confirm application status but no auto-enrol status)...');
    
    // Find records that are confirmed but haven't been processed by the pipeline
    const result = await pool.query(
      `SELECT id, application_id FROM da_application 
       WHERE LOWER(application_status) = 'confirm application' 
         AND auto_enrol_status IS NULL
       ORDER BY created_at ASC`
    );

    const ids = result.rows.map(r => r.id);
    console.log(`🔍 Found ${ids.length} records to process.`);

    if (ids.length === 0) {
      console.log('✅ No stuck records found. System is already synced.');
      process.exit(0);
    }

    console.log('📦 Starting bulk processing in background...');
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      console.log(`⏳ Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(ids.length/batchSize)}...`);
      await bulkProcessDirectApplications(batch);
    }

    console.log('✅ Synchronous batch processing complete.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Sync script failed:', error);
    process.exit(1);
  }
}

sync();
