import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { google, drive_v3 } from 'googleapis';
import { cors } from '../../../lib/cors';

// Disable body parser to handle multipart/form-data
export const config = {
    api: {
        bodyParser: false,
    },
};

/**
 * Authenticate using a Service Account.
 * Files will be uploaded using the Service Account's identity.
 * Ensure the target Google Drive folder is shared with the Service Account email.
 */
function getDriveClient(): drive_v3.Drive {
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (!serviceAccountEmail || !privateKey) {
        throw new Error(
            'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in environment variables.'
        );
    }

    // Fix formatting for private key based on how different hosting providers (like Coolify/Vercel) inject it
    // 1. Remove wrapping quotes if they exist
    let formattedPrivateKey = privateKey.replace(/^"|"$/g, '');
    // 2. Replace escaped literal \n with actual newlines
    formattedPrivateKey = formattedPrivateKey.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({
        email: serviceAccountEmail,
        key: formattedPrivateKey,
        scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
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

/**
 * Create a subfolder inside a parent folder and return its ID.
 */
async function createSubfolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    folderName: string
): Promise<string> {
    const response = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
        },
        fields: 'id',
    });
    return response.data.id!;
}

/**
 * Get or create a subfolder for the student inside the parent folder.
 */
async function getOrCreateStudentFolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    studentName: string
): Promise<string> {
    const existing = await findSubfolder(drive, parentFolderId, studentName);
    if (existing) {
        console.log(`📁 Reusing existing Drive folder for "${studentName}": ${existing}`);
        return existing;
    }

    const newId = await createSubfolder(drive, parentFolderId, studentName);
    console.log(`📁 Created new Drive folder for "${studentName}": ${newId}`);
    return newId;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method === 'GET') {
        const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        if (!parentFolderId) {
            return res.status(500).json({ success: false, error: 'GOOGLE_DRIVE_FOLDER_ID is not configured.' });
        }

        const courseCode = (req.query.courseCode as string) || '';
        
        if (!courseCode) {
            return res.status(400).json({ success: false, error: 'Course code (TGS ref) is required.' });
        }

        try {
            const drive = getDriveClient();
            
            // Search for the folder by checking if its name contains the TGS ref
            const safeCode = courseCode.replace(/'/g, "\\'");
            const response = await drive.files.list({
                q: `'${parentFolderId}' in parents and name contains '${safeCode}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, name, webViewLink)',
                spaces: 'drive',
            });

            const files = response.data.files;
            if (!files || files.length === 0) {
                return res.status(404).json({ success: false, error: `Course folder containing TGS ref '${courseCode}' not found in Google Drive.` });
            }

            const courseFolderId = files[0].id;

            // Now search for the "Assessment Records" folder inside the course folder
            const assessmentRecordsResponse = await drive.files.list({
                q: `'${courseFolderId}' in parents and name = 'Assessment Records' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, name, webViewLink)',
                spaces: 'drive',
            });

            const assessmentFiles = assessmentRecordsResponse.data.files;
            if (assessmentFiles && assessmentFiles.length > 0) {
                return res.status(200).json({ success: true, link: assessmentFiles[0].webViewLink });
            } else {
                return res.status(404).json({ success: false, error: `The 'Assessment Records' folder was not found inside the course folder.` });
            }
        } catch (error: any) {
            console.error('Drive API Error:', error);
            return res.status(500).json({ success: false, error: error.message || 'Failed to communicate with Google Drive API' });
        }
    }

    if (req.method !== 'POST') {
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
    const studentName = (req.query.studentName as string) || 'Unknown Student';

    try {
        const form = new IncomingForm({
            keepExtensions: true,
            maxFileSize: 50 * 1024 * 1024, // 50 MB limit
        });

        const { files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile || !uploadedFile.filepath) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const originalName = uploadedFile.originalFilename || 'untitled';
        const mimeType = uploadedFile.mimetype || 'application/octet-stream';

        const drive = getDriveClient();

        // 1. Get Course Folder (e.g., "CRS-123 Intro to AI")
        const courseFolderName = courseCode && courseName 
            ? `${courseCode} ${courseName}`.trim()
            : (courseName || courseCode || 'Unknown Course');
        const courseFolderId = await findSubfolder(drive, parentFolderId, courseFolderName);
        
        if (!courseFolderId) {
            try { fs.unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }
            return res.status(404).json({ success: false, error: `Course folder '${courseFolderName}' not found in Google Drive.` });
        }

        // 2. Get Student Submission Folder (e.g., "25-10-2023 John Doe")
        // Format date as DD-MM-YYYY
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0'); // January is 0!
        const yyyy = today.getFullYear();
        const dateStr = `${dd}-${mm}-${yyyy}`;

        const studentFolderName = `${dateStr} ${studentName}`;
        const studentFolderId = await findSubfolder(drive, courseFolderId, studentFolderName);

        if (!studentFolderId) {
            try { fs.unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }
            return res.status(404).json({ success: false, error: `Student folder '${studentFolderName}' not found inside course folder.` });
        }

        // 3. Upload file into the student's subfolder
        const driveResponse = await drive.files.create({
            requestBody: {
                name: originalName,
                parents: [studentFolderId],
            },
            media: {
                mimeType,
                body: fs.createReadStream(uploadedFile.filepath),
            },
            fields: 'id, name, webViewLink, webContentLink',
        });

        // Clean up temporary file
        try { fs.unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }

        const driveFile = driveResponse.data;

        // Make the file viewable by anyone with the link
        await drive.permissions.create({
            fileId: driveFile.id!,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        // Fetch updated file metadata
        const updatedFile = await drive.files.get({
            fileId: driveFile.id!,
            fields: 'id, name, webViewLink, webContentLink',
        });

        console.log(`✅ Google Drive: "${originalName}" → folder "${studentName}" (${studentFolderId})`);

        return res.status(200).json({
            success: true,
            data: {
                fileId: updatedFile.data.id,
                fileName: updatedFile.data.name,
                fileUrl: updatedFile.data.webViewLink,
                downloadUrl: updatedFile.data.webContentLink,
                originalFilename: originalName,
                studentFolder: studentName,
                studentFolderId,
            },
        });
    } catch (error: any) {
        console.error('❌ Google Drive Upload Error:', error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Failed to upload file to Google Drive.',
        });
    }
}

export default handler;
