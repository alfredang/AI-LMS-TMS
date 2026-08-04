import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { searchEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

/**
 * POST /api/admin/da-live-ssg-recovery
 *
 * Perform live search for 'MANUAL' DA applications.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('🔄 [da-live-ssg-recovery] Fetching records marked as MANUAL...');
    const fetchRes = await pool.query(`
      SELECT id, application_id, trainee_name, trainee_id, course_run_id, course_reference_number, sponsorship_type 
      FROM da_application 
      WHERE enrolment_id = 'MANUAL'
      OR enrolment_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      LIMIT 200
    `);
    
    const records = fetchRes.rows;
    if (records.length === 0) {
      return res.status(200).json({ success: true, message: 'No records to process' });
    }

    console.log(`📊 Found ${records.length} records to search.`);
    const tp = await getTrainingPartnerIdentifiers();
    const results = {
      found: 0,
      notFound: 0,
      errors: 0,
      details: [] as any[]
    };

    for (const r of records) {
      try {
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
          console.log(`✅ FOUND [${r.application_id}]: ${searchRes.referenceNumber}`);
          await pool.query(`
            UPDATE da_application 
            SET 
              enrolment_id = $1, 
              enrolment_status = $2, 
              auto_enrol_status = 'enroled',
              updated_at = NOW() 
            WHERE id = $3
          `, [searchRes.referenceNumber, searchRes.enrolmentStatus || 'Confirmed', r.id]);
          
          results.found++;
          results.details.push({ id: r.application_id, status: 'found', ref: searchRes.referenceNumber });
        } else {
          results.notFound++;
          results.details.push({ id: r.application_id, status: 'not_found' });
        }
      } catch (err) {
        console.error(`❌ ERROR [${r.application_id}]:`, err.message);
        results.errors++;
        results.details.push({ id: r.application_id, status: 'error', error: err.message });
      }

      // 200ms delay to be safe
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return res.status(200).json({
      success: true,
      summary: results,
    });
  } catch (err) {
    console.error('❌ da-live-ssg-recovery error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
