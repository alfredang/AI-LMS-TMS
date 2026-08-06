import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface ApiResponse {
  success: boolean;
  message?: string;
  data?: any;
}

interface UpdateDeveloperRequest {
  userId: string;
  profileData: {
    name?: string;
    email?: string;
    profilePictureUrl?: string;
    tel?: string;
    gender?: string;
    developerType?: string;
    linkedinUrl?: string;
    bio?: string;
    dob?: string;
    nric?: string;
    nationality?: string;
    ethnicity?: string;
    secondaryEmail?: string;
    cvUrl?: string;
    cvOriginalFilename?: string;
    cvFolderUrl?: string;
    qualifications?: string[];
    education?: string; // Single education string using DeveloperEducation enum values
    areasOfSpecialty?: string[];
    workExperience?: any[];
    password?: string;
    newCertifications?: Array<{
      name: string;
      fileUrl: string;
      originalFilename: string;
    }>;
    certificationsToDelete?: string[];
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method not allowed' 
    });
  }

  try {
    const { userId, profileData }: UpdateDeveloperRequest = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    console.log('📝 Developer Update API: Starting update for userId:', userId);
    console.log('📝 Developer Update API: Update data:', profileData);

    // First, verify the user exists and is a developer (user may have multiple roles)
    const roleCheckQuery = `
      SELECT u.full_name, ur.role 
      FROM app_user u 
      LEFT JOIN user_role_map ur ON u.id = ur.user_id 
      WHERE u.id = $1
    `;
    
    const roleCheckResult = await pool.query(roleCheckQuery, [userId]);
    
    if (roleCheckResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userRoles = roleCheckResult.rows.map(r => r.role?.toLowerCase());
    const userName = roleCheckResult.rows[0].full_name;
    if (!userRoles.includes('developer')) {
      console.log('📝 Developer Update API: User exists but roles are:', userRoles);
      return res.status(403).json({
        success: false,
        message: `User ${userName} is not a developer (roles: ${userRoles.join(', ')})`
      });
    }

    console.log('✅ Developer Update API: User verified as developer');

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Handle password update
      if (profileData.password) {
        console.log('🔒 Developer Update API: Updating password');
        await client.query(
          'UPDATE app_user SET password = $1 WHERE id = $2',
          [profileData.password, userId]
        );
      }

      // Handle app_user table updates
      const userUpdateFields = [];
      const userUpdateValues = [];
      let userParamIndex = 1;

      if (profileData.name) {
        userUpdateFields.push(`full_name = $${userParamIndex++}`);
        userUpdateValues.push(profileData.name);
      }
      if (profileData.email) {
        userUpdateFields.push(`email = $${userParamIndex++}`);
        userUpdateValues.push(profileData.email);
      }
      if (profileData.secondaryEmail !== undefined) {
        userUpdateFields.push(`secondary_email = $${userParamIndex++}`);
        userUpdateValues.push(profileData.secondaryEmail);
      }
      if (profileData.profilePictureUrl) {
        userUpdateFields.push(`profile_picture_url = $${userParamIndex++}`);
        userUpdateValues.push(profileData.profilePictureUrl);
      }

      if (userUpdateFields.length > 0) {
        userUpdateValues.push(userId);
        const userUpdateQuery = `
          UPDATE app_user 
          SET ${userUpdateFields.join(', ')}
          WHERE id = $${userParamIndex}
        `;
        console.log('👤 Developer Update API: Updating app_user table');
        await client.query(userUpdateQuery, userUpdateValues);
      }

      // Handle developer_profile table updates
      const profileUpdateFields = [];
      const profileUpdateValues = [];
      let profileParamIndex = 1;

      if (profileData.tel !== undefined) {
        profileUpdateFields.push(`tel = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.tel);
      }
      if (profileData.gender !== undefined) {
        profileUpdateFields.push(`gender = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.gender);
      }
      if (profileData.developerType !== undefined) {
        profileUpdateFields.push(`developer_type = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.developerType);
      }
      if (profileData.linkedinUrl !== undefined) {
        profileUpdateFields.push(`linkedin_url = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.linkedinUrl);
      }
      // bio and dob fields available but not currently used in UI
      if (profileData.bio !== undefined) {
        profileUpdateFields.push(`bio = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.bio);
      }
      if (profileData.dob !== undefined) {
        profileUpdateFields.push(`dob = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.dob);
      }
      if (profileData.nric !== undefined) {
        profileUpdateFields.push(`nric = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.nric);
      }
      if (profileData.nationality !== undefined) {
        profileUpdateFields.push(`nationality = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.nationality);
      }
      if (profileData.ethnicity !== undefined) {
        profileUpdateFields.push(`ethnicity = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.ethnicity);
      }
      if (profileData.cvUrl !== undefined) {
        profileUpdateFields.push(`cv_url = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.cvUrl);
      }
      if (profileData.cvOriginalFilename !== undefined) {
        profileUpdateFields.push(`cv_original_filename = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.cvOriginalFilename);
      }
      if (profileData.cvFolderUrl !== undefined) {
        profileUpdateFields.push(`cv_folder_url = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.cvFolderUrl);
      }
      if (profileData.qualifications !== undefined) {
        profileUpdateFields.push(`qualifications = $${profileParamIndex++}`);
        profileUpdateValues.push(JSON.stringify(profileData.qualifications));
      }
      if (profileData.education !== undefined) {
        profileUpdateFields.push(`education = $${profileParamIndex++}`);
        profileUpdateValues.push(profileData.education); // Store as single string, not JSON array
      }
      if (profileData.areasOfSpecialty !== undefined) {
        profileUpdateFields.push(`areas_of_specialty = $${profileParamIndex++}`);
        profileUpdateValues.push(JSON.stringify(profileData.areasOfSpecialty));
      }
      if (profileData.skillsTags !== undefined) {
        profileUpdateFields.push(`skills_tags = $${profileParamIndex++}`);
        profileUpdateValues.push(JSON.stringify(profileData.skillsTags));
      }

      if (profileUpdateFields.length > 0) {
        profileUpdateValues.push(userId);
        const profileUpdateQuery = `
          UPDATE developer_profile 
          SET ${profileUpdateFields.join(', ')}
          WHERE user_id = $${profileParamIndex}
        `;
        console.log('👨‍💻 Developer Update API: Updating developer_profile table');
        await client.query(profileUpdateQuery, profileUpdateValues);
      }

      // Handle work experience updates
      if (profileData.workExperience !== undefined) {
        console.log('💼 Developer Update API: Updating work experience');
        
        // Delete existing work experience
        await client.query(
          'DELETE FROM work_experience WHERE developer_id = $1',
          [userId]
        );

        // Insert new work experience entries
        for (const exp of profileData.workExperience) {
          if (exp.jobTitle && exp.company) {
            // Convert YYYY-MM format to YYYY-MM-01 for PostgreSQL date type
            const formatDateForDB = (dateStr: string | null): string | null => {
              if (!dateStr || dateStr === 'Present') return null;
              // If already in full date format (YYYY-MM-DD), use as is
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
              // If in YYYY-MM format, add -01 for first day of month
              if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`;
              return null;
            };

            await client.query(`
              INSERT INTO work_experience (
                developer_id, company, job_title, start_date, end_date, description
              ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
              userId,
              exp.company,
              exp.jobTitle,
              formatDateForDB(exp.startDate),
              exp.endDate === 'Present' ? null : formatDateForDB(exp.endDate),
              exp.description || null
            ]);
          }
        }
      }

      // Handle new certification uploads
      if (profileData.newCertifications && profileData.newCertifications.length > 0) {
        console.log('📜 Developer Update API: Adding new certifications');
        
        for (const cert of profileData.newCertifications) {
          await client.query(`
            INSERT INTO certification (
              developer_id, name, file_url, original_filename
            ) VALUES ($1, $2, $3, $4)
          `, [
            userId,
            cert.name,
            cert.fileUrl,
            cert.originalFilename
          ]);
        }
      }

      // Handle certification deletions
      if (profileData.certificationsToDelete && profileData.certificationsToDelete.length > 0) {
        console.log('🗑️ Developer Update API: Deleting certifications');
        
        for (const certId of profileData.certificationsToDelete) {
          // First, get the file URL before deleting from database
          const certQuery = await client.query(
            'SELECT file_url FROM certification WHERE id = $1 AND developer_id = $2',
            [certId, userId]
          );
          
          if (certQuery.rows.length > 0) {
            const fileUrl = certQuery.rows[0].file_url;
            
            // Delete from database
            await client.query(
              'DELETE FROM certification WHERE id = $1 AND developer_id = $2',
              [certId, userId]
            );
            
            // Delete physical file
            try {
              const fs = require('fs');
              const path = require('path');
              
              if (fileUrl && fileUrl.startsWith('/uploads/developer/certification/')) {
                const fileName = path.basename(fileUrl);
                const filePath = path.join(process.cwd(), 'public', 'uploads', 'developer', 'certification', fileName);
                
                console.log(`🗑️ Developer Update API: Attempting to delete certification file: ${filePath}`);
                
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                  console.log(`✅ Developer Update API: Successfully deleted certification file: ${fileName}`);
                } else {
                  console.log(`⚠️ Developer Update API: Certification file not found: ${filePath}`);
                }
              }
            } catch (fileDeleteError) {
              console.error('❌ Developer Update API: Error deleting certification file:', fileDeleteError);
              // Continue execution even if file deletion fails
            }
          }
        }
      }

      await client.query('COMMIT');

      // Fetch updated profile to return
      const updatedProfileResult = await client.query(`
        SELECT 
          au.profile_picture_url AS profile_picture,
          au.full_name AS name,
          dp.tel AS phone,
          au.email,
          au.secondary_email,
          dp.developer_type,
          dp.gender,
          dp.linkedin_url AS linkedin_profile,
          dp.cv_url AS cv,
          dp.cv_original_filename,
          dp.qualifications,
          dp.education,
          dp.areas_of_specialty,
          dp.nric,
          dp.nationality,
          dp.ethnicity,
          TO_CHAR(dp.dob, 'YYYY-MM-DD') AS dob,
          au.password,
          au.password_hash
        FROM developer_profile dp
        JOIN app_user au ON dp.user_id = au.id
        WHERE dp.user_id = $1
      `, [userId]);

      if (updatedProfileResult.rows.length === 0) {
        throw new Error('Developer profile not found after update');
      }

      const updatedRow = updatedProfileResult.rows[0];

      // Fetch updated certifications
      const certificationsResult = await client.query(`
        SELECT 
          c.id,
          c.name,
          c.file_url,
          c.original_filename,
          c.created_at
        FROM certification c
        WHERE c.developer_id = $1
        ORDER BY c.created_at DESC
      `, [userId]);

      // Fetch updated work experience
      const workExpResult = await client.query(`
        SELECT 
          we.id,
          we.company,
          we.job_title,
          we.start_date,
          we.end_date,
          we.description,
          we.created_at
        FROM work_experience we
        WHERE we.developer_id = $1
        ORDER BY we.start_date DESC NULLS LAST
      `, [userId]);

      const updatedProfile = {
        id: userId,
        name: updatedRow.name,
        email: updatedRow.email,
        loginId: updatedRow.email,
        profilePictureUrl: updatedRow.profile_picture,
        tel: updatedRow.phone,
        gender: updatedRow.gender,
        developerType: updatedRow.developer_type,
        linkedinUrl: updatedRow.linkedin_profile,
        nric: updatedRow.nric || '',
        nationality: updatedRow.nationality || '',
        ethnicity: updatedRow.ethnicity || '',
        dob: updatedRow.dob || '',
        secondaryEmail: updatedRow.secondary_email || '',
        cvUrl: updatedRow.cv,
        cvOriginalFilename: updatedRow.cv_original_filename,
        qualifications: (updatedRow.qualifications && typeof updatedRow.qualifications === 'string' && updatedRow.qualifications.trim()) ? JSON.parse(updatedRow.qualifications) : [],
        education: updatedRow.education || '', // Single education string
        areasOfSpecialty: (updatedRow.areas_of_specialty && typeof updatedRow.areas_of_specialty === 'string' && updatedRow.areas_of_specialty.trim()) ? JSON.parse(updatedRow.areas_of_specialty) : [],
        certifications: certificationsResult.rows.map(cert => ({
          id: cert.id,
          name: cert.name,
          fileUrl: cert.file_url,
          originalFilename: cert.original_filename,
          createdAt: cert.created_at
        })),
        workExperience: workExpResult.rows.map(exp => {
          // Convert dates back to YYYY-MM format for frontend
          const formatDateForFrontend = (dateStr: string | null): string => {
            if (!dateStr) return 'Present';
            // Convert YYYY-MM-DD to YYYY-MM
            if (typeof dateStr === 'string' && dateStr.includes('-')) {
              return dateStr.substring(0, 7); // Get YYYY-MM part
            }
            return dateStr;
          };

          return {
            id: exp.id,
            jobTitle: exp.job_title,
            company: exp.company,
            startDate: formatDateForFrontend(exp.start_date),
            endDate: exp.end_date ? formatDateForFrontend(exp.end_date) : 'Present',
            description: exp.description || ''
          };
        }),
        password: updatedRow.password,
        passwordHash: updatedRow.password_hash
      };

      console.log('✅ Developer Update API: Profile updated successfully');

      res.status(200).json({
        success: true,
        message: 'Developer profile updated successfully',
        data: {
          profile: updatedProfile
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Developer Update API: Error updating profile:', error);
    
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}

export default withAuth(handler);
