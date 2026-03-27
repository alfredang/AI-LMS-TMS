import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { emailService } from '../../../lib/services/emailService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { enrollmentId } = req.body;

    if (!enrollmentId) {
        return res.status(400).json({ success: false, message: 'enrollmentId is required' });
    }

    try {
        // Fetch enrollment with learner and course details
        const result = await pool.query(`
            SELECT
                e.id as enrollment_id,
                e.certificate,
                e.assessment_status,
                u.full_name as learner_name,
                u.email as learner_email,
                c.title as course_title,
                c.course_code,
                cr.start_date,
                cr.end_date
            FROM enrollment e
            JOIN app_user u ON e.user_id = u.id
            JOIN course c ON e.course_id = c.id
            JOIN course_run cr ON e.course_run_id = cr.id
            WHERE e.id = $1
        `, [enrollmentId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Enrollment not found' });
        }

        const enrollment = result.rows[0];

        if (!enrollment.certificate) {
            return res.status(400).json({
                success: false,
                message: `No certificate exists for ${enrollment.learner_name} in "${enrollment.course_title}". The learner must be marked as Competent and have a certificate generated first.`,
            });
        }

        // Send email with certificate link
        const emailResult = await emailService.sendEmail({
            to: enrollment.learner_email,
            subject: `Your Certificate of Completion - ${enrollment.course_title}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1a3a69;">Congratulations, ${enrollment.learner_name}!</h2>
                    <p>You have successfully completed the following course:</p>
                    <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a3a69;">
                        <p style="margin: 0; font-size: 18px; font-weight: bold; color: #1a3a69;">${enrollment.course_title}</p>
                        ${enrollment.course_code ? `<p style="margin: 4px 0 0; color: #666;">Course Code: ${enrollment.course_code}</p>` : ''}
                    </div>
                    <p>Your certificate is ready for download:</p>
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${enrollment.certificate}"
                           style="background-color: #1a3a69; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                            Download Certificate
                        </a>
                    </div>
                    <p style="color: #666; font-size: 13px;">If the button doesn't work, copy and paste this link into your browser:<br/>
                    <a href="${enrollment.certificate}" style="color: #1a3a69;">${enrollment.certificate}</a></p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                    <p style="color: #999; font-size: 12px;">Tertiary Infotech Pte Ltd<br/>Learning Management System</p>
                </div>
            `,
            text: `Congratulations ${enrollment.learner_name}!\n\nYou have completed: ${enrollment.course_title}\n\nDownload your certificate: ${enrollment.certificate}\n\nTertiary Infotech Pte Ltd`,
        });

        if (emailResult.success) {
            return res.status(200).json({
                success: true,
                message: `Certificate email sent to ${enrollment.learner_email}`,
                data: {
                    learnerName: enrollment.learner_name,
                    learnerEmail: enrollment.learner_email,
                    courseTitle: enrollment.course_title,
                    certificateUrl: enrollment.certificate,
                    messageId: emailResult.messageId,
                },
            });
        } else {
            return res.status(500).json({
                success: false,
                message: `Failed to send email: ${emailResult.error}`,
            });
        }
    } catch (error: any) {
        console.error('Error sending certificate email:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
}
