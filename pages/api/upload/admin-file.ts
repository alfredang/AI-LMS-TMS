import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { cors } from '../../../lib/cors';

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
    
    // Validate file type - admin only supports profilePicture for now
    if (!fileType || fileType !== 'profilePicture') {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Must be "profilePicture"'
      });
    }

    // Set upload directory - ADMIN-SPECIFIC PATH
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'admin');
    
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    console.log(`📁 Admin Upload: Uploading ${fileType} to ${uploadDir}`);

    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      filename: (name: string, ext: string, part: any) => {
        // Create filename with timestamp_originalname.format
        const timestamp = Date.now();
        const originalName = part.originalFilename || 'unknown';
        // Clean the original name (remove spaces and special characters for safety)
        const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
        return `${timestamp}_${cleanName}${ext}`;
      }
    });

    const [fields, files] = await form.parse(req);
    
    // Get the uploaded file
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Validate file type (only images for profile pictures)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(uploadedFile.mimetype || '')) {
      // Delete the uploaded file
      fs.unlinkSync(uploadedFile.filepath);
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'
      });
    }

    // Delete old file if specified
    if (oldFileUrl && typeof oldFileUrl === 'string') {
      try {
        const oldFilePath = path.join(process.cwd(), 'public', oldFileUrl.replace(/^\//, ''));
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log(`🗑️ Admin Upload: Deleted old file: ${oldFilePath}`);
        }
      } catch (error) {
        console.warn('⚠️ Admin Upload: Failed to delete old file:', error);
      }
    }

    // Generate relative URL path
    const relativePath = `/uploads/admin/${path.basename(uploadedFile.filepath)}`;

    console.log(`✅ Admin Upload: File uploaded successfully`);
    console.log(`📁 File path: ${uploadedFile.filepath}`);
    console.log(`🔗 Relative path: ${relativePath}`);

    return res.status(200).json({
      success: true,
      message: 'Admin file uploaded successfully',
      data: {
        fileName: path.basename(uploadedFile.filepath),
        originalName: uploadedFile.originalFilename,
        fileUrl: relativePath,
        relativePath: relativePath,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      }
    });

  } catch (error) {
    console.error('❌ Admin Upload Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload admin file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default handler;