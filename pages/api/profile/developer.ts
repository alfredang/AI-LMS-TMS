import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface DeveloperProfileRow {
  profile_picture: string;
  name: string;
  phone: string;
  email: string;
  developer_type: string;
  gender: string;
  linkedin_profile: string;
  cv: string;
  cv_original_filename: string;
  qualifications: any;
  education: any;
  areas_of_specialty: any;
  password: string;
  password_hash: string;
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
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      console.log('❌ Developer API: Invalid or missing userId');
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    console.log('📋 Developer API: Fetching profile for userId:', userId);

    // Main query to get developer profile with user data
    // Use LEFT JOIN to handle multi-role users who may not have developer_profile record yet
    const developerProfileQuery = `
      SELECT
        au.profile_picture_url AS profile_picture,
        au.full_name AS name,
        dp.tel AS phone,
        au.email,
        dp.developer_type,
        dp.gender,
        dp.linkedin_url AS linkedin_profile,
        dp.cv_url AS cv,
        dp.cv_original_filename AS cv_original_filename,
        dp.qualifications,
        dp.education,
        dp.areas_of_specialty,
        au.password,
        au.password_hash
      FROM app_user au
      LEFT JOIN developer_profile dp ON dp.user_id = au.id
      WHERE au.id = $1
    `;

    // Query for work experience
    const workExperienceQuery = `
      SELECT 
        we.id,
        we.company,
        we.job_title,
        TO_CHAR(we.start_date, 'YYYY-MM') as start_date,
        CASE 
          WHEN we.end_date IS NULL THEN NULL
          ELSE TO_CHAR(we.end_date, 'YYYY-MM')
        END as end_date,
        we.description,
        we.created_at
      FROM work_experience we
      WHERE we.developer_id = $1
      ORDER BY we.start_date DESC
    `;

    // Query for certifications
    const certificationsQuery = `
      SELECT 
        c.id,
        c.name,
        c.file_url,
        c.original_filename,
        c.created_at
      FROM certification c
      WHERE c.developer_id = $1
      ORDER BY c.created_at DESC
    `;

    console.log('📋 Developer API: Executing database queries...');

    const [profileResult, workExpResult, certificationsResult] = await Promise.all([
      pool.query(developerProfileQuery, [userId]).catch(err => {
        console.error('❌ Developer API: Profile query error:', err);
        throw err;
      }),
      pool.query(workExperienceQuery, [userId]).catch(err => {
        console.error('❌ Developer API: Work experience query error:', err);
        throw err;
      }),
      pool.query(certificationsQuery, [userId]).catch(err => {
        console.error('❌ Developer API: Certifications query error:', err);
        throw err;
      })
    ]);

    console.log('📋 Developer API: Profile query result:', {
      rowCount: profileResult.rows.length,
      hasData: profileResult.rows.length > 0
    });

    console.log('📋 Developer API: Work experience query result:', {
      rowCount: workExpResult.rows.length
    });

    console.log('📋 Developer API: Certifications query result:', {
      rowCount: certificationsResult.rows.length
    });

    if (profileResult.rows.length === 0) {
      console.log('❌ Developer API: No user found for userId:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Profile row exists (app_user found), but developer_profile may be NULL for multi-role users
    console.log('📋 Developer API: User found, developer_profile may be NULL for multi-role users');

    const row: DeveloperProfileRow = profileResult.rows[0];

    console.log('📋 Developer API: Retrieved developer data:', {
      name: row.name,
      email: row.email,
      hasWorkExp: workExpResult.rows.length > 0,
      hasCertifications: certificationsResult.rows.length > 0
    });

    // Transform work experience data from database query
    const workExperience = workExpResult.rows.map((exp: any) => {
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
    });

    // Transform certifications data
    const certifications = certificationsResult.rows.map(cert => ({
      id: cert.id,
      name: cert.name,
      fileUrl: cert.file_url,
      originalFilename: cert.original_filename,
      createdAt: cert.created_at
    }));

    // Transform the data to match frontend expectations
    // Handle NULL values for multi-role users who may not have developer_profile record
    const developerProfile = {
      id: userId,
      name: row.name,
      email: row.email,
      loginId: row.email, // Using email as login ID
      profilePictureUrl: row.profile_picture,
      tel: row.phone || '',
      gender: row.gender || '',
      developerType: row.developer_type || '',
      linkedinUrl: row.linkedin_profile || '',
      cvUrl: row.cv || '',
      cvOriginalFilename: row.cv_original_filename || '',
      // Use data from certification table
      certifications: certifications,
      qualifications: (() => {
        if (!row.qualifications) return [];
        if (Array.isArray(row.qualifications)) return row.qualifications;
        if (typeof row.qualifications === 'object' && Object.keys(row.qualifications).length === 0) return [];
        if (typeof row.qualifications === 'string') return JSON.parse(row.qualifications);
        return [];
      })(),
      education: row.education || '', // Single education string
      areasOfSpecialty: (() => {
        if (!row.areas_of_specialty) return [];
        if (Array.isArray(row.areas_of_specialty)) return row.areas_of_specialty;
        if (typeof row.areas_of_specialty === 'object' && Object.keys(row.areas_of_specialty).length === 0) return [];
        if (typeof row.areas_of_specialty === 'string') return JSON.parse(row.areas_of_specialty);
        return [];
      })(),
      workExperience: workExperience, // Use data from work_experience table
      // Additional fields for security (not exposed to frontend)
      password: row.password,
      passwordHash: row.password_hash
    };

    console.log('✅ Developer API: Successfully transformed profile data');

    res.status(200).json({
      success: true,
      data: {
        profile: developerProfile
      }
    });

  } catch (error) {
    console.error('❌ Developer API: Error fetching developer profile:', error);
    console.error('❌ Developer API: Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      userId: req.query.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching developer profile'
    });
  }
}