import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { cors } from '../../../lib/cors';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Creating test certificate data...');
    
    const userId = '11111111-1111-4111-8111-111111111111';
    const courseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    
    // Update the enrollment with a certificate URL
    const updateQuery = `
      UPDATE public.enrollment 
      SET certificate = '/mock-data/certificates/full-stack-web-development-certificate.pdf'
      WHERE user_id = $1 AND course_id = $2
      RETURNING id, certificate
    `;
    
    const result = await pool.query(updateQuery, [userId, courseId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found'
      });
    }
    
    console.log('✅ Certificate URL added to enrollment');
    
    return res.status(200).json({
      success: true,
      data: {
        enrollmentId: result.rows[0].id,
        certificateUrl: result.rows[0].certificate,
        message: 'Test certificate data created'
      }
    });
  } catch (error) {
    console.error('❌ Failed to create test certificate:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

export default handler;
