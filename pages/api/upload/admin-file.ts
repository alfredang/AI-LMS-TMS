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

    // Parse form to system temp dir first (reliable across all environments)
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
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
      try { fs.unlinkSync(uploadedFile.filepath); } catch {}
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'
      });
    }

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'admin');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Build final filename and copy from temp to destination
    const timestamp = Date.now();
    const originalName = uploadedFile.originalFilename || 'unknown';
    const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}_${cleanName}`;
    const destPath = path.join(uploadDir, fileName);

    fs.writeFileSync(destPath, fs.readFileSync(uploadedFile.filepath));
    try { fs.unlinkSync(uploadedFile.filepath); } catch {}

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

    const relativePath = `/uploads/admin/${fileName}`;

    console.log(`✅ Admin Upload: File uploaded successfully`);
    console.log(`📁 Saved to: ${destPath}`);
    console.log(`🔗 Relative path: ${relativePath}`);

    return res.status(200).json({
      success: true,
      message: 'Admin file uploaded successfully',
      data: {
        fileName,
        originalName: uploadedFile.originalFilename,
        fileUrl: relativePath,
        relativePath,
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