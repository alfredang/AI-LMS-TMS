import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { searchEnrolment } from '../lib/ssg/services/enrolment-service';

async function run() {
  try {
    const tp = { uen: '201200696W', code: '201200696W-01' };

    console.log(`Checking SSG for ${tp.uen} / ${tp.code}`);

    const payload1 = {
      enrolment: {
        course: { 
          referenceNumber: 'TGS-2021003160', 
          run: { id: "1077454" } 
        },
        trainee: {
          id: 'S9841127E',
          idType: { type: 'NRIC' },
          sponsorshipType: 'INDIVIDUAL'
        },
        trainingPartner: { uen: tp.uen, code: tp.code }
      },
      parameters: { page: 0, pageSize: 10 }
    };

    const res1 = await searchEnrolment(payload1);
    console.log("SSG Result for S9841127E:");
    console.log(JSON.stringify(res1, null, 2));

  } catch(e: any) { 
    console.error('Error:', e.message); 
  }
}
run();
