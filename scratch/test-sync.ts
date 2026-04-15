import { addDaLearnerToCalendar } from '../lib/google-calendar/da-calendar-sync';

// Must load environment variables manually for a standalone script if not using Next.js runtime
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    const res = await addDaLearnerToCalendar(
        'CAROLYNPANG96@GMAIL.COM',
        '553456d0-f2c6-4ed1-84f1-0f512e9c3543',
        'Running a Successful eCommerce Store with Shopify',
        '2026-04-25T16:00:00.000Z'
    );
    console.log(res);
}

run().catch(console.error);
