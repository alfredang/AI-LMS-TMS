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
    
    // Validate file type
    if (!fileType || (fileType !== 'cv' && fileType !== 'certification' && fileType !== 'profilePicture')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Must be "cv", "certification", or "profilePicture"'
      });
    }

    // Parse form to system temp dir first (reliable across all environments)
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
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
      try { fs.unlinkSync(file.filepath); } catch {}
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only PDF, Word documents, text files, and images are allowed.'
      });
    }

    // Set upload directory based on file type and ensure it exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'trainers', fileType as string);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Build final filename and copy from temp to destination
    const timestamp = Date.now();
    const originalName = file.originalFilename || 'file';
    const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}_${cleanName}`;
    const destPath = path.join(uploadDir, fileName);

    fs.writeFileSync(destPath, fs.readFileSync(file.filepath));
    try { fs.unlinkSync(file.filepath); } catch {}

    // If there's an old file URL, delete the old file
    if (oldFileUrl && typeof oldFileUrl === 'string') {
      try {
        const oldFilePath = path.join(process.cwd(), 'public', oldFileUrl);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log('🗑️ Deleted old file:', oldFilePath);
        }
      } catch (error) {
        console.error('⚠️ Failed to delete old file:', error);
      }
    }

    const fileUrl = `/uploads/trainers/${fileType}/${fileName}`;

    console.log('✅ File uploaded successfully:', {
      originalName: file.originalFilename,
      filename: fileName,
      fileUrl,
      size: file.size,
      mimetype: file.mimetype
    });

    return res.status(200).json({
      success: true,
      data: {
        originalFilename: file.originalFilename,
        filename: file.originalFilename,
        storedFilename: fileName,
        filepath: destPath,
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