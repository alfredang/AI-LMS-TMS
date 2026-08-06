import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File } from 'formidable';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { createGrantImportUploadJob } from '@/lib/services/grantImport/grantImportUploadJob';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '25mb',
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let tempFilePath: string | null = null;

  try {
    const { actorUserId } = await requireFinanceOrAdmin(req);

    const form = formidable({
      multiples: false,
      maxFileSize: 25 * 1024 * 1024,
      uploadDir: os.tmpdir(),
      keepExtensions: true,
    });

    const { files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const file = (files.file as File | File[] | undefined) || (files.xlsx as File | File[] | undefined);
    const first = Array.isArray(file) ? file[0] : file;
    if (!first?.filepath) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    tempFilePath = first.filepath;

    const originalFilename = first.originalFilename || path.basename(first.filepath);
    const lower = String(originalFilename).toLowerCase();
    const isXlsx =
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      String((first as any).mimetype || '').toLowerCase().includes('spreadsheetml') ||
      String((first as any).mimetype || '').toLowerCase().includes('excel');

    if (!isXlsx) {
      return res.status(400).json({ success: false, error: 'Invalid file type. Please upload a .xlsx file.' });
    }

    if (typeof first.size === 'number' && first.size <= 0) {
      return res.status(400).json({ success: false, error: 'Empty file uploaded' });
    }

    // Create an async job so frontend can show accurate progress.
    // Do NOT delete the temp file here; the job runner will delete it after completion/TTL.
    tempFilePath = null;
    const { jobId } = createGrantImportUploadJob({
      tempFilePath: first.filepath,
      filename: originalFilename,
      actorUserId,
    });

    return res.status(200).json({ success: true, data: { jobId } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  } finally {
    if (tempFilePath) fs.unlink(tempFilePath, () => {});
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
