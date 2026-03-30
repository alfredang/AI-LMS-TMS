import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import fs from 'fs';
import path from 'path';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        const { courseRunId } = req.query;

        if (!courseRunId) {
            return res.status(400).json({ success: false, message: 'Missing courseRunId' });
        }

        let dbCourseRunId = courseRunId;
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(courseRunId as string)) {
            const runRes = await pool.query('SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1', [courseRunId]);
            if (runRes.rows.length === 0) {
                return res.status(200).json({ success: true, documents: [] });
            }
            dbCourseRunId = runRes.rows[0].id;
        }

        try {
            const result = await pool.query(
                `SELECT id, course_run_id as "courseRunId", file_name as "fileName", file_url as "fileUrl", uploaded_by as "uploadedBy", created_at as "createdAt"
                 FROM course_additional_document
                 WHERE course_run_id = $1
                 ORDER BY created_at DESC`,
                [dbCourseRunId]
            );
            return res.status(200).json({ success: true, documents: result.rows });
        } catch (error: any) {
            console.error('Error fetching additional documents:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    } else if (req.method === 'DELETE') {
        const { id } = req.query;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Missing document id' });
        }

        try {
            // Get the file URL to delete from disk
            const selectRes = await pool.query(`SELECT file_url FROM course_additional_document WHERE id = $1`, [id]);
            if (selectRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Document not found' });
            }

            const fileUrl = selectRes.rows[0].file_url;
            await pool.query(`DELETE FROM course_additional_document WHERE id = $1`, [id]);

            // Attempt to delete physical file
            if (fileUrl) {
                try {
                    const filePath = path.join(process.cwd(), 'public', fileUrl);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log('🗑️ Deleted additional document:', filePath);
                    }
                } catch (fsError) {
                    console.error('Failed to delete physical file:', fsError);
                }
            }

            return res.status(200).json({ success: true, message: 'Document deleted successfully' });
        } catch (error: any) {
            console.error('Error deleting additional document:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    } else {
        res.setHeader('Allow', ['GET', 'DELETE']);
        return res.status(405).json({ success: false, message: `Method ${req.method} Not Allowed` });
    }
}
