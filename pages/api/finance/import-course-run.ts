import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { refreshGrantsForEnrolments } from '../../../lib/services/billingSync';
import { tryEnqueueInvoiceFromSsgRecord } from '../../../lib/services/invoiceJobs';
import { resolveCourseIdByCode } from '../../../lib/courseCode';

const ENROL_PAGE_SIZE = 100;

async function fetchAllEnrolmentsForRun(
  api: ReturnType<typeof createSSGEnrolmentAPI>,
  tpUen: string,
  tpCode: string,
  runId: string
): Promise<any[]> {
  const all: any[] = [];
  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    const result = await api.searchEnrolment({
      parameters: { page: pageIndex, pageSize: ENROL_PAGE_SIZE },
      enrolment: {
        course: { run: { id: runId } },
        trainingPartner: { uen: tpUen, code: tpCode },
      },
    } as any);
    if (result.error) {
      const code = String(result.status ?? 0);
      if (code === '404') return all;
      throw new Error(`SSG enrolment search failed for run ${runId}: ${code} ${result.error.message ?? ''}`.trim());
    }
    const wrapped: any[] = Array.isArray(result.data) ? result.data : [];
    if (wrapped.length === 0) return all;
    all.push(...wrapped);
    if (wrapped.length < ENROL_PAGE_SIZE) return all;
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

async function upsertSsgEnrolmentStaging(record: any): Promise<void> {
  const trainee = (record?.trainee ?? {}) as Record<string, unknown>;
  const course = (record?.course ?? {}) as Record<string, unknown>;
  const run = (course?.run ?? {}) as Record<string, unknown>;
  const tp = (record?.trainingPartner ?? {}) as Record<string, unknown>;
  const email = (trainee.email as Record<string, unknown>)?.full ?? null;

  await pool.query(
    `INSERT INTO ssg_enrolments (
       id, enrolment_id, trainee_name, trainee_nric,
       course_title, course_reference, course_run_id,
       training_partner_code, enrolment_status, sponsorship_type,
       enrolment_date, raw_data, created_date, imported_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::timestamptz, $11, NOW(), NOW()
     )
     ON CONFLICT (enrolment_id) DO UPDATE SET
       trainee_name = EXCLUDED.trainee_name,
       trainee_nric = EXCLUDED.trainee_nric,
       course_title = EXCLUDED.course_title,
       course_reference = EXCLUDED.course_reference,
       course_run_id = EXCLUDED.course_run_id,
       enrolment_status = EXCLUDED.enrolment_status,
       sponsorship_type = EXCLUDED.sponsorship_type,
       enrolment_date = EXCLUDED.enrolment_date,
       raw_data = EXCLUDED.raw_data,
       imported_at = NOW()`,
    [
      record?.referenceNumber ?? null,
      (trainee.fullName as string) || null,
      (trainee.id as string) || null,
      (course.title as string) || null,
      (course.referenceNumber as string) || null,
      (run.id as string) || null,
      (tp.code as string) || null,
      (record?.status as string) || null,
      (trainee.sponsorshipType as string) || null,
      (trainee.enrolmentDate as string) || null,
      JSON.stringify({ ...record, trainee: { ...trainee, email: { full: email } } }),
    ]
  );
}

function parseToISO(d: number | string | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) return `${m[3]}-${months[m[2]] ?? '01'}-${m[1].padStart(2, '0')}`;
  return null;
}

