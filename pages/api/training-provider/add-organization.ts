import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import bcrypt from 'bcryptjs';

interface AddOrganizationRequest {
  // Owner account details
  ownerEmail: string;
  ownerPassword: string;
  ownerName: string;
  ownerPhone?: string;
  
  // Company information
  companyName: string;
  companyShortname?: string;
  uen: string;
  companyAddress: string;
  contactPersonName: string;
  contactTel: string;
  colorScheme?: string;
  
  // Settings (optional with defaults)
  normalFundRate?: number;
  enhancedFundRate?: number;
  gstRate?: number;
  gstRegister?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  const {
    ownerEmail,
    ownerPassword,
    ownerName,
    ownerPhone,
    companyName,
    companyShortname,
    uen,
    companyAddress,
    contactPersonName,
    contactTel,
    colorScheme,
    normalFundRate,
    enhancedFundRate,
    gstRate,
    gstRegister
  } = req.body as AddOrganizationRequest;

  // Validate required fields
  if (!ownerEmail || !ownerPassword || !ownerName) {
    return res.status(400).json({
      success: false,
      error: 'Owner email, password, and name are required'
    });
  }

  if (!companyName || !uen || !companyAddress || !contactPersonName || !contactTel) {
    return res.status(400).json({
      success: false,
      error: 'Company name, UEN, address, contact person name, and contact number are required'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(ownerEmail)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format'
    });
  }

  // Validate password strength (minimum 8 characters)
  if (ownerPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 8 characters long'
    });
  }

  // Validate UEN format (Singapore UEN is typically 9-10 characters)
  if (uen.length < 8 || uen.length > 12) {
    return res.status(400).json({
      success: false,
      error: 'UEN must be between 8 and 12 characters'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if email already exists
    const emailCheck = await client.query(
      'SELECT id FROM app_user WHERE email = $1',
      [ownerEmail]
    );

    if (emailCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Email already exists'
      });
    }

    // Check if UEN already exists
    const uenCheck = await client.query(
      'SELECT id FROM training_provider WHERE uen = $1',
      [uen]
    );

    if (uenCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'UEN already exists'
      });
    }

    // 1. Create training provider organization
    const tpResult = await client.query(`
      INSERT INTO training_provider (
        id, company_name, company_shortname, uen, company_address,
        contact_person_name, contact_tel, color_scheme,
        normal_fund_rate, enhanced_fund_rate, gst_rate, gst_register,
        sync_google_calendar, sync_ms_calendar, integrate_google_drive, integrate_ms_onedrive,
        auto_send_proforma_invoice, auto_send_confirm_email, auto_send_invoice, 
        auto_send_receipt, auto_send_certificate, auto_send_thankyou_email,
        auto_mask_sensitive_data, auto_delete_after_six_months,
        enable_otp_login, enable_default_otp, enable_leaderboard, enable_point_sys,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        false, false, false, false, false, false, false, false, false, false,
        false, false, false, false, false, false,
        NOW(), NOW()
      ) RETURNING id
    `, [
      companyName,
      companyShortname || null,
      uen,
      companyAddress,
      contactPersonName,
      contactTel,
      colorScheme || '#3B82F6',
      normalFundRate || 70,
      enhancedFundRate || 90,
      gstRate || 9,
      gstRegister || false
    ]);

    const providerId = tpResult.rows[0].id;
    console.log('✅ Created training provider organization:', providerId);

    // 2. Create owner user account
    const hashedPassword = await bcrypt.hash(ownerPassword, 10);
    const userResult = await client.query(`
      INSERT INTO app_user (
        id, email, password, password_hash, full_name, 
        profile_picture_url, account_status, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, NULL, 'active', NOW(), NOW()
      ) RETURNING id
    `, [ownerEmail, ownerPassword, hashedPassword, ownerName]);

    const userId = userResult.rows[0].id;
    console.log('✅ Created owner user account:', userId);

    // 3. Assign Training Provider role
    await client.query(`
      INSERT INTO user_role_map (user_id, role)
      VALUES ($1, 'Training Provider')
    `, [userId]);
    console.log('✅ Assigned Training Provider role to user');

    // 4. Link owner to organization via training_provider_member
    await client.query(`
      INSERT INTO training_provider_member (provider_id, user_id, created_at)
      VALUES ($1, $2, NOW())
    `, [providerId, userId]);
    console.log('✅ Linked owner to training provider organization');

    // 5. Create admin profile if phone is provided
    if (ownerPhone) {
      await client.query(`
        INSERT INTO admin_profile (user_id, tel)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET tel = EXCLUDED.tel
      `, [userId, ownerPhone]);
      console.log('✅ Created admin profile with phone number');
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Training provider organization created successfully',
      data: {
        providerId,
        userId,
        companyName,
        ownerEmail
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating training provider organization:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific database errors
    if (errorMessage.includes('duplicate key')) {
      if (errorMessage.includes('email')) {
        return res.status(400).json({
          success: false,
          error: 'Email already exists'
        });
      } else if (errorMessage.includes('uen')) {
        return res.status(400).json({
          success: false,
          error: 'UEN already exists'
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to create training provider organization',
      details: errorMessage
    });
  } finally {
    client.release();
  }
}
