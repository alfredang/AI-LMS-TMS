import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

// Training-Provider-level "Briefing on Assessment" template text.
// Free text (one point per line) shown to learners & trainers in the
// Assessment area of every course detail page.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let briefingOnAssessment: string | null = null;
      try {
        const result = await pool.query('SELECT briefing_on_assessment FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          briefingOnAssessment = result.rows[0].briefing_on_assessment;
        }
      } catch (e) {
        console.log('briefing_on_assessment column does not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { briefingOnAssessment }
      });
    } catch (error) {
      console.error('Error fetching briefing on assessment:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch briefing on assessment' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { briefingOnAssessment } = req.body;

      if (typeof briefingOnAssessment !== 'string') {
        return res.status(400).json({ success: false, error: 'briefingOnAssessment must be a string' });
      }

      try {
        await pool.query('UPDATE training_provider SET briefing_on_assessment = $1', [briefingOnAssessment]);
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS briefing_on_assessment TEXT');
        await pool.query('UPDATE training_provider SET briefing_on_assessment = $1', [briefingOnAssessment]);
      }

      return res.status(200).json({ success: true, message: 'Briefing on assessment updated successfully' });
    } catch (error) {
      console.error('Error updating briefing on assessment:', error);
      return res.status(500).json({ success: false, error: 'Failed to update briefing on assessment' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
