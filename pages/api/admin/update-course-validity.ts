import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { courseId, casScore, esScore, fundingValidity } = req.body;

  if (!courseId) {
    return res.status(400).json({ message: 'courseId is required' });
  }

  try {
    await pool.query(
      `UPDATE public.course
       SET cas_score = $1, es_score = $2, funding_validity = $3, updated_at = NOW()
       WHERE id = $4`,
      [
        casScore != null && casScore !== '' ? parseFloat(casScore) : null,
        esScore != null && esScore !== '' ? parseFloat(esScore) : null,
        fundingValidity || null,
        courseId,
      ]
    );

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Failed to update course validity:', error);
    return res.status(500).json({ message: error.message || 'Failed to update' });
  }
}
