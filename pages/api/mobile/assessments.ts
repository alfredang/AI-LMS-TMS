import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { canTrain, classDetail, isEnrolled, METHOD_KEYS, UUID_RE } from '../../../lib/mobile/app';

// Assessments for the apps.
//  POST   {action:'submit', runId, type, fileName, fileURL, folderId?}  learner: record an uploaded file
//  DELETE {submissionId}                                                learner: remove their own, unsigned file
//  POST   {action:'grade', enrolmentIds, isCompetent}                   trainer: Competent / Not Yet Competent
// The file itself is uploaded to the academy's Google Drive first (/api/upload/google-drive);
// only Drive links are accepted here, and only for a published assessment of the learner's own class.
const DRIVE_RE = /^https:\/\/(drive|docs)\.google\.com\/[^\s]+$/i;

export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (user.isService) return res.status(403).end();
  const body = req.body || {};
  try {
    if (req.method === 'DELETE') {
      if (!UUID_RE.test(String(body.submissionId || ''))) return res.status(400).json({ error: 'Submission not found' });
      const r = await pool.query(
        `DELETE FROM link_assessment_submission WHERE id=$1 AND user_id=$2 AND assessor_signed_at IS NULL`, [body.submissionId, user.id]);
      return r.rowCount ? res.json({ success: true }) : res.status(404).json({ error: 'This file cannot be removed. It may already be marked by your assessor.' });
    }
    if (req.method !== 'POST') return res.status(405).end();

    if (body.action === 'submit') {
      const runId = String(body.runId || ''), type = String(body.type || '');
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 250) : '';
      const fileURL = typeof body.fileURL === 'string' ? body.fileURL.trim() : '';
      const folderId = typeof body.folderId === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(body.folderId) ? body.folderId : null;
      if (!user.roles.has('learner') || !UUID_RE.test(runId) || !(await isEnrolled(user.id, runId))) return res.status(404).json({ error: 'Class not found' });
      if (!METHOD_KEYS.includes(type) || !fileName || !DRIVE_RE.test(fileURL)) return res.status(400).json({ error: 'This submission is not valid. Please upload the file again.' });
      const detail: any = await classDetail(user.id, 'learner', runId);
      if (!detail?.assessments?.some((a: any) => a.type === type)) return res.status(403).json({ error: 'This assessment is not open for submission yet.' });
      const r = await pool.query(
        `INSERT INTO link_assessment_submission (user_id, course_run_id, assessment_type, file_name, file_url, drive_folder_id, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING id::text`, [user.id, runId, type, fileName, fileURL, folderId]);
      return res.status(201).json({ success: true, id: r.rows[0].id });
    }

    if (body.action === 'grade') {
      const ids: string[] = Array.isArray(body.enrolmentIds) ? body.enrolmentIds.filter((x: unknown) => typeof x === 'string' && UUID_RE.test(x)).slice(0, 20) : [];
      if (!user.roles.has('trainer') || !ids.length || typeof body.isCompetent !== 'boolean') return res.status(400).json({ error: 'Choose a learner and a result.' });
      const rows = (await pool.query(`SELECT course_run_id::text AS run, user_id::text AS uid FROM enrollment WHERE id::text = ANY($1)`, [ids])).rows;
      const runs = Array.from(new Set(rows.map((r: any) => r.run)));
      // One class at a time, never the trainer's own enrolment, and only a class they teach.
      if (rows.length !== ids.length || runs.length !== 1 || rows.some((r: any) => r.uid === user.id) || !(await canTrain(user.id, runs[0]))) {
        return res.status(404).json({ error: 'Learner not found on your class' });
      }
      const status = body.isCompetent ? 'Competent' : 'Not Yet Competent';
      await pool.query(`UPDATE enrollment SET assessment_status=$1, updated_at=now() WHERE id::text = ANY($2)`, [status, ids]);
      return res.json({ success: true, status });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch {
    return res.status(500).json({ error: 'The assessment could not be updated. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
