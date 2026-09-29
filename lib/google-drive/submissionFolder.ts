/**
 * Resolve the learner's "Assessment Records" Drive folder for a course run.
 *
 * Uploads go to Course > Assessment Records > Session > <Learner Name>; the
 * folder id is stored on link_assessment_submission.drive_folder_id at upload
 * time. Rows created before that column existed are back-filled here from the
 * file's Drive parent (one metadata call per learner, once), and the folder is
 * made link-viewable so the trainer can open it without a per-email grant —
 * the files inside are already anyone-with-link.
 */

import pool from '../db';
import { getDriveClient, extractGoogleFileId, setGoogleFileLinkViewable } from './drive-helpers';

export interface SubmissionFolderInput {
  user_id: string;
  drive_folder_id: string | null;
  /** Any Drive file link of this learner's submissions (for back-fill). */
  file_url: string | null;
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/**
 * Returns { userId → folder id } for every learner that has one, back-filling
 * missing ids from Drive. Drive failures are logged and skipped so the roster
 * still loads.
 */
export async function resolveSubmissionFolders(
  courseRunId: string,
  learners: SubmissionFolderInput[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: SubmissionFolderInput[] = [];
  for (const l of learners) {
    if (l.drive_folder_id) out[l.user_id] = l.drive_folder_id;
    else if (l.file_url) missing.push(l);
  }
  if (missing.length === 0) return out;

  let drive;
  try {
    drive = await getDriveClient();
  } catch (err: any) {
    console.warn('Assessment folder back-fill skipped (no Drive client):', err?.message);
    return out;
  }

  await Promise.all(missing.map(async l => {
    const fileId = extractGoogleFileId(l.file_url || '');
    if (!fileId) return;
    try {
      const meta = await drive!.files.get({ fileId, fields: 'parents' });
      const folderId = meta.data.parents?.[0];
      if (!folderId) return;
      out[l.user_id] = folderId;
      await pool.query(
        `UPDATE link_assessment_submission
            SET drive_folder_id = $1
          WHERE user_id = $2 AND course_run_id = $3 AND drive_folder_id IS NULL`,
        [folderId, l.user_id, courseRunId],
      );
      await setGoogleFileLinkViewable(drive!, folderId, `assessment folder ${folderId}`);
    } catch (err: any) {
      console.warn(`Assessment folder back-fill failed for user ${l.user_id}:`, err?.message);
    }
  }));

  return out;
}
