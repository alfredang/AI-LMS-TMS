import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Canonical assessment method keys (matches course.assessment_methods jsonb and
// link_assessment_submission.assessment_type). Legacy submission types map onto them.
const METHOD_ORDER = ['writtenAssessment', 'practicalExam', 'caseStudy', 'rolePlay', 'oralQuestioning', 'project', 'assignment'];
const LEGACY_TYPE_MAP: Record<string, string> = {
    written: 'writtenAssessment',
    practical: 'practicalExam',
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { courseRunId, withMeta } = req.query;

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
        const [resData, subsData, methodsData] = await Promise.all([
            pool.query(query, [courseRunId]),
            pool.query(
                `SELECT user_id, array_agg(DISTINCT assessment_type) as types
                 FROM link_assessment_submission
                 WHERE course_run_id = $1
                 GROUP BY user_id`,
                [courseRunId]
            ),
            pool.query(
                `SELECT c.assessment_methods, c.written_assessment_link, c.practical_performance_assessment_link
                 FROM course_run cr
                 JOIN course c ON c.id = cr.course_id
                 WHERE cr.id = $1`,
                [courseRunId]
            ),
        ]);
        const students = resData.rows;

        // Per-user set of submitted assessment methods (normalized to canonical keys)
        const submittedByUser: Record<string, string[]> = {};
        subsData.rows.forEach(row => {
            const normalized = new Set<string>(
                (row.types || []).map((t: string) => LEGACY_TYPE_MAP[t] || t)
            );
            submittedByUser[row.user_id] = METHOD_ORDER.filter(m => normalized.has(m));
        });

        // Which assessment methods this course uses (drives the columns shown in the UI)
        const courseRow = methodsData.rows[0];
        let assessmentMethods: string[] = [];
        if (courseRow?.assessment_methods) {
            assessmentMethods = METHOD_ORDER.filter(m => courseRow.assessment_methods[m]?.enabled);
        }
        if (assessmentMethods.length === 0 && courseRow) {
            if (courseRow.written_assessment_link) assessmentMethods.push('writtenAssessment');
            if (courseRow.practical_performance_assessment_link) assessmentMethods.push('practicalExam');
        }
        if (assessmentMethods.length === 0) {
            assessmentMethods = ['writtenAssessment', 'practicalExam'];
        }

        // Standardize competent_status flags
        const finalStudents = students.map(s => ({
            ...s,
            is_competent: s.competent_status === 'Competent' || s.competent_status === 'Passed',
            submitted_assessments: (s.user_id && submittedByUser[s.user_id]) || []
        })).sort((a, b) => a.student_name.localeCompare(b.student_name));

        if (withMeta === '1') {
            return res.status(200).json({ students: finalStudents, assessment_methods: assessmentMethods });
        }
        return res.status(200).json(finalStudents);
    } catch (error: any) {
        console.error('Error fetching class students:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
