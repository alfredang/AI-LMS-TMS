import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import { emailService } from '../../../lib/services/emailService';

interface SendOtpRequest {
  email: string;
}

interface SendOtpResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// Generate a 6-digit OTP
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function handler(req: NextApiRequest, res: NextApiResponse<SendOtpResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email }: SendOtpRequest = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      success: false,
      error: 'Valid email is required'
    });
  }

  try {
    console.log(`📧 Send OTP request for email: ${email}`);

    // Check if user exists in database
    const userQuery = `
      SELECT id, email, full_name
      FROM public.app_user
      WHERE LOWER(email) = LOWER($1)
    `;
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      console.log(`❌ User not found: ${email}`);
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address'
      });
    }

    const user = userResult.rows[0];
    console.log(`✅ User found: ${user.email}`);

    // Invalidate any existing unused OTPs for this email
    await pool.query(`
      UPDATE public.otp_codes
      SET used = TRUE
      WHERE LOWER(email) = LOWER($1) AND used = FALSE
    `, [email]);

    // Generate new OTP
    const otp = generateOtp();
    const expiryMinutes = 10;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Store OTP in database
    await pool.query(`
      INSERT INTO public.otp_codes (email, otp_code, expires_at)
      VALUES (LOWER($1), $2, $3)
    `, [email, otp, expiresAt]);

    console.log(`✅ OTP generated and stored for ${email}, expires at ${expiresAt.toISOString()}`);

    // Send OTP via email
    const emailResult = await emailService.sendOtpEmail(email, otp, expiryMinutes);

    if (!emailResult.success) {
      console.error(`❌ Failed to send OTP email to ${email}:`, emailResult.error);
      // Still return success since OTP is stored - email delivery issues shouldn't block the flow
      // In production, you might want to handle this differently
    }

    console.log(`✅ OTP process completed for ${email}`);

    // In development, include the OTP in response for testing
    // Remove this in production!
    const isDevelopment = process.env.NODE_ENV !== 'production';

    return res.status(200).json({
      success: true,
      message: 'OTP has been sent to your email address',
      ...(isDevelopment && { otp }) // Only include OTP in development mode
    });

  } catch (error: any) {
    console.error('❌ Send OTP error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send OTP. Please try again.'
    });
  }
}

export default handler;
