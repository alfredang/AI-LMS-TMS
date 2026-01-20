import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../lib/db';
import { cors } from '../../lib/cors';

interface UpdateLearnerProfileRequest {
  userId: string;
  profileData: {
    // app_user fields
    name?: string;
    email?: string;
    profilePictureUrl?: string;
    password?: string;
    // learner_profile fields
    tel?: string;
    company?: string;
    employmentStatus?: string;
    nationality?: string;
    ethnicity?: string;
    dob?: string;
    nric?: string;
    gender?: string;
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { userId, profileData }: UpdateLearnerProfileRequest = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    if (!profileData || Object.keys(profileData).length === 0) {
      return res.status(400).json({ success: false, error: 'Profile data is required' });
    }

    console.log('Updating profile for user:', userId);
    console.log('Profile data:', profileData);

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Prepare app_user updates
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

      // Always update the updated_at timestamp
      appUserFields.push(`updated_at = now()`);

      // Update app_user table if there are fields to update
      if (appUserFields.length > 1) { // More than just updated_at
        const appUserQuery = `
          UPDATE app_user 
          SET ${appUserFields.join(', ')} 
          WHERE id = $${paramIndex}
        `;
        appUserValues.push(userId);
        
        console.log('App User Query:', appUserQuery);
        console.log('App User Values:', appUserValues);
        
        await client.query(appUserQuery, appUserValues);
      }

      // Prepare learner_profile updates
      const learnerFields = [];
      const learnerValues = [];
      paramIndex = 1;

      if (profileData.tel !== undefined) {
        learnerFields.push(`tel = $${paramIndex}`);
        learnerValues.push(profileData.tel);
        paramIndex++;
      }

      if (profileData.company !== undefined) {
        learnerFields.push(`company = $${paramIndex}`);
        learnerValues.push(profileData.company);
        paramIndex++;
      }

      if (profileData.employmentStatus !== undefined) {
        learnerFields.push(`employment_status = $${paramIndex}`);
        learnerValues.push(profileData.employmentStatus);
        paramIndex++;
      }

      if (profileData.nationality !== undefined) {
        learnerFields.push(`nationality = $${paramIndex}`);
        learnerValues.push(profileData.nationality);
        paramIndex++;
      }

      if (profileData.ethnicity !== undefined) {
        learnerFields.push(`ethnicity = $${paramIndex}`);
        learnerValues.push(profileData.ethnicity);
        paramIndex++;
      }

      if (profileData.dob !== undefined) {
        learnerFields.push(`dob = $${paramIndex}`);
        learnerValues.push(profileData.dob);
        paramIndex++;
      }

      if (profileData.nric !== undefined) {
        learnerFields.push(`nric = $${paramIndex}`);
        learnerValues.push(profileData.nric);
        paramIndex++;
      }

      if (profileData.gender !== undefined) {
        learnerFields.push(`gender = $${paramIndex}`);
        learnerValues.push(profileData.gender);
        paramIndex++;
      }

      // Update learner_profile table if there are fields to update
      if (learnerFields.length > 0) {
        const learnerQuery = `
          UPDATE learner_profile 
          SET ${learnerFields.join(', ')} 
          WHERE user_id = $${paramIndex}
        `;
        learnerValues.push(userId);
        
        console.log('Learner Profile Query:', learnerQuery);
        console.log('Learner Profile Values:', learnerValues);
        
        await client.query(learnerQuery, learnerValues);
      }

      // Commit transaction
      await client.query('COMMIT');

      // Fetch updated profile to return
      const updatedProfileQuery = `
        SELECT 
          u.id,
          u.full_name as name,
          u.email,
          u.email as "loginId",
          u.profile_picture_url as "profilePictureUrl",
          u.created_at as "createdAt",
          u.updated_at as "updatedAt",
          lp.tel,
          lp.company,
          lp.employment_status as "employmentStatus",
          lp.nationality,
          lp.ethnicity,
          lp.dob,
          lp.nric,
          lp.gender
        FROM app_user u
        LEFT JOIN learner_profile lp ON u.id = lp.user_id
        WHERE u.id = $1
      `;

      const result = await client.query(updatedProfileQuery, [userId]);
      
      if (result.rows.length === 0) {
        throw new Error('User not found after update');
      }

      const updatedProfile = result.rows[0];

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          profile: updatedProfile
        }
      });

    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error updating learner profile:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
