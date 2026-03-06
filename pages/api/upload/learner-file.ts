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

    const uploadedFile = Array.isArray(file) ? file[0] : file;

    if (!uploadedFile || !uploadedFile.filepath) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file upload'
      });
    }

    // Validate file type based on extension
    const allowedExtensions = {
      cv: ['.pdf', '.doc', '.docx'],
      certification: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'],
      profilePicture: ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    };

    const fileExtension = path.extname(uploadedFile.originalFilename || '').toLowerCase();
    const allowedExts = allowedExtensions[fileType as keyof typeof allowedExtensions];

    if (!allowedExts.includes(fileExtension)) {
      try { fs.unlinkSync(uploadedFile.filepath); } catch {}
      return res.status(400).json({
        success: false,
        error: `Invalid file type for ${fileType}. Allowed: ${allowedExts.join(', ')}`
      });
    }

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'learner', fileType as string);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Build final filename and copy from temp to destination
    const timestamp = Date.now();
    const originalName = uploadedFile.originalFilename || 'file';
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
          console.log(`🗑️ Learner Upload: Deleted old file: ${oldFilePath}`);
        }
      } catch (deleteError) {
        console.error('❌ Learner Upload: Error deleting old file:', deleteError);
      }
    }

    const fileUrl = `/uploads/learner/${fileType}/${fileName}`;

    console.log(`✅ Learner Upload: File saved successfully: ${fileName}`);

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