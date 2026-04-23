import { retryFailedCalendarSyncs } from '../lib/google-calendar/da-calendar-sync';
import pool from '../lib/db';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function runCleanup() {
  console.log('Running background calendar sync/cleanup sweep...');
  try {
    await retryFailedCalendarSyncs();
    console.log('Sweep complete.');
  } catch (err) {
    console.error('Sweep failed:', err);
  } finally {
    await pool.end();
  }
}

runCleanup();
