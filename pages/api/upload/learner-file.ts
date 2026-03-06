import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { cors } from '../../../lib/cors';
import { getBaseUrl } from '../../../lib/config';

// Disable body parser to handle multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fileType, userId, oldFileUrl } = req.query;
    
    // Validate file type
    if (!fileType || (fileType !== 'cv' && fileType !== 'certification' && fileType !== 'profilePicture')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Must be "cv", "certification", or "profilePicture"'
      });
    }

    // Set upload directory based on file type - LEARNER-SPECIFIC PATH
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'learner', fileType as string);
    
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    console.log(`📁 Learner Upload: Uploading ${fileType} to ${uploadDir}`);

    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      filename: (name: string, ext: string, part: any) => {
        // Create unique filename with timestamp
        const timestamp = Date.now();
        const originalName = part.originalFilename || 'file';
        const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
        return `${timestamp}_${cleanName}`;
      }
    });

    // Delete old file if specified (for profile picture replacement)
    if (oldFileUrl && typeof oldFileUrl === 'string') {
      try {
        // Extract filename from URL and construct local path
        const oldFileName = path.basename(oldFileUrl);
        const oldFilePath = path.join(uploadDir, oldFileName);
        
        console.log(`🗑️ Learner Upload: Attempting to delete old file: ${oldFilePath}`);
        
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log(`✅ Learner Upload: Successfully deleted old file: ${oldFileName}`);
        } else {
          console.log(`⚠️ Learner Upload: Old file not found: ${oldFilePath}`);
        }
      } catch (deleteError) {
        console.error('❌ Learner Upload: Error deleting old file:', deleteError);
        // Continue with upload even if deletion fails
      }
    }

    const files = await new Promise<any>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });

    const file = files.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Handle both single file and array of files
    const uploadedFile = Array.isArray(file) ? file[0] : file;
    
    if (!uploadedFile || !uploadedFile.filepath) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file upload'
      });
    }

    const fileName = path.basename(uploadedFile.filepath);
    const fileUrl = `${getBaseUrl().replace(/\/$/, '')}/uploads/learner/${fileType}/${fileName}`;
    
    console.log(`✅ Learner Upload: File uploaded successfully: ${fileName}`);
    console.log(`📁 Learner Upload: File URL: ${fileUrl}`);

    // Validate file type based on extension
    const allowedExtensions = {
      cv: ['.pdf', '.doc', '.docx'],
      certification: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'],
      profilePicture: ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    };

    const fileExtension = path.extname(uploadedFile.originalFilename || '').toLowerCase();
    const allowedExts = allowedExtensions[fileType as keyof typeof allowedExtensions];
    
    if (!allowedExts.includes(fileExtension)) {
      // Delete the uploaded file since it's invalid
      fs.unlinkSync(uploadedFile.filepath);
      return res.status(400).json({
        success: false,
        error: `Invalid file type for ${fileType}. Allowed: ${allowedExts.join(', ')}`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        fileUrl,
        originalFilename: uploadedFile.originalFilename,
        fileName,
        fileSize: uploadedFile.size
      }
    });

  } catch (error) {
    console.error('❌ Learner Upload Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    });
  }
}

export default handler;