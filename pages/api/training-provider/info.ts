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
    const { userId } = req.query;

    // Helper function to ensure absolute URL for images
    const getAbsoluteImageUrl = (url: string | null) => {
      if (!url) return '/images/default-company-logo.png';
      if (url.startsWith('http') || url.startsWith('blob:')) return url;
      const base = getBaseUrl().replace(/\/$/, '');
      const path = url.startsWith('/') ? url : `/${url}`;
      return `${base}${path}`;
    };

    // If userId is provided, get info for that specific user's organization
    if (userId && typeof userId === 'string') {
      console.log('🔍 Fetching training provider info for user:', userId);
      
      // Try to find user's training provider organization using 3-tier lookup
      let result;
      
      // 1. Try training_provider_member (multi-company approach)
      result = await pool.query(`
        SELECT
          tp.id,
          tp.company_logo_url AS profile_picture_url,
          tp.company_name,
          tp.company_shortname,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.color_scheme,
          tp.force_first_password_change
        FROM training_provider_member tpm
        JOIN training_provider tp ON tpm.provider_id = tp.id
        WHERE tpm.user_id = $1
      `, [userId]);

      // 2. If not found, check if user IS the training provider (direct ownership)
      if (result.rows.length === 0) {
        result = await pool.query(`
          SELECT
            tp.id,
            tp.company_logo_url AS profile_picture_url,
            tp.company_name,
            tp.company_shortname,
            tp.enable_otp_login,
            tp.enable_default_otp,
            tp.default_otp,
            tp.color_scheme,
            tp.force_first_password_change
          FROM training_provider tp
          WHERE tp.id = $1
        `, [userId]);
      }

      // 3. If still not found, check provider_admin_user (legacy)
      if (result.rows.length === 0) {
        result = await pool.query(`
          SELECT
            tp.id,
            tp.company_logo_url AS profile_picture_url,
            tp.company_name,
            tp.company_shortname,
            tp.enable_otp_login,
            tp.enable_default_otp,
            tp.default_otp,
            tp.color_scheme,
            tp.force_first_password_change
          FROM provider_admin_user pau
          JOIN training_provider tp ON pau.provider_id = tp.id
          WHERE pau.user_id = $1
        `, [userId]);
      }
      
      if (result.rows.length > 0) {
        const trainingProvider = result.rows[0];

        // Safely fetch reference links (columns may not exist)
        let refLinks: any = {};
        try {
          const refResult = await pool.query(
            `SELECT master_list_url, tertiary_tms_url, tertiary_fms_url, tertiary_mms_url, tertiary_tpms_url, n8n_host1_url, n8n_host2_url FROM training_provider WHERE id = $1`,
            [trainingProvider.id]
          );
          if (refResult.rows.length > 0) refLinks = refResult.rows[0];
        } catch (e) { /* columns don't exist yet */ }

        const responseData = {
          companyLogoUrl: getAbsoluteImageUrl(trainingProvider.profile_picture_url),
          companyName: trainingProvider.company_name || 'Training Provider',
          companyShortname: trainingProvider.company_shortname || 'TP',
          enableOtpLogin: trainingProvider.enable_otp_login || false,
          enableDefaultOtp: trainingProvider.enable_default_otp || false,
          defaultOtp: trainingProvider.default_otp || '',
          colorScheme: trainingProvider.color_scheme || null,
          forceFirstPasswordChange: trainingProvider.force_first_password_change || false,
          referenceLinks: {
            masterListUrl: refLinks.master_list_url || '',
            tertiaryTmsUrl: refLinks.tertiary_tms_url || '',
            tertiaryFmsUrl: refLinks.tertiary_fms_url || '',
            tertiaryMmsUrl: refLinks.tertiary_mms_url || '',
            tertiaryTpmsUrl: refLinks.tertiary_tpms_url || '',
            n8nHost1Url: refLinks.n8n_host1_url || '',
            n8nHost2Url: refLinks.n8n_host2_url || '',
          },
        };

        console.log('✅ Training provider info fetched for user:', responseData);
        return res.status(200).json({
          success: true,
          data: responseData
        });
      }
    }

    // Fallback: Get the first training provider in the system (for login screen, etc.)
    console.log('🔍 Fetching default training provider info (no userId or not found)');
    let result;
    try {
      result = await pool.query(`
        SELECT
          au.id AS user_id,
          tp.company_logo_url AS profile_picture_url,
          tp.company_name,
          tp.company_shortname,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.color_scheme,
          tp.force_first_password_change
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
        enableDefaultOtp: false,
        defaultOtp: '',
        colorScheme: null,
        forceFirstPasswordChange: false
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
      defaultOtp: trainingProvider.default_otp || '',
      colorScheme: trainingProvider.color_scheme || null,
      forceFirstPasswordChange: trainingProvider.force_first_password_change || false
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
