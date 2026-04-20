import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { searchEnrolment } from '../lib/ssg/services/enrolment-service';
import { getTrainingPartnerIdentifiers } from '../lib/trainingPartnerIdentifiers';

async function run() {
  try {
    const tp = await getTrainingPartnerIdentifiers();
    console.log(`Checking SSG for ${tp.uen}`);

    const payload1 = {
      enrolment: {
        course: { 
          referenceNumber: 'TGS-2020505444', 
          run: { id: "1043546" } 
        },
        trainee: {
          id: 'S8423277G',
          idType: { type: 'NRIC' },
          sponsorshipType: 'INDIVIDUAL'
        },
        trainingPartner: { uen: tp.uen, code: tp.code }
      },
      parameters: { page: 0, pageSize: 10 }
    };

    const res1 = await searchEnrolment(payload1);
    console.log("SSG Result for S8423277G:");
    console.log(JSON.stringify(res1, null, 2));

    const payload2 = {
      enrolment: {
        course: { 
          referenceNumber: 'TGS-2021010185', 
          run: { id: "1227925" } 
        },
        trainee: {
          id: 'S2641087H',
          idType: { type: 'NRIC' },
          sponsorshipType: 'INDIVIDUAL'
        },
        trainingPartner: { uen: tp.uen, code: tp.code }
      },
      parameters: { page: 0, pageSize: 10 }
    };
    const res2 = await searchEnrolment(payload2);
    console.log("\\nSSG Result for S2641087H:");
    console.log(JSON.stringify(res2, null, 2));

  } catch(e: any) { 
    console.error('Error:', e.message); 
  }
}
run();
