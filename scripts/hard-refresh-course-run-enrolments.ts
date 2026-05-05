import pool from '../lib/db';
import { createSSGEnrolmentAPI } from '../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../lib/trainingPartnerIdentifiers';
import { refreshGrantsForEnrolments } from '../lib/services/billingSync';

function usage(): never {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage:',
      '  node --import tsx scripts/hard-refresh-course-run-enrolments.ts <courseRunId> [ssgApp]',
      '',
      'Example:',
      '  node --import tsx scripts/hard-refresh-course-run-enrolments.ts 1075752 app1',
    ].join('\n')
  );
  process.exit(1);
}

async function fetchAllEnrolmentsForRun(
  api: ReturnType<typeof createSSGEnrolmentAPI>,
  tpUen: string,
  tpCode: string,
  runId: string
): Promise<any[]> {
  const PAGE_SIZE = 100;
  const all: any[] = [];
  for (let pageIndex = 0; pageIndex < 80; pageIndex++) {
    const result = await api.searchEnrolment({
      parameters: { page: pageIndex, pageSize: PAGE_SIZE },
      enrolment: {
        course: { run: { id: runId } },
        trainingPartner: { uen: tpUen, code: tpCode },
      },
    } as any);

    if (result.error) {
      const code = String(result.status ?? 0);
      if (code === '404') return all;
      throw new Error(
        `SSG enrolment search failed for run ${runId}: ${code} ${result.error.message ?? ''}`.trim()
      );
    }

    const wrapped: any[] = Array.isArray(result.data) ? result.data : [];
    if (wrapped.length === 0) return all;
    all.push(...wrapped);
    if (wrapped.length < PAGE_SIZE) return all;
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
      record?.referenceNumber ?? null, // enrolment_id
      (trainee.fullName as string) || null,
      (trainee.id as string) || null,
      (course.title as string) || null,
      (course.referenceNumber as string) || null,
      (run.id as string) || null, // course_run_id
      (tp.code as string) || null,
      (record?.status as string) || null,
      (trainee.sponsorshipType as string) || null,
      (trainee.enrolmentDate as string) || null,
      JSON.stringify({ ...record, trainee: { ...trainee, email: { full: email } } }),
    ]
  );
}

async function main() {
  const runId = String(process.argv[2] || '').trim();
  const ssgApp = String(process.argv[3] || '').trim() || undefined;
  if (!runId) usage();

  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[hard-refresh] Fetching enrolments for course run ${runId}${ssgApp ? ` (ssgApp=${ssgApp})` : ''}…`);

  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();
  const tpUen = tp.uen || credentials.uen;
  const tpCode = tp.code;
  const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

  const wrapped = await fetchAllEnrolmentsForRun(api, tpUen, tpCode, runId);
  const enrolmentIds: string[] = [];
  let upserted = 0;
  for (const row of wrapped) {
    const rec = row?.enrolment ?? row;
    const eid = rec?.referenceNumber ? String(rec.referenceNumber).trim() : '';
    if (!eid) continue;
    const rid = rec?.course?.run?.id ? String(rec.course.run.id).trim() : '';
    if (rid && rid !== runId) continue;
    await upsertSsgEnrolmentStaging(rec);
    upserted++;
    enrolmentIds.push(eid);
  }

  const unique = Array.from(new Set(enrolmentIds));
  if (unique.length > 0) {
    await refreshGrantsForEnrolments(unique, ssgApp);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[hard-refresh] Done. Enrolments upserted: ${upserted}. Unique enrolment IDs: ${unique.length}. Duration: ${Math.round(
      (Date.now() - startedAt) / 1000
    )}s`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[hard-refresh] Failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });

