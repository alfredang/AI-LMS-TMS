import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface TrainerProfileRow {
  name: string;
  picture: string;
  telephone: string;
  email: string;
  password: string;
  password_hash: string;
  gender: string;
  trainer_type: string;
  status: string;
  linkedin_url: string;
  cv_url: string;
  cv_original_filename: string;
  qualifications: any;
  education: string;
  areas_of_expertise: any;
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

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    console.log('🔍 Trainer API: Received request for userId:', userId);

    if (!userId || typeof userId !== 'string') {
      console.log('❌ Trainer API: Invalid userId provided');
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    console.log('📋 Trainer API: Executing trainer profile query...');

    // SQL query to get trainer profile data
    // Use LEFT JOIN to handle multi-role users who may not have trainer_profile record yet
    const trainerProfileQuery = `
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
        t.areas_of_expertise
      FROM app_user u
      LEFT JOIN trainer_profile t
        ON t.user_id = u.id
      WHERE u.id = $1
    `;

    // SQL query to get work experience
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

    // SQL query to get certifications
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

    console.log('📋 Trainer API: Executing database queries...');

    const [profileResult, workExpResult, certificationsResult] = await Promise.all([
      pool.query(trainerProfileQuery, [userId]).catch(err => {
        console.error('❌ Trainer API: Profile query error:', err);
        throw err;
      }),
      pool.query(workExperienceQuery, [userId]).catch(err => {
        console.error('❌ Trainer API: Work experience query error:', err);
        throw err;
      }),
      pool.query(certificationsQuery, [userId]).catch(err => {
        console.error('❌ Trainer API: Certifications query error:', err);
        throw err;
      })
    ]);

    console.log('📋 Trainer API: Profile query result:', {
      rowCount: profileResult.rows.length,
      hasData: profileResult.rows.length > 0
    });

    console.log('📋 Trainer API: Work experience query result:', {
      rowCount: workExpResult.rows.length
    });

    console.log('📋 Trainer API: Certifications query result:', {
      rowCount: certificationsResult.rows.length
    });

    if (profileResult.rows.length === 0) {
      console.log('❌ Trainer API: No user found for userId:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Profile row exists (app_user found), but trainer_profile may be NULL for multi-role users
    console.log('📋 Trainer API: User found, trainer_profile may be NULL for multi-role users');

    const row: TrainerProfileRow = profileResult.rows[0];

    console.log('📋 Trainer API: Retrieved trainer data:', {
      name: row.name,
      email: row.email,
      hasWorkExp: workExpResult.rows.length > 0,
      hasCertifications: certificationsResult.rows.length > 0
    });

    // Transform work experience data
    const workExperience = workExpResult.rows.map(exp => ({
      id: exp.id,
      jobTitle: exp.job_title,
      company: exp.company,
      startDate: exp.start_date,
      endDate: exp.end_date || 'Present', // Handle null end_date as 'Present'
      description: exp.description || ''
    }));

    // Transform certifications data
    const certifications = certificationsResult.rows.map(cert => ({
      id: cert.id,
      name: cert.name,
      fileUrl: cert.file_url,
      originalFilename: cert.original_filename,
      createdAt: cert.created_at
    }));

    // Transform the data to match frontend expectations
    // Handle NULL values for multi-role users who may not have trainer_profile record
    const trainerProfile = {
      id: userId,
      name: row.name,
      email: row.email,
      loginId: row.email, // Using email as login ID
      profilePictureUrl: row.picture,
      tel: row.telephone || '',
      gender: row.gender || '',
      trainerType: row.trainer_type || '',
      status: row.status || '',
      linkedinUrl: row.linkedin_url || '',
      cvUrl: row.cv_url || '',
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
      education: row.education || '',
      areasOfExpertise: (() => {
        if (!row.areas_of_expertise) return [];
        if (Array.isArray(row.areas_of_expertise)) return row.areas_of_expertise;
        if (typeof row.areas_of_expertise === 'object' && Object.keys(row.areas_of_expertise).length === 0) return [];
        if (typeof row.areas_of_expertise === 'string') return JSON.parse(row.areas_of_expertise);
        return [];
      })(),
      workExperience: workExperience, // Use data from work_experience table
      // Additional fields for security (not exposed to frontend)
      password: row.password,
      passwordHash: row.password_hash
    };

    console.log('✅ Trainer API: Successfully transformed profile data');

    res.status(200).json({
      success: true,
      data: {
        profile: trainerProfile
      }
    });

  } catch (error) {
    console.error('❌ Trainer API: Error fetching trainer profile:', error);
    console.error('❌ Trainer API: Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      userId: req.query.userId
    });
    
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}