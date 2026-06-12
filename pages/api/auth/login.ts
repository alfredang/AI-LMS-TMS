import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import bcrypt from 'bcryptjs';
import pool from '../../../lib/db';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { isPayrollEnabled } from '../../../lib/payroll/featureFlag';


interface LoginRequest {
  email: string;
  password?: string;
  otp?: string;
  role?: string; // Make role optional as it will be determined automatically
  loginType: 'password' | 'otp';
}

interface LoginResponse {
  success: boolean;
  data?: {
    user: {
      id: string;
      email: string;
      fullName: string;
      profilePictureUrl?: string;
      role: string;
      roles: string[]; // All roles the user has
    };
    role: string; // Primary/selected role
    roles: string[]; // All available roles for role selection
    token?: string;
    forcePasswordChange?: boolean;
    requiresProfileSetup?: boolean;
  };
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<LoginResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email, password, otp, loginType }: LoginRequest = req.body;
  const tp = await getTrainingPartnerIdentifiers();

  if (!email || !loginType) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: email and loginType'
    });
  }

  if (loginType === 'password' && !password) {
    return res.status(400).json({
      success: false,
      error: 'Password is required for password login'
    });
  }

  if (loginType === 'otp' && !otp) {
    return res.status(400).json({
      success: false,
      error: 'OTP is required for OTP login'
    });
  }

  try {
    console.log(`🔐 Login attempt for email: ${email}, type: ${loginType}`);

    // Check if DATABASE_URL is configured
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL environment variable is not set');
      return res.status(500).json({
        success: false,
        error: 'Database configuration error. Please check environment variables.'
      });
    }

    // Check once whether secondary_email column exists (safety net before migration is run)
    const colCheck = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'app_user' AND column_name = 'secondary_email'
    `);
    const hasSecondaryEmail = colCheck.rows.length > 0;

    // Handle different login types
    if (loginType === 'password') {
      // For password login, user MUST exist
      const userQuery = hasSecondaryEmail
        ? `SELECT id, email, password_hash as password, full_name, profile_picture_url, account_status
           FROM public.app_user WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1)`
        : `SELECT id, email, password_hash as password, full_name, profile_picture_url, account_status
           FROM public.app_user WHERE LOWER(email) = LOWER($1)`;
      const userResult = await pool.query(userQuery, [email]);

      if (userResult.rows.length === 0) {
        console.log(`❌ User not found: ${email}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or user does not exist'
        });
      }

      const user = userResult.rows[0];
      console.log(`✅ User found: ${user.email}`);

      // Check if account is disabled
      if (user.account_status !== 'active') {
        console.log(`❌ Account disabled for user: ${email}`);
        return res.status(403).json({
          success: false,
          error: `Your account has been disabled. Please contact ${tp.name || 'your training provider'} to request reactivation.`
        });
      }

      // Verify password using bcrypt
      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'Password is required for password login'
        });
      }

      console.log(`🔍 Debug: Stored password hash: ${user.password}`);
      console.log(`🔍 Debug: Input password: ${password}`);
      console.log(`🔍 Debug: Password hash starts with $2b$: ${user.password?.startsWith('$2b$')}`);

      if (!user.password) {
        return res.status(401).json({ success: false, error: 'No password set for this account. Please contact your administrator.' });
      }
      const isPasswordValid = await bcrypt.compare(password, user.password);
      console.log(`🔍 Debug: bcrypt.compare result: ${isPasswordValid}`);

      if (!isPasswordValid) {
        console.log(`❌ Invalid password for user: ${email}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid password'
        });
      }
      console.log(`✅ Password verified for user: ${email}`);

    } else if (loginType === 'otp') {
      // For OTP login, verify OTP first, then create user if needed
      // First check if OTP login is enabled for the training provider
      const settingsQuery = `
        SELECT enable_otp_login
        FROM training_provider
        LIMIT 1
      `;
      const settingsResult = await pool.query(settingsQuery);

      if (settingsResult.rows.length > 0 && !settingsResult.rows[0].enable_otp_login) {
        console.log(`❌ OTP login is disabled for training provider`);
        return res.status(401).json({
          success: false,
          error: 'OTP login is not enabled'
        });
      }

      // Verify OTP against the stored OTP in otp_codes table
      const otpQuery = `
        SELECT id, otp_code, expires_at, used
        FROM public.otp_codes
        WHERE LOWER(email) = LOWER($1)
          AND used = FALSE
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const otpResult = await pool.query(otpQuery, [email]);

      if (otpResult.rows.length === 0) {
        console.log(`❌ No valid OTP found for user: ${email}`);
        return res.status(401).json({
          success: false,
          error: 'OTP has expired or is invalid. Please request a new one.'
        });
      }

      const storedOtp = otpResult.rows[0];

      if (otp !== storedOtp.otp_code) {
        console.log(`❌ Invalid OTP for user: ${email}, expected: ${storedOtp.otp_code}, received: ${otp}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid OTP'
        });
      }

      // Mark OTP as used
      await pool.query(`
        UPDATE public.otp_codes
        SET used = TRUE
        WHERE id = $1
      `, [storedOtp.id]);

      console.log(`✅ OTP verified and marked as used for user: ${email}`);
    }

    // After authentication, check if user exists (or create for OTP login)
    const userQuery2 = hasSecondaryEmail
      ? `SELECT id, email, password_hash as password, full_name, profile_picture_url, account_status
         FROM public.app_user WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1)`
      : `SELECT id, email, password_hash as password, full_name, profile_picture_url, account_status
         FROM public.app_user WHERE LOWER(email) = LOWER($1)`;
    const userResult = await pool.query(userQuery2, [email]);

    let user: any;
    let requiresProfileSetup = false;

    if (userResult.rows.length === 0 && loginType === 'otp') {
      // Create new user for OTP login (similar to OAuth flow)
      console.log(`🆕 Creating new user via OTP login: ${email}`);

      const insertQuery = `
        INSERT INTO public.app_user (
          email,
          full_name,
          password,
          password_hash
        )
        VALUES ($1, $2, NULL, NULL)
        RETURNING id, email, full_name, profile_picture_url, account_status
      `;

      const insertResult = await pool.query(insertQuery, [
        email,
        email.split('@')[0] // Use email prefix as default name
      ]);

      user = insertResult.rows[0];

      // Assign default "Learner" role to new OTP users
      await pool.query(`
        INSERT INTO public.user_role_map (user_id, role)
        VALUES ($1, 'Learner')
      `, [user.id]);

      console.log(`✅ Created new user and assigned Learner role: ${email}`);
      requiresProfileSetup = true;
    } else {
      user = userResult.rows[0];

      // Check if account is disabled (for existing users)
      if (user.account_status !== 'active') {
        console.log(`❌ Account disabled for user: ${email}`);
        return res.status(403).json({
          success: false,
          error: `Your account has been disabled. Please contact ${tp.name || 'your training provider'} to request reactivation.`
        });
      }
    }

    // Get ALL user roles from user_role_map table
    const rolesQuery = `
      SELECT role FROM public.user_role_map
      WHERE user_id = $1
      ORDER BY
        CASE role
          WHEN 'Learner' THEN 1
          WHEN 'Trainer' THEN 2
          WHEN 'Developer' THEN 3
          WHEN 'Admin' THEN 4
          WHEN 'Finance' THEN 5
          WHEN 'Training Provider' THEN 6
          ELSE 7
        END
    `;

    const rolesResult = await pool.query(rolesQuery, [user.id]);

    // Filter out tenant-disabled roles (Payroll is opt-in per training_provider)
    const payrollEnabled = await isPayrollEnabled();
    const dbRoleStrings = rolesResult.rows
      .map((row: { role: string }) => row.role)
      .filter((r) => payrollEnabled || r !== 'Payroll');

    // Convert database roles to lowercase for consistency
    const userRoles: string[] = dbRoleStrings.map((dbRole: string) => {
      if (dbRole === 'Training Provider') return 'trainingProvider';
      return dbRole.toLowerCase();
    });

    // If no roles found in user_role_map, default to learner
    if (userRoles.length === 0) {
      userRoles.push('learner');
    }

    // Primary role is the first one (highest priority based on ORDER BY)
    const primaryRole = userRoles[0];

    console.log(`✅ User roles determined: ${userRoles.join(', ')}, primary: ${primaryRole}`);

    // Check if forced password change is needed:
    // 1. Per-user flag (admin reset or forgot password)
    // 2. Global setting (force first password change when using default password)
    let forcePasswordChange = false;
    if (loginType === 'password') {
      // Check per-user must_change_password flag first
      try {
        const flagResult = await pool.query('SELECT must_change_password FROM app_user WHERE id = $1', [user.id]);
        if (flagResult.rows.length > 0 && flagResult.rows[0].must_change_password) {
          forcePasswordChange = true;
          console.log(`🔐 User ${email} has must_change_password flag set`);
        }
      } catch (e) {
        // Column may not exist yet, skip
      }

      // Also check global force_first_password_change setting
      if (!forcePasswordChange) {
        try {
          const tpSettingsQuery = `SELECT force_first_password_change, default_password FROM training_provider LIMIT 1`;
          const tpSettings = await pool.query(tpSettingsQuery);
          if (tpSettings.rows.length > 0 && tpSettings.rows[0].force_first_password_change) {
            const defaultPwd = tpSettings.rows[0].default_password;
            if (defaultPwd) {
              const isDefaultPassword = await bcrypt.compare(defaultPwd, user.password);
              if (isDefaultPassword) {
                forcePasswordChange = true;
                console.log(`🔐 User ${email} still has default password, forcing change`);
              }
            }
          }
        } catch (e) {
          // Column may not exist yet, skip
        }
      }
    }

    // Successful login response
    const loginResponse = {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name || 'Unknown User',
          profilePictureUrl: user.profile_picture_url,
          role: primaryRole,
          roles: userRoles
        },
        role: primaryRole,
        roles: userRoles,
        token: `mock-jwt-token-${user.id}`, // In production, generate a real JWT
        forcePasswordChange,
        requiresProfileSetup
      }
    };

    console.log(`✅ Login successful for user: ${email}, roles: ${userRoles.join(', ')}`);
    return res.status(200).json(loginResponse);

  } catch (error: any) {
    console.error('❌ Login error:', error);

    // Check for specific database connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to database. Please try again later.'
      });
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(500).json({
        success: false,
        error: 'Database connection timed out. Please try again.'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default handler;