import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File } from 'formidable';
import fs from 'fs';
import path from 'path';
import { processClaimUpload } from '@lib/services/claimUploadService';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '20mb',
  },
};

function ensureUploadsDir(): string {
  const base = path.join(process.cwd(), 'public', 'uploads', 'claims');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const uploadDir = ensureUploadsDir();

    const form = formidable({
      multiples: false,
      maxFileSize: 20 * 1024 * 1024,
      uploadDir,
      keepExtensions: true,
      filename: (name, ext, part, form) => {
        const ts = Date.now();
        const safe = (part.originalFilename || 'claim').replace(/[^a-zA-Z0-9._-]/g, '_');
        return `${ts}_${safe}`;
      },
    });

    const { files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const file = (files.file as File | File[] | undefined);
    const first = Array.isArray(file) ? file[0] : file;
    if (!first || !first.filepath) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalFilename = first.originalFilename || path.basename(first.filepath);
    const lower = String(originalFilename).toLowerCase();
    const isXlsx =
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      String((first as any).mimetype || '').toLowerCase().includes('spreadsheetml') ||
      String((first as any).mimetype || '').toLowerCase().includes('excel');

    if (!isXlsx) {
      return res.status(400).json({ error: 'Invalid file type. Please upload an Excel file (.xlsx or .xls).' });
    }

    if (typeof first.size === 'number' && first.size <= 0) {
      return res.status(400).json({ error: 'Empty file uploaded' });
    }

    const response = await processClaimUpload({
      filepath: first.filepath,
      originalFilename: first.originalFilename || null,
      mimetype: (first as any).mimetype || null,
      size: typeof first.size === 'number' ? first.size : null,
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in claim-check-upload:', error);

    const msg = error instanceof Error ? error.message : String(error);
    // Common case after deploying new code before applying DB migrations
    if (msg.includes('does not exist') && msg.includes('ssg_claims')) {
      return res.status(500).json({
        error:
          'Database schema is missing required ssg_claims columns for the claim report import. Apply SQL migration `database/16-ssg-claims-add-report-fields.sql` to your database and retry.',
        details: msg,
      });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
}

