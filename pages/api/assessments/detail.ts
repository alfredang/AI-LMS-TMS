import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { assessmentId } = req.query;

  if (!assessmentId) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameter: assessmentId' 
    });
  }

  try {
    const query = `
      SELECT id, title, file_url, category, status
      FROM public.assessment
      WHERE id = $1
    `;

    const result = await pool.query(query, [assessmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching assessment details:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default handler;
