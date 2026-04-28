import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Ensure table exists (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS course_additional_document (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { courseRunId, uploadedBy } = req.query;

    if (!courseRunId || !uploadedBy) {
      return res.status(400).json({ success: false, error: 'Missing courseRunId or uploadedBy' });
    }

    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB limit
      allowEmptyFiles: false,
    });

    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'additional_documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const timestamp = Date.now();
    const originalName = file.originalFilename || 'document';
    const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}_${cleanName}`;
    const destPath = path.join(uploadDir, fileName);

    fs.writeFileSync(destPath, fs.readFileSync(file.filepath));
    try { fs.unlinkSync(file.filepath); } catch {}

    const fileUrl = `/uploads/additional_documents/${fileName}`;

    // Update database
    let dbCourseRunId = courseRunId;
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(courseRunId as string)) {
        const runRes = await pool.query('SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1', [courseRunId]);
        if (runRes.rows.length === 0) {
            try { fs.unlinkSync(destPath); } catch {}
            return res.status(404).json({ success: false, error: 'Course Run not found' });
        }
        dbCourseRunId = runRes.rows[0].id;
    }

    const result = await pool.query(
        `INSERT INTO course_additional_document (course_run_id, file_name, file_url, uploaded_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, file_name, file_url, uploaded_by, created_at`,
        [dbCourseRunId, originalName, fileUrl, uploadedBy]
    );

    return res.status(200).json({
      success: true,
      document: {
        id: result.rows[0].id,
        fileName: result.rows[0].file_name,
        fileUrl: result.rows[0].file_url,
        uploadedBy: result.rows[0].uploaded_by,
        createdAt: result.rows[0].created_at
      }
    });

  } catch (error) {
    console.error('❌ Error uploading additional document:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
