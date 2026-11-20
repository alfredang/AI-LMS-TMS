import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { NextApiRequest, NextApiResponse } from 'next';
import { CoursewareTemplateError, validateCoursewareTemplate } from '@lib/learner/coursewareEmailTemplate';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      const tp = await getTrainingPartnerIdentifiers();
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_cc TEXT');
      const result = await pool.query('SELECT courseware_attendance_email_subject, courseware_attendance_email_body, courseware_attendance_email_cc FROM training_provider WHERE uen=$1 ORDER BY created_at ASC NULLS LAST LIMIT 1', [tp.uen]);
      const row = result.rows[0] || {};

      return res.status(200).json({
        success: true,
        data: {
          coursewareAttendanceEmailSubject: row.courseware_attendance_email_subject || '',
          coursewareAttendanceEmailBody: row.courseware_attendance_email_body || '',
          coursewareAttendanceEmailCc: row.courseware_attendance_email_cc || '',
          previewCompany: { companyName: tp.name, companyShortName: tp.companyShortname,
            companyWebsite: tp.companyWebsite, companyEmail: tp.supportEmail || tp.companyEmail,
            companyPhone: tp.contactTel, siteUrl: tp.siteUrl },
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
      validateCoursewareTemplate(coursewareAttendanceEmailSubject, coursewareAttendanceEmailBody);
      if (coursewareAttendanceEmailCc != null && typeof coursewareAttendanceEmailCc !== 'string') {
        return res.status(400).json({ success: false, error: 'CC recipients must be a string.' });
      }
      const tp = await getTrainingPartnerIdentifiers();
      const provider = (await pool.query('SELECT id FROM training_provider WHERE uen=$1 ORDER BY created_at ASC NULLS LAST LIMIT 1', [tp.uen])).rows[0];
      if (!provider) return res.status(404).json({ success: false, error: 'Training provider not found.' });

      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS courseware_attendance_email_cc TEXT');
      await pool.query(
        'UPDATE training_provider SET courseware_attendance_email_subject = $1, courseware_attendance_email_body = $2, courseware_attendance_email_cc = $3 WHERE id=$4 AND uen=$5',
        [coursewareAttendanceEmailSubject, coursewareAttendanceEmailBody, coursewareAttendanceEmailCc || '', provider.id, tp.uen]
      );
      return res.status(200).json({ success: true, message: 'Courseware and attendance email template updated successfully' });
    } catch (error) {
      if (error instanceof CoursewareTemplateError) return res.status(400).json({ success: false, error: error.message });
      console.error('Error updating courseware and attendance email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update courseware and attendance email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
