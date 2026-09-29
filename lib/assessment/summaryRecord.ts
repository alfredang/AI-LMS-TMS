/**
 * Assessment Summary Record (ASR) e-signing service.
 *
 * One assessment_summary_record row per (course run, learner) holds the
 * candidate block (signed by the learner) and the assessor block (signed by
 * the trainer). Each signing snapshots the party's name / NRIC / date /
 * signature onto the row, then the PDF is regenerated from the course's ASR
 * template (course.assessment_summary_record_url) with every block signed so
 * far and uploaded to the learner's Assessment Records folder on Drive, so the
 * file always reflects the current state and the final copy carries both.
 *
 * Only the LMS app touches Drive and the DB — callers are the course-page UI
 * via /api/assessments/summary-record and /api/learner/signature.
 */

import { Readable } from 'stream';
import type { drive_v3 } from 'googleapis';
import pool from '../db';
import { getDriveClient, extractGoogleFileId } from '../google-drive/drive-helpers';
import { ensureLearnerAssessmentFolder } from '../google-drive/assessmentRecordFolder';
import { getGoogleDriveFolderId } from '../googleDriveFolder';
import { formatSignDate, signatureDataUrlToPng } from './assessorStamp';
import { stampSummaryRecord, type FieldKey, type Party, type PartyDetails } from './summaryRecordStamp';

// ── Learner signature (candidate block, saved once per learner) ───────────────

export interface LearnerSignatureRecord {
  user_id: string;
  learner_name: string;
  nric: string;
  signature_png: string | null; // data URL
  updated_at: string;
}

export async function getLearnerSignature(userId: string): Promise<LearnerSignatureRecord | null> {
  const r = await pool.query(
    `SELECT user_id, learner_name, nric, signature_png, updated_at
       FROM learner_signature
      WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0] || null;
}

/** Name/NRIC defaults from the learner's account, profile or latest enrolment. */
export async function getLearnerSignatureDefaults(userId: string): Promise<{ name: string; nric: string }> {
  const r = await pool.query(
    `SELECT au.full_name,
            COALESCE(NULLIF(lp.nric, ''),
                     (SELECT e.nric FROM enrollment e
                       WHERE e.user_id = au.id AND COALESCE(e.nric, '') <> ''
                       ORDER BY e.created_at DESC NULLS LAST LIMIT 1)) AS nric
       FROM app_user au
       LEFT JOIN learner_profile lp ON lp.user_id = au.id
      WHERE au.id = $1`,
    [userId],
  );
  return { name: r.rows[0]?.full_name || '', nric: r.rows[0]?.nric || '' };
}

export async function saveLearnerSignature(
  userId: string,
  input: {
    name: string;
    nric: string;
    /** undefined = keep the saved signature, null = clear it, string = replace it */
    signaturePng?: string | null;
  },
): Promise<LearnerSignatureRecord> {
  const clear = input.signaturePng === null;
  const r = await pool.query(
    `INSERT INTO learner_signature (user_id, learner_name, nric, signature_png)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
        SET learner_name  = EXCLUDED.learner_name,
            nric          = EXCLUDED.nric,
            signature_png = CASE
                              WHEN $5 THEN NULL
                              ELSE COALESCE(EXCLUDED.signature_png, learner_signature.signature_png)
                            END,
            updated_at    = now()
     RETURNING user_id, learner_name, nric, signature_png, updated_at`,
    [userId, input.name, input.nric, input.signaturePng ?? null, clear],
  );
  return r.rows[0];
}

// ── Summary record rows ───────────────────────────────────────────────────────

/** Public (signature-free) view of a row. */
export interface SummaryRecordView {
  id: string;
  courseRunId: string;
  learnerUserId: string;
  learner: { name: string | null; nric: string | null; signDate: string | null; signedAt: string | null } | null;
  trainer: { userId: string | null; name: string | null; nric: string | null; signDate: string | null; signedAt: string | null } | null;
  file: { id: string; url: string; name: string | null; generatedAt: string | null } | null;
}

interface SummaryRecordRow {
  id: string;
  course_run_id: string;
  learner_user_id: string;
  learner_name: string | null;
  learner_nric: string | null;
  learner_sign_date: string | null;
  learner_signature_png: string | null;
  learner_signed_at: string | null;
  trainer_user_id: string | null;
  trainer_name: string | null;
  trainer_nric: string | null;
  trainer_sign_date: string | null;
  trainer_signature_png: string | null;
  trainer_signed_at: string | null;
  template_file_id: string | null;
  file_id: string | null;
  file_url: string | null;
  file_name: string | null;
  generated_at: string | null;
}

const ROW_COLUMNS = `
  id, course_run_id, learner_user_id,
  learner_name, learner_nric, to_char(learner_sign_date, 'YYYY-MM-DD') AS learner_sign_date,
  learner_signature_png, learner_signed_at,
  trainer_user_id, trainer_name, trainer_nric, to_char(trainer_sign_date, 'YYYY-MM-DD') AS trainer_sign_date,
  trainer_signature_png, trainer_signed_at,
  template_file_id, file_id, file_url, file_name, generated_at`;

function toView(row: SummaryRecordRow | null): SummaryRecordView | null {
  if (!row) return null;
  return {
    id: row.id,
    courseRunId: row.course_run_id,
    learnerUserId: row.learner_user_id,
    learner: row.learner_signed_at
      ? { name: row.learner_name, nric: row.learner_nric, signDate: row.learner_sign_date, signedAt: row.learner_signed_at }
      : null,
    trainer: row.trainer_signed_at
      ? { userId: row.trainer_user_id, name: row.trainer_name, nric: row.trainer_nric, signDate: row.trainer_sign_date, signedAt: row.trainer_signed_at }
      : null,
    file: row.file_id && row.file_url
      ? { id: row.file_id, url: row.file_url, name: row.file_name, generatedAt: row.generated_at }
      : null,
  };
}

async function getRow(courseRunId: string, learnerUserId: string): Promise<SummaryRecordRow | null> {
  const r = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM assessment_summary_record
      WHERE course_run_id::text = $1 AND learner_user_id = $2`,
    [courseRunId, learnerUserId],
  );
  return r.rows[0] || null;
}

