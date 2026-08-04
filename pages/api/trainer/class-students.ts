import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { courseRunId } = req.query;

    if (!courseRunId || typeof courseRunId !== 'string') {
        return res.status(400).json({ message: 'Course run UUID is required' });
    }

    try {
        // Fetch all enrolments from the unified `enrollment` table
        const query = `
            SELECT 
                e.id as enrolment_id,
                e.user_id,
                COALESCE(u.full_name, e.nric, 'Unknown') as student_name,
                COALESCE(u.email, e.email) as email,
                e.nric,
                e.assessment_status as competent_status,
                e.certificate,
                CASE WHEN e.enrolment_id IS NOT NULL THEN 'ssg' ELSE 'manual' END as source
            FROM enrollment e
            LEFT JOIN app_user u ON e.user_id = u.id
            WHERE e.course_run_id = $1
        `;
        const resData = await pool.query(query, [courseRunId]);
        const students = resData.rows;

        // Standardize competent_status flags
        const finalStudents = students.map(s => ({
            ...s,
            is_competent: s.competent_status === 'Competent' || s.competent_status === 'Passed'
        })).sort((a, b) => a.student_name.localeCompare(b.student_name));

        return res.status(200).json(finalStudents);
    } catch (error: any) {
        console.error('Error fetching class students:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
