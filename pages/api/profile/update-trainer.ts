import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDeleteFileUrl } from '../../../lib/urlHelpers';

interface UpdateTrainerProfileRequest {
  userId: string;
  profileData: {
    name?: string;
    email?: string;
    tel?: string;
    gender?: string;
    trainerType?: string;
    status?: string;
    linkedinUrl?: string;
    cvUrl?: string;
    cvOriginalFilename?: string;
    profilePictureUrl?: string;
    areasOfExpertise?: string[];
    qualifications?: string[];
    education?: string;
    workExperience?: any[];
    certifications?: any[];
    certificationsToDelete?: string[];
    newCertifications?: Array<{name: string, fileUrl: string, originalFilename?: string}>;
    password?: string;
    commonName?: string;
    country?: string;
    cnPlusEmail?: string;
    nric?: string;
    secondaryEmail?: string;
    nationality?: string;
    ethnicity?: string;
    dob?: string;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    // GET method is handled in the trainer.ts file
    return res.status(405).json({ message: 'Use GET /api/profile/trainer for fetching profiles' });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { userId, profileData }: UpdateTrainerProfileRequest = req.body;
    console.log('🔍 update-trainer: userId =', userId);
    console.log('🔍 update-trainer: profileData =', JSON.stringify(profileData));

    if (!userId || !profileData) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID and profile data are required' 
      });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Build update query dynamically based on provided fields
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      // Handle user table updates
      const userUpdates: string[] = [];
      const userValues: any[] = [];
      let userParamIndex = 1;

      if (profileData.name) {
        userUpdates.push(`full_name = $${userParamIndex++}`);
        userValues.push(profileData.name);
      }

      if (profileData.email) {
        userUpdates.push(`email = $${userParamIndex++}`);
        userValues.push(profileData.email);
      }

      if (profileData.secondaryEmail) {
        userUpdates.push(`secondary_email = $${userParamIndex++}`);
        userValues.push(profileData.secondaryEmail);
      }

      if (profileData.password) {
        userUpdates.push(`password = $${userParamIndex++}`);
        userValues.push(profileData.password);
      }

      if (profileData.profilePictureUrl !== undefined) {
        userUpdates.push(`profile_picture_url = $${userParamIndex++}`);
        userValues.push(profileData.profilePictureUrl);
      }

      // Handle trainer_profile table updates
      if (profileData.tel !== undefined) {
        updateFields.push(`tel = $${paramIndex++}`);
        updateValues.push(profileData.tel);
      }

      if (profileData.gender) {
        updateFields.push(`gender = $${paramIndex++}`);
        updateValues.push(profileData.gender);
      }

      if (profileData.trainerType) {
        updateFields.push(`trainer_type = $${paramIndex++}`);
        updateValues.push(profileData.trainerType);
      }

      if (profileData.status) {
        updateFields.push(`status = $${paramIndex++}`);
        updateValues.push(profileData.status);
      }

      if (profileData.linkedinUrl !== undefined) {
        updateFields.push(`linkedin_url = $${paramIndex++}`);
        updateValues.push(profileData.linkedinUrl);
      }

      if (profileData.cvUrl !== undefined) {
        updateFields.push(`cv_url = $${paramIndex++}`);
        updateValues.push(profileData.cvUrl);
      }

      if (profileData.cvOriginalFilename !== undefined) {
        updateFields.push(`cv_original_filename = $${paramIndex++}`);
        updateValues.push(profileData.cvOriginalFilename);
      }

      if (profileData.areasOfExpertise) {
        updateFields.push(`areas_of_expertise = $${paramIndex++}`);
        updateValues.push(typeof profileData.areasOfExpertise === 'string'
          ? profileData.areasOfExpertise
          : JSON.stringify(profileData.areasOfExpertise));
      }

      if (profileData.qualifications) {
        updateFields.push(`qualifications = $${paramIndex++}`);
        updateValues.push(typeof profileData.qualifications === 'string'
          ? profileData.qualifications
          : JSON.stringify(profileData.qualifications));
      }

      if (profileData.education !== undefined) {
        updateFields.push(`education = $${paramIndex++}`);
        updateValues.push(profileData.education);
      }

      if (profileData.commonName !== undefined) {
        updateFields.push(`common_name = $${paramIndex++}`);
        updateValues.push(profileData.commonName);
      }

      if (profileData.country !== undefined) {
        updateFields.push(`country = $${paramIndex++}`);
        updateValues.push(profileData.country);
      }

      if (profileData.cnPlusEmail !== undefined) {
        updateFields.push(`cn_plus_email = $${paramIndex++}`);
        updateValues.push(profileData.cnPlusEmail);
      }

      if (profileData.nric !== undefined) {
        updateFields.push(`nric = $${paramIndex++}`);
        updateValues.push(profileData.nric);
      }

      if (profileData.nationality !== undefined) {
        updateFields.push(`nationality = $${paramIndex++}`);
        updateValues.push(profileData.nationality || null);
      }

      if (profileData.ethnicity !== undefined) {
        updateFields.push(`ethnicity = $${paramIndex++}`);
        updateValues.push(profileData.ethnicity || null);
      }

      if (profileData.dob !== undefined) {
        updateFields.push(`dob = $${paramIndex++}`);
        updateValues.push(profileData.dob || null);
      }

      // Note: certifications are now handled in separate certification table
      // Remove the old certifications field update

      // Update user table if needed
      if (userUpdates.length > 0) {
        const userUpdateQuery = `
          UPDATE app_user
          SET ${userUpdates.join(', ')}
          WHERE id = $${userParamIndex}
        `;
        userValues.push(userId);
        console.log('🔍 User update query:', userUpdateQuery);
        console.log('🔍 User values:', userValues);
        const userUpdateResult = await client.query(userUpdateQuery, userValues);
        console.log('🔍 User rows affected:', userUpdateResult.rowCount);
      }

      // Update trainer_profile table if needed
      if (updateFields.length > 0) {
        const trainerUpdateQuery = `
          UPDATE trainer_profile 
          SET ${updateFields.join(', ')}
          WHERE user_id = $${paramIndex}
        `;
        updateValues.push(userId);
        await client.query(trainerUpdateQuery, updateValues);
      }

      // Handle work experience updates
      if (profileData.workExperience) {
        // Delete existing work experience
        await client.query('DELETE FROM work_experience WHERE trainer_id = $1', [userId]);
        
        // Insert new work experience records
        for (const exp of profileData.workExperience) {
          if (exp.jobTitle && exp.company) { // Only insert if we have required fields
            const insertExpQuery = `
              INSERT INTO work_experience (trainer_id, company, job_title, start_date, end_date, description)
              VALUES ($1, $2, $3, $4, $5, $6)
            `;
            
            // Handle end date - convert 'Present' to null
            const endDate = exp.endDate === 'Present' || exp.endDate === '' || exp.endDate === null ? null : exp.endDate + '-01';
            const startDate = exp.startDate ? exp.startDate + '-01' : null;
            
            await client.query(insertExpQuery, [
              userId,
              exp.company,
              exp.jobTitle,
              startDate,
              endDate,
              exp.description || ''
            ]);
          }
        }
      }

      // Handle certificate deletions
      if (profileData.certificationsToDelete && profileData.certificationsToDelete.length > 0) {
        for (const certId of profileData.certificationsToDelete) {
          // First get the file_url to delete the file
          const certResult = await client.query(
            'SELECT file_url FROM certification WHERE id = $1 AND trainer_id = $2', 
            [certId, userId]
          );
          
          if (certResult.rows.length > 0) {
            const fileUrl = certResult.rows[0].file_url;
            
            // Delete the database record
            await client.query(
              'DELETE FROM certification WHERE id = $1 AND trainer_id = $2', 
              [certId, userId]
            );
            
            // Delete the physical file
            try {
              const response = await fetch(getDeleteFileUrl(fileUrl), {
                method: 'DELETE'
              });
              if (response.ok) {
                console.log('🗑️ Certificate file deleted:', fileUrl);
              }
            } catch (error) {
              console.error('⚠️ Failed to delete certificate file:', error);
            }
          }
        }
      }

      // Handle new certificate additions
      if (profileData.newCertifications && profileData.newCertifications.length > 0) {
        for (const cert of profileData.newCertifications) {
          await client.query(
            'INSERT INTO certification (trainer_id, name, file_url, original_filename) VALUES ($1, $2, $3, $4)',
            [userId, cert.name, cert.fileUrl, cert.originalFilename || cert.name]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch updated profile with work experience and certifications
      const fetchUpdatedProfileQuery = `
        SELECT
          u.full_name AS name,
          u.profile_picture_url AS picture,
          t.tel AS telephone,
          u.email,
          u.password,
          u.password_hash,
          t.gender,
          t.trainer_type,
          t.status,
          t.linkedin_url,
          t.cv_url,
          t.cv_original_filename,
          t.qualifications,
          t.education,
          t.areas_of_expertise,
          t.common_name,
          t.country,
          t.cn_plus_email,
          t.nric,
          u.secondary_email,
          t.nationality,
          t.ethnicity,
          to_char(t.dob, 'YYYY-MM-DD') as dob
        FROM app_user u
        LEFT JOIN trainer_profile t
          ON t.user_id = u.id
        WHERE u.id = $1
      `;

      // Get work experience separately
      const workExperienceQuery = `
        SELECT 
          id,
          company,
          job_title,
          TO_CHAR(start_date, 'YYYY-MM') as start_date,
          CASE 
            WHEN end_date IS NULL THEN NULL
            ELSE TO_CHAR(end_date, 'YYYY-MM')
          END as end_date,
          description
        FROM work_experience
        WHERE trainer_id = $1
        ORDER BY start_date DESC
      `;

      // Get certifications separately
      const certificationsQuery = `
        SELECT 
          id,
          name,
          file_url,
          original_filename,
          created_at
        FROM certification
        WHERE trainer_id = $1
        ORDER BY created_at DESC
      `;

      const [profileResult, workExpResult, certificationsResult] = await Promise.all([
        client.query(fetchUpdatedProfileQuery, [userId]),
        client.query(workExperienceQuery, [userId]),
        client.query(certificationsQuery, [userId])
      ]);

      if (profileResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const row = profileResult.rows[0];

      // Transform work experience data
      const workExperience = workExpResult.rows.map((exp: any) => ({
        id: exp.id,
        jobTitle: exp.job_title,
        company: exp.company,
        startDate: exp.start_date,
        endDate: exp.end_date || 'Present',
        description: exp.description || ''
      }));

      // Transform certifications data
      const certifications = certificationsResult.rows.map((cert: any) => ({
        id: cert.id,
        name: cert.name,
        fileUrl: cert.file_url,
        originalFilename: cert.original_filename,
        createdAt: cert.created_at
      }));

      // Transform the data to match frontend expectations
      const updatedProfile = {
        id: userId,
        name: row.name,
        email: row.email,
        loginId: row.email,
        profilePictureUrl: row.picture,
        tel: row.telephone,
        gender: row.gender,
        trainerType: row.trainer_type,
        status: row.status,
        linkedinUrl: row.linkedin_url,
        cvUrl: row.cv_url,
        cvOriginalFilename: row.cv_original_filename,
        certifications: certifications, // Use data from certification table
        qualifications: (() => {
          if (!row.qualifications) return [];
          if (Array.isArray(row.qualifications)) return row.qualifications;
          try { return JSON.parse(row.qualifications); } catch { return []; }
        })(),
        education: row.education || '',
        areasOfExpertise: (() => {
          if (!row.areas_of_expertise) return [];
          if (Array.isArray(row.areas_of_expertise)) return row.areas_of_expertise;
          try { return JSON.parse(row.areas_of_expertise); } catch { return []; }
        })(),
        workExperience: workExperience,
        commonName: row.common_name || '',
        country: row.country || '',
        cnPlusEmail: row.cn_plus_email || '',
        nric: row.nric || '',
        secondaryEmail: row.secondary_email || '',
        nationality: row.nationality || '',
        ethnicity: row.ethnicity || '',
        dob: row.dob || '',
      };

      res.status(200).json({
        success: true,
        data: {
          profile: updatedProfile
        },
        message: 'Trainer profile updated successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error updating trainer profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}