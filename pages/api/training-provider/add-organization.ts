import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import bcrypt from 'bcryptjs';
import { IncomingForm, File } from 'formidable';
import fs from 'fs';
import path from 'path';

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

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper function to save uploaded logo
// Helper function to save uploaded logo
const saveLogoFile = async (file: File, providerId: string, companyName: string): Promise<string> => {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'training_provider', 'company_logo');

  // Ensure directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const timestamp = Date.now();
  const fileExtension = path.extname(file.originalFilename || '.png');

  // Sanitize company name for filename (remove special characters, replace spaces with underscores)
  const sanitizedCompanyName = companyName
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .toLowerCase(); // Convert to lowercase

  const fileName = `${sanitizedCompanyName}_${timestamp}${fileExtension}`;
  const filePath = path.join(uploadDir, fileName);

  // Copy file from temp location
  const fileData = fs.readFileSync(file.filepath);
  fs.writeFileSync(filePath, fileData);

  return `/uploads/training_provider/company_logo/${fileName}`;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    let ownerEmail: string;
    let ownerPassword: string;
    let ownerName: string;
    let ownerPhone: string | undefined;
    let companyName: string;
    let companyShortname: string | undefined;
    let uen: string;
    let companyAddress: string;
    let contactPersonName: string;
    let contactTel: string;
    let colorScheme: string | undefined;
    let normalFundRate: number | undefined;
    let enhancedFundRate: number | undefined;
    let gstRate: number | undefined;
    let gstRegister: boolean | undefined;
    let logoFile: File | undefined;

    // Check if request has multipart form data (file upload)
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      try {
        // Parse multipart form data
        const form = new IncomingForm({
          uploadDir: '/tmp',
          keepExtensions: true,
          maxFileSize: 5 * 1024 * 1024, // 5MB max
        });

        const { fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
          form.parse(req, (err, fields, files) => {
            if (err) reject(err);
            else resolve({ fields, files });
          });
        });

        // Parse the JSON data from fields
        const dataStr = Array.isArray(fields.data) ? fields.data[0] : fields.data;
        const data = JSON.parse(dataStr || '{}') as AddOrganizationRequest;

        ownerEmail = data.ownerEmail;
        ownerPassword = data.ownerPassword;
        ownerName = data.ownerName;
        ownerPhone = data.ownerPhone;
        companyName = data.companyName;
        companyShortname = data.companyShortname;
        uen = data.uen;
        companyAddress = data.companyAddress;
        contactPersonName = data.contactPersonName;
        contactTel = data.contactTel;
        colorScheme = data.colorScheme;
        normalFundRate = data.normalFundRate;
        enhancedFundRate = data.enhancedFundRate;
        gstRate = data.gstRate;
        gstRegister = data.gstRegister;

        // Get logo file if present
        if (files.companyLogo) {
          logoFile = Array.isArray(files.companyLogo) ? files.companyLogo[0] : files.companyLogo;
        }
      } catch (parseError) {
        console.error('Error parsing multipart form:', parseError);
        return res.status(400).json({
          success: false,
          error: 'Failed to parse form data: ' + (parseError instanceof Error ? parseError.message : 'Unknown error')
        });
      }
    } else {
      // Parse JSON body manually since bodyParser is disabled
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        const data = JSON.parse(bodyStr) as AddOrganizationRequest;

        ownerEmail = data.ownerEmail;
        ownerPassword = data.ownerPassword;
        ownerName = data.ownerName;
        ownerPhone = data.ownerPhone;
        companyName = data.companyName;
        companyShortname = data.companyShortname;
        uen = data.uen;
        companyAddress = data.companyAddress;
        contactPersonName = data.contactPersonName;
        contactTel = data.contactTel;
        colorScheme = data.colorScheme;
        normalFundRate = data.normalFundRate;
        enhancedFundRate = data.enhancedFundRate;
        gstRate = data.gstRate;
        gstRegister = data.gstRegister;
      } catch (jsonError) {
        console.error('Error parsing JSON body:', jsonError);
        return res.status(400).json({
          success: false,
          error: 'Failed to parse JSON data: ' + (jsonError instanceof Error ? jsonError.message : 'Unknown error')
        });
      }
    }

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

      // Check if email already exists (including disabled users)
      const emailCheck = await client.query(
        'SELECT id, account_status FROM app_user WHERE email = $1',
        [ownerEmail]
      );

      // If email exists and user is active, reject
      if (emailCheck.rows.length > 0 && emailCheck.rows[0].account_status !== 'disabled') {
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

      let userId: string;
      let providerId: string;

      // If user exists but is disabled, reactivate them
      if (emailCheck.rows.length > 0 && emailCheck.rows[0].account_status === 'disabled') {
        userId = emailCheck.rows[0].id;
        console.log('♻️ Reactivating disabled user:', userId);

        // Update existing user
        const hashedPassword = await bcrypt.hash(ownerPassword, 10);
        await client.query(`
        UPDATE app_user 
        SET full_name = $1, password = $2, password_hash = $3, account_status = 'active', updated_at = NOW() 
        WHERE id = $4
      `, [ownerName, ownerPassword, hashedPassword, userId]);

        // Delete existing roles and add all roles
        await client.query('DELETE FROM user_role_map WHERE user_id = $1', [userId]);
        const allRoles = ['Training Provider', 'Trainer', 'Developer', 'Learner', 'Admin'];
        for (const role of allRoles) {
          await client.query(`
          INSERT INTO user_role_map (user_id, role)
          VALUES ($1, $2::user_role)
        `, [userId, role]);
        }

        // Update admin profile phone if provided
        if (ownerPhone) {
          await client.query(`
          INSERT INTO admin_profile (user_id, tel)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO UPDATE SET tel = EXCLUDED.tel
        `, [userId, ownerPhone]);
        }

      } else {
        // Create new user
        const hashedPassword = await bcrypt.hash(ownerPassword, 10);
        const userResult = await client.query(`
        INSERT INTO app_user (
          id, email, password, password_hash, full_name, 
          profile_picture_url, account_status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, NULL, 'active', NOW(), NOW()
        ) RETURNING id
      `, [ownerEmail, ownerPassword, hashedPassword, ownerName]);

        userId = userResult.rows[0].id;
        console.log('✅ Created owner user account:', userId);

        // Assign ALL roles to owner
        const allRoles = ['Training Provider', 'Trainer', 'Developer', 'Learner', 'Admin'];
        for (const role of allRoles) {
          await client.query(`
          INSERT INTO user_role_map (user_id, role)
          VALUES ($1, $2::user_role)
        `, [userId, role]);
        }
        console.log('✅ Assigned all roles to owner:', allRoles);

        // Create admin profile if phone is provided
        if (ownerPhone) {
          await client.query(`
          INSERT INTO admin_profile (user_id, tel)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO UPDATE SET tel = EXCLUDED.tel
        `, [userId, ownerPhone]);
          console.log('✅ Created admin profile with phone number');
        }
      }

      // Create training provider organization
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

      providerId = tpResult.rows[0].id;
      console.log('✅ Created training provider organization:', providerId);

      // Save logo file if provided
      let logoUrl: string | null = null;
      if (logoFile && logoFile.size > 0) {
        logoUrl = await saveLogoFile(logoFile, providerId, companyName);
        console.log('✅ Saved company logo:', logoUrl);

        // Update training provider with logo URL
        await client.query(`
        UPDATE training_provider 
        SET company_logo_url = $1 
        WHERE id = $2
      `, [logoUrl, providerId]);
      }

      // Link owner to organization via training_provider_member
      await client.query(`
      INSERT INTO training_provider_member (provider_id, user_id, created_at)
      VALUES ($1, $2, NOW())
    `, [providerId, userId]);
      console.log('✅ Linked owner to training provider organization');

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
  } catch (outerError) {
    console.error('❌ Unexpected error in add-organization handler:', outerError);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: outerError instanceof Error ? outerError.message : 'Unknown error'
    });
  }
}
