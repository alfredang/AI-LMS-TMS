const pool = require('./lib/db').default;

async function checkLogs() {
    try {
        const res = await pool.query(`
            SELECT id, created_at, status, course_title 
            FROM auto_create_trainer_folder_log 
            WHERE created_at > NOW() - INTERVAL '2 days'
            ORDER BY created_at DESC
        `);
        console.log('--- Logs (Last 2 Days) ---');
        console.table(res.rows);
        
        const config = await pool.query(`
            SELECT id, cron_expression, enabled, last_run_at, last_status 
            FROM scheduler_config 
            WHERE id = 'auto_create_trainer_folders'
        `);
        console.log('\n--- Scheduler Config ---');
        console.table(config.rows);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkLogs();
