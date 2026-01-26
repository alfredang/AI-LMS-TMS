import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import fs from 'fs';
import path from 'path';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { enrollmentId, assessmentId, fileName, fileUrl } = req.body;

  if (!enrollmentId || !assessmentId || !fileName) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameters: enrollmentId, assessmentId, fileName' 
    });
  }

  try {
    // Check if there's already a submission for this enrollment and assessment
    const existingQuery = `
      SELECT file_url FROM public.submission 
      WHERE enrollment_id = $1 AND assessment_id = $2
    `;
    const existingResult = await pool.query(existingQuery, [enrollmentId, assessmentId]);
    
    // Use the provided file URL or fallback to mock data
    const actualFileUrl = fileUrl || `/mock-data/${fileName}`;
    
    const query = `
      INSERT INTO public.submission (enrollment_id, assessment_id, file_name, submitted_at, file_url)
      VALUES ($1, $2, $3, NOW(), $4)
      ON CONFLICT (enrollment_id, assessment_id)
      DO UPDATE SET
        file_name    = EXCLUDED.file_name,
        file_url     = EXCLUDED.file_url,
        submitted_at = EXCLUDED.submitted_at
      RETURNING *
    `;

    const result = await pool.query(query, [enrollmentId, assessmentId, fileName, actualFileUrl]);

    // If this was a resubmission (existing submission found), delete the old file
    if (existingResult.rows.length > 0) {
      const oldFileUrl = existingResult.rows[0].file_url;
      if (oldFileUrl && oldFileUrl !== actualFileUrl && !oldFileUrl.startsWith('/mock-data/')) {
        try {
          // Construct the full file path
          const oldFilePath = path.join(process.cwd(), 'public', oldFileUrl);
          
          // Check if the old file exists and delete it
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            console.log(`🗑️ Deleted old submission file: ${oldFilePath}`);
          }
        } catch (deleteError) {
          console.error('⚠️ Failed to delete old submission file:', deleteError);
          // Continue processing even if file deletion fails
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error submitting assessment:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default handler;
