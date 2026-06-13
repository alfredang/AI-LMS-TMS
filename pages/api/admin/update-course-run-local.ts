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
    confirmCancellation,
  } = req.body ?? {};

  if (!courseRunId || String(courseRunId).trim() === '') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    // Guard: never silently cancel a live class. If this edit sets status to
    // 'Cancelled' while the run is currently 'Confirmed' or has enrollments,
    // require an explicit confirmCancellation flag. Prevents accidental
    // cancellation of confirmed/enrolled classes via the Edit Class form.
    if (classStatus === 'Cancelled' && confirmCancellation !== true) {
      const current = await pool.query(
        `SELECT cr.class_status,
                (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id) AS enr_count
           FROM course_run cr
          WHERE cr.course_run_id = $1
          LIMIT 1`,
        [String(courseRunId).trim()]
      );
      const row = current.rows[0];
      if (row) {
        const isConfirmed = row.class_status === 'Confirmed';
        const enrCount = parseInt(row.enr_count, 10) || 0;
        if (isConfirmed || enrCount > 0) {
          const reasons: string[] = [];
          if (isConfirmed) reasons.push('it is Confirmed');
          if (enrCount > 0) reasons.push(`it has ${enrCount} enrolled learner(s)`);
          return res.status(409).json({
            success: false,
            error: `Cannot cancel this class because ${reasons.join(' and ')}. Re-submit with confirmCancellation: true to override.`,
            requiresConfirmation: true,
            currentStatus: row.class_status,
            enrollmentCount: enrCount,
          });
        }
      }
    }

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
