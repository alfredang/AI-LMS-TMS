import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { resolveCourseIdByCode } from '../../../lib/courseCode';
import { resolveTscFields } from '../../../lib/courseCaslSkills';
import { ensureCaslSkillsColumn } from '../../../lib/course-casl-skills-ensure-column';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { title, courseCode, courseType, tscTitle, tscCode, caslSkills, trainingHours, assessmentHours } = req.body;

  if (!title || !courseCode) {
    return res.status(400).json({ success: false, error: 'title and courseCode are required' });
  }

  try {
    // A renewed course keeps its original course_code, so a code already in use as
    // another course's current or historic code slips past the course_code unique
    // constraint and would create a duplicate course record.
    const existingId = await resolveCourseIdByCode(courseCode.trim());
    if (existingId) {
      return res.status(409).json({
        success: false,
        error: `Course code ${courseCode.trim()} already belongs to an existing course.`,
      });
    }

    // CASL courses have no TSC: a tscTitle sent for one is carried into CASL Skills.
    const tsc = resolveTscFields({ courseType: courseType || 'Non-WSQ', tscTitle, tscCode, caslSkills });
    await ensureCaslSkillsColumn();

    const result = await pool.query(
      `INSERT INTO course (title, course_code, course_type, tsc_title, tsc_code, casl_skills, training_hours, assessment_hours, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $8, $6, $7, NOW(), NOW())
       ON CONFLICT (course_code) DO NOTHING
       RETURNING id`,
      [
        title.trim(),
        courseCode.trim(),
        courseType || 'Non-WSQ',
        tsc.tscTitle,
        tsc.tscCode,
        parseFloat(trainingHours) || 0,
        parseFloat(assessmentHours) || 0,
        tsc.caslSkills,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ success: false, error: `A course with code "${courseCode}" already exists.` });
    }

    return res.status(200).json({ success: true, message: 'Course added successfully', id: result.rows[0].id });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
