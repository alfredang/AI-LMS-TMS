const { Client } = require('pg');
const crypto = require('crypto');
const http = require('https');

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

    // Load SSG Credentials
    const credRes = await client.query(`SELECT * FROM training_provider LIMIT 1`);
    const creds = credRes.rows[0];
    if (!creds || !creds.ssg_encryption_key) {
      throw new Error('SSG credentials not found in training_provider table');
    }

    const encKey = Buffer.from(creds.ssg_encryption_key, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const uen = creds.uen;
    const tpCode = creds.tp_code;
    const ssgBaseUrl = creds.ssg_api_url || 'https://api.ssg-wsg.sg';
    const cert = creds.ssg_certificate_content;
    const key = creds.ssg_private_key_content;

    let foundCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    for (const r of records) {
      console.log(`🔍 [${r.application_id}] Searching for ${r.trainee_name} (${r.trainee_id})...`);
      
      try {
        let sponsorshipType = 'INDIVIDUAL';
        if ((r.sponsorship_type || '').toUpperCase().includes('EMPLOYER')) sponsorshipType = 'EMPLOYER';

        const payload = {
          enrolment: {
            course: { run: { id: String(r.course_run_id) }, referenceNumber: r.course_reference_number },
            trainee: { id: r.trainee_id, idType: { type: 'NRIC' }, sponsorshipType },
            trainingPartner: { uen, code: tpCode }
          },
          parameters: { page: 0, pageSize: 1 }
        };

        const searchRes = await ssgEncryptedPost(ssgBaseUrl, '/tpg/enrolments/search', payload, encKey, iv, cert, key);

        if (searchRes && searchRes.data && (searchRes.data.enrolment || (Array.isArray(searchRes.data) && searchRes.data[0]))) {
          const enrolmentData = searchRes.data.enrolment || searchRes.data[0].enrolment;
          const refNo = enrolmentData.referenceNumber;
          const status = enrolmentData.status || 'Confirmed';

          console.log(`   ✅ FOUND: ${refNo} (${status})`);
          await client.query(`
            UPDATE da_application 
            SET 
              enrolment_id = $1, 
              enrolment_status = $2, 
              auto_enrol_status = 'enroled',
              updated_at = NOW() 
            WHERE id = $3
          `, [refNo, status, r.id]);
          foundCount++;
        } else {
          console.log(`   ❌ NOT FOUND`);
          notFoundCount++;
        }
      } catch (err) {
        console.error(`   ❌ ERROR: ${err.message}`);
        errorCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 300)); // Rate limit safety
    }

    console.log('\n✨ Recovery Complete ✨');
    console.log(`✅ IDs Recovered: ${foundCount}`);
    console.log(`❌ Not Found:    ${notFoundCount}`);
    console.log(`⚠️  Errors:       ${errorCount}`);

  } catch (err) {
    console.error('❌ Recovery process failed:', err);
  } finally {
    await client.end();
  }
}

async function ssgEncryptedPost(baseUrl, path, payload, encKey, iv, cert, key) {
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const url = new URL(path, baseUrl);
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    cert: cert,
    key: key,
    rejectUnauthorized: false // Often needed for dev/proxy environments
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve({ status: 404 });
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        
        try {
          const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
          let decrypted = decipher.update(data, 'base64', 'utf8');
          decrypted += decipher.final('utf8');
          resolve(JSON.parse(decrypted));
        } catch (e) {
          reject(new Error(`Decrypt failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(encrypted);
    req.end();
  });
}

recover();