export async function getSummaryRecord(courseRunId: string, learnerUserId: string): Promise<SummaryRecordView | null> {
  return toView(await getRow(courseRunId, learnerUserId));
}

export interface LearnerSummaryStatus {
  learnerUserId: string;
  learnerName: string;
  email: string | null;
  record: SummaryRecordView | null;
}

/** Every active learner in the run with their signing state (one row per learner). */
export async function listSummaryRecords(courseRunId: string): Promise<LearnerSummaryStatus[]> {
  const r = await pool.query(
    `SELECT DISTINCT ON (au.id) au.id AS learner_user_id, au.full_name, au.email,
            asr.id AS asr_id
       FROM enrollment e
       JOIN app_user au ON au.id = e.user_id
       LEFT JOIN assessment_summary_record asr
         ON asr.course_run_id = e.course_run_id AND asr.learner_user_id = au.id
      WHERE e.course_run_id::text = $1
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      ORDER BY au.id`,
    [courseRunId],
  );
  const rows = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM assessment_summary_record WHERE course_run_id::text = $1`,
    [courseRunId],
  );
  const byLearner = new Map<string, SummaryRecordRow>();
  for (const row of rows.rows as SummaryRecordRow[]) byLearner.set(row.learner_user_id, row);

  return (r.rows as { learner_user_id: string; full_name: string; email: string | null }[])
    .map(l => ({
      learnerUserId: l.learner_user_id,
      learnerName: l.full_name,
      email: l.email,
      record: toView(byLearner.get(l.learner_user_id) || null),
    }))
    .sort((a, b) => a.learnerName.localeCompare(b.learnerName));
}

export async function isLearnerEnrolled(userId: string, courseRunId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM enrollment e
      WHERE e.user_id = $1 AND e.course_run_id::text = $2
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      LIMIT 1`,
    [userId, courseRunId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ── Run / template lookup ─────────────────────────────────────────────────────

export interface SummaryRunInfo {
  courseRunId: string;
  courseCode: string | null;
  courseTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  trainerName: string | null;
  trainerCommonName: string | null;
  templateUrl: string | null;
}

export async function getSummaryRunInfo(courseRunId: string): Promise<SummaryRunInfo | null> {
  const r = await pool.query(
    `SELECT cr.id, to_char(cr.start_date, 'YYYY-MM-DD') AS start_date, to_char(cr.end_date, 'YYYY-MM-DD') AS end_date,
            cr.assigned_trainer_name, c.course_code, c.title, c.assessment_summary_record_url,
            tp.common_name AS trainer_common_name
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN trainer_profile tp ON tp.user_id = cr.assigned_trainer_id
      WHERE cr.id::text = $1`,
    [courseRunId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    courseRunId: row.id,
    courseCode: row.course_code,
    courseTitle: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    trainerName: row.trainer_common_name || row.assigned_trainer_name || null,
    trainerCommonName: row.trainer_common_name,
    templateUrl: row.assessment_summary_record_url,
  };
}

const PDF_MIME = 'application/pdf';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const WORD_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

/**
 * The ASR template as PDF bytes. A PDF is downloaded as-is; a Google Doc is
 * exported; a Word file is converted through a temporary Google Doc copy.
 */
async function fetchTemplatePdf(drive: drive_v3.Drive, templateUrl: string): Promise<{ bytes: Buffer; fileId: string; name: string }> {
  const fileId = extractGoogleFileId(templateUrl);
  if (!fileId) throw new Error('The Assessment Summary Record link on the course is not a Google Drive file');

  const meta = await drive.files.get({ fileId, fields: 'id, name, mimeType' });
  const mimeType = meta.data.mimeType || '';
  const name = (meta.data.name || 'Assessment Summary Record').replace(/\.(pdf|docx?|gdoc)$/i, '');

  if (mimeType === PDF_MIME) {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return { bytes: Buffer.from(res.data as ArrayBuffer), fileId, name };
  }
  if (mimeType === GOOGLE_DOC_MIME) {
    const exp = await drive.files.export({ fileId, mimeType: PDF_MIME }, { responseType: 'arraybuffer' });
    return { bytes: Buffer.from(exp.data as ArrayBuffer), fileId, name };
  }
  if (WORD_MIMES.has(mimeType)) {
    const copy = await drive.files.copy({
      fileId,
      requestBody: { name: `${name} (asr-convert)`, mimeType: GOOGLE_DOC_MIME },
      fields: 'id',
    });
    const tmpId = copy.data.id!;
    try {
      const exp = await drive.files.export({ fileId: tmpId, mimeType: PDF_MIME }, { responseType: 'arraybuffer' });
      return { bytes: Buffer.from(exp.data as ArrayBuffer), fileId, name };
    } finally {
      try { await drive.files.delete({ fileId: tmpId }); } catch { /* best effort */ }
    }
  }
  throw new Error(`Unsupported Assessment Summary Record template type (${mimeType || 'unknown'}) — use a PDF, Google Doc or Word file`);
}

// ── Generation ────────────────────────────────────────────────────────────────

function partyDetails(row: SummaryRecordRow, party: Party): PartyDetails | null {
  const signedAt = party === 'learner' ? row.learner_signed_at : row.trainer_signed_at;
  if (!signedAt) return null;
  const name = (party === 'learner' ? row.learner_name : row.trainer_name) || '';
  const nric = (party === 'learner' ? row.learner_nric : row.trainer_nric) || '';
  const date = (party === 'learner' ? row.learner_sign_date : row.trainer_sign_date) || '';
  const png = party === 'learner' ? row.learner_signature_png : row.trainer_signature_png;
  return { name, nric, date: date ? formatSignDate(date) : '', signaturePng: signatureDataUrlToPng(png) };
}

export interface GenerationResult {
  fileId: string;
  fileUrl: string;
  fileName: string;
  filled: { learner: FieldKey[]; trainer: FieldKey[] };
}

/**
 * Rebuild the signed PDF from the template with every signed block and put it
 * in the learner's Assessment Records folder (replacing the previous copy so
 * the link stays stable).
 */
export async function regenerateSummaryRecordPdf(courseRunId: string, learnerUserId: string): Promise<GenerationResult> {
  const row = await getRow(courseRunId, learnerUserId);
  if (!row) throw new Error('No Assessment Summary Record signing state for this learner');
  const run = await getSummaryRunInfo(courseRunId);
  if (!run) throw new Error('Course run not found');
  if (!run.templateUrl) {
    throw new Error('This course has no Assessment Summary Record template link — set it under the course details first');
  }

  const rootFolderId = await getGoogleDriveFolderId();
  if (!rootFolderId) throw new Error('Google Drive Root Folder ID is not configured (Company Setting → Integration → Google)');

  const drive = await getDriveClient();
  const template = await fetchTemplatePdf(drive, run.templateUrl);
  const stamped = await stampSummaryRecord(template.bytes, {
    learner: partyDetails(row, 'learner'),
    trainer: partyDetails(row, 'trainer'),
  });
  if (stamped.tableNotFound) {
    throw new Error('Could not find the Candidate / Assessor sign-off table in the Assessment Summary Record template');
  }

  const learner = await pool.query(`SELECT full_name FROM app_user WHERE id = $1`, [learnerUserId]);
  const learnerName: string = learner.rows[0]?.full_name || row.learner_name || 'Learner';
  const fileName = `${template.name} - ${learnerName} (signed).pdf`.slice(0, 255);

  let fileId = row.file_id;
  let fileUrl = row.file_url;
  let uploaded = false;
  if (fileId) {
    try {
      const upd = await drive.files.update({
        fileId,
        requestBody: { name: fileName },
        media: { mimeType: PDF_MIME, body: Readable.from(stamped.buffer) },
        fields: 'id, webViewLink',
      });
      fileId = upd.data.id || fileId;
      fileUrl = upd.data.webViewLink || fileUrl;
      uploaded = true;
    } catch (e) {
      console.warn(`ASR: could not update ${fileId}, creating a new copy:`, (e as Error).message);
    }
  }
  if (!uploaded) {
    const folderId = await ensureLearnerAssessmentFolder(drive, rootFolderId, {
      courseCode: run.courseCode,
      courseTitle: run.courseTitle,
      startDate: run.startDate,
      endDate: run.endDate,
      trainerName: run.trainerName || 'Unknown Trainer',
      trainerCommonName: run.trainerCommonName,
    }, learnerName);
    const created = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: PDF_MIME, body: Readable.from(stamped.buffer) },
      fields: 'id, webViewLink',
    });
    fileId = created.data.id!;
    fileUrl = created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
  }

  await pool.query(
    `UPDATE assessment_summary_record
        SET template_file_id = $1, file_id = $2, file_url = $3, file_name = $4,
            generated_at = now(), updated_at = now()
      WHERE id = $5`,
    [template.fileId, fileId, fileUrl, fileName, row.id],
  );

  return { fileId: fileId!, fileUrl: fileUrl!, fileName, filled: stamped.filled };
}

