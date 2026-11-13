import { AuthedApiRequest, withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { generateAndUploadCertificate } from '../../../lib/services/certificateService';
import { checkCertificateIssuance } from '../../../lib/services/certificateIssuance';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { enrolmentId } = req.body;

    if (!enrolmentId || typeof enrolmentId !== 'string') {
        return res.status(400).json({ message: 'enrolmentId is required' });
    }

    try {
        const authUser = (req as AuthedApiRequest).authUser!;
        const privileged = authUser.isService || ['admin', 'trainingProvider', 'trainer', 'developer']
            .some(role => authUser.roles.has(role));
        if (!privileged) {
            const owned = await pool.query(
                `SELECT 1 FROM enrollment WHERE id = $1 AND user_id = $2 LIMIT 1`,
                [enrolmentId, authUser.id]
            );
            if (owned.rowCount === 0) {
                return res.status(403).json({ success: false, message: 'You may only generate your own certificate.' });
            }
        }

        // Guard: this is the learner-facing, self-service path. A certificate may
        // only be minted once the class has actually ended (or the trainer marked
        // the learner Competent) AND the minimum attendance is met — otherwise a
        // learner could download a certificate on the morning of their class.
        // Also covers cancelled classes / cancelled enrolments.
        const decision = await checkCertificateIssuance(enrolmentId);
        if (!decision.allowed) {
            return res.status(409).json({
                success: false,
                message: decision.reason,
                code: decision.code,
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

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'trainer', 'developer', 'learner'] });
