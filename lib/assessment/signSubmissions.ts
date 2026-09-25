/**
 * Apply / remove the trainer's assessor sign-off on a learner's assessment
 * submissions (link_assessment_submission rows) for one class.
 *
 * Signing: each unsigned PDF/DOCX submission is downloaded from Google Drive,
 * stamped (see assessorStamp.ts), uploaded next to the original as
 * "<name> (signed).<ext>", and the row's file_url/file_name are switched to the
 * stamped copy with the original kept in original_file_url/original_file_name.
 *
 * Unsigning: the row is pointed back at the original and the stamped copy is
 * removed from Drive (best effort).
 *
 * Only the LMS app touches Drive and the DB — callers are the trainer UI via
 * /api/trainer/sign-assessments.
 */

import { Readable } from 'stream';
import type { drive_v3 } from 'googleapis';
import pool from '../db';
import { getDriveClient, extractGoogleFileId } from '../google-drive/drive-helpers';
import {
  detectStampFormat,
  formatSignDate,
  signatureDataUrlToPng,
  stampAssessment,
  type AssessorDetails,
  type LabelKey,
} from './assessorStamp';

export interface AssessorRecord {
  user_id: string;
  assessor_name: string;
  nric: string;
  sign_date: string; // yyyy-mm-dd
  signature_png: string | null; // data URL
  updated_at: string;
}

