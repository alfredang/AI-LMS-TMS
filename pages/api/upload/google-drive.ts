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
        // The bulletproof method: decode from Base64
        console.log('🔐 Using Base64 encoded Google Service Account Private Key');
        formattedPrivateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');
    } else if (privateKey) {
        // EXTREMELY ROBUST KEY PARSING FOR CLOUD HOSTING
        // Some providers (like Coolify, Vercel, Docker) inject multi-line secrets in weird ways.
        // This handles literal "\n" strings, actual newlines, and accidental wrapping quotes.
        formattedPrivateKey = privateKey
            .replace(/^"|"$/g, '') // Strip wrapping double quotes
            .replace(/^'|'$/g, '') // Strip wrapping single quotes
            .split(String.raw`\n`).join('\n') // Convert literal "\n" escape sequences to true newlines
            .replace(/\\n/g, '\n'); // Convert any standard escaped newlines
    }

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
        supportsAllDrives: true,
    });
    
    // Auto-transfer ownership to main account so we don't hit the 0-byte Service Account quota
    await transferOwnership(drive, response.data.id!);
    
    return response.data.id!;
}

/**
 * Transfer ownership of a file to the main tertiary account to avoid Service Account quota limits
 */
async function transferOwnership(drive: drive_v3.Drive, fileId: string) {
    try {
        await drive.permissions.create({
            fileId: fileId,
            transferOwnership: true,
            requestBody: {
                role: 'owner',
                type: 'user',
                emailAddress: 'agenticai.tertiaryrobotics@gmail.com'
            },
        });
    } catch (err) {
        console.warn(`⚠️ Could not transfer ownership for ${fileId} - it may fail if it exceeds quota`, err);
    }
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

/**
 * Robust hierarchy builder: Ensures Course Folder -> 'Assessment Records' -> Learner Folder exists
 */
async function ensureStudentUploadPath(
    drive: drive_v3.Drive,
    rootFolderId: string,
    courseCode: string,
    courseName: string,
    studentIdentifier: string
): Promise<string> {
    // 1. Course Folder (Search by TGS Ref, create if missing)
    let courseFolderId = null;
    let tgsRef = courseCode;
    if (!tgsRef) {
        const tgsMatch = courseName.match(/(TGS-\d+)/);
        if (tgsMatch) {
            tgsRef = tgsMatch[1];
        }
    }

    const expectedCourseFolderName = tgsRef && courseName && !courseName.includes(tgsRef)
        ? `${tgsRef} ${courseName}`.trim()
        : (`${courseCode} ${courseName}`).trim() || 'Unknown Course';

    if (tgsRef) {
        // Search by TGS Ref (most reliable)
        const safeTgsRef = tgsRef.replace(/'/g, "\\'");
        const tgsResponse = await drive.files.list({
            q: `'${rootFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
            courseFolderId = tgsResponse.data.files[0].id!;
        }
    } else {
        // Search by exact name
        courseFolderId = await findSubfolder(drive, rootFolderId, expectedCourseFolderName);
    }

    if (!courseFolderId) {
        // Auto-create Course folder if completely missing
        courseFolderId = await createSubfolder(drive, rootFolderId, expectedCourseFolderName);
        console.log(`📁 Created new Course folder: ${expectedCourseFolderName}`);
    }

    // 2. Assessment Records Subfolder
    let assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
    if (!assessmentRecordsId) {
        assessmentRecordsId = await createSubfolder(drive, courseFolderId, 'Assessment Records');
        console.log(`📁 Created 'Assessment Records' inside Course folder`);
    }

    // 3. Learner Date Subfolder
    const studentFolderId = await getOrCreateStudentFolder(drive, assessmentRecordsId, studentIdentifier);
    return studentFolderId;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method === 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed. Use POST for file uploads.' });
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

        // Build Learner Identifier (e.g., "16-03-2026 John Doe")
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const dateStr = `${dd}-${mm}-${yyyy}`;
        const studentIdentifier = `${dateStr} ${studentName}`;

        // 1 & 2 & 3. Ensure the full path exists (Course -> Assessment Records -> Learner Name)
        const studentFolderId = await ensureStudentUploadPath(
            drive, 
            parentFolderId, 
            courseCode, 
            courseName, 
            studentIdentifier
        );

        // 4. Upload file into the student's subfolder
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
            supportsAllDrives: true,
        });

        // Clean up temporary file
        try { fs.unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }

        const driveFile = driveResponse.data;

        // 5. Instantly transfer ownership of the specific File to the main account
        await transferOwnership(drive, driveFile.id!);

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
