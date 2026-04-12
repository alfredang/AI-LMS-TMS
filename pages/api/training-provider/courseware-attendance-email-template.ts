import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_cc TEXT');
      const result = await pool.query('SELECT courseware_attendance_email_subject, courseware_attendance_email_body, courseware_attendance_email_cc FROM training_provider LIMIT 1');
      const row = result.rows[0] || {};
      let coursewareAttendanceEmailBody = row.courseware_attendance_email_body || '';

      // Replace variables with hardcoded values if needed
      coursewareAttendanceEmailBody = coursewareAttendanceEmailBody
        .replace(/\{COMPANY_PHONE\}/g, '6929 2168')
        .replace(/\{COMPANY_EMAIL\}/g, 'enquiry@tertiaryinfotech.com')
        .replace(/\{COMPANY_SHORT_NAME\}/g, 'Tertiary Courses SG')
        .replace(/\{COMPANY_NAME\}/g, 'Tertiary Infotech');

      return res.status(200).json({
        success: true,
        data: {
          coursewareAttendanceEmailSubject: row.courseware_attendance_email_subject || '',
          coursewareAttendanceEmailBody,
          coursewareAttendanceEmailCc: row.courseware_attendance_email_cc || '',
        }
      });
    } catch (error) {
      console.error('Error fetching courseware and attendance email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch courseware and attendance email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      let { coursewareAttendanceEmailSubject, coursewareAttendanceEmailBody, coursewareAttendanceEmailCc } = req.body;
      if (typeof coursewareAttendanceEmailSubject !== 'string' || typeof coursewareAttendanceEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'coursewareAttendanceEmailSubject and coursewareAttendanceEmailBody must be strings' });
      }

      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_cc TEXT');
      await pool.query(
        'UPDATE training_provider SET courseware_attendance_email_subject = $1, courseware_attendance_email_body = $2, courseware_attendance_email_cc = $3',
        [coursewareAttendanceEmailSubject, coursewareAttendanceEmailBody, coursewareAttendanceEmailCc || '']
      );
      return res.status(200).json({ success: true, message: 'Courseware and attendance email template updated successfully' });
    } catch (error) {
      console.error('Error updating courseware and attendance email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update courseware and attendance email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}