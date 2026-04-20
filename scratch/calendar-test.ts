import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { runAutomation } from '../pages/api/external/auto-add-today-enrolments-to-calendar';

async function run() {
  try {
    const res = await runAutomation();
    console.log(res);
  } catch(e: any) {
    console.error('Error:', e.message);
  }
}
run();
