import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const {
    courseRunId,
    courseStartDate,
    courseEndDate,
    openingRegistrationDate,
    closingRegistrationDate,
    block,
    street,
    building,
    floor,
    unit,
    postalCode,
    room,
    wheelChairAccess,
    courseVacancyCode,
    courseVacancyDescription,
    courseAdminEmail,
    classStatus,
    classType,
  } = req.body ?? {};

  if (!courseRunId || String(courseRunId).trim() === '') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE course_run
       SET start_date                = COALESCE($1, start_date),
           end_date                  = COALESCE($2, end_date),
           registration_opening_date = $3,
           registration_closing_date = $4,
           venue_block               = $5,
           venue_street              = $6,
           venue_building            = $7,
           venue_floor               = $8,
           venue_unit                = $9,
           venue_postal_code         = $10,
           venue_room                = $11,
           venue_wheelchair_access   = $12,
           course_vacancy_code       = $13,
           course_vacancy_description = $14,
           course_admin_email        = $15,
           class_status              = COALESCE($16, class_status),
           class_type                = COALESCE($17, class_type),
           updated_at                = NOW()
       WHERE course_run_id = $18`,
      [
        courseStartDate || null,
        courseEndDate || null,
        openingRegistrationDate || null,
        closingRegistrationDate || null,
        block || null,
        street || null,
        building || null,
        floor || null,
        unit || null,
        postalCode || null,
        room || null,
        wheelChairAccess != null ? wheelChairAccess === true || wheelChairAccess === 'true' : null,
        courseVacancyCode || null,
        courseVacancyDescription || null,
        courseAdminEmail || null,
        classStatus || null,
        classType || null,
        String(courseRunId).trim(),
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    return res.status(200).json({ success: true, message: 'Course run updated locally' });
  } catch (error) {
    console.error('Error updating course run locally:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update course run',
    });
  }
}
