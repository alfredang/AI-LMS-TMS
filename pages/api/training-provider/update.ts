import pool from '../../../lib/db';
import { IncomingForm, File, Fields, Files } from 'formidable';
import fs from 'fs';
import path from 'path';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  TRAINING_PROVIDER_FOLDER_BY_FIELD,
  trainingProviderSkipTimestampForFolder,
} from '../../../lib/constants/trainingProviderUploadLayout';

const FOLDER_MAPPING: { [key: string]: string } = TRAINING_PROVIDER_FOLDER_BY_FIELD as unknown as {
  [key: string]: string;
};

// Disable body parser to handle multipart form data
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper function to ensure directory exists
const ensureDirectoryExists = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Helper function to delete old file
const deleteOldFile = (filePath: string) => {
  if (filePath && filePath.startsWith('/uploads/')) {
    const fullPath = path.join(process.cwd(), 'public', filePath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`✅ Deleted old file: ${fullPath}`);
      } catch (error) {
        console.error(`❌ Failed to delete old file: ${fullPath}`, error);
      }
    }
  }
};

// Helper function to save uploaded file
const saveUploadedFile = async (file: File, userId: string, fieldName: string): Promise<string> => {
  console.log('💾 saveUploadedFile called with:', { fieldName, userId, fileSize: file.size });
  console.log('🔍 File object details:', {
    filepath: file.filepath,
    originalFilename: file.originalFilename,
    mimetype: file.mimetype,
    size: file.size
  });

  // Use the module-level folder mapping
  const folderName = FOLDER_MAPPING[fieldName] || 'misc';
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'training_provider', folderName);
  console.log('📁 Upload directory:', uploadDir);
  console.log('📁 Current working directory:', process.cwd());

  ensureDirectoryExists(uploadDir);
  console.log('✅ Directory ensured, checking existence...');
  console.log('📁 Target directory exists:', fs.existsSync(uploadDir));
  console.log('📁 Target directory path:', uploadDir);
  console.log('📁 Parent directory exists:', fs.existsSync(path.dirname(uploadDir)));

  if (!fs.existsSync(uploadDir)) {
    console.error('❌ Directory creation failed, attempting manual creation...');
    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log('✅ Manual directory creation successful');
    } catch (dirError) {
      console.error('❌ Manual directory creation failed:', dirError);
      throw new Error(`Failed to create upload directory: ${uploadDir}`);
    }
  }

  const timestamp = Date.now();

  // Clean the original filename to remove any potential UUID prefixes or unwanted characters
  let cleanFilename = file.originalFilename || 'file';

  console.log('🧹 Cleaning filename:', {
    original: file.originalFilename,
    beforeCleaning: cleanFilename
  });

  // Remove any UUID-like patterns from the beginning of the filename (with or without underscore)
  cleanFilename = cleanFilename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_?/i, '');

  // Remove any timestamp patterns from the beginning (digits followed by underscore)
  cleanFilename = cleanFilename.replace(/^\d+_/, '');

  // Fix double extensions (e.g., "test.txt.txt" -> "test.txt")
  let fileExtension = path.extname(cleanFilename);
  const nameWithoutExt = path.basename(cleanFilename, fileExtension);

  // Check if the name without extension also ends with the same extension
  if (fileExtension && nameWithoutExt.toLowerCase().endsWith(fileExtension.toLowerCase())) {
    const correctedName = nameWithoutExt.slice(0, -fileExtension.length);
    cleanFilename = correctedName + fileExtension;
    console.log('🔧 Fixed double extension:', {
      before: file.originalFilename,
      after: cleanFilename,
      extension: fileExtension
    });
  }

  // If filename is now empty or just an extension, use a default name
  if (!cleanFilename || cleanFilename === fileExtension) {
    cleanFilename = `file${fileExtension}`;
  }

  // Get just the base name without extension  
  const baseName = path.basename(cleanFilename, fileExtension);

  const skipTimestamp = trainingProviderSkipTimestampForFolder(folderName);
  const fileName = skipTimestamp ? `${baseName}${fileExtension}` : `${timestamp}_${baseName}${fileExtension}`;
  const filePath = path.join(uploadDir, fileName);

  console.log('📄 Filename generation details:', {
    originalFilename: file.originalFilename,
    afterUuidRemoval: cleanFilename,
    baseName: baseName,
    fileExtension: fileExtension,
    finalFileName: fileName,
    finalFilePath: filePath,
    targetFolder: folderName
  });

  try {
    // Copy file from temp location to final location
    console.log('📋 Reading temp file from:', file.filepath);
    console.log('🔍 Temp file exists before read:', fs.existsSync(file.filepath));

    if (!fs.existsSync(file.filepath)) {
      throw new Error(`Temp file does not exist: ${file.filepath}`);
    }

    // Get temp file stats first
    const tempStats = fs.statSync(file.filepath);
    console.log('📊 Temp file stats:', {
      size: tempStats.size,
      created: tempStats.birthtime,
      modified: tempStats.mtime
    });

    const fileData = fs.readFileSync(file.filepath);
    console.log('📊 File data size after read:', fileData.length);

    // Allow empty files but log a warning
    if (fileData.length === 0) {
      console.log('⚠️ Warning: File is empty (0 bytes), but proceeding with upload');
    }

    console.log('💾 Writing file to:', filePath);
    console.log('📁 Target directory exists:', fs.existsSync(uploadDir));
    console.log('📁 Target directory permissions test...');

    // Test write permissions first
    const testFile = path.join(uploadDir, 'test_write.tmp');
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('✅ Directory write permissions: OK');
    } catch (permError) {
      console.error('❌ Directory write permission error:', permError);
      throw permError;
    }

    // Now write the actual file
    fs.writeFileSync(filePath, fileData);
    console.log('✅ File written successfully');

    // Verify file was written correctly
    const finalExists = fs.existsSync(filePath);
    console.log('🔍 Final file exists:', finalExists);

    if (finalExists) {
      const finalStats = fs.statSync(filePath);
      console.log('📈 Final file size:', finalStats.size);
      console.log('📅 Final file created:', finalStats.birthtime);
      console.log('🎯 Final file location:', filePath);

      // Additional verification: check if file is in the expected folder
      const expectedDir = path.join(process.cwd(), 'public', 'uploads', 'training_provider', folderName);
      const isInCorrectDir = filePath.startsWith(expectedDir);
      console.log('📂 File in correct directory:', isInCorrectDir);
      console.log('📂 Expected directory:', expectedDir);
      console.log('📂 Actual file path:', filePath);
    } else {
      throw new Error('File was not written to disk successfully');
    }
  } catch (error) {
    console.error('❌ Error saving file:', error);
    console.error('❌ Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    throw error;
  }

  // Return the URL path (relative to public folder)
  return `/uploads/training_provider/${folderName}/${fileName}`;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Use /tmp as writable directory
    const tempDir = '/tmp';

    // Parse the multipart form data with improved formidable configuration
    const form = new IncomingForm({
      allowEmptyFiles: true,  // Allow empty files to prevent FormidableError
      multiples: true,
      keepExtensions: true,
      minFileSize: 0,  // Allow files of any size including 0 bytes
      maxFileSize: 100 * 1024 * 1024,  // 100MB max file size
      uploadDir: tempDir,  // Use custom temp directory
      createDirsFromUploads: true
    });

    const { fields, files } = await new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
      form.parse(req, (err: any, fields: Fields, files: Files) => {
        if (err) {
          console.error('❌ Formidable parse error:', err);
          reject(err);
        } else {
          resolve({ fields, files });
        }
      });
    });

    // Extract userId from fields
    const userId = Array.isArray(fields.userId) ? fields.userId[0] : fields.userId;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    console.log('🔄 Updating training provider profile for userId:', userId);

    // Parse the JSON data from fields
    const profileDataStr = Array.isArray(fields.profileData) ? fields.profileData[0] : fields.profileData;
    const profileData = JSON.parse(profileDataStr || '{}');

    console.log('📋 Profile data received:', JSON.stringify(profileData, null, 2));
    console.log('📁 Files received:', Object.keys(files));
    console.log('🔍 Detailed file info:');
    Object.keys(files).forEach(key => {
      const file = files[key];
      const fileInfo = Array.isArray(file) ? file[0] : file;
      if (fileInfo) {
        console.log(`  - ${key}: ${fileInfo.originalFilename} (${fileInfo.size} bytes, type: ${fileInfo.mimetype})`);
      }
    });

    console.log('🎯 Template field mapping check:');
    Object.keys(files).forEach(fileKey => {
      if (FOLDER_MAPPING[fileKey]) {
        console.log(`  ✅ ${fileKey} -> ${FOLDER_MAPPING[fileKey]} folder`);
      } else {
        console.log(`  ❌ ${fileKey} -> NO MAPPING FOUND (will use 'misc' folder)`);
      }
    });

    // Resolve the training provider ID for this user
    // Supports multiple training provider companies
    console.log('🔍 Looking up user\'s training provider organization...');
    
    let trainingProviderId: string | null = null;
    
    // First, check training_provider_member table (new multi-company approach)
    const memberCheck = await pool.query(
      'SELECT provider_id FROM training_provider_member WHERE user_id = $1', 
      [userId]
    );
    
    if (memberCheck.rows.length > 0) {
      trainingProviderId = memberCheck.rows[0].provider_id;
      console.log('✅ Found via training_provider_member:', trainingProviderId);
    }
    
    // If not found, check if user IS the training provider (direct ownership)
    if (!trainingProviderId) {
      console.log('🔍 Not found via member table, checking direct provider ownership...');
      const directTpCheck = await pool.query('SELECT id FROM training_provider WHERE id = $1', [userId]);
      
      if (directTpCheck.rows.length > 0) {
        trainingProviderId = userId;
        console.log('✅ User is a direct Training Provider');
      }
    }
    
    // If still not found, check provider_admin_user table (legacy/admin access)
    if (!trainingProviderId) {
      console.log('🔍 Not found as owner, checking provider_admin_user (legacy admin access)...');
      const adminCheck = await pool.query('SELECT provider_id FROM provider_admin_user WHERE user_id = $1', [userId]);
      
      if (adminCheck.rows.length > 0) {
        trainingProviderId = adminCheck.rows[0].provider_id;
        console.log('✅ Resolved Training Provider ID via Admin Linkage:', trainingProviderId);
      }
    }
    
    if (!trainingProviderId) {
      return res.status(404).json({ 
        success: false, 
        error: 'No training provider organization found for this user. Please contact administrator.' 
      });
    }

    console.log('🎯 Target Training Provider ID for updates:', trainingProviderId);

    // Get current profile to check for old files
    const currentProfile = await pool.query(`
      SELECT tp.invoice_template_url, tp.receipt_template_url, tp.certificate_template_url,
             tp.pro_forma_template_url, tp.ssg_self_sign_cert_file, tp.ssg_private_key_file,
             tp.ssg_app1_cert_file, tp.ssg_app1_private_key_file,
             tp.ssg_app3_cert_file, tp.ssg_app3_private_key_file,
             au.profile_picture_url
      FROM app_user au
      LEFT JOIN training_provider tp ON tp.id = $2
      WHERE au.id = $1
    `, [userId, trainingProviderId]);

    const oldFiles = currentProfile.rows[0] || {};

    // Handle file uploads and track new file paths
    const filePaths: { [key: string]: string } = {};

    console.log('📋 Processing file uploads...', Object.keys(files));

    // Handle company logo upload
    if (files.companyLogo) {
      console.log('📸 Processing company logo upload...');
      const logoFile = Array.isArray(files.companyLogo) ? files.companyLogo[0] : files.companyLogo;
      console.log('🔍 Logo file details:', {
        originalFilename: logoFile.originalFilename,
        size: logoFile.size,
        mimetype: logoFile.mimetype,
        filepath: logoFile.filepath
      });

      // Check if temp file exists
      console.log('🔍 Temp file exists:', fs.existsSync(logoFile.filepath));

      // Only process if file has content
      if (logoFile && logoFile.size > 0) {
        if (oldFiles.profile_picture_url) {
          console.log('🗑️ Deleting old logo file:', oldFiles.profile_picture_url);
          deleteOldFile(oldFiles.profile_picture_url);
        }

        console.log('🚀 About to call saveUploadedFile...');
        try {
          filePaths.companyLogoUrl = await saveUploadedFile(logoFile, userId, 'logo');
          console.log('✅ Company logo saved successfully:', filePaths.companyLogoUrl);
        } catch (saveError) {
          console.error('❌ Error in saveUploadedFile:', saveError);
          throw saveError;
        }
      } else {
        console.log(`⚠️ Company logo is empty or invalid (size: ${logoFile?.size}), skipping...`);
      }
    } else {
      console.log('⚠️ No company logo file received in upload');
    }

    // Handle document template uploads
    const templateFields = [
      { fileKey: 'invoiceTemplate', dbField: 'invoice_template_url', oldFile: oldFiles.invoice_template_url },
      { fileKey: 'receiptTemplate', dbField: 'receipt_template_url', oldFile: oldFiles.receipt_template_url },
      { fileKey: 'certificateTemplate', dbField: 'certificate_template_url', oldFile: oldFiles.certificate_template_url },
      { fileKey: 'proFormaInvoiceTemplate', dbField: 'pro_forma_template_url', oldFile: oldFiles.pro_forma_template_url },
      { fileKey: 'ssgCertFile', dbField: 'ssg_self_sign_cert_file', oldFile: oldFiles.ssg_self_sign_cert_file },
      { fileKey: 'ssgPrivateKeyFile', dbField: 'ssg_private_key_file', oldFile: oldFiles.ssg_private_key_file },
      { fileKey: 'ssgApp1CertFile', dbField: 'ssg_app1_cert_file', oldFile: oldFiles.ssg_app1_cert_file },
      { fileKey: 'ssgApp1PrivateKeyFile', dbField: 'ssg_app1_private_key_file', oldFile: oldFiles.ssg_app1_private_key_file },
      { fileKey: 'ssgApp3CertFile', dbField: 'ssg_app3_cert_file', oldFile: oldFiles.ssg_app3_cert_file },
      { fileKey: 'ssgApp3PrivateKeyFile', dbField: 'ssg_app3_private_key_file', oldFile: oldFiles.ssg_app3_private_key_file }
    ];

    for (const template of templateFields) {
      if (files[template.fileKey]) {
        console.log(`📄 Processing ${template.fileKey} upload...`);
        const templateFileRaw = files[template.fileKey];
        const templateFile = Array.isArray(templateFileRaw) ? templateFileRaw[0] : templateFileRaw;

        console.log(`🔍 ${template.fileKey} file details:`, {
          originalFilename: templateFile?.originalFilename,
          size: templateFile?.size,
          mimetype: templateFile?.mimetype,
          filepath: templateFile?.filepath,
          expectedFolder: FOLDER_MAPPING[template.fileKey] || 'unknown'
        });

        // Only process if file has content
        if (templateFile && templateFile.size > 0) {
          if (template.oldFile) {
            console.log(`🗑️ Deleting old ${template.fileKey}:`, template.oldFile);
            deleteOldFile(template.oldFile);
          }

          try {
            console.log(`🚀 About to save ${template.fileKey} with folder mapping: ${template.fileKey} -> ${FOLDER_MAPPING[template.fileKey]}`);
            filePaths[template.dbField] = await saveUploadedFile(templateFile, userId, template.fileKey);
            console.log(`✅ ${template.fileKey} saved to:`, filePaths[template.dbField]);
          } catch (saveError) {
            console.error(`❌ Error saving ${template.fileKey}:`, saveError);
            throw saveError;
          }
        } else {
          console.log(`⚠️ ${template.fileKey} is empty or invalid (size: ${templateFile?.size}), checking temp file...`);

          // Additional debugging for empty files
          if (templateFile) {
            console.log('🔍 Empty file debugging:', {
              tempPath: templateFile.filepath,
              tempFileExists: fs.existsSync(templateFile.filepath),
              originalName: templateFile.originalFilename,
              mimetype: templateFile.mimetype
            });

            // Try to read temp file directly to see if it has content
            if (fs.existsSync(templateFile.filepath)) {
              try {
                const tempFileStats = fs.statSync(templateFile.filepath);
                console.log('📊 Temp file stats:', {
                  size: tempFileStats.size,
                  created: tempFileStats.birthtime,
                  modified: tempFileStats.mtime
                });

                if (tempFileStats.size > 0) {
                  console.log('🔧 File has content in temp location, proceeding with upload despite size=0 report...');

                  if (template.oldFile) {
                    console.log(`🗑️ Deleting old ${template.fileKey}:`, template.oldFile);
                    deleteOldFile(template.oldFile);
                  }

                  try {
                    console.log(`🚀 About to save ${template.fileKey} with folder mapping: ${template.fileKey} -> ${FOLDER_MAPPING[template.fileKey]}`);
                    filePaths[template.dbField] = await saveUploadedFile(templateFile, userId, template.fileKey);
                    console.log(`✅ ${template.fileKey} saved to:`, filePaths[template.dbField]);
                  } catch (saveError) {
                    console.error(`❌ Error saving ${template.fileKey}:`, saveError);
                    throw saveError;
                  }
                } else {
                  console.log('❌ Temp file also shows 0 bytes, file is genuinely empty');
                }
              } catch (statError) {
                console.error('❌ Error reading temp file stats:', statError);
              }
            } else {
              console.log('❌ Temp file does not exist at reported path');
            }
          }
        }
      } else {
        console.log(`⚠️ No ${template.fileKey} file received in upload`);
      }
    }

    console.log('📁 Final file paths before database update:', JSON.stringify(filePaths, null, 2));

    // Start transaction
    await pool.query('BEGIN');

    try {
      console.log('💾 Starting database transaction...');

      // Update app_user table (do NOT write company logo to profile_picture_url —
      // company logo goes to training_provider.company_logo_url only)
      const userUpdateResult = await pool.query(`
        UPDATE app_user
        SET full_name = COALESCE($1, full_name),
            password = COALESCE($2, password),
            updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `, [
        profileData.name || profileData.companyName,
        profileData.password,
        userId
      ]);

      console.log('🔍 Company name sync debug:', {
        'profileData.name': profileData.name,
        'profileData.companyName': profileData.companyName,
        'final_name_used': profileData.name || profileData.companyName,
        'app_user_update_rows': userUpdateResult.rowCount
      });
      console.log('✅ app_user updated, rows affected:', userUpdateResult.rowCount);

      // Update training_provider table
      const updateQuery = `
        UPDATE training_provider
        SET company_name = $1,
            company_shortname = $2,
            uen = $3,
            company_address = $4,
            company_email = $38,
            company_tel = $39,
            company_website = $40,
            contact_person_name = $5,
            contact_tel = $6,
            invoice_template_url = COALESCE($7, invoice_template_url),
            receipt_template_url = COALESCE($8, receipt_template_url),
            certificate_template_url = COALESCE($9, certificate_template_url),
            pro_forma_template_url = COALESCE($10, pro_forma_template_url),
            ssg_self_sign_cert_file = COALESCE($11, ssg_self_sign_cert_file),
            ssg_private_key_file = COALESCE($12, ssg_private_key_file),
            ssg_encryption_key = $13,
            sync_google_calendar = $14,
            sync_ms_calendar = $15,
            integrate_google_drive = $16,
            integrate_ms_onedrive = $17,
            auto_send_proforma_invoice = $18,
            auto_send_confirm_email = $19,
            auto_send_invoice = $20,
            auto_send_receipt = $21,
            auto_send_certificate = $22,
            auto_send_thankyou_email = $23,
            auto_mask_sensitive_data = $24,
            auto_delete_after_six_months = $25,
            enable_otp_login = $26,
            enable_default_otp = $27,
            default_otp = $28,
            enable_leaderboard = $29,
            enable_point_sys = $30,
            normal_fund_rate = $31,
            enhanced_fund_rate = $32,
            gst_rate = $33,
            gst_register = $34,
            color_scheme = $35,
            company_logo_url = COALESCE($37, company_logo_url),
            ssg_app1_cert_file = COALESCE($41, ssg_app1_cert_file),
            ssg_app1_private_key_file = COALESCE($42, ssg_app1_private_key_file),
            ssg_app1_encryption_key = $43,
            ssg_app3_cert_file = COALESCE($44, ssg_app3_cert_file),
            ssg_app3_private_key_file = COALESCE($45, ssg_app3_private_key_file),
            ssg_app3_encryption_key = $46,
            ssg_app4_client_id = $47,
            ssg_app4_client_secret = $48,
            ssg_default_app = $49,
            auto_enrol_direct_applications = $50,
            auto_generate_qb_invoice = $51,
            sanitise_after_months = $52
        WHERE id = $36
        RETURNING *
      `;

      const queryParams = [
        profileData.companyName,
        profileData.companyShortname,
        profileData.uen,
        profileData.companyAddress,
        profileData.contactPerson?.name,
        profileData.contactPerson?.tel,
        filePaths.invoice_template_url || profileData.invoiceTemplateUrl || null,
        filePaths.receipt_template_url || profileData.receiptTemplateUrl || null,
        filePaths.certificate_template_url || profileData.certificateTemplateUrl || null,
        filePaths.pro_forma_template_url || profileData.proFormaInvoiceTemplateUrl || null,
        filePaths.ssg_self_sign_cert_file,
        filePaths.ssg_private_key_file,
        profileData.ssgEncryptionKey,
        profileData.integrations?.syncGoogleCalendar || false,
        false,
        profileData.integrations?.googleDrive || false,
        profileData.integrations?.microsoftOneDrive || false,
        profileData.adminSettings?.autoSendProFormaInvoice || false,
        profileData.adminSettings?.autoSendConfirmationEmail || false,
        profileData.adminSettings?.autoSendInvoiceOnGrantSuccess || false,
        profileData.adminSettings?.autoSendReceiptOnPayment || false,
        profileData.adminSettings?.autoSendCertificateOnCompletion || false,
        profileData.adminSettings?.autoSendThankYouEmail || false,
        profileData.securitySettings?.autoMaskSensitiveData || false,
        profileData.securitySettings?.autoDeleteAfter6Months || false,
        profileData.securitySettings?.enableOtpLogin || false,
        profileData.securitySettings?.enableDefaultOtp || false,
        profileData.securitySettings?.defaultOtpValue || '',
        profileData.gamingSettings?.enableLeaderboard || false,
        profileData.gamingSettings?.enablePoints || false,
        profileData.fundingSettings?.normalFunding || 70,
        profileData.fundingSettings?.enhancedFunding || 90,
        profileData.fundingSettings?.gstRate || 8.0,
        profileData.fundingSettings?.isGstRegistered || false,
        profileData.colorScheme || '#3B82F6',
        trainingProviderId,
        filePaths.companyLogoUrl || null,
        profileData.companyEmail || '',
        profileData.companyTel || '',
        profileData.companyWebsite || '',
        filePaths.ssg_app1_cert_file || null,
        filePaths.ssg_app1_private_key_file || null,
        profileData.ssgApp1EncryptionKey ?? null,
        filePaths.ssg_app3_cert_file || null,
        filePaths.ssg_app3_private_key_file || null,
        profileData.ssgApp3EncryptionKey ?? null,
        profileData.ssgApp4ClientId ?? null,
        profileData.ssgApp4ClientSecret ?? null,
        profileData.ssgDefaultApp || 'app1',
        profileData.adminSettings?.autoEnrolDirectApplications || false,
        profileData.adminSettings?.autoGenerateQbInvoice || false,
        Math.max(1, Math.min(60, parseInt(String(profileData.securitySettings?.sanitiseAfterMonths ?? 6), 10) || 6))
      ];

      console.log('🔍 File upload parameters being sent to database:', {
        'invoice_template_url': queryParams[6],
        'receipt_template_url': queryParams[7],
        'certificate_template_url': queryParams[8],
        'pro_forma_template_url': queryParams[9],
        'ssg_self_sign_cert_file': queryParams[10],
        'ssg_private_key_file': queryParams[11]
      });

      const providerUpdateResult = await pool.query(updateQuery, queryParams);

      console.log('✅ training_provider updated, rows affected:', providerUpdateResult.rowCount);

      // Safely update force_first_password_change and default_password (columns may not exist yet)
      try {
        await pool.query(
          `UPDATE training_provider SET force_first_password_change = $1, default_password = $2 WHERE id = $3`,
          [profileData.securitySettings?.forceFirstPasswordChange || false, profileData.securitySettings?.defaultPassword || null, trainingProviderId]
        );
      } catch (e) {
        // Columns don't exist yet, skip
      }

      // Safely update calendar URL and email config (columns may not exist yet)
      try {
        await pool.query(
          `UPDATE training_provider SET
            google_calendar_url = $1,
            email_user = $2,
            google_client_id = $3,
            google_client_secret = $4,
            google_refresh_token = $5,
            google_slides_template_id = $6,
            certificate_folder_url = $7
          WHERE id = $8`,
          [
            profileData.integrations?.googleCalendarUrl || null,
            profileData.integrations?.emailUser || null,
            profileData.integrations?.googleClientId || null,
            profileData.integrations?.googleClientSecret || null,
            profileData.integrations?.googleRefreshToken || null,
            profileData.integrations?.googleSlidesTemplateId || null,
            profileData.integrations?.certificateFolderUrl || null,
            trainingProviderId,
          ]
        );
      } catch (e) {
        // Columns don't exist yet, skip
      }

      // Safely update extra integration columns (each group independent so missing columns don't block others)
      const autoCreateAndUpdate = async (columns: { name: string; value: any }[]) => {
        const setClauses = columns.map((c, i) => `${c.name} = $${i + 1}`).join(', ');
        const values = [...columns.map(c => c.value), trainingProviderId];
        const whereIdx = columns.length + 1;
        try {
          await pool.query(`UPDATE training_provider SET ${setClauses} WHERE id = $${whereIdx}`, values);
        } catch (e) {
          try {
            for (const c of columns) {
              await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS ${c.name} text`);
            }
            await pool.query(`UPDATE training_provider SET ${setClauses} WHERE id = $${whereIdx}`, values);
          } catch (e2) {
            console.error(`Failed to save columns ${columns.map(c => c.name).join(', ')}:`, e2);
          }
        }
      };

      // Reference links
      await autoCreateAndUpdate([
        { name: 'master_list_url', value: profileData.integrations?.masterListUrl || null },
        { name: 'tertiary_tms_url', value: profileData.integrations?.tertiaryTmsUrl || null },
        { name: 'tertiary_fms_url', value: profileData.integrations?.tertiaryFmsUrl || null },
        { name: 'tertiary_mms_url', value: profileData.integrations?.tertiaryMmsUrl || null },
        { name: 'tertiary_tpms_url', value: profileData.integrations?.tertiaryTpmsUrl || null },
      ]);
      // n8n
      await autoCreateAndUpdate([
        { name: 'n8n_host1_url', value: profileData.integrations?.n8nHost1Url || null },
        { name: 'n8n_host2_url', value: profileData.integrations?.n8nHost2Url || null },
        // Finance automation webhooks (JSON map). Keys match FINANCE_AUTOMATION_ACTIONS webhookEnvKey values.
        { name: 'n8n_finance_webhooks_json', value: profileData.integrations?.n8nFinanceWebhooksJson || null },
      ]);
      // Magento
      await autoCreateAndUpdate([
        { name: 'magento_backend_url', value: profileData.integrations?.magentoBackendUrl || null },
      ]);
      // Google Drive extras
      await autoCreateAndUpdate([
        { name: 'trainer_profile_image_url', value: profileData.integrations?.trainerProfileImageUrl || null },
      ]);
      // OpenClaw / Orion
      await autoCreateAndUpdate([
        { name: 'openclaw_mode', value: profileData.integrations?.openClawMode || 'live' },
        { name: 'openclaw_gateway_url', value: profileData.integrations?.openClawGatewayUrl || null },
        { name: 'openclaw_local_gateway_url', value: profileData.integrations?.openClawLocalGatewayUrl || null },
        { name: 'openclaw_hooks_path', value: profileData.integrations?.openClawHooksPath || null },
        { name: 'openclaw_agent_id', value: profileData.integrations?.openClawAgentId || null },
        { name: 'openclaw_callback_url', value: profileData.integrations?.openClawCallbackUrl || null },
      ]);
      // Support email (separate from company_email)
      await autoCreateAndUpdate([
        { name: 'support_email', value: profileData.contactPerson?.email || null },
      ]);
      // Admin thresholds
      await autoCreateAndUpdate([
        { name: 'upcoming_classes_threshold_days', value: String(profileData.adminSettings?.upcomingClassesThresholdDays || 21) },
      ]);

      // Handle API keys - delete existing and insert new ones (with selected model)
      console.log('🔑 Processing API keys...');
      const deleteResult = await pool.query('DELETE FROM training_provider_api WHERE training_provider_id = $1', [trainingProviderId]);
      console.log('🗑️ Deleted existing API keys, rows affected:', deleteResult.rowCount);

      if (profileData.apiKeys && typeof profileData.apiKeys === 'object' && Object.keys(profileData.apiKeys).length > 0) {
        console.log('➕ Adding new API keys:', Object.keys(profileData.apiKeys));
        for (const [keyName, keyValue] of Object.entries(profileData.apiKeys)) {
          // Ensure keyValue is a non-empty string
          const strValue = typeof keyValue === 'string' ? keyValue.trim() : String(keyValue || '').trim();
          if (strValue !== '') {
            // Get selected model for this API key (if any), preserving empty string for "None"
            const selectedModel = profileData.apiKeyModels?.[keyName] ?? null;
            const insertResult = await pool.query(`
              INSERT INTO training_provider_api (training_provider_id, key_name, key_value, selected_model)
              VALUES ($1, $2, $3, $4)
            `, [trainingProviderId, keyName, strValue, selectedModel]);
            console.log(`✅ Added API key "${keyName}" with model "${selectedModel}", rows affected:`, insertResult.rowCount);
          } else {
            console.log(`⚠️ Skipping empty API key "${keyName}"`);
          }
        }
      } else {
        console.log('ℹ️ No API keys to add');
      }

      // Commit transaction
      await pool.query('COMMIT');

      console.log('✅ Training provider profile updated successfully');

      // Fetch updated profile data to return
      const updatedProfileResult = await pool.query(`
        SELECT 
          au.id, au.full_name as "companyName", au.email, tp.company_logo_url as "companyLogoUrl",
          tp.company_name as "companyName", tp.company_shortname as "companyShortname", 
          tp.uen, tp.company_address as "companyAddress",
          tp.contact_person_name as "contactPersonName", tp.contact_tel as "contactPersonTel",
          tp.invoice_template_url as "invoiceTemplateUrl",
          tp.receipt_template_url as "receiptTemplateUrl",
          tp.certificate_template_url as "certificateTemplateUrl",
          tp.pro_forma_template_url as "proFormaInvoiceTemplateUrl",
          tp.ssg_self_sign_cert_file as "ssgCertFile",
          tp.ssg_private_key_file as "ssgPrivateKeyFile"
        FROM app_user au
        INNER JOIN training_provider tp ON au.id = tp.id
        WHERE au.id = $1
      `, [userId]);

      const updatedProfile = updatedProfileResult.rows[0] || {};

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          profileId: userId,
          updatedFiles: filePaths,
          profile: updatedProfile
        }
      });

    } catch (error) {
      // Rollback transaction
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Error updating training provider profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
