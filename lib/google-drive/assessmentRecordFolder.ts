/**
 * Learner "Assessment Records" folder resolution on Google Drive:
 *
 *   <root> / <TGS-ref Course title> / Assessment Records / <session> / <learner>
 *
 * Shared by the manual Assessment Summary Record upload and the e-signed ASR
 * generator so both land in the same learner folder.
 */

import type { drive_v3 } from 'googleapis';
import {
    findSubfolder,
    findSessionFolderByStartDate,
    createSubfolder,
    buildSessionFolderName,
    buildStartDatePrefix,
} from './drive-helpers';

export interface AssessmentRecordRun {
    courseCode: string | null;
    courseTitle: string | null;
    startDate: Date | string | null;
    endDate: Date | string | null;
    /** Display name used in the session folder name */
    trainerName: string | null;
    /** trainer_profile.common_name, used to match an existing session folder */
    trainerCommonName?: string | null;
}

async function getOrCreateFolder(drive: drive_v3.Drive, parentId: string, name: string): Promise<string> {
    const existing = await findSubfolder(drive, parentId, name);
    return existing || (await createSubfolder(drive, parentId, name));
}

/**
 * Find or create the learner's folder under the course's Assessment Records.
 */
export async function ensureLearnerAssessmentFolder(
    drive: drive_v3.Drive,
    rootFolderId: string,
    run: AssessmentRecordRun,
    studentName: string,
): Promise<string> {
    const courseCode = run.courseCode || '';
    const courseName = run.courseTitle || '';

    // 1. Course folder — matched by TGS ref when there is one
    let courseFolderId: string | null = null;
    let tgsRef = courseCode;
    if (!tgsRef) {
        const m = courseName.match(/(TGS-\d+)/);
        if (m) tgsRef = m[1];
    }
    const expectedCourseFolderName = tgsRef && courseName && !courseName.includes(tgsRef)
        ? `${tgsRef} ${courseName}`.trim()
        : `${courseCode} ${courseName}`.trim() || 'Unknown Course';

    if (tgsRef) {
        const safeTgsRef = tgsRef.replace(/'/g, "\\'");
        const r = await drive.files.list({
            q: `'${rootFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        if (r.data.files && r.data.files.length > 0) courseFolderId = r.data.files[0].id!;
    } else {
        courseFolderId = await findSubfolder(drive, rootFolderId, expectedCourseFolderName);
    }
    if (!courseFolderId) courseFolderId = await createSubfolder(drive, rootFolderId, expectedCourseFolderName);

    // 2. Assessment Records
    const assessmentRecordsId = await getOrCreateFolder(drive, courseFolderId, 'Assessment Records');

    // 3. Session folder (when the run has dates)
    let targetParentId = assessmentRecordsId;
    if (run.startDate && run.endDate) {
        const start = new Date(run.startDate);
        const end = new Date(run.endDate);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const sessionFolderName = buildSessionFolderName(start, end, run.trainerName || 'Unknown Trainer');
            const startDatePrefix = buildStartDatePrefix(start);
            let sessionFolderId = await findSessionFolderByStartDate(
                drive, assessmentRecordsId, startDatePrefix, run.trainerCommonName || undefined,
            );
            if (!sessionFolderId) sessionFolderId = await createSubfolder(drive, assessmentRecordsId, sessionFolderName);
            targetParentId = sessionFolderId;
        }
    }

    // 4. Learner folder
    return getOrCreateFolder(drive, targetParentId, studentName);
}