export interface SubmissionSignResult {
  submissionId: string;
  fileName: string;
  assessmentType: string;
  status: 'signed' | 'unsigned' | 'skipped' | 'error';
  filled?: LabelKey[];
  fileUrl?: string;
  reason?: string;
}

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function getAssessorRecord(userId: string): Promise<AssessorRecord | null> {
  const r = await pool.query(
    `SELECT user_id, assessor_name, nric, to_char(sign_date, 'YYYY-MM-DD') AS sign_date,
            signature_png, updated_at
       FROM trainer_assessor_signature
      WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0] || null;
}

/** Name/NRIC defaults from the trainer's account and profile, for a first-time dialog. */
export async function getAssessorDefaults(userId: string): Promise<{ name: string; nric: string }> {
  const r = await pool.query(
    `SELECT au.full_name, tp.nric
       FROM app_user au
       LEFT JOIN trainer_profile tp ON tp.user_id = au.id
      WHERE au.id = $1`,
    [userId],
  );
  return { name: r.rows[0]?.full_name || '', nric: r.rows[0]?.nric || '' };
}

export async function saveAssessorRecord(
  userId: string,
  input: {
    name: string;
    nric: string;
    signDate: string;
    /** undefined = keep the saved signature, null = clear it, string = replace it */
    signaturePng?: string | null;
  },
): Promise<AssessorRecord> {
  const clear = input.signaturePng === null;
  const r = await pool.query(
    `INSERT INTO trainer_assessor_signature (user_id, assessor_name, nric, sign_date, signature_png)
     VALUES ($1, $2, $3, $4::date, $5)
     ON CONFLICT (user_id) DO UPDATE
        SET assessor_name = EXCLUDED.assessor_name,
            nric          = EXCLUDED.nric,
            sign_date     = EXCLUDED.sign_date,
            signature_png = CASE
                              WHEN $6 THEN NULL
                              ELSE COALESCE(EXCLUDED.signature_png, trainer_assessor_signature.signature_png)
                            END,
            updated_at    = now()
     RETURNING user_id, assessor_name, nric, to_char(sign_date, 'YYYY-MM-DD') AS sign_date,
               signature_png, updated_at`,
    [userId, input.name, input.nric, input.signDate, input.signaturePng ?? null, clear],
  );
  // Backfill the profile NRIC (admin-visible) when it is still empty.
  if (input.nric) {
    await pool.query(
      `UPDATE trainer_profile SET nric = $1 WHERE user_id = $2 AND (nric IS NULL OR nric = '')`,
      [input.nric, userId],
    );
  }
  return r.rows[0];
}

export function toAssessorDetails(rec: AssessorRecord): AssessorDetails {
  return {
    name: rec.assessor_name,
    nric: rec.nric,
    date: formatSignDate(rec.sign_date),
    signaturePng: signatureDataUrlToPng(rec.signature_png),
  };
}

// ── Drive I/O ─────────────────────────────────────────────────────────────────

async function downloadSubmission(drive: drive_v3.Drive, fileId: string) {
  const meta = await drive.files.get({ fileId, fields: 'id, name, mimeType, parents' });
  const mimeType = meta.data.mimeType || '';
  let name = meta.data.name || 'assessment';

  let data: ArrayBuffer;
  if (mimeType === GOOGLE_DOC_MIME) {
    // A Google Doc has no bytes of its own — export it as DOCX and stamp that.
    const exp = await drive.files.export({ fileId, mimeType: DOCX_MIME }, { responseType: 'arraybuffer' });
    data = exp.data as ArrayBuffer;
    if (!/\.docx$/i.test(name)) name = `${name}.docx`;
    return { buffer: Buffer.from(data), name, mimeType: DOCX_MIME, parents: meta.data.parents || [] };
  }

  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  data = res.data as ArrayBuffer;
  return { buffer: Buffer.from(data), name, mimeType, parents: meta.data.parents || [] };
}

function signedFileName(original: string): string {
  const dot = original.lastIndexOf('.');
  if (dot <= 0) return `${original} (signed)`;
  return `${original.slice(0, dot)} (signed)${original.slice(dot)}`;
}

async function uploadSigned(drive: drive_v3.Drive, params: { name: string; mimeType: string; parents: string[]; buffer: Buffer }) {
  const created = await drive.files.create({
    requestBody: { name: params.name, parents: params.parents.length ? params.parents : undefined },
    media: { mimeType: params.mimeType, body: Readable.from(params.buffer) },
    fields: 'id, name, webViewLink',
  });
  const fileId = created.data.id;
  if (!fileId) throw new Error('Google Drive did not return a file id for the signed copy');
  await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
  return {
    fileId,
    name: created.data.name || params.name,
    webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

// ── Sign / unsign ─────────────────────────────────────────────────────────────

interface SubmissionRow {
  id: string;
  assessment_type: string;
  file_name: string;
  file_url: string;
  assessor_signed_at: string | null;
  original_file_url: string | null;
  original_file_name: string | null;
}

async function listSubmissions(learnerUserId: string, courseRunId: string): Promise<SubmissionRow[]> {
  const r = await pool.query(
    `SELECT id, assessment_type, file_name, file_url, assessor_signed_at, original_file_url, original_file_name
       FROM link_assessment_submission
      WHERE user_id = $1 AND course_run_id = $2
      ORDER BY assessment_type, submitted_at`,
    [learnerUserId, courseRunId],
  );
  return r.rows;
}

export async function signLearnerSubmissions(params: {
  trainerUserId: string;
  learnerUserId: string;
  courseRunId: string;
  assessor: AssessorRecord;
}): Promise<SubmissionSignResult[]> {
  const details = toAssessorDetails(params.assessor);
  const rows = await listSubmissions(params.learnerUserId, params.courseRunId);
  if (rows.length === 0) return [];

  const drive = await getDriveClient();
  const results: SubmissionSignResult[] = [];

  for (const row of rows) {
    const base = { submissionId: row.id, fileName: row.file_name, assessmentType: row.assessment_type };
    if (row.assessor_signed_at) {
      results.push({ ...base, status: 'skipped', reason: 'Already signed', fileUrl: row.file_url });
      continue;
    }
    const fileId = extractGoogleFileId(row.file_url);
    if (!fileId) {
      results.push({ ...base, status: 'skipped', reason: 'Not a Google Drive link' });
      continue;
    }

    try {
      const src = await downloadSubmission(drive, fileId);
      const format = detectStampFormat(src.name, src.mimeType);
      if (!format) {
        results.push({ ...base, status: 'skipped', reason: `Unsupported file type (${src.name}) — only PDF and DOCX can be signed` });
        continue;
      }

      const stamped = await stampAssessment(src.buffer, format, details);
      if (stamped.filled.length === 0) {
        results.push({
          ...base,
          status: 'skipped',
          reason: stamped.noLabelsFound
            ? 'No "Assessor Name / NRIC / Date / Signature" block found in the file'
            : 'Assessor block is already filled in',
        });
        continue;
      }

      const uploaded = await uploadSigned(drive, {
        name: signedFileName(src.name),
        mimeType: format === 'pdf' ? 'application/pdf' : DOCX_MIME,
        parents: src.parents,
        buffer: stamped.buffer,
      });

      await pool.query(
        `UPDATE link_assessment_submission
            SET original_file_url  = COALESCE(original_file_url, file_url),
                original_file_name = COALESCE(original_file_name, file_name),
                file_url           = $1,
                file_name          = $2,
                assessor_signed_at = now(),
                assessor_signed_by = $3
          WHERE id = $4`,
        [uploaded.webViewLink, uploaded.name.slice(0, 255), params.trainerUserId, row.id],
      );
      results.push({ ...base, status: 'signed', filled: stamped.filled, fileUrl: uploaded.webViewLink, fileName: uploaded.name });
    } catch (err: any) {
      console.error(`Assessor sign failed for submission ${row.id}:`, err);
      results.push({ ...base, status: 'error', reason: err?.message || 'Signing failed' });
    }
  }

  return results;
}

export async function unsignLearnerSubmissions(params: {
  learnerUserId: string;
  courseRunId: string;
}): Promise<SubmissionSignResult[]> {
  const rows = await listSubmissions(params.learnerUserId, params.courseRunId);
  const signed = rows.filter(r => r.assessor_signed_at);
  if (signed.length === 0) return [];

  const drive = await getDriveClient();
  const results: SubmissionSignResult[] = [];

  for (const row of signed) {
    const base = { submissionId: row.id, fileName: row.file_name, assessmentType: row.assessment_type };
    try {
      const signedCopyId = extractGoogleFileId(row.file_url);
      const restoreUrl = row.original_file_url || row.file_url;
      const restoreName = row.original_file_name || row.file_name;

      await pool.query(
        `UPDATE link_assessment_submission
            SET file_url = $1, file_name = $2,
                original_file_url = NULL, original_file_name = NULL,
                assessor_signed_at = NULL, assessor_signed_by = NULL
          WHERE id = $3`,
        [restoreUrl, restoreName, row.id],
      );

      // Remove the stamped copy only when we actually restored a different original.
      if (row.original_file_url && signedCopyId && signedCopyId !== extractGoogleFileId(row.original_file_url)) {
        try { await drive.files.delete({ fileId: signedCopyId }); } catch (e) {
          console.warn(`Could not delete signed copy ${signedCopyId}:`, (e as Error).message);
        }
      }
      results.push({ ...base, status: 'unsigned', fileUrl: restoreUrl, fileName: restoreName });
    } catch (err: any) {
      console.error(`Assessor unsign failed for submission ${row.id}:`, err);
      results.push({ ...base, status: 'error', reason: err?.message || 'Unsign failed' });
    }
  }
  return results;
}
