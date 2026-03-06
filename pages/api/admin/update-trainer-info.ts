import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { courseRunUuid, courseRunId, trainerName, trainerEmail, trainerId } = req.body;

    // Validate required fields
    if (!courseRunUuid || !trainerName) {
      return res.status(400).json({
        success: false,
        error: 'courseRunUuid and trainerName are required'
      });
    }

    console.log('🔄 Updating trainer info for course run UUID:', courseRunUuid);
    console.log('🔄 Course run ID (for reference):', courseRunId);
    console.log('👨‍🏫 Trainer name:', trainerName);
    console.log('📧 Trainer email:', trainerEmail);
    console.log('🆔 Trainer UUID:', trainerId || '(none)');

    // Check if the assigned_trainer_name column exists, if not add it
    const checkNameColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'course_run' 
      AND column_name = 'assigned_trainer_name'
    `;
    
    const nameColumnCheck = await pool.query(checkNameColumnQuery);
    
    if (nameColumnCheck.rows.length === 0) {
      console.log('📝 Adding assigned_trainer_name column to course_run table');
      await pool.query(`
        ALTER TABLE course_run 
        ADD COLUMN assigned_trainer_name TEXT
      `);
    }

    // Check if the assigned_trainer_email column exists, if not add it
    const checkEmailColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'course_run' 
      AND column_name = 'assigned_trainer_email'
    `;
    
    const emailColumnCheck = await pool.query(checkEmailColumnQuery);
    
    if (emailColumnCheck.rows.length === 0) {
      console.log('📝 Adding assigned_trainer_email column to course_run table');
      await pool.query(`
        ALTER TABLE course_run 
        ADD COLUMN assigned_trainer_email TEXT
      `);
    }

    // Check if the assigned_trainer_id column exists, if not add it
    const checkIdColumnQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'course_run'
      AND column_name = 'assigned_trainer_id'
    `;

    const idColumnCheck = await pool.query(checkIdColumnQuery);

    if (idColumnCheck.rows.length === 0) {
      console.log('📝 Adding assigned_trainer_id column to course_run table');
      await pool.query(`
        ALTER TABLE course_run
        ADD COLUMN assigned_trainer_id UUID
      `);
    }

    // Update the course_run with trainer name, email, and optionally the UUID
    let updateQuery: string;
    let updateParams: any[];

    if (trainerId) {
      updateQuery = `
        UPDATE course_run
        SET assigned_trainer_name = $1,
            assigned_trainer_email = $2,
            assigned_trainer_id = $3,
            updated_at = NOW()
        WHERE id = $4
      `;
      updateParams = [trainerName, trainerEmail || null, trainerId, courseRunUuid];
    } else {
      updateQuery = `
        UPDATE course_run
        SET assigned_trainer_name = $1,
            assigned_trainer_email = $2,
            updated_at = NOW()
        WHERE id = $3
      `;
      updateParams = [trainerName, trainerEmail || null, courseRunUuid];
    }

    console.log('🔍 Executing update query with params:', updateParams);
    const result = await pool.query(updateQuery, updateParams);

    console.log('📊 Query result - rows affected:', result.rowCount);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: `Course run not found with UUID: ${courseRunUuid}`
      });
    }

    console.log('✅ Successfully updated trainer info for course run');

    res.status(200).json({
      success: true,
      message: 'Trainer information updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating trainer information:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}