import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { cors } from '../../../lib/cors';
import { uploadProfileImageBufferToDrive } from '../../../lib/google-drive/profile-image-helpers';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { role, userId } = req.query;

    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
    });

    const [, files] = await form.parse(req);
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!uploadedFile?.filepath) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(uploadedFile.mimetype || '')) {
      try { fs.unlinkSync(uploadedFile.filepath); } catch {}
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.',
      });
    }

    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    try { fs.unlinkSync(uploadedFile.filepath); } catch {}

    const uploadResult = await uploadProfileImageBufferToDrive({
      buffer: fileBuffer,
      mimeType: uploadedFile.mimetype || 'application/octet-stream',
      originalName: uploadedFile.originalFilename || 'profile-image',
      role: typeof role === 'string' ? role : 'user',
      userId: typeof userId === 'string' ? userId : undefined,
    });

    return res.status(200).json({
      success: true,
      data: {
        fileUrl: uploadResult.fileUrl,
        fileName: uploadResult.fileName,
        originalFilename: uploadedFile.originalFilename,
        fileId: uploadResult.fileId,
        webViewLink: uploadResult.webViewLink,
        fileSize: uploadedFile.size,
      },
    });
  } catch (error) {
    console.error('❌ Profile image Google Drive upload error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Profile image upload failed',
    });
  }
}

export default withAuth(handler);