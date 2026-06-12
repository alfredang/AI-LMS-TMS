import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { ensureCourseAnnouncementTable } from '../../../lib/course-announcement-ensure-table';

export const config = {
    api: {
        bodyParser: false,
    },
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function firstString(value: unknown): string | undefined {
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        await ensureCourseAnnouncementTable();

        const form = new IncomingForm({
            keepExtensions: true,
            maxFileSize: 50 * 1024 * 1024,
            allowEmptyFiles: false,
        });

        const [fields, files] = await form.parse(req);

        const courseRunId = firstString(fields.courseRunId);
        const postedBy = firstString(fields.postedBy);
        const title = firstString(fields.title)?.trim() || null;
        const message = firstString(fields.message)?.trim() || null;
        const linkUrl = firstString(fields.linkUrl)?.trim() || null;

        if (!courseRunId || !postedBy) {
            return res.status(400).json({ success: false, error: 'Missing courseRunId or postedBy' });
        }

        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        const hasFile = !!file && !!file.originalFilename;

        if (!message && !linkUrl && !hasFile) {
            return res.status(400).json({ success: false, error: 'Announcement must have a message, link, or file' });
        }

        let dbCourseRunId: string = courseRunId;
        if (!UUID_RE.test(courseRunId)) {
            const runRes = await pool.query('SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1', [courseRunId]);
            if (runRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Course Run not found' });
            }
            dbCourseRunId = runRes.rows[0].id;
        }

        let fileName: string | null = null;
        let fileUrl: string | null = null;

        if (hasFile && file) {
            const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'announcements');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            const originalName = file.originalFilename || 'attachment';
            const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
            const storedName = `${Date.now()}_${cleanName}`;
            const destPath = path.join(uploadDir, storedName);

            fs.writeFileSync(destPath, fs.readFileSync(file.filepath));
            try { fs.unlinkSync(file.filepath); } catch {}

            fileName = originalName;
            fileUrl = `/uploads/announcements/${storedName}`;
        }

        const result = await pool.query(
            `INSERT INTO course_announcement (course_run_id, title, message, link_url, file_name, file_url, posted_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, course_run_id AS "courseRunId", title, message, link_url AS "linkUrl",
                       file_name AS "fileName", file_url AS "fileUrl", posted_by AS "postedBy", created_at AS "createdAt"`,
            [dbCourseRunId, title, message, linkUrl, fileName, fileUrl, postedBy]
        );

        return res.status(200).json({ success: true, announcement: result.rows[0] });
    } catch (error: any) {
        console.error('Error creating announcement:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}
