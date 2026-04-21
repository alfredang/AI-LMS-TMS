import { Client } from 'pg';
import { searchEnrolment } from '../lib/ssg/services/enrolment-service';
import { getTrainingPartnerIdentifiers } from '../lib/trainingPartnerIdentifiers';

const connectionString = 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable';

async function recover() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('🔄 Fetching records marked as MANUAL...');
    const res = await client.query(`
      SELECT id, application_id, trainee_name, trainee_id, course_run_id, course_reference_number, sponsorship_type 
      FROM da_application 
      WHERE enrolment_id = 'MANUAL'
    `);
    const records = res.rows;
    console.log(`📊 Found ${records.length} records to search.`);

    if (records.length === 0) {
      console.log('✅ No records to process.');
      return;
    }

    const tp = await getTrainingPartnerIdentifiers();
    let foundCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    for (const r of records) {
      console.log(`🔍 [${r.application_id}] Searching for ${r.trainee_name} (${r.trainee_id})...`);
      
      try {
        // Map sponsorship type
        let sponsorshipType = 'INDIVIDUAL';
        if ((r.sponsorship_type || '').toUpperCase().includes('EMPLOYER')) sponsorshipType = 'EMPLOYER';

        const searchRes = await searchEnrolment({
          enrolment: {
            course: { run: { id: String(r.course_run_id) }, referenceNumber: r.course_reference_number },
            trainee: { id: r.trainee_id, idType: { type: 'NRIC' }, sponsorshipType },
            trainingPartner: { uen: tp.uen, code: tp.code }
          },
          parameters: { page: 0, pageSize: 1 }
        });

        if (searchRes.success && searchRes.referenceNumber) {
          console.log(`   ✅ FOUND: ${searchRes.referenceNumber}`);
          await client.query(`
            UPDATE da_application 
            SET 
              enrolment_id = $1, 
              enrolment_status = $2, 
              auto_enrol_status = 'enroled',
              updated_at = NOW() 
            WHERE id = $3
          `, [searchRes.referenceNumber, searchRes.enrolmentStatus || 'Confirmed', r.id]);
          foundCount++;
        } else {
          console.log(`   ❌ NOT FOUND (${searchRes.status})`);
          notFoundCount++;
        }
      } catch (err) {
        console.error(`   ❌ ERROR: ${err.message}`);
        errorCount++;
      }

      // Small delay to respect rate limits (e.g., 200ms)
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n✨ Recovery Complete ✨');
    console.log(`✅ IDs Recovered: ${foundCount}`);
    console.log(`❌ Not Found:    ${notFoundCount}`);
    console.log(`⚠️  Errors:       ${errorCount}`);
    console.log(`📈 Success Rate: ${((foundCount / records.length) * 100).toFixed(1)}%`);

  } catch (err) {
    console.error('❌ Recovery process failed:', err);
  } finally {
    await client.end();
  }
}

recover();
