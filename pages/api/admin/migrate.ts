import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { cors } from '../../../lib/cors';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD || 'shuo1314520.',
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
    console.log('🔄 Running migration: Add file_url to submission table...');
    
    // Add file_url column to submission table if it doesn't exist
    await pool.query(`
      ALTER TABLE public.submission 
      ADD COLUMN IF NOT EXISTS file_url text;
    `);
    
    console.log('✅ Added file_url column');
    
    // Add unique constraint if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE public.submission 
        ADD CONSTRAINT submission_enrollment_assessment_unique 
        UNIQUE (enrollment_id, assessment_id);
      `);
      console.log('✅ Added unique constraint');
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        console.log('ℹ️ Unique constraint already exists');
      } else {
        throw error;
      }
    }
    
    // Create index for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_submission_user_course 
      ON public.submission(enrollment_id, assessment_id);
    `);
    
    console.log('✅ Created index');

    return res.status(200).json({
      success: true,
      message: 'Migration completed successfully'
    });
  } catch (error) {
    console.error('❌ Migration failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

export default handler;
