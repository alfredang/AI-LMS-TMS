/**
 * One-time script to assign all roles to a user.
 * Usage: npx ts-node scripts/assign-all-roles.ts
 *
 * Requires DATABASE_URL environment variable.
 */
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

const TARGET_EMAIL = 'kongweng@tertiaryinfotech.com';
const TARGET_NAME = 'Koh Kong Weng';
const ALL_ROLES = ['Learner', 'Trainer', 'Admin', 'Developer', 'Training Provider'] as const;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if user exists
    let result = await client.query(
      'SELECT id FROM public.app_user WHERE email = $1',
      [TARGET_EMAIL]
    );

    let userId: string;

    if (result.rows.length === 0) {
      // Create the user with a temporary password (they should reset it)
      const createResult = await client.query(
        `INSERT INTO public.app_user (id, email, password_hash, full_name, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, crypt('TempPass123!', gen_salt('bf', 10)), $2, 'active', NOW(), NOW())
         RETURNING id`,
        [TARGET_EMAIL, TARGET_NAME]
      );
      userId = createResult.rows[0].id;
      console.log(`✅ Created user: ${TARGET_NAME} (${TARGET_EMAIL}) — ID: ${userId}`);
    } else {
      userId = result.rows[0].id;
      console.log(`✅ Found existing user: ${TARGET_EMAIL} — ID: ${userId}`);
    }

    // Assign all roles
    for (const role of ALL_ROLES) {
      await client.query(
        `INSERT INTO public.user_role_map (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, role]
      );
      console.log(`  → Assigned role: ${role}`);
    }

    // Create profile records if they don't exist
    await client.query(
      `INSERT INTO public.learner_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );
    await client.query(
      `INSERT INTO public.trainer_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );
    await client.query(
      `INSERT INTO public.admin_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );
    await client.query(
      `INSERT INTO public.developer_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );

    // Link to training provider if one exists
    const providerResult = await client.query(
      'SELECT id FROM public.training_provider LIMIT 1'
    );
    if (providerResult.rows.length > 0) {
      await client.query(
        `INSERT INTO public.provider_admin_user (provider_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [providerResult.rows[0].id, userId]
      );
      console.log(`  → Linked to training provider`);
    }

    await client.query('COMMIT');
    console.log(`\n✅ All roles assigned to ${TARGET_NAME} (${TARGET_EMAIL})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
