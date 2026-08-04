import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { Readable } from 'stream';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import {
  getDriveClient,
  findSubfolder,
  createSubfolder,
} from '../../../lib/google-drive/drive-helpers';

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * POST /api/admin/ca-upload-supporting-doc
 *
 * multipart/form-data:
 *   - file:                  the document (image or PDF)
 *   - companyApplicationId:  uuid of the company_application row
 *
 * Drive structure:
 *   {DRIVE_ROOT} / CA Supporting Docs / {employer UEN} / {course run ID} / {NRIC}_{filename}
 *
 * Writes supporting_doc_drive_file_id, supporting_doc_drive_web_view_link,
 * supporting_doc_uploaded_at on the row. Resets verification status to NULL
 * (treated as "uploaded but not yet reviewed") so re-uploads after a
 * mismatch force the admin to re-verify.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const form = new IncomingForm({ maxFileSize: 20 * 1024 * 1024 });
    const { fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const companyApplicationId = Array.isArray(fields.companyApplicationId)
      ? fields.companyApplicationId[0]
      : fields.companyApplicationId;
    if (!companyApplicationId) {
      return res.status(400).json({ success: false, error: 'companyApplicationId is required' });
    }

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }

    const rowRes = await pool.query(
      `SELECT id, employer_uen, course_run_id, trainee_nric, trainee_full_name
         FROM public.company_application
        WHERE id = $1`,
      [companyApplicationId]
    );
    const row = rowRes.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, error: 'Company application row not found' });
    }

    const drive = await getDriveClient();
    // CA supporting docs land in a dedicated folder under the LMS ops
    // root (12 AI_LMS_TMS), separate from GOOGLE_DRIVE_FOLDER_ID which
    // other features (trainer photos, assessment uploads, etc.) share.
    // Env var takes precedence so other tenants can override without a
    // code change; the hardcoded default is Tertiary's folder ID.
    const DEFAULT_CA_DOCS_FOLDER_ID = '1DQbQA9HWbzk7NXgwO8ud1yrqTeu48yyN';
    const rootFolderId = (
      process.env.CA_SUPPORTING_DOCS_FOLDER_ID ||
      DEFAULT_CA_DOCS_FOLDER_ID
    ).trim();
    if (!rootFolderId) {
      return res.status(500).json({
        success: false,
        error: 'CA supporting docs folder ID not configured (CA_SUPPORTING_DOCS_FOLDER_ID env or hardcoded default)',
      });
    }

    const sanitize = (v: string) => v.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown';
    const employerKey = sanitize(String(row.employer_uen || 'unknown_uen'));
    const courseKey = sanitize(String(row.course_run_id || 'unknown_run'));
    const nricKey = sanitize(String(row.trainee_nric || 'unknown_nric'));

    const ensureFolder = async (parentId: string, name: string): Promise<string> => {
      const existing = await findSubfolder(drive, parentId, name);
      if (existing) return existing;
      return createSubfolder(drive, parentId, name);
    };

    const rootBucket = await ensureFolder(rootFolderId, 'CA Supporting Docs');
    const employerFolder = await ensureFolder(rootBucket, employerKey);
    const courseFolder = await ensureFolder(employerFolder, courseKey);

    const originalName = sanitize(String(uploaded.originalFilename || `doc_${Date.now()}`));
    const fileName = `${nricKey}_${Date.now()}_${originalName}`;
    const mimeType = uploaded.mimetype || 'application/octet-stream';
    const fileStream = fs.createReadStream(uploaded.filepath);

    const createResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [courseFolder],
      },
      media: {
        mimeType,
        body: Readable.from(fileStream),
      },
      fields: 'id, webViewLink',
    });

    const fileId = createResponse.data.id;
    if (!fileId) {
      throw new Error('Google Drive did not return a file ID for supporting doc upload');
    }

    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    const webViewLink = createResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    await pool.query(
      `UPDATE public.company_application
          SET supporting_doc_drive_file_id        = $2,
              supporting_doc_drive_web_view_link  = $3,
              supporting_doc_uploaded_at          = now(),
              supporting_doc_verification_status  = NULL,
              supporting_doc_verified_at          = NULL,
              supporting_doc_verified_by          = NULL,
              updated_at                          = now()
        WHERE id = $1`,
      [companyApplicationId, fileId, webViewLink]
    );

    try {
      fs.unlinkSync(uploaded.filepath);
    } catch {
      // tempfile cleanup best-effort
    }

    return res.status(200).json({
      success: true,
      fileId,
      webViewLink,
      traineeFullName: row.trainee_full_name,
    });
  } catch (err: any) {
    console.error('ca-upload-supporting-doc error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to upload supporting doc',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
