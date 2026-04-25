import { SSGEnrolmentAPI } from './lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from './lib/ssg/services/credentials-service';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function search() {
  const credentialsService = getSSGCredentialsService();
  const credentials = await credentialsService.getSSGCredentials();
  
  if (!credentials) {
    console.error('No credentials found');
    return;
  }
  
  const api = new SSGEnrolmentAPI(credentials.ssgApiBaseUrl, credentials);
  
  const targets = [
    { nric: 'S7316775B', runId: '1074983', appId: 'CA-2604-000942' },
    { nric: 'T0473005J', runId: '1076667', appId: 'CA-2604-000952' },
    { nric: 'T0423010D', runId: '1078965', appId: 'CA-2604-000968' },
    { nric: 'S7501439B', runId: '1310926', appId: 'CA-2604-000976' },
    { nric: 'S6810341Z', runId: '1076774', appId: 'CA-2604-000983' }
  ];
  
  const results = [];
  
  for (const target of targets) {
    console.log(`Searching for ${target.appId} (${target.nric}) in run ${target.runId}...`);
    try {
      const resp = await api.searchEnrolment({
        enrolment: {
          trainee: { id: target.nric },
          course: { run: { id: target.runId } }
        }
      });
      
      if (resp.data && Array.isArray(resp.data) && resp.data.length > 0) {
        const enrolmentId = resp.data[0].enrolment.referenceNumber;
        console.log(`✅ Found: ${enrolmentId}`);
        results.push({ ...target, enrolmentId });
      } else {
        console.log(`❌ Not found in SSG (Status: ${resp.status}, Error: ${JSON.stringify(resp.error)})`);
      }
    } catch (e) {
      console.error(`❌ Error searching for ${target.appId}:`, e);
    }
  }
  
  console.log('Final Results:', JSON.stringify(results, null, 2));
}

search().catch(console.error);
