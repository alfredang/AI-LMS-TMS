import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { enrolmentId } = req.body;

    if (!enrolmentId || typeof enrolmentId !== 'string') {
        return res.status(400).json({ message: 'enrolmentId is required' });
    }

    try {
        // Fetch the enrollment to ensure they are competent
        const enrollQuery = `
            SELECT 
                e.id as enrolment_id,
                e.assessment_status,
                u.full_name,
                c.title as course_name,
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
            return res.status(404).json({ message: 'Enrollment not found.' });
        }

        const data = enrollRes.rows[0];

        if (data.assessment_status !== 'Competent' && data.assessment_status !== 'Passed') {
            return res.status(403).json({ message: 'Student is not marked as competent. Cannot generate certificate.' });
        }

        // Format dates: (start date)-(end date) or (date) if same
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

        // Load the PDF template
        const templatePath = path.join(process.cwd(), 'public', 'certificate_template', 'Certificate Template (n8n Automation) Blank.pdf');
        let templateBytes: Buffer;
        try {
            templateBytes = fs.readFileSync(templatePath);
        } catch (e) {
            return res.status(500).json({ 
                message: 'PDF Certificate template not found. Please upload it to public/certificate_template/' 
            });
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
        
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'certificates');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const physicalPath = path.join(uploadDir, fileName);
        fs.writeFileSync(physicalPath, pdfBytes);
        const fileUrl = `/uploads/certificates/${fileName}`;

        // Save DB ref
        await pool.query(
            `UPDATE enrollment SET certificate = $1 WHERE id = $2`,
            [fileUrl, enrolmentId]
        );

        // Stream PDF Directly back as download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        
        return res.status(200).send(Buffer.from(pdfBytes));

    } catch (error: any) {
        console.error('Error generating certificate:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