// ── Sign / unsign ─────────────────────────────────────────────────────────────

export interface Signer {
  userId: string;
  name: string;
  nric: string;
  /** PNG data URL */
  signaturePng: string;
}

/**
 * Record one party's signature and regenerate the PDF. Returns the updated
 * view plus what was drawn.
 */
export async function signSummaryRecord(params: {
  courseRunId: string;
  learnerUserId: string;
  party: Party;
  signDate: string; // yyyy-mm-dd
  signer: Signer;
}): Promise<{ record: SummaryRecordView; generation: GenerationResult }> {
  const { courseRunId, learnerUserId, party, signDate, signer } = params;
  if (party === 'learner') {
    await pool.query(
      `INSERT INTO assessment_summary_record
         (course_run_id, learner_user_id, learner_name, learner_nric, learner_sign_date, learner_signature_png, learner_signed_at)
       VALUES ($1::uuid, $2, $3, $4, $5::date, $6, now())
       ON CONFLICT (course_run_id, learner_user_id) DO UPDATE
          SET learner_name = EXCLUDED.learner_name, learner_nric = EXCLUDED.learner_nric,
              learner_sign_date = EXCLUDED.learner_sign_date, learner_signature_png = EXCLUDED.learner_signature_png,
              learner_signed_at = now(), updated_at = now()`,
      [courseRunId, learnerUserId, signer.name, signer.nric, signDate, signer.signaturePng],
    );
  } else {
    await pool.query(
      `INSERT INTO assessment_summary_record
         (course_run_id, learner_user_id, trainer_user_id, trainer_name, trainer_nric, trainer_sign_date, trainer_signature_png, trainer_signed_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, now())
       ON CONFLICT (course_run_id, learner_user_id) DO UPDATE
          SET trainer_user_id = EXCLUDED.trainer_user_id, trainer_name = EXCLUDED.trainer_name,
              trainer_nric = EXCLUDED.trainer_nric, trainer_sign_date = EXCLUDED.trainer_sign_date,
              trainer_signature_png = EXCLUDED.trainer_signature_png,
              trainer_signed_at = now(), updated_at = now()`,
      [courseRunId, learnerUserId, signer.userId, signer.name, signer.nric, signDate, signer.signaturePng],
    );
  }

  const generation = await regenerateSummaryRecordPdf(courseRunId, learnerUserId);
  const record = (await getSummaryRecord(courseRunId, learnerUserId))!;
  return { record, generation };
}

