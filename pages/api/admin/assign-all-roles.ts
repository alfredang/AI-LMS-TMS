import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

const ALL_ROLES = ['Learner', 'Trainer', 'Admin', 'Developer', 'Training Provider'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email, fullName, roles } = req.body;
  const rolesToAssign: string[] = roles && Array.isArray(roles) ? roles : ALL_ROLES;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'email is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if user exists
    let result = await client.query(
      'SELECT id FROM public.app_user WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    let userId: string;

    if (result.rows.length === 0) {
      const tp = await getTrainingPartnerIdentifiers();
      const hashedPassword = await bcrypt.hash(tp.defaultPassword, 10);

      const name = fullName || email.split('@')[0];
      const createResult = await client.query(
        `INSERT INTO public.app_user (id, email, password, password_hash, full_name, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', NOW(), NOW())
         RETURNING id`,
        [email.toLowerCase().trim(), tp.defaultPassword, hashedPassword, name]
      );
      userId = createResult.rows[0].id;
    } else {
      userId = result.rows[0].id;
      // Update name if provided
      if (fullName) {
        await client.query(
          'UPDATE public.app_user SET full_name = $1, updated_at = NOW() WHERE id = $2',
          [fullName, userId]
        );
      }
    }

    // Assign requested roles
    for (const role of rolesToAssign) {
      await client.query(
        `INSERT INTO public.user_role_map (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, role]
      );
    }

    // Ensure profile records exist for assigned roles
    if (rolesToAssign.includes('Learner')) {
      await client.query(
        `INSERT INTO public.learner_profile (user_id, tel) VALUES ($1, 'N/A') ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }
    if (rolesToAssign.includes('Trainer')) {
      await client.query(
        `INSERT INTO public.trainer_profile (user_id, tel, gender, trainer_type, status)
         VALUES ($1, 'N/A', 'Prefer not to say', 'non-ACLP', 'Active')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }
    if (rolesToAssign.includes('Admin')) {
      await client.query(
        `INSERT INTO public.admin_profile (user_id, tel) VALUES ($1, 'N/A') ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }
    if (rolesToAssign.includes('Developer')) {
      await client.query(
        `INSERT INTO public.developer_profile (user_id, tel, developer_type)
         VALUES ($1, 'N/A', 'N/A')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }

    // Link to training provider only if Training Provider role is assigned
    if (rolesToAssign.includes('Training Provider')) {
      const providerResult = await client.query(
        'SELECT id FROM public.training_provider LIMIT 1'
      );
      if (providerResult.rows.length > 0) {
        await client.query(
          `INSERT INTO public.provider_admin_user (provider_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [providerResult.rows[0].id, userId]
        );
        await client.query(
          `INSERT INTO public.training_provider_member (provider_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [providerResult.rows[0].id, userId]
        );
      }
    }

    // Still link as member (not admin) so they can access the system
    const providerResult = await client.query(
      'SELECT id FROM public.training_provider LIMIT 1'
    );
    if (providerResult.rows.length > 0) {
      await client.query(
        `INSERT INTO public.training_provider_member (provider_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [providerResult.rows[0].id, userId]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      data: { userId, email, roles: rolesToAssign },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error assigning roles:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to assign roles',
    });
  } finally {
    client.release();
  }
}
