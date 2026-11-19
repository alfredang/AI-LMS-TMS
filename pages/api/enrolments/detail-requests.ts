import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { requireCourseRunTrainer } from '../../../lib/auth/courseRunAccess';
import { pushEnrolmentToSsgForLearner } from '../../../lib/ssg/pushEnrolmentToSsgForLearner';
import {
  ensureEnrolmentDetailRequestTable, getEnrolmentRunContext, mapRequestRow, resolveLocalEnrolment, REQUEST_COLUMNS,
  missingEmployerDetails, cleanEmployerDetails, employerDetailErrors,
} from '../../../lib/learner/enrolmentDetailRequest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[A-Z0-9][A-Z0-9-]{5,39}$/i;

/**
 * Enrolment details learners submitted through the class's enrolment QR code
 * (E-Attendance page → Enrolment Requests).
 * Admin / training provider / developer: any class. Trainer: only classes they are assigned to.
 *
 * GET  ?courseRunUuid=                         → { data: request[], qrAvailable }
 * POST { id, action: 'enrol' }                  → enrol the learner on TPGateway (REAL SSG) and store the ref
 * POST { id, action: 'set_ref', enrolmentRef }  → record a ref obtained elsewhere (e.g. the TPGateway portal)
 * POST { id, action: 'set_employer', employerName, employerUen, employerContactName,
 *        employerContactEmail, employerContactNumber }  → fill in / correct the company details of a
 *                                                 company-sponsored request (the form leaves the UEN
 *                                                 and contact optional; TPGateway needs them)
 * POST { courseRunUuid, action: 'set_employer_all', ...company details }  → one company for the whole class
 *                                                 (corporate run): writes the details given (blank ones are
 *                                                 left as they are) to every pending company-sponsored request
 * POST { id, action: 'dismiss' | 'reopen' }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthedApiRequest).authUser!;
  try {
    await ensureEnrolmentDetailRequestTable();

    if (req.method === 'GET') {
      const courseRunUuid = String(req.query.courseRunUuid || '').trim();
      if (!UUID_RE.test(courseRunUuid)) return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
      if (!(await requireCourseRunTrainer(user, res, courseRunUuid))) return;

      // A learner enrolled by another route since submitting (SSG sync, Assign Student, the portal):
      // mark their request done with the ref now on their local enrolment or in the imported
      // SSG enrolments for the run.
      await pool.query(
        `UPDATE enrolment_detail_request r
            SET status = 'enrolled', enrolment_ref = x.ref, last_error = NULL,
                processed_at = COALESCE(r.processed_at, NOW()), updated_at = NOW()
           FROM (
             SELECT r2.id, COALESCE(
               (SELECT NULLIF(TRIM(e.enrolment_id), '') FROM enrollment e WHERE e.id = r2.enrollment_uuid),
               (SELECT se.enrolment_id
                  FROM ssg_enrolments se JOIN course_run cr ON cr.course_run_id = se.course_run_id
                 WHERE cr.id = r2.course_run_uuid AND UPPER(se.trainee_nric) = r2.nric
                   AND NULLIF(TRIM(se.enrolment_id), '') IS NOT NULL
                   AND LOWER(COALESCE(se.enrolment_status, '')) NOT IN ('cancelled', 'withdrawn', 'rejected')
                 ORDER BY se.enrolment_date DESC NULLS LAST LIMIT 1)
             ) AS ref
               FROM enrolment_detail_request r2
              WHERE r2.course_run_uuid = $1 AND r2.status IN ('submitted', 'failed')
           ) x
          WHERE x.id = r.id AND x.ref IS NOT NULL`,
        [courseRunUuid]
      );

      const rows = (await pool.query(
        `SELECT ${REQUEST_COLUMNS} FROM enrolment_detail_request
          WHERE course_run_uuid = $1
          ORDER BY CASE status WHEN 'submitted' THEN 0 WHEN 'failed' THEN 1 WHEN 'enrolled' THEN 2 ELSE 3 END, submitted_at`,
        [courseRunUuid]
      )).rows;
      const run = await getEnrolmentRunContext(courseRunUuid);
      // qrAvailable: the public QR form accepts submissions for this class (WSQ/SSG class, live).
      return res.status(200).json({ success: true, data: rows.map(mapRequestRow), qrAvailable: !!run && run.open && run.ssgEnrolable });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { id, action, enrolmentRef } = (req.body || {}) as { id?: string; action?: string; enrolmentRef?: string };

    if (action === 'set_employer_all') {
      const courseRunUuid = String(req.body?.courseRunUuid || '').trim();
      if (!UUID_RE.test(courseRunUuid)) return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
      if (!(await requireCourseRunTrainer(user, res, courseRunUuid))) return;
      const e = cleanEmployerDetails(req.body);
      const given = Object.values(e).some(Boolean);
      // Validate only what was typed: a blank field keeps each learner's own value.
      const fieldErrors = employerDetailErrors({ ...e, employerName: e.employerName || 'unchanged' }, { requireAll: false });
      if (!given || Object.keys(fieldErrors).length) {
        return res.status(400).json({ success: false, error: given ? Object.values(fieldErrors)[0] : 'Enter at least one company detail', fieldErrors });
      }
      const updated = await pool.query(
        `UPDATE enrolment_detail_request
            SET employer_name = COALESCE(NULLIF($2, ''), employer_name),
                employer_uen = COALESCE(NULLIF($3, ''), employer_uen),
                employer_contact_name = COALESCE(NULLIF($4, ''), employer_contact_name),
                employer_contact_email = COALESCE(NULLIF($5, ''), employer_contact_email),
                employer_contact_number = COALESCE(NULLIF($6, ''), employer_contact_number),
                status = 'submitted', last_error = NULL, updated_at = NOW()
          WHERE course_run_uuid = $1 AND sponsorship_type = 'Employer' AND status IN ('submitted', 'failed')`,
        [courseRunUuid, e.employerName, e.employerUen, e.employerContactName, e.employerContactEmail, e.employerContactNumber]
      );
      const rows = (await pool.query(
        `SELECT ${REQUEST_COLUMNS} FROM enrolment_detail_request
          WHERE course_run_uuid = $1
          ORDER BY CASE status WHEN 'submitted' THEN 0 WHEN 'failed' THEN 1 WHEN 'enrolled' THEN 2 ELSE 3 END, submitted_at`,
        [courseRunUuid]
      )).rows;
      return res.status(200).json({
        success: true, updated: updated.rowCount,
        message: `Company details set on ${updated.rowCount} company-sponsored request${updated.rowCount === 1 ? '' : 's'}`,
        data: rows.map(mapRequestRow),
      });
    }
    if (!id || !UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'id is required' });

    const reqRow = (await pool.query(
      `SELECT ${REQUEST_COLUMNS} FROM enrolment_detail_request WHERE id = $1`, [id]
    )).rows[0];
    if (!reqRow) return res.status(404).json({ success: false, error: 'Request not found' });
    if (!(await requireCourseRunTrainer(user, res, reqRow.course_run_uuid))) return;

    const finish = async (status: string, ref: string | null, error: string | null) => {
      const updated = (await pool.query(
        `UPDATE enrolment_detail_request
            SET status = $2, enrolment_ref = COALESCE($3, enrolment_ref), last_error = $4,
                processed_at = NOW(), processed_by = $5, updated_at = NOW()
          WHERE id = $1
        RETURNING ${REQUEST_COLUMNS}`,
        [id, status, ref, error, user.isService ? null : user.id]
      )).rows[0];
      return mapRequestRow(updated);
    };

    switch (action) {
      case 'enrol': {
        if (reqRow.status === 'enrolled') {
          return res.status(409).json({ success: false, error: `Already enrolled (${reqRow.enrolment_ref || 'ref on file'})` });
        }
        // Company-sponsored: TPGateway needs the UEN and a contact, which the learner may have left blank.
        const missing = missingEmployerDetails(reqRow);
        if (missing.length) {
          const message = `Add the ${missing.join(', ')} (Edit company) before enrolling on TPGateway, or enrol on the TPGateway portal and use Enter Ref.`;
          const request = await finish('failed', null, message);
          return res.status(200).json({ success: false, status: 'error', message, request });
        }
        // The request came from the public QR form: find (or create) the learner's account and
        // local enrolment on the class first, so the TPGateway ref has a record to live on.
        const local = await resolveLocalEnrolment(reqRow, { create: true });
        if (!local.ok) {
          const request = await finish('failed', null, local.error);
          return res.status(200).json({ success: false, status: 'error', message: local.error, request });
        }
        const employer = reqRow.sponsorship_type === 'Employer';
        const result = await pushEnrolmentToSsgForLearner(reqRow.course_run_uuid, { userId: local.userId }, {
          traineeName: reqRow.trainee_name,
          nric: reqRow.nric,
          dateOfBirth: reqRow.date_of_birth,
          contactNumber: reqRow.contact_number,
          email: reqRow.email,
          sponsorshipType: reqRow.sponsorship_type,
          employer: employer ? {
            uen: reqRow.employer_uen || '',
            contactName: reqRow.employer_contact_name || '',
            contactEmail: reqRow.employer_contact_email || '',
            contactNumber: reqRow.employer_contact_number || '',
          } : undefined,
        });
        const ok = result.status === 'synced' || result.status === 'already_enrolled';
        const request = await finish(ok ? 'enrolled' : 'failed', ok ? result.enrolmentRef || null : null, ok ? null : result.message);
        return res.status(200).json({ success: ok, status: result.status, message: result.message, request });
      }

      case 'set_ref': {
        const ref = String(enrolmentRef || '').trim().toUpperCase();
        if (!REF_RE.test(ref)) return res.status(400).json({ success: false, error: 'Enter a valid enrolment reference, e.g. ENR-2411-123456' });
        // Store the ref on the learner's local enrolment when they have one on the class
        // (no account is created here; the ref is always kept on the request itself).
        const local = await resolveLocalEnrolment(reqRow, { create: false });
        if (local.ok) {
          await pool.query(
            `UPDATE enrollment
                SET enrolment_id = $1, nric = COALESCE(NULLIF(nric, ''), $3),
                    course_sponsorship = $4::course_sponsorship, updated_at = NOW()
              WHERE id = $2`,
            [ref, local.enrollmentUuid, reqRow.nric, reqRow.sponsorship_type]
          );
        }
        const request = await finish('enrolled', ref, null);
        return res.status(200).json({ success: true, message: `Enrolment ${ref} recorded`, request });
      }

      case 'set_employer': {
        if (reqRow.status === 'enrolled') return res.status(409).json({ success: false, error: 'An enrolled request cannot be changed' });
        if (reqRow.sponsorship_type !== 'Employer') return res.status(400).json({ success: false, error: 'This request is self sponsored' });
        const e = cleanEmployerDetails(req.body);
        const fieldErrors = employerDetailErrors(e, { requireAll: false });
        if (Object.keys(fieldErrors).length) {
          return res.status(400).json({ success: false, error: Object.values(fieldErrors)[0], fieldErrors });
        }
        const updated = (await pool.query(
          `UPDATE enrolment_detail_request
              SET employer_name = $2, employer_uen = NULLIF($3, ''), employer_contact_name = NULLIF($4, ''),
                  employer_contact_email = NULLIF($5, ''), employer_contact_number = NULLIF($6, ''),
                  status = CASE WHEN status = 'failed' THEN 'submitted' ELSE status END, last_error = NULL, updated_at = NOW()
            WHERE id = $1
          RETURNING ${REQUEST_COLUMNS}`,
          [id, e.employerName, e.employerUen, e.employerContactName, e.employerContactEmail, e.employerContactNumber]
        )).rows[0];
        return res.status(200).json({ success: true, message: 'Company details saved', request: mapRequestRow(updated) });
      }

      case 'dismiss':
      case 'reopen': {
        if (reqRow.status === 'enrolled') return res.status(409).json({ success: false, error: 'An enrolled request cannot be changed' });
        const request = await finish(action === 'dismiss' ? 'dismissed' : 'submitted', null, null);
        return res.status(200).json({ success: true, request });
      }

      default:
        return res.status(400).json({ success: false, error: 'Unknown action' });
    }
  } catch (err: any) {
    console.error('[enrolment detail-requests] failed:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
