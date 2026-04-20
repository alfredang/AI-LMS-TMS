require('dotenv').config({ path: '.env.local' });
const { searchEnrolment } = require('../lib/ssg/services/enrolment-service');
const pool = new (require("pg").Pool)({connectionString: process.env.DATABASE_URL});

async function run() {
  try {
    const tpRes = await pool.query('SELECT uen, tp_code FROM training_provider LIMIT 1');
    const tp = { uen: tpRes.rows[0].uen, code: tpRes.rows[0].tp_code };

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

  } catch(e) { 
    console.error('Error:', e.message); 
  } finally {
    pool.end();
  }
}
run();
