import { NextApiRequest, NextApiResponse } from 'next';
import { addDaLearnerToCalendar } from '../../../lib/google-calendar/da-calendar-sync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        const result = await addDaLearnerToCalendar(
            'CAROLYNPANG96@GMAIL.COM',
            '553456d0-f2c6-4ed1-84f1-0f512e9c3543',
            'Running a Successful eCommerce Store with Shopify',
            '2026-04-25T16:00:00.000Z'
        );
        res.status(200).json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
