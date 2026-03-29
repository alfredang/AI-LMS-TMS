import { Pool } from 'pg';
import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';

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

// --- Google Drive Helpers ---
function createDriveClient(clientId: string, clientSecret: string, refreshToken: string): drive_v3.Drive {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
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

// --- Fetch training provider settings from DB ---
async function getTrainingProviderSettings(pool: Pool, enrolmentId: string) {
    // Get training provider via enrollment -> course -> training provider
    const result = await pool.query(`
        SELECT
            tp.google_client_id,
            tp.google_client_secret,
            tp.google_refresh_token,
            tp.google_slides_template_id,
            tp.certificate_folder_url,
            tp.certificate_template_url
        FROM enrollment e
        JOIN course c ON e.course_id = c.id
        JOIN training_provider tp ON c.training_provider_id = tp.id
        WHERE e.id = $1
    `, [enrolmentId]);

    if (result.rows.length === 0) {
        // Fallback: try via course_run
        const fallback = await pool.query(`
            SELECT
                tp.google_client_id,
                tp.google_client_secret,
                tp.google_refresh_token,
                tp.google_slides_template_id,
                tp.certificate_folder_url,
                tp.certificate_template_url
            FROM enrollment e
            JOIN course_run cr ON e.course_run_id = cr.id
            JOIN course c ON cr.course_id = c.id
            JOIN training_provider tp ON c.training_provider_id = tp.id
            WHERE e.id = $1
        `, [enrolmentId]);
        if (fallback.rows.length === 0) {
            // Last fallback: get the first training provider
            const lastFallback = await pool.query(`
                SELECT
                    google_client_id,
                    google_client_secret,
                    google_refresh_token,
                    google_slides_template_id,
                    certificate_folder_url,
                    certificate_template_url
                FROM training_provider
                LIMIT 1
            `);
            if (lastFallback.rows.length === 0) {
                throw new Error('No training provider found');
            }
            return lastFallback.rows[0];
        }
        return fallback.rows[0];
    }
    return result.rows[0];
}

/**
 * Generates a PDF certificate for an Enrollment and securely uploads it to Google Drive.
 * Uses Google Slides template from Company Settings and stores in the configured certificate folder.
 * @param enrolmentId The UUID of the specific enrollment
 * @param pool Database connection pool
 * @returns The webViewLink (URL) of the uploaded PDF
 */
export async function generateAndUploadCertificate(enrolmentId: string, pool: Pool): Promise<string> {
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

    if (data.assessment_status !== 'Competent' && data.assessment_status !== 'Passed') {
        throw new Error(`Student status is ${data.assessment_status}. Cannot generate certificate.`);
    }

    // 2. Get training provider settings from DB
    const tpSettings = await getTrainingProviderSettings(pool, enrolmentId);

    const clientId = tpSettings.google_client_id;
    const clientSecret = tpSettings.google_client_secret;
    const refreshToken = tpSettings.google_refresh_token;
    const slidesTemplateId = tpSettings.google_slides_template_id || tpSettings.certificate_template_url;
    const certificateFolderUrl = tpSettings.certificate_folder_url;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Google OAuth credentials are not configured in Company Settings. Please set Google Client ID, Client Secret, and Refresh Token under Google Integration.');
    }
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
    const drive = createDriveClient(clientId, clientSecret, refreshToken);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const slides = google.slides({ version: 'v1', auth: oauth2Client });

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
                    { replaceAllText: { containsText: { text: '[Student Name]', matchCase: true }, replaceText: data.full_name } },
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
        const fileName = `Certificate_${data.full_name.replace(/\s+/g, '_')}_${data.course_name.replace(/\s+/g, '_')}.pdf`;

        // 5a. Locate course folder
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
                q: `'${rootFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, name)',
                spaces: 'drive',
            });
            if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
                courseFolderId = tgsResponse.data.files[0].id!;
            }
        } else {
            courseFolderId = await findSubfolder(drive, rootFolderId, expectedCourseFolderName);
        }

        if (!courseFolderId) {
            const createRes = await drive.files.create({
                requestBody: { name: expectedCourseFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [rootFolderId] },
                fields: 'id',
            });
            courseFolderId = createRes.data.id!;
        }

        // 5b. Locate 'Certificates' subfolder
        let certificatesFolderId = await findSubfolder(drive, courseFolderId, 'Certificates');
        if (!certificatesFolderId) {
            const createCertRes = await drive.files.create({
                requestBody: { name: 'Certificates', mimeType: 'application/vnd.google-apps.folder', parents: [courseFolderId] },
                fields: 'id',
            });
            certificatesFolderId = createCertRes.data.id!;
        }

        // 5c. Upload & overwrite existing PDF
        const safeFileName = fileName.replace(/'/g, "\\'");
        const existingFileRes = await drive.files.list({
            q: `'${certificatesFolderId}' in parents and name = '${safeFileName}' and trashed = false`,
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
                requestBody: { name: fileName, parents: [certificatesFolderId] },
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
    } catch (err) {
        // Clean up temp file if it exists
        if (tempFileId) {
            try {
                await drive.files.delete({ fileId: tempFileId });
            } catch {}
        }
        throw err;
    }
}
