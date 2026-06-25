import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { generateAndUploadCertificate } from '../../../lib/services/certificateService';
import { checkCertificateEligibility } from '../../../lib/services/enrolmentEligibility';

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
        // Guard: a cancelled class or cancelled/withdrawn enrolment must not
        // produce a certificate.
        const eligibility = await checkCertificateEligibility(enrolmentId);
        if (!eligibility.eligible) {
            return res.status(409).json({
                success: false,
                message: `Certificate unavailable because ${eligibility.reason}.`,
                blockedByEligibility: true,
            });
        }

        const fileUrl = await generateAndUploadCertificate(enrolmentId, pool);
        return res.status(200).json({ success: true, message: 'Certificate generated successfully', fileUrl });
    } catch (error: any) {
        console.error('Error generating certificate:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
