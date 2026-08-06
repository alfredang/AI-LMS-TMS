import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import pool from '../../../lib/db';



function extractFileId(url: string): string | null {
    // Handles: https://drive.google.com/file/d/{id}/view and webViewLink formats
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { learnerId } = req.query;

    try {
        if (learnerId && typeof learnerId === 'string') {
            // Fetch enrollments for a specific learner
            const query = `
                SELECT 
                    e.id as enrollment_id,
                    c.title as course_title,
                    c.course_code,
                    cr.start_date,
                    cr.end_date,
                    e.assessment_status,
                    e.certificate
                FROM enrollment e
                JOIN course c ON e.course_id = c.id
                JOIN course_run cr ON e.course_run_id = cr.id
                WHERE e.user_id = $1
                ORDER BY cr.start_date DESC
            `;
            const result = await pool.query(query, [learnerId]);
            const enrollments = result.rows;

            // Real-time Google Drive verification for enrollments with certificate URLs
            const drive = await getDriveClient();
            if (drive) {
                for (const enrollment of enrollments) {
                    if (enrollment.certificate) {
                        const fileId = extractFileId(enrollment.certificate);
                        if (fileId) {
                            try {
                                const fileRes = await drive.files.get({ fileId, fields: 'id, trashed' });
                                // File exists but is in trash — treat as deleted
                                if (fileRes.data.trashed) {
                                    await pool.query(`UPDATE enrollment SET certificate = NULL WHERE id = $1`, [enrollment.enrollment_id]);
                                    enrollment.certificate = null;
                                }
                            } catch (err: any) {
                                // 404 or any access error — file is gone
                                await pool.query(`UPDATE enrollment SET certificate = NULL WHERE id = $1`, [enrollment.enrollment_id]);
                                enrollment.certificate = null;
                            }
                        }
                    }
                }
            }

            return res.status(200).json(enrollments);
        } else {
            // Fetch all learners
            const query = `
                SELECT 
                    u.id,
                    u.full_name,
                    u.email
                FROM app_user u
                JOIN user_role_map ur ON u.id = ur.user_id
                WHERE ur.role = 'Learner'
                ORDER BY u.full_name ASC
            `;
            const result = await pool.query(query);
            return res.status(200).json(result.rows);
        }
    } catch (error: any) {
        console.error('Error fetching certificate data:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
