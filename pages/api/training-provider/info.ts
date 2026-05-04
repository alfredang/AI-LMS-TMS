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
          tp.uen,
          tp.company_website,
          tp.company_email,
          tp.company_logo_url AS profile_picture_url,
          tp.company_name,
          tp.company_shortname,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.color_scheme,
          tp.force_first_password_change,
          tp.support_email,
          tp.contact_tel,
          tp.company_tel,
          tp.company_address,
          tp.show_lesson_plan_learner_view
        FROM training_provider_member tpm
        JOIN training_provider tp ON tpm.provider_id = tp.id
        WHERE tpm.user_id = $1
      `, [userId]);

      // 2. If not found, check if user IS the training provider (direct ownership)
      if (result.rows.length === 0) {
        result = await pool.query(`
          SELECT
            tp.id,
            tp.uen,
            tp.company_logo_url AS profile_picture_url,
            tp.company_name,
            tp.company_shortname,
            tp.enable_otp_login,
            tp.enable_default_otp,
            tp.default_otp,
            tp.color_scheme,
            tp.force_first_password_change,
            tp.support_email,
            tp.contact_tel,
            tp.company_tel,
            tp.company_address,
            tp.show_lesson_plan_learner_view
          FROM training_provider tp
          WHERE tp.id = $1
        `, [userId]);
      }

      // 3. If still not found, check provider_admin_user (legacy)
      if (result.rows.length === 0) {
        result = await pool.query(`
          SELECT
            tp.id,
            tp.uen,
            tp.company_logo_url AS profile_picture_url,
            tp.company_name,
            tp.company_shortname,
            tp.enable_otp_login,
            tp.enable_default_otp,
            tp.default_otp,
            tp.color_scheme,
            tp.force_first_password_change,
            tp.support_email,
            tp.contact_tel,
            tp.company_tel,
            tp.company_address,
            tp.show_lesson_plan_learner_view
          FROM provider_admin_user pau
          JOIN training_provider tp ON pau.provider_id = tp.id
          WHERE pau.user_id = $1
        `, [userId]);
      }
      
      if (result.rows.length > 0) {
        const trainingProvider = result.rows[0];

        // Safely fetch extra integration columns (each group independent)
        let refLinks: any = {};
        try {
          const r = await pool.query(`SELECT master_list_url, tertiary_tms_url, tertiary_fms_url, tertiary_mms_url, tertiary_tpms_url FROM training_provider WHERE id = $1`, [trainingProvider.id]);
          if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
        } catch (e) { /* columns don't exist */ }
        try {
          const r = await pool.query(`SELECT n8n_host1_url, n8n_host2_url FROM training_provider WHERE id = $1`, [trainingProvider.id]);
          if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
        } catch (e) { /* columns don't exist */ }
        try {
          const r = await pool.query(`SELECT n8n_finance_webhooks_json FROM training_provider WHERE id = $1`, [trainingProvider.id]);
          if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
        } catch (e) { /* columns don't exist */ }
        try {
          const r = await pool.query(`SELECT magento_backend_url FROM training_provider WHERE id = $1`, [trainingProvider.id]);
          if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
        } catch (e) { /* columns don't exist */ }

        let privacyPolicy: string | null = null;
        let acceptableUsePolicy: string | null = null;
        try {
          const r = await pool.query(`SELECT privacy_policy, acceptable_use_policy FROM training_provider WHERE id = $1`, [trainingProvider.id]);
          if (r.rows.length > 0) {
            privacyPolicy = r.rows[0].privacy_policy;
            acceptableUsePolicy = r.rows[0].acceptable_use_policy;
          }
        } catch (e) { /* columns don't exist */ }

        let virtualMeetingProvider: 'google_meet' | 'zoom' | 'teams' = 'google_meet';
        try {
          const r = await pool.query(`SELECT virtual_meeting_provider FROM training_provider WHERE id = $1`, [trainingProvider.id]);
          const v = r.rows[0]?.virtual_meeting_provider;
          if (v === 'zoom' || v === 'teams') virtualMeetingProvider = v;
        } catch (e) { /* column doesn't exist yet */ }

        const responseData = {
          uen: trainingProvider.uen || '',
          companyWebsite: trainingProvider.company_website || '',
          companyEmail: trainingProvider.company_email || '',
          companyLogoUrl: getAbsoluteImageUrl(trainingProvider.profile_picture_url),
          companyName: trainingProvider.company_name || 'Training Provider',
          companyShortname: trainingProvider.company_shortname || 'TP',
          enableOtpLogin: trainingProvider.enable_otp_login || false,
          enableDefaultOtp: trainingProvider.enable_default_otp || false,
          defaultOtp: trainingProvider.default_otp || '',
          colorScheme: trainingProvider.color_scheme || null,
          forceFirstPasswordChange: trainingProvider.force_first_password_change || false,
          showLessonPlanLearnerView: trainingProvider.show_lesson_plan_learner_view || false,
          privacyPolicy: privacyPolicy || null,
          acceptableUsePolicy: acceptableUsePolicy || null,
          virtualMeetingProvider,
          referenceLinks: {
            masterListUrl: refLinks.master_list_url || '',
            tertiaryTmsUrl: refLinks.tertiary_tms_url || '',
            tertiaryFmsUrl: refLinks.tertiary_fms_url || '',
            tertiaryMmsUrl: refLinks.tertiary_mms_url || '',
            tertiaryTpmsUrl: refLinks.tertiary_tpms_url || '',
            n8nHost1Url: refLinks.n8n_host1_url || '',
            n8nHost2Url: refLinks.n8n_host2_url || '',
            n8nFinanceWebhooksJson: refLinks.n8n_finance_webhooks_json || '',
            magentoBackendUrl: refLinks.magento_backend_url || '',
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
          tp.uen,
          tp.company_website,
          tp.company_email,
          tp.company_logo_url AS profile_picture_url,
          tp.company_name,
          tp.company_shortname,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.color_scheme,
          tp.force_first_password_change,
          tp.support_email,
          tp.contact_tel,
          tp.company_tel,
          tp.company_address,
          tp.show_lesson_plan_learner_view
        FROM user_role_map urm
        JOIN app_user au ON au.id = urm.user_id
        CROSS JOIN training_provider tp
        WHERE urm.role = 'Training Provider'
        LIMIT 1;
      `);
    } catch (error) {
      console.error('❌ Training provider table query failed:', error);
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
        WHERE urm.role = 'Training Provider'
        LIMIT 1;
      `);

      // Use default training provider info
      const responseData = {
        uen: '',
        companyWebsite: '',
        companyEmail: '',
        companyLogoUrl: trainingProviderUser.rows.length > 0 && trainingProviderUser.rows[0].profile_picture_url
          ? getAbsoluteImageUrl(trainingProviderUser.rows[0].profile_picture_url)
          : '/images/default-company-logo.png',
        companyName: 'Training Provider',
        companyShortname: 'TP',
        enableOtpLogin: true,
        enableDefaultOtp: false,
        defaultOtp: '',
        colorScheme: null,
        forceFirstPasswordChange: false,
        showLessonPlanLearnerView: false,
        privacyPolicy: null,
        acceptableUsePolicy: null
      };

      console.log('✅ Training provider info (default):', responseData);
      
      return res.status(200).json({
        success: true,
        data: responseData
      });
    }

    const trainingProvider = result.rows[0];

    let fallbackPrivacyPolicy: string | null = null;
    let fallbackAcceptableUsePolicy: string | null = null;
    try {
      const r = await pool.query('SELECT privacy_policy, acceptable_use_policy FROM training_provider LIMIT 1');
      if (r.rows.length > 0) {
        fallbackPrivacyPolicy = r.rows[0].privacy_policy;
        fallbackAcceptableUsePolicy = r.rows[0].acceptable_use_policy;
      }
    } catch (e) { /* columns don't exist */ }

    let fallbackVirtualMeetingProvider: 'google_meet' | 'zoom' | 'teams' = 'google_meet';
    try {
      const r = await pool.query('SELECT virtual_meeting_provider FROM training_provider LIMIT 1');
      const v = r.rows[0]?.virtual_meeting_provider;
      if (v === 'zoom' || v === 'teams') fallbackVirtualMeetingProvider = v;
    } catch (e) { /* column doesn't exist yet */ }

    const responseData = {
      uen: trainingProvider.uen || '',
      companyWebsite: trainingProvider.company_website || '',
      companyEmail: trainingProvider.company_email || '',
      supportEmail: trainingProvider.support_email || trainingProvider.company_email || '',
      contactTel: trainingProvider.contact_tel || trainingProvider.company_tel || '',
      companyAddress: trainingProvider.company_address || '',
      companyLogoUrl: getAbsoluteImageUrl(trainingProvider.profile_picture_url),
      companyName: trainingProvider.company_name || 'Training Provider',
      companyShortname: trainingProvider.company_shortname || 'TP',
      enableOtpLogin: trainingProvider.enable_otp_login || false,
      enableDefaultOtp: trainingProvider.enable_default_otp || false,
      defaultOtp: trainingProvider.default_otp || '',
      colorScheme: trainingProvider.color_scheme || null,
      forceFirstPasswordChange: trainingProvider.force_first_password_change || false,
      showLessonPlanLearnerView: trainingProvider.show_lesson_plan_learner_view || false,
      privacyPolicy: fallbackPrivacyPolicy || null,
      acceptableUsePolicy: fallbackAcceptableUsePolicy || null,
      virtualMeetingProvider: fallbackVirtualMeetingProvider
    };

    console.log('✅ Training provider info fetched:', responseData);
    
    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error: any) {
    console.error('❌ Error in /api/training-provider/info:', {
      message: error.message,
      stack: error.stack,
      query: error.query,
      detail: error.detail
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch training provider info',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
