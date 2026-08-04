import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import fs from 'fs';
import path from 'path';
import { ensureCourseAnnouncementTable } from '../../../lib/course-announcement-ensure-table';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
    await ensureCourseAnnouncementTable();

    if (req.method === 'GET') {
        const { courseRunId } = req.query;

        if (!courseRunId || typeof courseRunId !== 'string') {
            return res.status(400).json({ success: false, message: 'Missing courseRunId' });
        }

        let dbCourseRunId = courseRunId;
        if (!UUID_RE.test(courseRunId)) {
            const runRes = await pool.query('SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1', [courseRunId]);
            if (runRes.rows.length === 0) {
                return res.status(200).json({ success: true, announcements: [] });
            }
            dbCourseRunId = runRes.rows[0].id;
        }

        try {
            const result = await pool.query(
                `SELECT id, course_run_id AS "courseRunId", title, message, link_url AS "linkUrl",
                        file_name AS "fileName", file_url AS "fileUrl", posted_by AS "postedBy",
                        created_at AS "createdAt"
                 FROM course_announcement
                 WHERE course_run_id = $1
                 ORDER BY created_at DESC`,
                [dbCourseRunId]
            );
            return res.status(200).json({ success: true, announcements: result.rows });
        } catch (error: any) {
            console.error('Error fetching announcements:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    if (req.method === 'DELETE') {
        const { id } = req.query;

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ success: false, message: 'Missing announcement id' });
        }

        try {
            const selectRes = await pool.query(`SELECT file_url FROM course_announcement WHERE id = $1`, [id]);
            if (selectRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Announcement not found' });
            }

            const fileUrl: string | null = selectRes.rows[0].file_url;
            await pool.query(`DELETE FROM course_announcement WHERE id = $1`, [id]);

            if (fileUrl) {
                try {
                    const filePath = path.join(process.cwd(), 'public', fileUrl);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (fsError) {
                    console.error('Failed to delete announcement file:', fsError);
                }
            }

            return res.status(200).json({ success: true, message: 'Announcement deleted' });
        } catch (error: any) {
            console.error('Error deleting announcement:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ success: false, message: `Method ${req.method} Not Allowed` });
}

export default withAuth(handler);
