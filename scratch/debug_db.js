const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable"
  });
  try {
    await client.connect();
    
    console.log('--- Logs for Today ---');
    const logsRes = await client.query(`
      SELECT id, created_at, status, course_title, run_id, error_message
      FROM auto_create_trainer_folder_log
      WHERE created_at >= CURRENT_DATE
      ORDER BY created_at DESC
    `);
    console.table(logsRes.rows);

    console.log('\n--- Scheduler Config ---');
    const configRes = await client.query(`
      SELECT id, cron_expression, enabled, last_run_at, last_status
      FROM scheduler_config
      WHERE id = 'auto_create_trainer_folders'
    `);
    console.table(configRes.rows);

    console.log('\n--- Recent Scheduler Executions ---');
    const recentRes = await client.query(`
      SELECT * FROM auto_create_trainer_folder_log
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.table(recentRes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
