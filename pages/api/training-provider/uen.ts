import { withAuth } from '@lib/auth/withAuth';
/**
 * Next.js API route to fetch UEN from training_provider table
 * GET /api/training-provider/uen - Get UEN from database
 */

import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Query to get UEN from training_provider table
    const query = `
      SELECT uen 
      FROM training_provider 
      LIMIT 1
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No training provider found',
        message: 'No UEN found in training_provider table'
      });
    }

    const uen = result.rows[0].uen;

    if (!uen) {
      return res.status(404).json({ 
        error: 'UEN is null',
        message: 'UEN value is null in the database'
      });
    }

    res.status(200).json({ uen });

  } catch (error) {
    console.error('Database error fetching UEN:', error);
    res.status(500).json({ 
      error: 'Database error',
      message: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
