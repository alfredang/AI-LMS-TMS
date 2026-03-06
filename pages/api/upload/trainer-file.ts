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

    // Set upload directory based on file type
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'trainers', fileType as string);
    
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      filename: (name: string, ext: string, part: any) => {
        // Create unique filename with timestamp
        const timestamp = Date.now();
        const originalName = part.originalFilename || 'file';
        // Clean the filename to prevent issues
        const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
        return `${timestamp}_${cleanName}`;
      }
    });

    const [fields, files] = await form.parse(req);
    
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Validate file types
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp'
    ];

    if (!allowedMimeTypes.includes(file.mimetype || '')) {
      // Delete the uploaded file since it's invalid
      fs.unlinkSync(file.filepath);
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only PDF, Word documents, text files, and images are allowed.'
      });
    }

    // If there's an old file URL, delete the old file (for CV replacement)
    if (oldFileUrl && typeof oldFileUrl === 'string') {
      try {
        const oldFilePath = path.join(process.cwd(), 'public', oldFileUrl);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log('🗑️ Deleted old file:', oldFilePath);
        }
      } catch (error) {
        console.error('⚠️ Failed to delete old file:', error);
        // Continue with upload even if old file deletion fails
      }
    }

    // Generate the public URL path
    const relativePath = path.relative(path.join(process.cwd(), 'public'), file.filepath);
    const fileUrl = `${getBaseUrl().replace(/\/$/, '')}/${relativePath.replace(/\\/g, '/')}`;

    console.log('✅ File uploaded successfully:', {
      originalName: file.originalFilename,
      filename: path.basename(file.filepath),
      fileUrl,
      size: file.size,
      mimetype: file.mimetype
    });

    return res.status(200).json({
      success: true,
      data: {
        originalFilename: file.originalFilename, // Keep this for display
        filename: file.originalFilename, // Return original name for display
        storedFilename: path.basename(file.filepath), // Keep the stored filename for reference
        filepath: file.filepath,
        fileUrl: fileUrl,
        size: file.size,
        mimetype: file.mimetype
      }
    });

  } catch (error) {
    console.error('❌ Error uploading trainer file:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default handler;