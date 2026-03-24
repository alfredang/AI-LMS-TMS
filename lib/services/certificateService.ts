import { Pool } from 'pg';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';

// --- Google Drive Helpers ---
function getDriveClient(): drive_v3.Drive {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Google OAuth credentials. Ensure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN are set.');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:9876');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
}

async function findSubfolder(drive: drive_v3.Drive, parentFolderId: string, folderName: string): Promise<string | null> {
    const safeName = folderName.replace(/'/g, "\\'");
    const response = await drive.files.list({
        // Fix for missing single-quotes around safeName inside the query string
        q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    const files = response.data.files;
    return (files && files.length > 0) ? files[0].id! : null;
}

/**
 * Generates a PDF certificate for an Enrollment and securely uploads it to Google Drive.
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

    // Note: We only generate certificates for strictly Competent/Passed students 
    if (data.assessment_status !== 'Competent' && data.assessment_status !== 'Passed') {
        throw new Error(`Student status is ${data.assessment_status}. Cannot generate certificate.`);
    }

    // 2. Format dates: (start date)-(end date) or (date) if same
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

    // 3. Load the PDF template
    const templatePath = path.join(process.cwd(), 'public', 'certificate_template', 'Certificate Template (n8n Automation) Blank.pdf');
    let templateBytes: Buffer;
    try {
        templateBytes = fs.readFileSync(templatePath);
    } catch (e) {
        throw new Error('PDF Certificate template not found. Please upload it to public/certificate_template/Certificate Template (n8n Automation) Blank.pdf');
    }

    const pdfDoc = await PDFDocument.load(templateBytes);
    const pages = pdfDoc.getPages();
    const page = pages[0]; // Assuming template is a 1-page PDF

    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // --- Student Name (Centered over the underline) ---
    const studentName = data.full_name;
    const nameFontSize = 32;
    const nameWidth = helveticaBold.widthOfTextAtSize(studentName, nameFontSize);
    // The block is approx 256 points wide starting at 18. Center is 18 + 256/2 = 146.
    const nameX = Math.max(18, 146 - (nameWidth / 2));
    
    page.drawText(studentName, {
        x: nameX,
        y: 442, // Shifted up (+10 from 432) to hover correctly over the line
        size: nameFontSize,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    // --- Course Name (Wrapped to max 2 lines, Left Aligned) ---
    const courseText = data.course_name;
    const maxCourseWidth = 330;
    let courseFontSize = 26;
    let lines: string[] = [];
    
    while (courseFontSize >= 12) {
        const words = courseText.split(' ');
        lines = [words[0] || ''];
        let lineIdx = 0;
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const currentWidth = helveticaBold.widthOfTextAtSize(lines[lineIdx] + ' ' + word, courseFontSize);
            if (currentWidth <= maxCourseWidth) {
                lines[lineIdx] += ' ' + word;
            } else {
                lineIdx++;
                lines[lineIdx] = word;
            }
        }
        if (lines.length <= 2) break; // fits in 2 lines!
        courseFontSize -= 2;
    }

    // Draw course lines
    const courseStartY = 350; // Shifted up (+5 from 345)
    const lineHeight = courseFontSize * 1.3;
    lines.forEach((line, index) => {
        page.drawText(line, {
            x: 22, // Moved right (+4 from 18)
            y: courseStartY - (index * lineHeight),
            size: courseFontSize,
            font: helveticaBold,
            color: rgb(0.043, 0.302, 0.533), // Exact #0b4d88
        });
    });

    // --- Course Dates ---
    page.drawText(dateString, {
        x: 102, // Moved right (+4 from 98)
        y: 290, // Shifted up (+2 from 288)
        size: 24,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    const pdfBytes = await pdfDoc.save();
    const fileName = `Certificate_${data.full_name.replace(/\\s+/g, '_')}_${data.course_name.replace(/\\s+/g, '_')}.pdf`;
    
    // 4. --- Google Drive Upload Pipeline ---
    const drive = getDriveClient();
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured.');

    // 4a. Locate specific Course Folder mathematically 
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

    // 4b. Firmly locate 'Certificates' subfolder (prevent duplicates)
    let certificatesFolderId = await findSubfolder(drive, courseFolderId, 'Certificates');
    if (!certificatesFolderId) {
        const createCertRes = await drive.files.create({
            requestBody: { name: 'Certificates', mimeType: 'application/vnd.google-apps.folder', parents: [courseFolderId] },
            fields: 'id',
        });
        certificatesFolderId = createCertRes.data.id!;
    }

    // 4c. Upload & intelligently overwrite PDF to avoid duplicated file bloat
    const safeFileName = fileName.replace(/'/g, "\\'");
    const existingFileRes = await drive.files.list({
        q: `'${certificatesFolderId}' in parents and name = '${safeFileName}' and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
    });

    let fileUrl = '';
    if (existingFileRes.data.files && existingFileRes.data.files.length > 0) {
        // Update identically named existing file cleanly
        const existingFileId = existingFileRes.data.files[0].id!;
        await drive.files.update({
            fileId: existingFileId,
            media: { mimeType: 'application/pdf', body: Readable.from(Buffer.from(pdfBytes)) },
        });
        fileUrl = `https://drive.google.com/file/d/${existingFileId}/view`;
    } else {
        // Upload directly as completely new file with public visibility
        const driveResponse = await drive.files.create({
            requestBody: { name: fileName, parents: [certificatesFolderId] },
            media: { mimeType: 'application/pdf', body: Readable.from(Buffer.from(pdfBytes)) },
            fields: 'id, webViewLink',
        });
        
        await drive.permissions.create({
            fileId: driveResponse.data.id!,
            requestBody: { role: 'reader', type: 'anyone' },
        });
        fileUrl = driveResponse.data.webViewLink!;
    }

    // 5. Save Drive link to DB natively
    await pool.query(`UPDATE enrollment SET certificate = $1 WHERE id = $2`, [fileUrl, enrolmentId]);

    return fileUrl;
}
