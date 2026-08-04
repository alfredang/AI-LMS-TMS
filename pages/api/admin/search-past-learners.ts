import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { searchTerm } = req.body;

  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Search term is required' });
  }

  const term = searchTerm.trim();

  try {
    const result = await pool.query(`
      SELECT
        se.enrolment_id,
        se.trainee_name,
        se.trainee_nric,
        se.course_title,
        se.course_reference,
        se.course_run_id,
        se.enrolment_status,
        se.sponsorship_type,
        se.enrolment_date,
        se.completion_date,
        sg.grant_id,
        sg.status AS grant_status,
        sg.funding_scheme_description,
        sg.component_description,
        sg.estimated_grant_amount,
        sg.approved_grant_amount
      FROM ssg_enrolments se
      LEFT JOIN ssg_grants sg ON sg.enrollment_id = se.enrolment_id
      WHERE UPPER(se.trainee_nric) = UPPER($1)
      ORDER BY se.enrolment_date DESC NULLS LAST
    `, [term]);

    return res.status(200).json({
      success: true,
      data: { results: result.rows, total: result.rowCount }
    });
  } catch (error) {
    console.error('Error searching past learners:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
