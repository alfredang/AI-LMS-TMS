import type { NextApiRequest, NextApiResponse } from 'next'
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

// Local utility function for API responses
function createApiResponse(success: boolean, message: string, data?: any, error?: string) {
  return {
    success,
    message,
    data,
    error,
    timestamp: new Date().toISOString()
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'PUT') {
    return res.status(405).json(
      createApiResponse(false, 'Method not allowed')
    );
  }

  try {
    const { userId, profileData } = req.body;

    console.log('🔄 Admin Profile Update API called with:', { userId, profileData });

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json(
        createApiResponse(false, 'Missing or invalid userId parameter')
      );
    }

    if (!profileData || typeof profileData !== 'object') {
      return res.status(400).json(
        createApiResponse(false, 'Missing or invalid profileData parameter')
      );
    }

    // Start a transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Prepare app_user update fields
      const appUserFields = [];
      const appUserValues = [];
      let paramIndex = 1;

      if (profileData.name !== undefined) {
        appUserFields.push(`full_name = $${paramIndex}`);
        appUserValues.push(profileData.name);
        paramIndex++;
      }

      if (profileData.email !== undefined) {
        appUserFields.push(`email = $${paramIndex}`);
        appUserValues.push(profileData.email);
        paramIndex++;
      }

      if (profileData.profilePictureUrl !== undefined) {
        appUserFields.push(`profile_picture_url = $${paramIndex}`);
        appUserValues.push(profileData.profilePictureUrl);
        paramIndex++;
      }

      if (profileData.password !== undefined) {
        appUserFields.push(`password = $${paramIndex}`);
        appUserValues.push(profileData.password);
        paramIndex++;
      }

      // Check email uniqueness before attempting update
      if (profileData.email !== undefined) {
        const emailCheck = await client.query(
          'SELECT id FROM public.app_user WHERE email = $1 AND id != $2',
          [profileData.email, userId]
        );
        if (emailCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json(
            createApiResponse(false, 'This email address is already in use by another account.')
          );
        }
      }

      // Always update the updated_at timestamp
      appUserFields.push(`updated_at = NOW()`);

      // Update app_user table if there are fields to update
      if (appUserFields.length > 1) { // More than just updated_at
        const appUserQuery = `
          UPDATE app_user
          SET ${appUserFields.join(', ')}
          WHERE id = $${paramIndex}
        `;
        appUserValues.push(userId);

        console.log('🔄 Executing app_user update:', appUserQuery);
        console.log('📝 Values:', appUserValues);

        await client.query(appUserQuery, appUserValues);
        console.log('✅ app_user table updated successfully');
      }

      // Prepare admin_profile update fields
      const adminProfileFields = [];
      const adminProfileValues = [];
      let adminParamIndex = 1;

      if (profileData.tel !== undefined) {
        adminProfileFields.push(`tel = $${adminParamIndex}`);
        adminProfileValues.push(profileData.tel);
        adminParamIndex++;
      }

      // Update admin_profile table if there are fields to update
      if (adminProfileFields.length > 0) {
        const adminProfileQuery = `
          UPDATE admin_profile
          SET ${adminProfileFields.join(', ')}
          WHERE user_id = $${adminParamIndex}
        `;
        adminProfileValues.push(userId);

        console.log('🔄 Executing admin_profile update:', adminProfileQuery);
        console.log('📝 Values:', adminProfileValues);

        await client.query(adminProfileQuery, adminProfileValues);
        console.log('✅ admin_profile table updated successfully');
      }

      // Commit the transaction
      await client.query('COMMIT');

      // Fetch the updated profile data
      const result = await client.query(`
        SELECT 
            au.id AS user_id,
            au.full_name,
            au.email,
            au.profile_picture_url,
            ap.tel AS telephone
        FROM app_user au
        JOIN admin_profile ap 
            ON ap.user_id = au.id
        WHERE au.id = $1
      `, [userId]);

      if (result.rows.length === 0) {
        throw new Error('Admin profile not found after update');
      }

      const updatedProfile = result.rows[0];
      
      const responseData = {
        id: updatedProfile.user_id,
        name: updatedProfile.full_name,
        email: updatedProfile.email,
        tel: updatedProfile.telephone,
        loginId: updatedProfile.email,
        profilePictureUrl: updatedProfile.profile_picture_url,
        updated_at: new Date().toISOString()
      };

      console.log('✅ Admin profile updated successfully:', responseData);

      return res.status(200).json(
        createApiResponse(true, 'Admin profile updated successfully', { profile: responseData })
      );

    } catch (error) {
      // Rollback the transaction
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error updating admin profile:', error);
    return res.status(500).json(
      createApiResponse(
        false, 
        'Failed to update admin profile',
        null,
        error instanceof Error ? error.message : 'Unknown error'
      )
    );
  }
}