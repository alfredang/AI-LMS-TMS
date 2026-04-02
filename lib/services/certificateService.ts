import { Pool } from 'pg';
import { Readable } from 'stream';
import { google, drive_v3, slides_v1 } from 'googleapis';
import { getGoogleDriveClient, getGoogleSlidesClient, getGoogleCredentials } from '../google-auth/googleAuth';

// --- Helper to extract folder ID from Google Drive URL or raw ID ---
function extractFolderId(input: string): string {
    // Handle: https://drive.google.com/drive/folders/{id}?...
    const folderMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];
    // Handle: https://drive.google.com/drive/u/0/folders/{id}
    const folderMatch2 = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch2) return folderMatch2[1];
    // Assume raw folder ID
    return input.trim();
}

async function findSubfolder(drive: drive_v3.Drive, parentFolderId: string, folderName: string): Promise<string | null> {
    const safeName = folderName.replace(/'/g, "\\'");
    const response = await drive.files.list({
        q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    const files = response.data.files;
    return (files && files.length > 0) ? files[0].id! : null;
}


/**
 * Generates a PDF certificate for an Enrollment and securely uploads it to Google Drive.
 * Uses Google Slides template from Company Settings and stores in the configured certificate folder.
 * @param enrolmentId The UUID of the specific enrollment
 * @param pool Database connection pool
 * @returns The webViewLink (URL) of the uploaded PDF
 */
export async function generateAndUploadCertificate(enrolmentId: string, pool: Pool, overrideLearnerName?: string): Promise<string> {
    // 1. Fetch the enrollment details
    const enrollQuery = `
        SELECT
            e.id as enrolment_id,
            e.assessment_status,
            u.full_name,
            c.title as course_name,
            c.course_code,
            cr.start_date,
            cr.end_date
        FROM enrollment e
        JOIN app_user u ON e.user_id = u.id
        JOIN course c ON e.course_id = c.id
        JOIN course_run cr ON e.course_run_id = cr.id
        WHERE e.id = $1
    `;
    const enrollRes = await pool.query(enrollQuery, [enrolmentId]);

    if (enrollRes.rowCount === 0) {
        throw new Error('Enrollment not found.');
    }

    const data = enrollRes.rows[0];
    const learnerName = overrideLearnerName || data.full_name;

    // 2. Get training provider settings from DB and initialize Google clients
    const drive = await getGoogleDriveClient(pool);
    const slides = await getGoogleSlidesClient(pool);
    
    // Fetch individual settings for folder/template URLs
    const settingsRes = await pool.query(`
        SELECT 
            google_slides_template_id,
            certificate_folder_url,
            certificate_template_url
        FROM training_provider
        LIMIT 1
    `);
    const tpSettings = settingsRes.rows[0];

    const slidesTemplateId = tpSettings.google_slides_template_id || tpSettings.certificate_template_url;
    const certificateFolderUrl = tpSettings.certificate_folder_url;

    if (!slidesTemplateId) {
        throw new Error('Certificate Template ID is not configured in Company Settings. Please set it under Document Templates.');
    }
    if (!certificateFolderUrl) {
        throw new Error('Certificate Folder URL is not configured in Company Settings. Please set it under Google Integration.');
    }

    // 3. Format dates
    const sDate = new Date(data.start_date);
    const eDate = new Date(data.end_date);
    let dateString = '';
    const formatOptions: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };

    if (!data.start_date && !data.end_date) {
        dateString = 'N/A';
    } else if (data.start_date && data.end_date && sDate.getTime() !== eDate.getTime()) {
        dateString = `${sDate.toLocaleDateString('en-SG', formatOptions)} - ${eDate.toLocaleDateString('en-SG', formatOptions)}`;
    } else {
        const dateToUse = data.start_date || data.end_date;
        dateString = new Date(dateToUse).toLocaleDateString('en-SG', formatOptions);
    }

    // 4. Generate PDF from Google Slides template

    let tempFileId: string | null = null;

    try {
        // 4a. Copy the Google Slides template
        const copyResponse = await drive.files.copy({
            fileId: slidesTemplateId,
            requestBody: { name: `Certificate - ${data.full_name}` },
        });
        tempFileId = copyResponse.data.id!;

        // 4b. Replace placeholders
        await slides.presentations.batchUpdate({
            presentationId: tempFileId,
            requestBody: {
                requests: [
                    { replaceAllText: { containsText: { text: '[Student Name]', matchCase: true }, replaceText: learnerName } },
                    { replaceAllText: { containsText: { text: '[Course Name]', matchCase: true }, replaceText: data.course_name } },
                    { replaceAllText: { containsText: { text: '[Course Dates]', matchCase: true }, replaceText: dateString } },
                ],
            },
        });

        // 4c. Export as PDF
        const pdfResponse = await drive.files.export(
            { fileId: tempFileId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdfResponse.data as ArrayBuffer);

        // 4d. Delete the temp Slides copy
        await drive.files.delete({ fileId: tempFileId });
        tempFileId = null;

        // 5. Upload PDF to Google Drive certificate folder
        const rootFolderId = extractFolderId(certificateFolderUrl);
        const fileName = `Certificate_${learnerName.replace(/\s+/g, '_')}_${data.course_name.replace(/\s+/g, '_')}.pdf`;

        // 5a. Locate 'Certificates' subfolder inside the root
        let certificatesFolderId = await findSubfolder(drive, rootFolderId, 'Certificates');
        if (!certificatesFolderId) {
            const createCertRes = await drive.files.create({
                requestBody: { name: 'Certificates', mimeType: 'application/vnd.google-apps.folder', parents: [rootFolderId] },
                fields: 'id',
            });
            certificatesFolderId = createCertRes.data.id!;
        }

        // 5b. Locate course folder inside 'Certificates'
        let courseFolderId = null;
        let tgsRef = data.course_code;
        if (!tgsRef) {
            const tgsMatch = data.course_name.match(/(TGS-\d+)/);
            if (tgsMatch) tgsRef = tgsMatch[1];
        }

        const expectedCourseFolderName = tgsRef && data.course_name && !data.course_name.includes(tgsRef)
            ? `${tgsRef} ${data.course_name}`.trim()
            : (`${data.course_code || ''} ${data.course_name}`).trim() || 'Unknown Course';

        if (tgsRef) {
            const safeTgsRef = tgsRef.replace(/'/g, "\\'");
            const tgsResponse = await drive.files.list({
                q: `'${certificatesFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, name)',
                spaces: 'drive',
            });
            if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
                courseFolderId = tgsResponse.data.files[0].id!;
            }
        } else {
            courseFolderId = await findSubfolder(drive, certificatesFolderId, expectedCourseFolderName);
        }

        if (!courseFolderId) {
            const createRes = await drive.files.create({
                requestBody: { name: expectedCourseFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [certificatesFolderId] },
                fields: 'id',
            });
            courseFolderId = createRes.data.id!;
        }

        // 5c. Upload & overwrite existing PDF
        const safeFileName = fileName.replace(/'/g, "\\'");
        const existingFileRes = await drive.files.list({
            q: `'${courseFolderId}' in parents and name = '${safeFileName}' and trashed = false`,
            fields: 'files(id)',
            spaces: 'drive',
        });

        let fileUrl = '';
        if (existingFileRes.data.files && existingFileRes.data.files.length > 0) {
            const existingFileId = existingFileRes.data.files[0].id!;
            await drive.files.update({
                fileId: existingFileId,
                media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
            });
            fileUrl = `https://drive.google.com/file/d/${existingFileId}/view`;
        } else {
            const driveResponse = await drive.files.create({
                requestBody: { name: fileName, parents: [courseFolderId] },
                media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
                fields: 'id, webViewLink',
            });

            await drive.permissions.create({
                fileId: driveResponse.data.id!,
                requestBody: { role: 'reader', type: 'anyone' },
            });
            fileUrl = driveResponse.data.webViewLink!;
        }

        // 6. Save Drive link to DB
        await pool.query(`UPDATE enrollment SET certificate = $1 WHERE id = $2`, [fileUrl, enrolmentId]);

        return fileUrl;
    } catch (err: any) {
        // Handle specific Google OAuth errors with helpful guidance
        const msg = err.message || '';
        const isUnauthorized = err.code === 401 || err.status === 401 || msg.includes('unauthorized_client');
        const isInsufficientScopes = err.code === 403 || err.status === 403 || msg.includes('insufficient authentication scopes');

        if (isUnauthorized) {
            throw new Error(
                'Google OAuth Error: unauthorized_client (401). ' +
                'This usually means the Client ID or Client Secret in Company Settings does not match the ones used to generate the Refresh Token. ' +
                'Please ensure your Client ID and Client Secret in Settings match your Google Cloud Console (and .env.local) exactly.'
            );
        }

        if (isInsufficientScopes) {
            throw new Error(
                'Google OAuth Error: Request had insufficient authentication scopes (403). ' +
                'Please re-authorize your account in Company Settings > Integrations > Google and ensure you have included ' + 
                'BOTH "https://www.googleapis.com/auth/drive" and "https://www.googleapis.com/auth/presentations" scopes.'
            );
        }

        // Clean up temp file if it exists
        if (tempFileId) {
            try {
                await drive.files.delete({ fileId: tempFileId });
            } catch (cleanupErr) {
                console.warn('Failed to clean up temporary Google Slide copy:', cleanupErr);
            }
        }
        throw err;
    }
}

/**
 * Deletes a previously generated certificate from Google Drive.
 * Expected to be called when a learner is downgraded from 'Competent'.
 * @param certificateUrl The URL or file ID of the certificate to delete
 * @param pool Database connection pool
 */
export async function deleteCertificate(certificateUrl: string, pool: Pool) {
    if (!certificateUrl) return;

    // Extract fileId from the URL
    const match = certificateUrl.match(/\/file\/d\/([^/]+)/) || certificateUrl.match(/[?&]id=([^&]+)/);
    const fileId = match ? match[1] : certificateUrl.trim();

    try {
        const drive = await getGoogleDriveClient(pool);
        
        await drive.files.delete({ fileId });
        console.log(`Deleted certificate ${fileId} from Google Drive.`);
    } catch (error: any) {
        // Ignore 404s (already deleted or not found)
        if (error.code !== 404) {
            console.error(`Failed to delete Google Drive certificate ${fileId}:`, error);
        }
    }
}