/**
 * Remove one party's signature. The PDF is regenerated with the other block,
 * or removed from Drive when nobody is left signed.
 */
export async function clearSummaryRecordSignature(params: {
  courseRunId: string;
  learnerUserId: string;
  party: Party;
}): Promise<{ record: SummaryRecordView | null; generation: GenerationResult | null }> {
  const { courseRunId, learnerUserId, party } = params;
  const row = await getRow(courseRunId, learnerUserId);
  if (!row) return { record: null, generation: null };

  if (party === 'learner') {
    await pool.query(
      `UPDATE assessment_summary_record
          SET learner_name = NULL, learner_nric = NULL, learner_sign_date = NULL,
              learner_signature_png = NULL, learner_signed_at = NULL, updated_at = now()
        WHERE id = $1`,
      [row.id],
    );
  } else {
    await pool.query(
      `UPDATE assessment_summary_record
          SET trainer_user_id = NULL, trainer_name = NULL, trainer_nric = NULL, trainer_sign_date = NULL,
              trainer_signature_png = NULL, trainer_signed_at = NULL, updated_at = now()
        WHERE id = $1`,
      [row.id],
    );
  }

  const after = (await getRow(courseRunId, learnerUserId))!;
  if (after.learner_signed_at || after.trainer_signed_at) {
    const generation = await regenerateSummaryRecordPdf(courseRunId, learnerUserId);
    return { record: await getSummaryRecord(courseRunId, learnerUserId), generation };
  }

  // Nobody signed any more — drop the generated file.
  if (after.file_id) {
    try {
      const drive = await getDriveClient();
      await drive.files.delete({ fileId: after.file_id });
    } catch (e) {
      console.warn(`ASR: could not delete ${after.file_id}:`, (e as Error).message);
    }
  }
  await pool.query(
    `UPDATE assessment_summary_record
        SET file_id = NULL, file_url = NULL, file_name = NULL, generated_at = NULL, updated_at = now()
      WHERE id = $1`,
    [after.id],
  );
  return { record: await getSummaryRecord(courseRunId, learnerUserId), generation: null };
}
