import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
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

interface RosterRow {
    enrolment_id: string;
    user_id: string | null;
    student_name: string;
    email: string | null;
    nric: string | null;
    competent_status: string | null;
    certificate: string | null;
    traqom_completed: boolean;
    source: 'manual' | 'ssg';
    is_competent: boolean;
    submitted_assessments: string[];
    /** Files the learner uploaded for this run (all methods). */
    submission_count: number;
    /** True when every uploaded file carries the assessor sign-off stamp. */
    assessor_signed: boolean;
}

export interface RosterLearner extends RosterRow {
    /** Every enrolment row this learner has in the run (primary first). */
    enrolment_ids: string[];
    /** Distinct emails across those rows (primary first). */
    emails: string[];
}

const normName = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
const normNric = (s: string | null) => (s ? s.trim().toUpperCase() : '');

/**
 * The same learner often has two enrolment rows in one run — a manual LMS
 * signup (personal email, no NRIC) and the SSG-synced one (work email, NRIC).
 * Collapse rows that share a name, as long as their NRICs don't disagree, into
 * one learner so the roster shows them once with both emails. The SSG row is
 * primary (it carries the NRIC and the certificate); grading/TRAQOM actions
 * use `enrolment_ids` to update every row.
 */
function mergeDuplicateLearners(rows: RosterRow[]): RosterLearner[] {
    const groups = new Map<string, RosterRow[]>();
    for (const row of rows) {
        const key = row.user_id ? normName(row.student_name) : `enrolment:${row.enrolment_id}`;
        const nric = normNric(row.nric);
        const group = groups.get(key);
        const conflict = group?.some(g => nric && normNric(g.nric) && normNric(g.nric) !== nric);
        if (group && !conflict) group.push(row);
        else groups.set(conflict ? `${key}|${nric}` : key, [row]);
    }

    return Array.from(groups.values()).map(group => {
        const ordered = [...group].sort((a, b) => {
            if (a.source !== b.source) return a.source === 'ssg' ? -1 : 1;
            if (!!a.certificate !== !!b.certificate) return a.certificate ? -1 : 1;
            return 0;
        });
        const primary = ordered[0];
        const uniq = (vals: (string | null)[]) => Array.from(new Set(vals.filter((v): v is string => !!v)));
        const isCompetent = ordered.some(r => r.is_competent);
        return {
            ...primary,
            nric: primary.nric ?? ordered.find(r => r.nric)?.nric ?? null,
            email: primary.email || ordered.find(r => r.email)?.email || null,
            emails: uniq(ordered.map(r => r.email)),
            enrolment_ids: ordered.map(r => r.enrolment_id),
            source: ordered.some(r => r.source === 'ssg') ? 'ssg' : 'manual',
            certificate: primary.certificate ?? ordered.find(r => r.certificate)?.certificate ?? null,
            is_competent: isCompetent,
            competent_status: isCompetent
                ? (ordered.find(r => r.is_competent)?.competent_status ?? primary.competent_status)
                : primary.competent_status,
            traqom_completed: ordered.some(r => r.traqom_completed),
            submitted_assessments: METHOD_ORDER.filter(m => ordered.some(r => r.submitted_assessments.includes(m))),
            submission_count: Math.max(...ordered.map(r => r.submission_count)),
            assessor_signed: ordered.some(r => r.assessor_signed),
        };
    });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { courseRunId, withMeta } = req.query;

    if (!courseRunId || typeof courseRunId !== 'string') {
        return res.status(400).json({ message: 'Course run UUID is required' });
    }

    // Trainers only see the roster of classes they are assigned to.
    if (!(await requireCourseRunTrainer((req as AuthedApiRequest).authUser!, res, courseRunId))) return;

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
                COALESCE(e.traqom_completed, false) as traqom_completed,
                CASE WHEN e.enrolment_id IS NOT NULL THEN 'ssg' ELSE 'manual' END as source
            FROM enrollment e
            LEFT JOIN app_user u ON e.user_id = u.id
            WHERE e.course_run_id = $1
        `;
        const [resData, subsData, methodsData] = await Promise.all([
            pool.query(query, [courseRunId]),
            pool.query(
                `SELECT user_id,
                        array_agg(DISTINCT assessment_type) as types,
                        COUNT(*)::int AS submission_count,
                        bool_and(assessor_signed_at IS NOT NULL) AS assessor_signed
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

        // Per-user set of submitted assessment methods (normalized to canonical keys),
        // plus the file count and whether the assessor stamp is on every file.
        const submittedByUser: Record<string, string[]> = {};
        const submissionMetaByUser: Record<string, { count: number; signed: boolean }> = {};
        subsData.rows.forEach(row => {
            const normalized = new Set<string>(
                (row.types || []).map((t: string) => LEGACY_TYPE_MAP[t] || t)
            );
            submittedByUser[row.user_id] = METHOD_ORDER.filter(m => normalized.has(m));
            submissionMetaByUser[row.user_id] = { count: row.submission_count || 0, signed: row.assessor_signed === true };
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
        const normalized = students.map(s => ({
            ...s,
            is_competent: s.competent_status === 'Competent' || s.competent_status === 'Passed',
            traqom_completed: s.traqom_completed === true,
            submitted_assessments: (s.user_id && submittedByUser[s.user_id]) || [],
            submission_count: (s.user_id && submissionMetaByUser[s.user_id]?.count) || 0,
            assessor_signed: !!(s.user_id && submissionMetaByUser[s.user_id]?.signed),
        }));

        const finalStudents = mergeDuplicateLearners(normalized)
            .sort((a, b) => a.student_name.localeCompare(b.student_name));

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
