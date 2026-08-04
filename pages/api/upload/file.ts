import { withAuth } from '@lib/auth/withAuth';
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

const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'submissions');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      allowEmptyFiles: true,
      minFileSize: 0,
      filename: (name: string, ext: string, part: any) => {
        // Create unique filename with timestamp
        const timestamp = Date.now();
        const originalName = part.originalFilename || 'file';
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

    // Generate the public URL path
    const relativePath = path.relative(path.join(process.cwd(), 'public'), file.filepath);
    const fileUrl = `/${relativePath.replace(/\\/g, '/')}`;

    return res.status(200).json({
      success: true,
      data: {
        filename: file.originalFilename,
        filepath: file.filepath,
        fileUrl: fileUrl,
        size: file.size,
        mimetype: file.mimetype
      }
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);