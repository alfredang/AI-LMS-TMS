import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { cors } from '../../../lib/cors';
import bcrypt from 'bcrypt';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD || 'shuo1314520.',
  port: parseInt(process.env.DB_PORT || '5432'),
});

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
    };
    role: string; // Add role to response data
    token?: string;
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

    // Check if user exists in database
    const userQuery = `
      SELECT id, email, password_hash as password, full_name, profile_picture_url
      FROM public.app_user
      WHERE email = $1
    `;
    
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

    // Handle different login types
    if (loginType === 'password') {
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
      // For OTP login, verify against training provider's default OTP
      // First get the training provider's default OTP
      const otpQuery = `
      SELECT default_otp, enable_otp_login, enable_default_otp
      FROM training_provider
      LIMIT 1
      `;
      
      const otpResult = await pool.query(otpQuery);
      
      if (otpResult.rows.length === 0) {
        console.log(`❌ No OTP settings found for training provider`);
        return res.status(401).json({ 
          success: false, 
          error: 'OTP login not available' 
        });
      }
      
      const otpSettings = otpResult.rows[0];
      
      // Check if OTP login is enabled
      if (!otpSettings.enable_otp_login || !otpSettings.enable_default_otp) {
        console.log(`❌ OTP login is disabled for training provider`);
        return res.status(401).json({ 
          success: false, 
          error: 'OTP login is not enabled' 
        });
      }
      
      // Verify OTP against the training provider's default OTP
      if (otp !== otpSettings.default_otp) {
        console.log(`❌ Invalid OTP for user: ${email}, expected: ${otpSettings.default_otp}, received: ${otp}`);
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid OTP' 
        });
      }
      console.log(`✅ OTP verified for user: ${email}`);
    }

    // Determine user role based on database structure
    let userRole = 'learner'; // Default role
    
    // Check if user is admin
    const adminCheck = await pool.query(
      'SELECT user_id FROM public.admin_profile WHERE user_id = $1',
      [user.id]
    );
    if (adminCheck.rows.length > 0) {
      userRole = 'admin';
    } else {
      // Check if user is trainer
      const trainerCheck = await pool.query(
        'SELECT user_id FROM public.trainer_profile WHERE user_id = $1',
        [user.id]
      );
      if (trainerCheck.rows.length > 0) {
        userRole = 'trainer';
      }
    }

    console.log(`✅ User role determined: ${userRole}`);

    // Successful login response
    const loginResponse = {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name || 'Unknown User',
          profilePictureUrl: user.profile_picture_url,
          role: userRole
        },
        role: userRole,
        token: `mock-jwt-token-${user.id}` // In production, generate a real JWT
      }
    };

    console.log(`✅ Login successful for user: ${email}, role: ${userRole}`);
    return res.status(200).json(loginResponse);

  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}

export default handler;