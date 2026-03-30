import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

const VALID_ROLES = ['Learner', 'Trainer', 'Developer', 'Admin', 'Finance', 'Training Provider'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, roles, accountStatus, currentUserId, full_name } = req.body;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  // Prevent users from editing their own roles
  if (currentUserId && userId === currentUserId) {
    return res.status(403).json({ success: false, error: 'Cannot edit your own roles' });
  }

  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ success: false, error: 'roles must be a non-empty array' });
  }

  // Validate all roles
  for (const role of roles) {
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role: "${role}". Valid roles: ${VALID_ROLES.join(', ')}`,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current roles before deletion to detect changes
    const currentRolesResult = await client.query(
      'SELECT role FROM public.user_role_map WHERE user_id = $1',
      [userId]
    );
    const currentRoles = currentRolesResult.rows.map((r: any) => r.role);
    const hadTrainingProviderRole = currentRoles.includes('Training Provider');
    const willHaveTrainingProviderRole = roles.includes('Training Provider');

    // Delete all existing roles for this user
    await client.query('DELETE FROM public.user_role_map WHERE user_id = $1', [userId]);

    // Insert new roles
    for (const role of roles) {
      await client.query(
        'INSERT INTO public.user_role_map (user_id, role) VALUES ($1, $2)',
        [userId, role]
      );
    }

    // Ensure corresponding profile records exist for each assigned role
    // First, try to get a telephone number from any existing profile
    const telResult = await client.query(
      `SELECT tel FROM public.learner_profile WHERE user_id = $1
       UNION SELECT tel FROM public.trainer_profile WHERE user_id = $1
       UNION SELECT tel FROM public.developer_profile WHERE user_id = $1
       UNION SELECT tel FROM public.admin_profile WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    const tel = telResult.rows.length > 0 ? telResult.rows[0].tel : 'N/A';

    for (const role of roles) {
      if (role === 'Learner') {
        await client.query(
          `INSERT INTO public.learner_profile (user_id, tel)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, tel]
        );
      } else if (role === 'Trainer') {
        await client.query(
          `INSERT INTO public.trainer_profile (user_id, tel, gender, trainer_type, status)
           VALUES ($1, $2, 'Prefer not to say', 'non-ACLP', 'Active')
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, tel]
        );
      } else if (role === 'Developer') {
        await client.query(
          `INSERT INTO public.developer_profile (user_id, tel, developer_type)
           VALUES ($1, $2, 'N/A')
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, tel]
        );
      } else if (role === 'Admin') {
        await client.query(
          `INSERT INTO public.admin_profile (user_id, tel)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, tel]
        );
      } else if (role === 'Training Provider') {
        // Link user to training provider organization via training_provider_member
        if (currentUserId) {
          // Find which training provider organization the current admin belongs to
          // Try training_provider_member first (new multi-company approach)
          let providerIdResult = await client.query(
            `SELECT provider_id FROM public.training_provider_member WHERE user_id = $1 LIMIT 1`,
            [currentUserId]
          );

          // If not found, try direct ownership
          if (providerIdResult.rows.length === 0) {
            providerIdResult = await client.query(
              `SELECT id as provider_id FROM public.training_provider WHERE id = $1 LIMIT 1`,
              [currentUserId]
            );
          }

          // If still not found, try provider_admin_user (legacy)
          if (providerIdResult.rows.length === 0) {
            providerIdResult = await client.query(
              `SELECT provider_id FROM public.provider_admin_user WHERE user_id = $1 LIMIT 1`,
              [currentUserId]
            );
          }

          if (providerIdResult.rows.length > 0) {
            const providerId = providerIdResult.rows[0].provider_id;

            // Add to training_provider_member (new approach)
            await client.query(
              `INSERT INTO public.training_provider_member (provider_id, user_id)
               VALUES ($1, $2)
               ON CONFLICT (provider_id, user_id) DO NOTHING`,
              [providerId, userId]
            );

            console.log(`✅ Added user ${userId} to training provider ${providerId} via training_provider_member`);
          } else {
            console.warn(`⚠️ Could not find training provider for current user ${currentUserId}`);
          }
        }
      }
    }

    // Handle Training Provider role removal
    // If user HAD the role but no longer has it, remove from training_provider_member
    if (hadTrainingProviderRole && !willHaveTrainingProviderRole) {
      await client.query(
        'DELETE FROM public.training_provider_member WHERE user_id = $1',
        [userId]
      );
      console.log(`🗑️ Removed user ${userId} from training_provider_member (role removed)`);
    }

    // Update account_status and/or full_name if provided
    if (accountStatus && (accountStatus === 'active' || accountStatus === 'disabled')) {
      await client.query(
        'UPDATE public.app_user SET account_status = $1, updated_at = NOW() WHERE id = $2',
        [accountStatus, userId]
      );
    }
    if (full_name && typeof full_name === 'string' && full_name.trim()) {
      await client.query(
        'UPDATE public.app_user SET full_name = $1, updated_at = NOW() WHERE id = $2',
        [full_name.trim(), userId]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      data: { userId, roles, accountStatus, full_name: full_name?.trim() ?? null },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user roles:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Failed to update user roles: ${errorMessage}`,
    });
  } finally {
    client.release();
  }
}

export default handler;
