/**
 * init-admin.js
 *
 * Creates the first protected admin account from environment variables.
 * Run ONCE after fresh database setup:
 *
 *   node scripts/init-admin.js
 *
 * Required environment variables:
 *   DATABASE_URL            - PostgreSQL connection string
 *   ADMIN_EMAIL             - Login email for the admin account
 *   ADMIN_PASSWORD          - Login password (min 8 chars recommended)
 *   ADMIN_FULL_NAME         - Display name for the admin
 *   TRAINING_PARTNER_UEN    - UEN of the training provider (e.g. 201509271W)
 *   TRAINING_PARTNER_CODE   - SSG partner code (e.g. 201509271W-01)
 *   COMPANY_NAME            - Company display name (e.g. Chelsea Academia)
 */

require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local', override: true });

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const REQUIRED = [
  'DATABASE_URL',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_FULL_NAME',
  'TRAINING_PARTNER_UEN',
  'TRAINING_PARTNER_CODE',
  'COMPANY_NAME',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach((k) => console.error(`   ${k}`));
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initAdmin() {
  const client = await pool.connect();
  try {
    // ── 1. Check: protected admin already exists ──────────────────────────
    const existing = await client.query(
      'SELECT id, email FROM public.app_user WHERE is_protected = true LIMIT 1'
    );
    if (existing.rows.length > 0) {
      console.log(`⚠️  Protected admin already exists (${existing.rows[0].email}). Skipping.`);
      return;
    }

    await client.query('BEGIN');

    // ── 2. Create training provider ───────────────────────────────────────
    const providerId = uuidv4();
    await client.query(
      `INSERT INTO public.training_provider
         (id, company_name, uen, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (uen) DO NOTHING`,
      [providerId, process.env.COMPANY_NAME, process.env.TRAINING_PARTNER_UEN]
    );

    // Re-fetch so we get the real id even if ON CONFLICT skipped our insert
    const providerRow = await client.query(
      'SELECT id FROM public.training_provider WHERE uen = $1',
      [process.env.TRAINING_PARTNER_UEN]
    );
    if (providerRow.rows.length === 0) {
      throw new Error(`Training provider with UEN ${process.env.TRAINING_PARTNER_UEN} not found after insert.`);
    }
    const actualProviderId = providerRow.rows[0].id;

    // ── 3. Create admin app_user ──────────────────────────────────────────
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    await client.query(
      `INSERT INTO public.app_user
         (id, email, password_hash, full_name, is_protected, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
      [userId, process.env.ADMIN_EMAIL, passwordHash, process.env.ADMIN_FULL_NAME]
    );

    // ── 4. Assign all roles ───────────────────────────────────────────────
    const ALL_ROLES = ['Learner', 'Trainer', 'Admin', 'Developer', 'Training Provider'];
    for (const role of ALL_ROLES) {
      await client.query(
        'INSERT INTO public.user_role_map (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, role]
      );
    }

    // ── 5. Link to training provider (both tables for compatibility) ──────
    await client.query(
      `INSERT INTO public.provider_admin_user (provider_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [actualProviderId, userId]
    );

    await client.query('COMMIT');

    console.log('✅ Protected admin account created successfully!');
    console.log(`   Email    : ${process.env.ADMIN_EMAIL}`);
    console.log(`   Name     : ${process.env.ADMIN_FULL_NAME}`);
    console.log(`   Company  : ${process.env.COMPANY_NAME}`);
    console.log(`   UEN      : ${process.env.TRAINING_PARTNER_UEN}`);
    console.log('');
    console.log('⚠️  Keep ADMIN_PASSWORD secret and remove it from .env after first login.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create admin:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

initAdmin();
