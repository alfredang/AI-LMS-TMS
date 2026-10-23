/**
 * Provision the two private database settings for the non-funded pilot.
 * Usage: node scripts/provision-mms-pilot.cjs TMS_ENV_FILE MMS_DATABASE_FILE MMS_REPO
 * The shared key is generated/reused in memory and is never printed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');

const [tmsEnvFile, mmsDatabaseFile, mmsRepo] = process.argv.slice(2);
if (!tmsEnvFile || !mmsDatabaseFile || !mmsRepo) {
    console.error('Provide TMS env file, MMS database file, and MMS repository path.');
    process.exit(1);
}
const environment = dotenv.parse(fs.readFileSync(tmsEnvFile));
const databaseUrl = environment.DATABASE_URL;
const mmsDatabaseUrl = fs.readFileSync(mmsDatabaseFile, 'utf8').trim();
const setupScript = path.join(mmsRepo, 'scripts/maintenance/configure-tms-handover.php');
if (!databaseUrl || !mmsDatabaseUrl.startsWith('mysql://') || !fs.existsSync(setupScript)) {
    console.error('The database connections or MMS setup script are missing.');
    process.exit(1);
}
const endpoint = 'https://www.tertiarycourses.com.sg/courses/api_tms_import';
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 12000,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined });

(async () => {
    try {
        await client.connect();
        await client.query(fs.readFileSync(path.join(__dirname, '../database/migrations/create_mms_handover_config.sql'), 'utf8'));
        await client.query('BEGIN');
        const existing = (await client.query('SELECT api_key,url FROM mms_handover_config WHERE id=1 FOR UPDATE')).rows[0];
        if (existing?.url && existing.url !== endpoint) throw new Error('The current TMS MMS endpoint differs; review it before setup.');
        const key = existing?.api_key || randomBytes(32).toString('hex');
        await client.query(`INSERT INTO mms_handover_config
            (id,enabled,automatic,notifications_enabled,url,api_key,course_allowlist,pilot_start_date,public_origin,provider_id,website_id,horizon_days,updated_by)
            VALUES(1,false,true,false,$1,$2,'C*',DATE '2026-10-23','https://www.tertiarycourses.com.sg','tertiary-sg',1,60,'pilot-bootstrap')
            ON CONFLICT(id) DO UPDATE SET enabled=false,automatic=true,notifications_enabled=false,
            url=EXCLUDED.url,api_key=EXCLUDED.api_key,course_allowlist='C*',pilot_start_date=EXCLUDED.pilot_start_date,
            public_origin=EXCLUDED.public_origin,provider_id=EXCLUDED.provider_id,website_id=EXCLUDED.website_id,
            horizon_days=EXCLUDED.horizon_days,updated_at=now(),updated_by='pilot-bootstrap'`, [endpoint, key]);
        await client.query('COMMIT');
        execFileSync('docker', ['run', '--rm', '-i', '-v', `${setupScript}:/configure.php:ro`, '--entrypoint', 'php', 'ai-mms-main-web:latest', '/configure.php'],
            { input: JSON.stringify({ database_url: mmsDatabaseUrl, api_key: key }), encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
        await client.query('BEGIN');
        const tasks = await client.query(`UPDATE scheduler_config SET enabled=true,updated_at=now()
            WHERE id=ANY($1) RETURNING id`, [['mms_nonfunded_discovery', 'mms_nonfunded_reconcile', 'mms_nonfunded_worker']]);
        if (tasks.rowCount !== 3) throw new Error('All three TMS MMS scheduler tasks must exist before enabling the pilot.');
        const activation = await client.query("UPDATE mms_handover_config SET enabled=true,updated_at=now(),updated_by='pilot-bootstrap' WHERE id=1 AND api_key=$1", [key]);
        if (activation.rowCount !== 1) throw new Error('TMS connection row changed during setup.');
        await client.query('COMMIT');
        console.log('Private TMS and MMS pilot connections and three scheduler jobs configured. Access notifications remain disabled.');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Pilot setup stopped:', error.message);
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
})();
