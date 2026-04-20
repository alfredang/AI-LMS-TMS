require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM da_application 
       WHERE (enrolment_status = 'Confirmed' OR application_status = 'Confirmed')
         AND enrolment_id IS NULL 
         AND trainee_email IS NOT NULL`
    );

    console.log(`Found ${rows.length} unenrolled Confirmed DA applications.`);

    let count = 0;
    for (const record of rows) {
      console.log(`Processing DA: ${record.application_id} (${record.trainee_email})`);
      const success = await createNativeEnrolmentFromDA(record, pool);
      if (success) {
        count++;
        console.log(`✅ Success for ${record.application_id}`);
      } else {
        console.log(`❌ Failed for ${record.application_id}`);
      }
    }

    console.log(`\\nCompleted processing. Successfully enrolled ${count}/${rows.length} applications.`);
  } catch (err) {
    console.error('Fatal Error:', err);
  } finally {
    pool.end();
  }
}

async function createNativeEnrolmentFromDA(record, dbPool) {
  if (!record.course_run_id || !record.trainee_id || !record.trainee_email) return null;
  try {
    const runRes = await dbPool.query(
      `SELECT id as internal_id, course_id FROM course_run 
       WHERE (id::text = $1 OR course_run_id = $1) AND is_deleted IS NOT TRUE LIMIT 1`,
      [record.course_run_id]
    );

    const internalRunId = runRes.rows[0]?.internal_id;
    const courseId = runRes.rows[0]?.course_id;
    if (!courseId || !internalRunId) {
      console.warn(`⚠️ [DA] Could not find course_run for ID: ${record.course_run_id}`);
      return null;
    }

    const existingUser = await dbPool.query(
      `SELECT id FROM app_user WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1) LIMIT 1`,
      [record.trainee_email]
    );

    let userId = existingUser.rows[0]?.id;

    if (!userId) {
      const newUser = await dbPool.query(
        `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '', 'active', NOW(), NOW())
         RETURNING id`,
        [record.trainee_email.toLowerCase(), record.trainee_name || '']
      );
      userId = newUser.rows[0].id;

      await dbPool.query(`INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`, [userId]);
      await dbPool.query(`INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, record.trainee_id, record.trainee_phone || '']
      );
    }

    const { rows } = await dbPool.query(
      `INSERT INTO enrollment (
          id, user_id, course_id, course_run_id, progress_percent, payment_status, 
          assessment_status, enrolment_status, enrolment_date, email, nric, created_at, updated_at
       )
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', 'Confirmed', CURRENT_DATE, $4, $5, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [userId, courseId, internalRunId, record.trainee_email, record.trainee_id]
    );

    const enrolmentId = rows[0]?.id;

    if (record.application_id) {
      await dbPool.query(
        `UPDATE da_application 
         SET enrolment_status = 'Confirmed',
             enrolment_id = $1
         WHERE application_id = $2 AND enrolment_id IS NULL`,
        [enrolmentId || null, record.application_id]
      );
    }

    return enrolmentId || true;
  } catch (err) {
    console.error(`❌ createNativeEnrolmentFromDA failed:`, err);
    return null;
  }
}

run();
