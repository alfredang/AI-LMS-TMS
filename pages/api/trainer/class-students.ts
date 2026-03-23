import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { courseRunId } = req.query;

    if (!courseRunId || typeof courseRunId !== 'string') {
        return res.status(400).json({ message: 'Course run UUID is required' });
    }

    try {
        // First get the SSG course run ID to fetch synced enrolments
        const crRes = await pool.query(`SELECT course_run_id FROM course_run WHERE id = $1`, [courseRunId]);
        const ssgCourseRunId = crRes.rows[0]?.course_run_id;

        // Fetch manual enrolments
        const manualQuery = `
            SELECT 
                e.id as enrolment_id,
                u.id as user_id,
                u.full_name as student_name,
                u.email,
                e.assessment_status as competent_status,
                'manual' as source
            FROM enrollment e
            JOIN app_user u ON e.user_id = u.id
            WHERE e.course_run_id = $1
        `;
        const manualRes = await pool.query(manualQuery, [courseRunId]);
        const manualStudents = manualRes.rows;

        // Fetch SSG enrolments
        let ssgStudents: any[] = [];
        if (ssgCourseRunId) {
            const ssgQuery = `
                SELECT 
                    id as enrolment_id,
                    NULL as user_id,
                    trainee_name as student_name,
                    trainee_nric as email,
                    enrolment_status as competent_status,
                    'ssg' as source
                FROM ssg_enrolments
                WHERE course_run_id = $1
            `;
            const ssgRes = await pool.query(ssgQuery, [ssgCourseRunId]);
            ssgStudents = ssgRes.rows;
        }

        // Deduplicate using a Map, prioritizing manual enrolments
        const studentMap = new Map();

        // Add SSG first
        for (const s of ssgStudents) {
            if (!s.student_name) continue;
            const key = s.student_name.toLowerCase().trim();
            studentMap.set(key, s);
        }

        // Overwrite with Manual enrolments (because they have real user IDs and emails)
        for (const s of manualStudents) {
            if (!s.student_name) continue;
            const key = s.student_name.toLowerCase().trim();
            studentMap.set(key, s);
        }

        const uniqueStudents = Array.from(studentMap.values());

        // Standardize competent_status flags
        const finalStudents = uniqueStudents.map(s => ({
            ...s,
            is_competent: s.competent_status === 'Competent' || s.competent_status === 'Passed'
        })).sort((a, b) => a.student_name.localeCompare(b.student_name));

        return res.status(200).json(finalStudents);
    } catch (error: any) {
        console.error('Error fetching class students:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
