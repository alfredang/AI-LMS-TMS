require('dotenv').config({ path: '.env.local' });
const { searchEnrolment } = require('../lib/ssg/services/enrolment-service');
const pool = new (require("pg").Pool)({connectionString: process.env.DATABASE_URL});

async function run() {
  try {
    const tpRes = await pool.query('SELECT uen, tp_code as code FROM training_provider LIMIT 1');
    const tp = tpRes.rows[0];

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

  } catch(e) { 
    console.error('Error:', e.message); 
  } finally {
    pool.end();
  }
}
run();
