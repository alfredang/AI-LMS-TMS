/** Pause/resume the configured pilot without deployment-platform access. */
const fs = require('node:fs');
const dotenv = require('dotenv');
const { Client } = require('pg');
const [state, envFile] = process.argv.slice(2);
if (!['pause', 'resume'].includes(state) || !envFile) {
    console.error('Usage: node scripts/set-mms-pilot-state.cjs pause|resume TMS_ENV_FILE');
    process.exit(1);
}
const { DATABASE_URL: databaseUrl } = dotenv.parse(fs.readFileSync(envFile));
if (!databaseUrl) throw new Error('TMS database URL is missing.');
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 12000,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined });
(async () => {
    try {
        await client.connect();
        const result = await client.query(`UPDATE mms_handover_config SET enabled=$1,updated_at=now(),updated_by='pilot-state-command'
            WHERE id=1 AND url='https://www.tertiarycourses.com.sg/courses/api_tms_import' AND length(api_key)>=32 RETURNING enabled`, [state === 'resume']);
        if (result.rowCount !== 1) throw new Error('The configured pilot connection was not found.');
        console.log(`MMS pilot ${result.rows[0].enabled ? 'resumed' : 'paused'}; class-access notifications are controlled separately.`);
    } catch (error) {
        console.error('MMS pilot state change failed:', error.message);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
})();
