import { NextApiRequest, NextApiResponse } from 'next';
import { google, drive_v3 } from 'googleapis';
import { cors } from '../../../lib/cors';

/**
 * Authenticate using a Service Account or Service Account Base64 string.
 */
function getDriveClient(): drive_v3.Drive {
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const privateKeyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64;

    if (!serviceAccountEmail) {
        throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL in environment variables.');
    }

    if (!privateKey && !privateKeyB64) {
        throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64 in environment variables.');
    }

    let formattedPrivateKey = '';

    if (privateKeyB64) {
        formattedPrivateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');
    } else if (privateKey) {
        formattedPrivateKey = privateKey
            .replace(/^"|"$/g, '')
            .replace(/^'|'$/g, '')
            .split(String.raw`\n`).join('\n')
            .replace(/\\n/g, '\n');
    }

    const auth = new google.auth.JWT({
        email: serviceAccountEmail,
        key: formattedPrivateKey,
        scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'], // Readonly is sufficient for verification
    });

    return google.drive({ version: 'v3', auth });
}

/**
 * Find a subfolder by name inside a parent folder.
 */
async function findSubfolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    folderName: string
): Promise<string | null> {
    const safeName = folderName.replace(/'/g, "\\'");
    const response = await drive.files.list({
        q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });

    const files = response.data.files;
    if (files && files.length > 0) {
        return files[0].id!;
    }
    return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!parentFolderId) {
        return res.status(500).json({
            success: false,
            error: 'GOOGLE_DRIVE_FOLDER_ID is not configured on the server.',
        });
    }

    const courseCode = (req.query.courseCode as string) || '';
    const courseName = (req.query.courseName as string) || '';
    const studentName = (req.query.studentName as string) || '';

    if (!studentName) {
         return res.status(400).json({
            success: false,
            error: 'Missing studentName parameter.',
        });
    }

    try {
        const drive = getDriveClient();

        // 1. Get Course Folder (e.g., "TGS-2023123456 Intro to AI")
        // Using "contains" logic just like the upload/google-drive API
        let courseFolderId = null;
        let tgsRef = courseCode;
        if (!tgsRef) {
            const tgsMatch = courseName.match(/(TGS-\d+)/);
            if (tgsMatch) {
                tgsRef = tgsMatch[1];
            }
        }

        if (tgsRef) {
             const safeTgsRef = tgsRef.replace(/'/g, "\\'");
             const tgsResponse = await drive.files.list({
                 q: `'${parentFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                 fields: 'files(id, name)',
                 spaces: 'drive',
             });
             if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
                  courseFolderId = tgsResponse.data.files[0].id!;
             }
        } else {
             const courseFolderName = (`${courseCode} ${courseName}`).trim() || 'Unknown Course';
             courseFolderId = await findSubfolder(drive, parentFolderId, courseFolderName);
        }
        
        if (!courseFolderId) {
            return res.status(404).json({ success: false, error: `Course folder not found in Google Drive.` });
        }

        // 2. Find "Assessment Records" folder
        const assessmentRecordsFolderId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
        if (!assessmentRecordsFolderId) {
             return res.status(404).json({ success: false, error: `The 'Assessment Records' folder was not found inside the course folder.` });
        }

        // 3. Find the Student's specific subfolder
        // Date format: DD-MM-YYYY
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const dateStr = `${dd}-${mm}-${yyyy}`;

        const studentFolderName = `${dateStr} ${studentName}`;
        const studentFolderId = await findSubfolder(drive, assessmentRecordsFolderId, studentFolderName);

        if (!studentFolderId) {
            // Folder hasn't even been generated yet (or they didn't click the open button today)
            return res.status(404).json({ success: false, error: `Student folder '${studentFolderName}' not found. Please click 'Open Submission Folder' first.` });
        }

        // 4. Verify if any files exist inside the student folder
        const fileResponse = await drive.files.list({
             q: `'${studentFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
             fields: 'files(id, name, webViewLink, createdTime)',
             spaces: 'drive',
             pageSize: 10,
        });

        const files = fileResponse.data.files;
        if (files && files.length > 0) {
            // We found files! They submitted.
            // Sort by creation time to get the most recent file
            files.sort((a, b) => new Date(b.createdTime!).getTime() - new Date(a.createdTime!).getTime());
            
            return res.status(200).json({ 
                success: true, 
                fileCount: files.length,
                latestFile: {
                    name: files[0].name,
                    link: files[0].webViewLink
                }
            });
        } else {
            // Folder exists, but it's empty
            return res.status(200).json({ 
                success: false, 
                fileCount: 0, 
                error: 'Your Google Drive submission folder is empty. Please upload your document to the folder and try verifying again.' 
            });
        }

    } catch (error: any) {
        console.error('Drive Verification API Error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to communicate with Google Drive API' });
    }
}
