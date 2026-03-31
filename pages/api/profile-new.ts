import type { NextApiRequest, NextApiResponse } from 'next'
import pool from '../../lib/db';
import { cors } from '../../lib/cors';


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

  if (req.method !== 'GET') {
    return res.status(405).json(
      createApiResponse(false, 'Method not allowed')
    );
  }

  try {
    const { userId, role } = req.query;

    console.log('🔍 Profile API called with:', { userId, role });

    if (!userId || !role || typeof userId !== 'string' || typeof role !== 'string') {
      return res.status(400).json(
        createApiResponse(false, 'Missing userId or role parameter')
      );
    }

    let profileData = null;

    if (role === 'learner') {
      profileData = await getLearnerProfile(userId);
    } else if (role === 'admin') {
      profileData = await getAdminProfile(userId);
    } else if (role === 'trainer') {
      profileData = await getTrainerProfile(userId);
    } else if (role === 'training_provider') {
      profileData = await getTrainingProviderProfile(userId);
    } else {
      return res.status(400).json(
        createApiResponse(false, `Role ${role} not implemented yet`)
      );
    }

    if (!profileData) {
      console.log('❌ No profile found in database for:', { userId, role });
      return res.status(404).json(
        createApiResponse(false, 'Profile not found', null,
          `No ${role} profile found for user ID: ${userId}`)
      );
    }

    return res.status(200).json(
      createApiResponse(true, 'Profile fetched successfully', {
        profile: profileData,
        role: role
      })
    );

  } catch (error) {
    console.error('❌ Database error:', error);
    return res.status(500).json(
      createApiResponse(false, 'Failed to fetch profile', null,
        error instanceof Error ? error.message : 'Unknown error')
    );
  }
}

async function getLearnerProfile(userId: string) {
  console.log('📋 Fetching learner profile for userId:', userId);

  // Use LEFT JOIN to handle multi-role users who may not have learner_profile record yet
  const result = await pool.query(`
    SELECT au.id,
           au.full_name,
           au.email,
           au.secondary_email,
           au.profile_picture_url,
           au.created_at,
           au.updated_at,
           au.password,
           lp.tel,
           lp.nric,
           lp.gender,
           lp.company,
           lp.employment_status,
           lp.nationality,
           lp.ethnicity,
           to_char(lp.dob, 'YYYY-MM-DD') AS dob,
           lp.invoice_url,
           lp.pro_forma_url,
           lp.receipt_url
    FROM app_user au
    LEFT JOIN learner_profile lp ON au.id = lp.user_id
    WHERE au.id = $1
  `, [userId]);

  console.log('📊 Learner query result:', result.rows.length, 'rows found');
  console.log("here is the dob,", result.rows[0]?.dob);

  if (result.rows.length === 0) {
    console.log('❌ No user found with ID:', userId);
    return null;
  }

  const profile = result.rows[0];
  console.log('✅ Raw profile data found (learner_profile may be NULL for multi-role users)');

  const formattedProfile = {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    secondaryEmail: profile.secondary_email || '',
    password: profile.password,
    loginId: profile.email,
    profilePictureUrl: profile.profile_picture_url,
    tel: profile.tel || '',
    nric: profile.nric || '',
    gender: profile.gender || '',
    company: profile.company || '',
    employmentStatus: profile.employment_status || '',
    nationality: profile.nationality || '',
    ethnicity: profile.ethnicity || '',
    invoice_url: profile.invoice_url || '',
    pro_forma_url: profile.pro_forma_url || '',
    receipt_url: profile.receipt_url || '',
    dob: profile.dob || '',
    created_at: profile.created_at?.toISOString() || new Date().toISOString(),
    updated_at: profile.updated_at?.toISOString() || new Date().toISOString()
  };

  console.log('✨ Formatted learner profile ready');
  return formattedProfile;
}

