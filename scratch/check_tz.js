const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable"
  });
  try {
    await client.connect();
    const res = await client.query("SHOW TIMEZONE; SELECT NOW();");
    console.log('Timezone:', res[0].rows[0]);
    console.log('Now (DB):', res[1].rows[0]);
    console.log('Now (Node):', new Date().toISOString());
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
