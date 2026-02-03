import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Helper function to ensure absolute URL for images
    const getAbsoluteImageUrl = (url: string | null) => {
      if (!url) return '/images/default-company-logo.png';
      if (url.startsWith('http') || url.startsWith('blob:')) return url;
      return `${getBaseUrl()}${url}`;
    };

    // First try the specified SQL query for training_provider table
    let result;
    try {
      result = await pool.query(`
        SELECT
          au.id AS user_id,
          COALESCE(tp.company_logo_url, au.profile_picture_url) AS profile_picture_url,
          tp.company_name,
          tp.company_shortname,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.color_scheme
        FROM user_role_map urm
        JOIN app_user au ON au.id = urm.user_id
        CROSS JOIN training_provider tp
        WHERE urm.role = 'Training Provider'::user_role
        LIMIT 1;
      `);
    } catch (error) {
      console.log('Training provider table query failed, checking for data...', error);
      result = { rows: [] };
    }

    // If no data in training_provider table, create default data
    if (result.rows.length === 0) {
      console.log('No training provider data found, creating default entry...');
      
      // Get the first training provider user for logo
      const trainingProviderUser = await pool.query(`
        SELECT au.id, au.profile_picture_url
        FROM user_role_map urm
        JOIN app_user au ON au.id = urm.user_id
        WHERE urm.role = 'Training Provider'::user_role
        LIMIT 1;
      `);

      // Use default training provider info
      const responseData = {
        companyLogoUrl: trainingProviderUser.rows.length > 0 && trainingProviderUser.rows[0].profile_picture_url 
          ? getAbsoluteImageUrl(trainingProviderUser.rows[0].profile_picture_url)
          : '/images/default-company-logo.png',
        companyName: 'Training Provider',
        companyShortname: 'TP',
        enableOtpLogin: true,
        enableDefaultOtp: true,
        defaultOtp: '123456',
        colorScheme: null
      };

      console.log('✅ Training provider info (default):', responseData);
      
      return res.status(200).json({
        success: true,
        data: responseData
      });
    }

    const trainingProvider = result.rows[0];

    const responseData = {
      companyLogoUrl: getAbsoluteImageUrl(trainingProvider.profile_picture_url),
      companyName: trainingProvider.company_name || 'Training Provider',
      companyShortname: trainingProvider.company_shortname || 'TP',
      enableOtpLogin: trainingProvider.enable_otp_login || false,
      enableDefaultOtp: trainingProvider.enable_default_otp || false,
      defaultOtp: trainingProvider.default_otp || '123456',
      colorScheme: trainingProvider.color_scheme || null
    };

    console.log('✅ Training provider info fetched:', responseData);
    
    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Error fetching training provider info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch training provider info'
    });
  }
}
