import { searchEnrolment } from './lib/ssg/services/enrolment-service';
import { getTrainingPartnerIdentifiers } from './lib/trainingPartnerIdentifiers';

const records = [
  { nric: 'S2641087H', runId: '1227925', code: 'TGS-2021010185' },
  { nric: 'S8080530F', runId: '1227471', code: 'TGS-2023039183' },
  { nric: 'S7320346E', runId: '1252841', code: 'TGS-2022015227' },
  { nric: 'S9139567C', runId: '1043546', code: 'TGS-2020505444' },
  { nric: 'T0010568B', runId: '1068286', code: 'TGS-2020505444' }
];

async function run() {
  const tp = await getTrainingPartnerIdentifiers();
  
  for (const r of records) {
    console.log(`🔍 Searching for ${r.nric} in run ${r.runId}...`);
    try {
      const res = await searchEnrolment({
        enrolment: {
          course: { run: { id: r.runId }, referenceNumber: r.code },
          trainee: { id: r.nric, idType: { type: 'NRIC' }, sponsorshipType: 'INDIVIDUAL' },
          trainingPartner: { uen: tp.uen, code: tp.code }
        },
        parameters: { page: 0, pageSize: 1 }
      });
      
      if (res.success && res.referenceNumber) {
        console.log(`✅ FOUND: ${r.nric} -> ${res.referenceNumber}`);
      } else {
        console.log(`❌ NOT FOUND: ${r.nric} (${res.status})`);
      }
    } catch (err) {
      console.error(`❌ ERROR searching for ${r.nric}:`, err.message);
    }
  }
}

run();