async function getAdminProfile(userId: string) {
  console.log('👨‍💼 Fetching admin profile for userId:', userId);

  // Use LEFT JOIN to handle multi-role users who may not have admin_profile record yet
  const result = await pool.query(`
    SELECT
        au.id AS user_id,
        au.full_name,
        au.email,
        au.password,
        au.profile_picture_url,
        ap.tel AS telephone
    FROM app_user au
    LEFT JOIN admin_profile ap
        ON ap.user_id = au.id
    WHERE au.id = $1
  `, [userId]);

  console.log('📊 Admin query result:', result.rows.length, 'rows found');

  if (result.rows.length === 0) {
    console.log('❌ No user found with ID:', userId);
    return null;
  }

  const profile = result.rows[0];
  console.log('✅ Admin profile found:', profile.full_name, '(admin_profile may be NULL for multi-role users)');

  return {
    id: profile.user_id,
    name: profile.full_name,
    email: profile.email,
    tel: profile.telephone || '',
    loginId: profile.email,
    profilePictureUrl: profile.profile_picture_url || `https://i.pravatar.cc/150?img=2`,
    password: profile.password,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function getTrainerProfile(userId: string) {
  console.log('👨‍🏫 Fetching trainer profile for userId:', userId);

  const result = await pool.query(`
    SELECT 
      u.id,
      u.email,
      u.full_name as name,
      u.profile_picture_url,
      u.created_at,
      u.updated_at,
      tp.tel,
      tp.gender,
      tp.trainer_type,
      tp.status,
      tp.linkedin_url,
      tp.cv_url,
      tp.areas_of_expertise,
      tp.work_experience,
      tp.certifications,
      tp.qualifications,
      tp.education
    FROM app_user u
    LEFT JOIN trainer_profile tp ON u.id = tp.user_id
    WHERE u.id = $1
  `, [userId]);

  console.log('📊 Trainer query result:', result.rows.length, 'rows found');

  if (result.rows.length === 0) {
    console.log('❌ No trainer found with ID:', userId);
    return null;
  }

  const profile = result.rows[0];
  console.log('✅ Trainer profile found:', profile.name);

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    loginId: profile.email,
    profilePictureUrl: profile.profile_picture_url || `https://i.pravatar.cc/150?img=3`,
    tel: profile.tel,
    gender: profile.gender,
    trainerType: profile.trainer_type,
    status: profile.status,
    linkedinUrl: profile.linkedin_url,
    cvUrl: profile.cv_url,
    areasOfExpertise: profile.areas_of_expertise,
    workExperience: profile.work_experience,
    certifications: profile.certifications,
    qualifications: profile.qualifications,
    education: profile.education,
    created_at: profile.created_at?.toISOString() || new Date().toISOString(),
    updated_at: profile.updated_at?.toISOString() || new Date().toISOString()
  };
}

async function getTrainingProviderProfile(userId: string) {
  console.log('📋 Fetching training provider profile for userId:', userId);

  // Fetch the training provider profile based on the user's organization membership
  // First, check training_provider_member table to find which organization this user belongs to
  // If not found, fall back to checking if they're directly linked via training_provider.id
  // If still not found, fall back to provider_admin_user table
  console.log('🔍 Looking up user\'s training provider organization...');

  let result = await pool.query(`
    SELECT 
        au.id,
        au.full_name,
        au.email,
        au.profile_picture_url AS profile_image,
        COALESCE(tp.company_logo_url, au.profile_picture_url) AS company_logo,
        au.password,
        tp.company_name,
        tp.company_shortname,
        tp.uen,
        tp.company_address,
        tp.company_email,
        tp.company_tel,
        tp.company_website,
        tp.contact_person_name,
        tp.contact_tel AS telephone,
        tp.pro_forma_template_url AS pro_forma_invoice_template,
        tp.invoice_template_url,
        tp.receipt_template_url,
        tp.certificate_template_url,
        tp.ssg_self_sign_cert_file,
        tp.ssg_private_key_file,
        tp.ssg_encryption_key,
        tp.sync_google_calendar,
        tp.sync_ms_calendar,
        tp.google_calendar_url,
        tp.ms_calendar_url,
        tp.integrate_google_drive,
        tp.integrate_ms_onedrive,
        tp.email_user,
        tp.google_client_id,
        tp.google_client_secret,
        tp.google_refresh_token,
        tp.google_slides_template_id,
        tp.certificate_folder_url,
        tp.auto_send_proforma_invoice,
        tp.auto_send_confirm_email,
        tp.auto_send_invoice,
        tp.auto_send_receipt,
        tp.auto_send_certificate,
        tp.auto_send_thankyou_email,
        tp.auto_mask_sensitive_data,
        tp.auto_delete_after_six_months,
        tp.enable_otp_login,
        tp.enable_default_otp,
        tp.default_otp,
        tp.enable_leaderboard,
        tp.enable_point_sys,
        tp.normal_fund_rate,
        tp.enhanced_fund_rate,
        tp.gst_rate,
        tp.gst_register,
        tp.color_scheme AS primary_color,
        tp.id as provider_id,
        tp.force_first_password_change,
        tp.default_password,
        'member' as access_type
    FROM app_user au
    INNER JOIN training_provider_member tpm ON au.id = tpm.user_id
    INNER JOIN training_provider tp ON tpm.provider_id = tp.id
    WHERE au.id = $1
  `, [userId]);

  // If not found via member table, check if user IS the training provider (direct ownership)
  if (result.rows.length === 0) {
    console.log('🔍 Not found via member table, checking direct provider ownership...');
    result = await pool.query(`
      SELECT 
          au.id,
          au.full_name,
          au.email,
          au.profile_picture_url AS profile_image,
          COALESCE(tp.company_logo_url, au.profile_picture_url) AS company_logo,
          au.password,
          tp.company_name,
          tp.company_shortname,
          tp.uen,
          tp.company_address,
          tp.company_email,
          tp.company_tel,
          tp.company_website,
          tp.contact_person_name,
          tp.contact_tel AS telephone,
          tp.pro_forma_template_url AS pro_forma_invoice_template,
          tp.invoice_template_url,
          tp.receipt_template_url,
          tp.certificate_template_url,
          tp.ssg_self_sign_cert_file,
          tp.ssg_private_key_file,
          tp.ssg_encryption_key,
          tp.sync_google_calendar,
          tp.sync_ms_calendar,
          tp.integrate_google_drive,
          tp.integrate_ms_onedrive,
          tp.email_user,
          tp.google_client_id,
          tp.google_client_secret,
          tp.google_refresh_token,
          tp.google_slides_template_id,
        tp.certificate_folder_url,
          tp.auto_send_proforma_invoice,
          tp.auto_send_confirm_email,
          tp.auto_send_invoice,
          tp.auto_send_receipt,
          tp.auto_send_certificate,
          tp.auto_send_thankyou_email,
          tp.auto_mask_sensitive_data,
          tp.auto_delete_after_six_months,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.enable_leaderboard,
          tp.enable_point_sys,
          tp.normal_fund_rate,
          tp.enhanced_fund_rate,
          tp.gst_rate,
          tp.gst_register,
          tp.color_scheme AS primary_color,
          tp.id as provider_id,
          tp.force_first_password_change,
          tp.default_password,
          'owner' as access_type
      FROM app_user au
      INNER JOIN training_provider tp ON au.id = tp.id
      WHERE au.id = $1
    `, [userId]);
  }

  // If still not found, check provider_admin_user table (legacy/admin access)
  if (result.rows.length === 0) {
    console.log('🔍 Not found as owner, checking provider_admin_user (legacy admin access)...');
    result = await pool.query(`
      SELECT
          au.id,
          au.full_name,
          au.email,
          au.profile_picture_url AS profile_image,
          COALESCE(tp.company_logo_url, au.profile_picture_url) AS company_logo,
          au.password,
          tp.company_name,
          tp.company_shortname,
          tp.uen,
          tp.company_address,
          tp.company_email,
          tp.company_tel,
          tp.company_website,
          tp.contact_person_name,
          tp.contact_tel AS telephone,
          tp.pro_forma_template_url AS pro_forma_invoice_template,
          tp.invoice_template_url,
          tp.receipt_template_url,
          tp.certificate_template_url,
          tp.ssg_self_sign_cert_file,
          tp.ssg_private_key_file,
          tp.ssg_encryption_key,
          tp.sync_google_calendar,
          tp.sync_ms_calendar,
          tp.integrate_google_drive,
          tp.integrate_ms_onedrive,
          tp.email_user,
          tp.google_client_id,
          tp.google_client_secret,
          tp.google_refresh_token,
          tp.google_slides_template_id,
        tp.certificate_folder_url,
          tp.auto_send_proforma_invoice,
          tp.auto_send_confirm_email,
          tp.auto_send_invoice,
          tp.auto_send_receipt,
          tp.auto_send_certificate,
          tp.auto_send_thankyou_email,
          tp.auto_mask_sensitive_data,
          tp.auto_delete_after_six_months,
          tp.enable_otp_login,
          tp.enable_default_otp,
          tp.default_otp,
          tp.enable_leaderboard,
          tp.enable_point_sys,
          tp.normal_fund_rate,
          tp.enhanced_fund_rate,
          tp.gst_rate,
          tp.gst_register,
          tp.color_scheme AS primary_color,
          tp.id as provider_id,
          tp.force_first_password_change,
          tp.default_password,
          'admin' as access_type
      FROM app_user au
      INNER JOIN provider_admin_user pau ON au.id = pau.user_id
      INNER JOIN training_provider tp ON pau.provider_id = tp.id
      WHERE au.id = $1
    `, [userId]);
  }

  console.log('📊 Training provider query result:', result.rows.length, 'rows found');

  if (result.rows.length === 0) {
    console.log('❌ No training provider profile found for user:', userId);
    console.log('⚠️ User may need to be linked to a training provider organization via training_provider_member table');
    return null;
  }

  const profileData = result.rows[0];
  console.log('✅ Found training provider profile:', profileData.company_name, '(access type:', profileData.access_type + ')');

  // Fetch API keys separately (including selected_model)
  const apiKeyResult = await pool.query(`
    SELECT
        tpa.key_name,
        tpa.key_value,
        tpa.selected_model
    FROM training_provider_api tpa
    WHERE tpa.training_provider_id = $1
  `, [profileData.provider_id]);

  console.log('📊 API keys query result:', apiKeyResult.rows.length, 'keys found');

  // Build API keys and models objects
  const apiKeys: { [key: string]: string } = {};
  const apiKeyModels: { [key: string]: string } = {};
  apiKeyResult.rows.forEach(row => {
    apiKeys[row.key_name] = row.key_value;
    // Allow empty string (None) to be included
    if (row.selected_model !== null && row.selected_model !== undefined) {
      apiKeyModels[row.key_name] = row.selected_model;
    }
  });

  // Safely fetch support_email (column may not exist yet)
  let supportEmail = '';
  try {
    const r = await pool.query(`SELECT support_email FROM training_provider WHERE id = $1`, [profileData.provider_id]);
    if (r.rows.length > 0 && r.rows[0].support_email) supportEmail = r.rows[0].support_email;
  } catch (e) { /* column doesn't exist yet */ }

  // Safely fetch extra integration columns (each group independent so missing columns don't wipe others)
  let refLinks: any = {};
  // Reference links
  try {
    const r = await pool.query(`SELECT master_list_url, tertiary_tms_url, tertiary_fms_url, tertiary_mms_url, tertiary_tpms_url FROM training_provider WHERE id = $1`, [profileData.provider_id]);
    if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
  } catch (e) { /* columns don't exist */ }
  // n8n
  try {
    const r = await pool.query(`SELECT n8n_host1_url, n8n_host2_url FROM training_provider WHERE id = $1`, [profileData.provider_id]);
    if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
  } catch (e) { /* columns don't exist */ }
  // Magento
  try {
    const r = await pool.query(`SELECT magento_backend_url FROM training_provider WHERE id = $1`, [profileData.provider_id]);
    if (r.rows.length > 0) refLinks = { ...refLinks, ...r.rows[0] };
  } catch (e) { /* columns don't exist */ }

  // Parse color scheme - now returning as string instead of object
  let colorScheme;
  try {
    if (profileData.primary_color) {
      // Try to parse as JSON first (for backward compatibility)
      const parsed = JSON.parse(profileData.primary_color);
      colorScheme = parsed.primary || parsed; // Extract primary if it's an object, otherwise use as-is
    } else {
      colorScheme = '#3B82F6'; // Default color as string
    }
  } catch (e) {
    // If JSON parsing fails, treat as direct color string
    colorScheme = profileData.primary_color || '#3B82F6';
  }

  return {
    id: profileData.id,
    name: profileData.full_name,
    email: profileData.email,
    loginId: profileData.email,
    password: profileData.password || '',
    profilePictureUrl: profileData.profile_image,
    companyName: profileData.company_name || '',
    companyShortname: profileData.company_shortname || '',
    uen: profileData.uen || '',
    companyAddress: profileData.company_address || '',
    companyEmail: profileData.company_email || '',
    companyTel: profileData.company_tel || '',
    companyWebsite: profileData.company_website || '',
    companyLogoUrl: profileData.company_logo || profileData.profile_image,
    contactPerson: {
      name: profileData.contact_person_name || '',
      email: supportEmail || profileData.company_email || '',
      tel: profileData.telephone || ''
    },
    apiKeys: apiKeys,
    apiKeyModels: apiKeyModels,
    invoiceTemplateUrl: profileData.invoice_template_url || '',
    receiptTemplateUrl: profileData.receipt_template_url || '',
    certificateTemplateUrl: profileData.certificate_template_url || '',
    proFormaInvoiceTemplateUrl: profileData.pro_forma_invoice_template || '',
    ssgCertFile: profileData.ssg_self_sign_cert_file || '',
    ssgPrivateKeyFile: profileData.ssg_private_key_file || '',
    ssgEncryptionKey: profileData.ssg_encryption_key || '',
    integrations: {
      syncGoogleCalendar: profileData.sync_google_calendar || false,
      googleCalendarUrl: profileData.google_calendar_url || '',
      googleDrive: profileData.integrate_google_drive || false,
      microsoftOneDrive: profileData.integrate_ms_onedrive || false,
      emailUser: profileData.email_user || '',
      googleClientId: profileData.google_client_id || '',
      googleClientSecret: profileData.google_client_secret || '',
      googleRefreshToken: profileData.google_refresh_token || '',
      googleSlidesTemplateId: profileData.google_slides_template_id || '',
      certificateFolderUrl: profileData.certificate_folder_url || '',
      masterListUrl: refLinks.master_list_url || '',
      tertiaryTmsUrl: refLinks.tertiary_tms_url || '',
      tertiaryFmsUrl: refLinks.tertiary_fms_url || '',
      tertiaryMmsUrl: refLinks.tertiary_mms_url || '',
      tertiaryTpmsUrl: refLinks.tertiary_tpms_url || '',
      n8nHost1Url: refLinks.n8n_host1_url || '',
      n8nHost2Url: refLinks.n8n_host2_url || '',
      magentoBackendUrl: refLinks.magento_backend_url || '',
    },
    adminSettings: {
      autoSendProFormaInvoice: profileData.auto_send_proforma_invoice || false,
      autoSendConfirmationEmail: profileData.auto_send_confirm_email || false,
      autoSendInvoiceOnGrantSuccess: profileData.auto_send_invoice || false,
      autoSendReceiptOnPayment: profileData.auto_send_receipt || false,
      autoSendCertificateOnCompletion: profileData.auto_send_certificate || false,
      autoSendThankYouEmail: profileData.auto_send_thankyou_email || false
    },
    securitySettings: {
      autoMaskSensitiveData: profileData.auto_mask_sensitive_data || false,
      autoDeleteAfter6Months: profileData.auto_delete_after_six_months || false,
      enableOtpLogin: profileData.enable_otp_login || false,
      enableDefaultOtp: profileData.enable_default_otp || false,
      defaultOtpValue: profileData.default_otp || '',
      forceFirstPasswordChange: profileData.force_first_password_change || false,
      defaultPassword: profileData.default_password || ''
    },
    gamingSettings: {
      enableLeaderboard: profileData.enable_leaderboard || false,
      enablePoints: profileData.enable_point_sys || false
    },
    fundingSettings: {
      normalFunding: (profileData.normal_fund_rate as 50 | 70) || 70,
      enhancedFunding: profileData.enhanced_fund_rate || 90,
      gstRate: profileData.gst_rate || 8.0,
      isGstRegistered: profileData.gst_register || false
    },
    colorScheme: colorScheme,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
