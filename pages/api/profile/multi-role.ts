import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { userId } = req.query;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    console.log('📋 Multi-Role API: Fetching for userId:', userId);

    // 1. Get user roles
    const rolesResult = await pool.query(
      'SELECT role FROM user_role_map WHERE user_id = $1',
      [userId]
    );
    const roles = rolesResult.rows.map(r => r.role as string);
    
    const isTrainer = roles.some(r => r.toLowerCase() === 'trainer');
    const isDeveloper = roles.some(r => r.toLowerCase() === 'developer');

    // 2. Get shared user data
    const userResult = await pool.query(`
      SELECT id, full_name, email, secondary_email, profile_picture_url, password, password_hash
      FROM app_user WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const user = userResult.rows[0];

    // 3. Get trainer profile if applicable
    let trainerData: any = null;
    let trainerWorkExp: any[] = [];
    let trainerCerts: any[] = [];

    if (isTrainer) {
      const tpResult = await pool.query(`
        SELECT tel, gender, trainer_type, status, linkedin_url, cv_url, cv_original_filename, cv_folder_url,
               qualifications, education, areas_of_expertise, skills_tags, certification_tags, common_name, country,
               cn_plus_email, nric, nationality, ethnicity, TO_CHAR(dob, 'YYYY-MM-DD') as dob
        FROM trainer_profile WHERE user_id = $1
      `, [userId]);

      if (tpResult.rows.length > 0) {
        const tp = tpResult.rows[0];
        const parseJsonb = (val: any) => {
          if (!val) return [];
          if (Array.isArray(val)) return val;
          if (typeof val === 'object' && Object.keys(val).length === 0) return [];
          if (typeof val === 'string') try { return JSON.parse(val); } catch { return []; }
          return [];
        };
        trainerData = {
          tel: tp.tel || '',
          gender: tp.gender || '',
          trainerType: tp.trainer_type || '',
          status: tp.status || '',
          linkedinUrl: tp.linkedin_url || '',
          cvUrl: tp.cv_url || '',
          cvOriginalFilename: tp.cv_original_filename || '',
          cvFolderUrl: tp.cv_folder_url || '',
          qualifications: parseJsonb(tp.qualifications),
          education: tp.education || '',
          areasOfExpertise: parseJsonb(tp.areas_of_expertise),
          skillsTags: parseJsonb(tp.skills_tags),
          certificationTags: parseJsonb(tp.certification_tags),
          commonName: tp.common_name || '',
          country: tp.country || '',
          cnPlusEmail: tp.cn_plus_email || '',
          nric: tp.nric || '',
          nationality: tp.nationality || '',
          ethnicity: tp.ethnicity || '',
          dob: tp.dob || '',
        };
      }

      const weResult = await pool.query(`
        SELECT id, company, job_title, TO_CHAR(start_date, 'YYYY-MM') as start_date,
               CASE WHEN end_date IS NULL THEN NULL ELSE TO_CHAR(end_date, 'YYYY-MM') END as end_date,
               description
        FROM work_experience WHERE trainer_id = $1 ORDER BY start_date DESC
      `, [userId]);
      trainerWorkExp = weResult.rows.map(e => ({
        id: e.id, jobTitle: e.job_title, company: e.company,
        startDate: e.start_date, endDate: e.end_date || 'Present', description: e.description || ''
      }));

      const certResult = await pool.query(`
        SELECT id, name, file_url, original_filename, created_at
        FROM certification WHERE trainer_id = $1 ORDER BY created_at DESC
      `, [userId]);
      trainerCerts = certResult.rows.map(c => ({
        id: c.id, name: c.name, fileUrl: c.file_url, originalFilename: c.original_filename
      }));
    }

    // 4. Get developer profile if applicable
    let developerData: any = null;
    let developerWorkExp: any[] = [];
    let developerCerts: any[] = [];

    if (isDeveloper) {
      const dpResult = await pool.query(`
        SELECT tel, developer_type, gender, linkedin_url, cv_url, cv_original_filename, cv_folder_url,
               qualifications, education, areas_of_specialty, skills_tags, nric, nationality, ethnicity,
               TO_CHAR(dob, 'YYYY-MM-DD') as dob, secondary_email
        FROM developer_profile WHERE user_id = $1
      `, [userId]);

      if (dpResult.rows.length > 0) {
        const dp = dpResult.rows[0];
        const parseJsonb = (val: any) => {
          if (!val) return [];
          if (Array.isArray(val)) return val;
          if (typeof val === 'object' && Object.keys(val).length === 0) return [];
          if (typeof val === 'string') try { return JSON.parse(val); } catch { return []; }
          return [];
        };
        developerData = {
          tel: dp.tel || '',
          developerType: dp.developer_type || '',
          gender: dp.gender || '',
          linkedinUrl: dp.linkedin_url || '',
          cvUrl: dp.cv_url || '',
          cvOriginalFilename: dp.cv_original_filename || '',
          cvFolderUrl: dp.cv_folder_url || '',
          qualifications: parseJsonb(dp.qualifications),
          education: dp.education || '',
          areasOfSpecialty: parseJsonb(dp.areas_of_specialty),
          skillsTags: parseJsonb(dp.skills_tags),
          nric: dp.nric || '',
          nationality: dp.nationality || '',
          ethnicity: dp.ethnicity || '',
          dob: dp.dob || '',
        };
      }

      const weResult = await pool.query(`
        SELECT id, company, job_title, TO_CHAR(start_date, 'YYYY-MM') as start_date,
               CASE WHEN end_date IS NULL THEN NULL ELSE TO_CHAR(end_date, 'YYYY-MM') END as end_date,
               description
        FROM work_experience WHERE developer_id = $1 ORDER BY start_date DESC
      `, [userId]);
      developerWorkExp = weResult.rows.map(e => ({
        id: e.id, jobTitle: e.job_title, company: e.company,
        startDate: e.start_date, endDate: e.end_date || 'Present', description: e.description || ''
      }));

      const certResult = await pool.query(`
        SELECT id, name, file_url, original_filename, created_at
        FROM certification WHERE developer_id = $1 ORDER BY created_at DESC
      `, [userId]);
      developerCerts = certResult.rows.map(c => ({
        id: c.id, name: c.name, fileUrl: c.file_url, originalFilename: c.original_filename
      }));
    }

    // 5. Build unified response
    // Resolve shared fields: prefer trainer data, fallback to developer
    const shared = {
      id: userId,
      name: user.full_name,
      email: user.email,
      loginId: user.email,
      secondaryEmail: user.secondary_email || '',
      profilePictureUrl: user.profile_picture_url || '',
      password: user.password,
      passwordHash: user.password_hash,
      // Personal info - prefer trainer, fallback to developer
      tel: trainerData?.tel || developerData?.tel || '',
      gender: trainerData?.gender || developerData?.gender || '',
      linkedinUrl: trainerData?.linkedinUrl || developerData?.linkedinUrl || '',
      nric: trainerData?.nric || developerData?.nric || '',
      nationality: trainerData?.nationality || developerData?.nationality || '',
      ethnicity: trainerData?.ethnicity || developerData?.ethnicity || '',
      dob: trainerData?.dob || developerData?.dob || '',
    };

    const response: any = {
      roles,
      shared,
    };

    if (isTrainer && trainerData) {
      response.trainer = {
        trainerType: trainerData.trainerType,
        status: trainerData.status,
        cvUrl: trainerData.cvUrl,
        cvOriginalFilename: trainerData.cvOriginalFilename,
        cvFolderUrl: trainerData.cvFolderUrl,
        qualifications: trainerData.qualifications,
        education: trainerData.education,
        areasOfExpertise: trainerData.areasOfExpertise,
        skillsTags: trainerData.skillsTags,
        certificationTags: trainerData.certificationTags,
        commonName: trainerData.commonName,
        country: trainerData.country,
        cnPlusEmail: trainerData.cnPlusEmail,
        workExperience: trainerWorkExp,
        certifications: trainerCerts,
      };
    }

    if (isDeveloper && developerData) {
      response.developer = {
        developerType: developerData.developerType,
        cvUrl: developerData.cvUrl,
        cvOriginalFilename: developerData.cvOriginalFilename,
        cvFolderUrl: developerData.cvFolderUrl,
        qualifications: developerData.qualifications,
        education: developerData.education,
        areasOfSpecialty: developerData.areasOfSpecialty,
        workExperience: developerWorkExp,
        certifications: developerCerts,
      };
    }

    console.log('✅ Multi-Role API: Returning profile with roles:', roles);

    return res.status(200).json({
      success: true,
      data: response,
    });

  } catch (error) {
    console.error('❌ Multi-Role API: Error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