function extractRaCode(qrCodeLink: string | undefined): string | null {
  if (!qrCodeLink) return null;
  const parts = qrCodeLink.split('/');
  return parts[parts.length - 1] || null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { course_run_id } = req.body ?? {};

  if (!course_run_id || String(course_run_id).trim() === '') {
    return res.status(400).json({ success: false, error: 'course_run_id is required' });
  }

  const courseRunId = String(course_run_id).trim();

  // ── Fetch course run data directly from SSG ─────────────────────────────────
  let courseCode: string;
  let courseTitle: string;
  let startDateISO: string | null;
  let endDateISO: string | null;
  let raCode: string | null;
  let modeOfLearning: string;

  const ssgApp = (req.headers['x-ssg-app'] as string) || undefined;
  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!credentials) {
    return res.status(500).json({ success: false, error: 'SSG credentials not found' });
  }
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

  try {
    const api = createSSGCourseAPI(ssgBaseUrl, credentials);
    const ssgResult = await api.viewCourseRun(courseRunId);

    const hasError =
      ssgResult.error &&
      (ssgResult.error.code ||
        ssgResult.error.message ||
        (ssgResult.error.details && ssgResult.error.details.length > 0));

    const courseData: any = ssgResult.data?.course;
    const run = courseData?.run;
    const courseInfo = courseData;

    if (hasError || !run || !courseInfo) {
      return res.status(404).json({
        success: false,
        error: `No data returned from SSG for course run ID: ${courseRunId}. Please verify the ID is correct.`,
      });
    }

    courseCode = courseInfo.referenceNumber as string;
    courseTitle = (courseInfo.title as string) ?? '';
    startDateISO = parseToISO(run.courseStartDate ?? run.courseDates?.start);
    endDateISO = parseToISO(run.courseEndDate ?? run.courseDates?.end);
    raCode = extractRaCode(run.qrCodeLink);

    const titleLower = courseTitle.toLowerCase();
    if (titleLower.includes('virtual')) modeOfLearning = 'Virtual';
    else if (titleLower.includes('external')) modeOfLearning = 'External';
    else if (titleLower.includes('hybrid')) modeOfLearning = 'Hybrid';
    else modeOfLearning = 'Physical';
  } catch {
    return res.status(502).json({
      success: false,
      error: 'Could not reach SSG API. Please check your network connection and try again.',
    });
  }

  // ── Upsert course run in database ───────────────────────────────────────────
  const client = await pool.connect();
  try {
    // Resolve through every code the course has ever carried. A funding renewal issues
    // a NEW reference code and SSG returns the current one, so a bare course_code match
    // either misses the course or hits a stub left by an earlier import.
    const courseId = await resolveCourseIdByCode(courseCode, client);

    if (!courseId) {
      return res.status(404).json({
        success: false,
        error: `Course not found in database for code: ${courseCode}. Add the course first before importing the run.`,
      });
    }

    const existingRun = await client.query(`SELECT id FROM course_run WHERE course_run_id = $1`, [
      courseRunId,
    ]);

    let action: 'created' | 'updated';

    if (existingRun.rows.length > 0) {
      await client.query(
        `UPDATE course_run
         SET course_id        = $1,
             start_date       = COALESCE($2, start_date),
             end_date         = COALESCE($3, end_date),
             mode_of_learning = COALESCE($4, mode_of_learning),
             digital_attendance_id = COALESCE($5, digital_attendance_id),
             class_status     = 'Confirmed',
             updated_at       = NOW()
         WHERE id = $6`,
        [courseId, startDateISO, endDateISO, modeOfLearning, raCode, existingRun.rows[0].id]
      );
      action = 'updated';
    } else {
      await client.query(
        `INSERT INTO course_run
           (course_id, course_run_id, start_date, end_date, mode_of_learning, digital_attendance_id, class_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'Confirmed', NOW(), NOW())`,
        [courseId, courseRunId, startDateISO, endDateISO, modeOfLearning, raCode]
      );
      action = 'created';
    }

    // Pull enrolments for this run from SSG into ssg_enrolments. Without this step the
    // Consolidated Finance Data page (which reads ssg_enrolments) stays empty after import,
    // and the in-page "Refresh from SSG" cannot help because it discovers runs by scanning
    // ssg_enrolments first (chicken-and-egg for a never-seen run).
    let enrolmentsFetched = 0;
    let enrolmentsUpserted = 0;
    let enrolmentSyncError: string | null = null;
    const upsertedEnrolmentIds: string[] = [];

    try {
      const tp = await getTrainingPartnerIdentifiers();
      const tpUen = tp.uen || credentials.uen;
      const tpCode = tp.code;
      const enrolApi = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
      const records = await fetchAllEnrolmentsForRun(enrolApi, tpUen, tpCode, courseRunId);
      enrolmentsFetched = records.length;

      for (const row of records) {
        const rec = row?.enrolment ?? row;
        const enrolId = rec?.referenceNumber ? String(rec.referenceNumber) : '';
        if (!enrolId) continue;
        try {
          await upsertSsgEnrolmentStaging(rec);
          enrolmentsUpserted++;
          upsertedEnrolmentIds.push(enrolId);
          void tryEnqueueInvoiceFromSsgRecord(rec).catch((e: unknown) =>
            console.warn('[finance/import-course-run] tryEnqueueInvoiceFromSsgRecord:', e)
          );
        } catch (e) {
          console.warn('[finance/import-course-run] upsert enrolment failed:', e);
        }
      }

      if (upsertedEnrolmentIds.length > 0) {
        try {
          await refreshGrantsForEnrolments(upsertedEnrolmentIds, ssgApp);
        } catch (e) {
          console.warn('[finance/import-course-run] refreshGrantsForEnrolments:', e);
        }
      }
    } catch (e) {
      enrolmentSyncError = e instanceof Error ? e.message : String(e);
      console.warn('[finance/import-course-run] enrolment sync failed:', enrolmentSyncError);
    }

    return res.status(200).json({
      success: true,
      action,
      data: {
        courseRunId,
        courseCode,
        courseTitle,
        startDate: startDateISO,
        endDate: endDateISO,
        modeOfLearning,
        raCode,
        enrolmentsFetched,
        enrolmentsUpserted,
        enrolmentSyncError,
      },
    });
  } catch (error) {
    console.error('❌ finance/import-course-run DB error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Database error while saving course run.',
    });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
