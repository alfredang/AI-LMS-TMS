import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // SQL query to get only courses for developer management (no course runs)
    const sqlQuery = `
      SELECT
          c.id AS course_id,
          c.title AS course_title,
          c.course_code,
          c.tsc_title,
          c.tsc_code,
          c.course_type,
          c.image_url AS course_image,
          c.training_hours,
          c.assessment_hours,
          c.mode_of_learning,
          c.schedule_id,
          c.course_fees_exclude_gst,
          c.tax_percent,
          c.course_fees_include_gst,
          c.after_normal_funding,
          c.after_mces_funding,
          c.is_utap_eligible,
          c.funding_validity,
          c.renewed_status,
          c.brochure_link,
          c.num_of_trainers,
          c.trainers_list
      FROM course c
      ORDER BY c.course_code DESC
    `;

    const result = await pool.query(sqlQuery);

    // Transform the data to match the frontend Course interface (without course run data)
    const courses = result.rows.map((row: any) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code || '', 
      courseDuration: (row.training_hours || 0) + (row.assessment_hours || 0),
      trainingHours: row.training_hours || 0,
      assessmentHours: row.assessment_hours || 0,
      courseType: row.course_type,
      tscTitle: row.tsc_title || '',
      tscCode: row.tsc_code || '',
      imageUrl: row.course_image || null,
      modeOfLearning: row.mode_of_learning ? [row.mode_of_learning] : ['Hybrid'],
      scheduleId: row.schedule_id || null,
      courseFeesExcludeGst: row.course_fees_exclude_gst || null,
      taxPercent: row.tax_percent || null,
      courseFeesIncludeGst: row.course_fees_include_gst || null,
      afterNormalFunding: row.after_normal_funding || null,
      afterMcesFunding: row.after_mces_funding || null,
      isUtapEligible: !!row.is_utap_eligible,
      fundingValidity: row.funding_validity || null,
      renewedStatus: row.renewed_status || null,
      brochureLink: row.brochure_link || null,
      numOfTrainers: row.num_of_trainers || 0,
      trainersList: row.trainers_list || null,
      courseRunId: null,
      startDate: null,
      endDate: null,
      classStatus: 'Published',
      topics: []
    }));

    console.log('📊 Developer courses endpoint - returning', courses.length, 'courses');
    
    return res.status(200).json(courses);

  } catch (error: any) {
    console.error('❌ Developer courses endpoint error:', error);
    return res.status(500).json({ 
      message: 'Failed to fetch courses', 
      error: error.message 
    });
  }
}
