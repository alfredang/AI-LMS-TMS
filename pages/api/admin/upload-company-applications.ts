import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { validateCompanyApplicationRows, type CourseRunOverride } from '../../../lib/companyApplicationValidator';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const COLUMN_TO_DB: Record<string, string> = {
  'Course Title*': 'course_title',
  'Course Start Date (DD-MM-YYYY)*': 'course_start_date',
  'Trainee Identity Type*': 'trainee_identity_type',
  'Trainee FULL Name as on government ID*': 'trainee_full_name',
  'Trainee ID Type*': 'trainee_id_type',
  'Trainee NRIC/FIN Number*': 'trainee_nric',
  'Date of Birth* (DD-MM-YYYY)': 'date_of_birth',
  'Trainee Company email Address*': 'trainee_email',
  'Trainee Mobile Phone Number*': 'trainee_phone',
  'Trainee Highest Qualification*': 'trainee_highest_qualification',
  'Employer Organization Name*': 'employer_org_name',
  'Employer UEN*': 'employer_uen',
  'Employer Contact Name*': 'employer_contact_name',
  'Employer Contact Designation*': 'employer_contact_designation',
  'Employer Contact Telephone No.*': 'employer_contact_phone',
  'Employer Contact Email Address*': 'employer_contact_email',
  'Have trainee(s) been given SSG funding before for the course applying for?': 'ssg_funding_before',
  'Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met': 'consent_ssg_terms',
  'Declaration that all grant application information is true and accurate': 'declaration_truthful',
  'Consent to receive marketing information via newsletter': 'consent_marketing',
  'Grant Application Nos (For TP to fill only after grant approved)': 'grant_application_nos',
};

const DB_COLUMNS = Object.values(COLUMN_TO_DB);

const AUTOMATION_COLUMNS = [
  'auto_enrol_status',
] as const;

interface DedupKey {
  traineeNric: string;
  employerUen: string;
  courseTitle: string;
  startDate: string;
}

function makeDedupKey(row: Record<string, string>): DedupKey | null {
  const traineeNric = String(row['Trainee NRIC/FIN Number*'] || '').trim().toLowerCase();
  const employerUen = String(row['Employer UEN*'] || '').trim().toLowerCase();
  const courseTitle = String(row['Course Title*'] || '').trim().toLowerCase();
  const startDate = String(row['Course Start Date (DD-MM-YYYY)*'] || '').trim().toLowerCase();
  if (!traineeNric || !courseTitle || !startDate) return null;
  return { traineeNric, employerUen, courseTitle, startDate };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const rows = (req.body?.rows ?? []) as Array<Record<string, string>>;
  if (!Array.isArray(rows)) return res.status(400).json({ message: 'rows must be an array' });
  if (rows.length === 0) return res.status(200).json({ inserted: 0 });

  try {
    await ensureCompanyApplicationsTable();

    // "Did you mean this run?" answers from the admin, keyed by the raw Excel
    // (title, date). Each is verified against a real course_run before it can
    // satisfy validation — a client can't wave a row through with a made-up id.
    const rawOverrides = Array.isArray(req.body?.courseRunOverrides) ? req.body.courseRunOverrides : [];
    const overrides: CourseRunOverride[] = [];
    const resolvedRunByKey = new Map<string, { courseRunId: string; courseCode: string }>();
    for (const o of rawOverrides) {
      const courseRunId = String(o?.courseRunId || '').trim();
      const courseTitle = String(o?.courseTitle || '');
      const courseStartDate = String(o?.courseStartDate || '');
      if (!courseRunId || !courseTitle) continue;
      const runRes = await pool.query(
        `SELECT cr.course_run_id::text AS course_run_id, c.course_code::text AS course_code
           FROM public.course_run cr
           JOIN public.course c ON c.id = cr.course_id
          WHERE cr.course_run_id = $1
            AND COALESCE(cr.is_deleted, false) = false
          LIMIT 1`,
        [courseRunId]
      );
      if (!runRes.rows[0]) {
        return res.status(400).json({ message: `Selected course run "${courseRunId}" no longer exists — reload and pick again.` });
      }
      overrides.push({ courseTitle, courseStartDate, courseRunId });
      resolvedRunByKey.set(
        `${courseTitle.trim().toLowerCase()}|${courseStartDate.trim()}`,
        { courseRunId: runRes.rows[0].course_run_id, courseCode: String(runRes.rows[0].course_code || '') }
      );
    }

    // Pre-flight: reject the whole upload if any row has issues so the admin can
    // fix it and re-upload cleanly. Catches things that previously only surfaced
    // after auto-enrol hit SSG (e.g. a DOB entered as MM-DD-YYYY becoming
    // "Invalid Date" in the payload, or a course run that doesn't exist).
    const validationErrors = await validateCompanyApplicationRows(rows, overrides);
    if (validationErrors.length > 0) {
      const resolvable = validationErrors.filter(e => e.courseRunUnresolved).length;
      return res.status(400).json({
        message: resolvable > 0
          ? `${validationErrors.length} row${validationErrors.length === 1 ? ' has' : 's have'} issues — pick the correct course run below, or fix the Excel and re-upload.`
          : `${validationErrors.length} row${validationErrors.length === 1 ? ' has' : 's have'} issues — fix the Excel and re-upload.`,
        validationErrors,
      });
    }

    const queuedIds: string[] = [];
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const dedupKey = makeDedupKey(row);
      const debugMap: Record<string, unknown> = {};
      const baseValues = DB_COLUMNS.map(dbCol => {
        const sourceKey = Object.keys(COLUMN_TO_DB).find(k => COLUMN_TO_DB[k] === dbCol)!;
        const raw = row[sourceKey];
        const val: any = raw == null || raw === '' ? null : String(raw).trim();
        debugMap[dbCol] = val;
        return val;
      });

      // When the admin resolved this row's course run by hand, persist that
      // choice instead of leaving the pipeline to re-derive it from the same
      // title/date that failed to match in the first place. The employer's
      // original wording is preserved in course_title — we add the answer, we
      // don't rewrite the question.
      const chosenRun = resolvedRunByKey.get(
        `${String(row['Course Title*'] || '').trim().toLowerCase()}|${String(row['Course Start Date (DD-MM-YYYY)*'] || '').trim()}`
      );
      const COLUMNS = chosenRun ? [...DB_COLUMNS, 'course_run_id', 'course_reference_number'] : DB_COLUMNS;
      const values = chosenRun
        ? [...baseValues, chosenRun.courseRunId, chosenRun.courseCode || null]
        : baseValues;
      console.log('[upload-company-applications] parsed row →', JSON.stringify({
        dedupKey,
        rowKeys: Object.keys(row),
        valuesByColumn: debugMap,
      }, null, 2));

      const existing = dedupKey
        ? await pool.query(
            `SELECT id FROM public.company_application
              WHERE LOWER(TRIM(COALESCE(trainee_nric, ''))) = $1
                AND LOWER(TRIM(COALESCE(employer_uen, ''))) = $2
                AND LOWER(TRIM(COALESCE(course_title, ''))) = $3
                AND LOWER(TRIM(COALESCE(course_start_date, ''))) = $4
              ORDER BY created_at ASC
              LIMIT 1`,
            [dedupKey.traineeNric, dedupKey.employerUen, dedupKey.courseTitle, dedupKey.startDate]
          )
        : { rows: [] };

      if (existing.rows[0]?.id) {
        const setClause = COLUMNS.map((col, index) => `${col} = $${index + 2}`).join(', ');
        const result = await pool.query(
          `UPDATE public.company_application
              SET ${setClause},
                  auto_enrol_status = 'pending',
                  auto_enrol_error = NULL,
                  updated_at = now()
            WHERE id = $1
            RETURNING id`,
          [existing.rows[0].id, ...values]
        );
        if (result.rows[0]?.id) {
          updated++;
          queuedIds.push(result.rows[0].id);
        }
      } else {
        const insertColumns = [...COLUMNS, ...AUTOMATION_COLUMNS];
        const insertValues = [...values, 'pending'];
        const placeholders = insertValues.map((_, index) => `$${index + 1}`).join(', ');
        try {
          const result = await pool.query(
            `INSERT INTO public.company_application (${insertColumns.join(', ')})
             VALUES (${placeholders})
             RETURNING id`,
            insertValues
          );
          if (result.rows[0]?.id) {
            inserted++;
            queuedIds.push(result.rows[0].id);
          }
        } catch (insertErr: any) {
          // 23505 = unique_violation. Race: another concurrent upload inserted
          // the same dedup key between our SELECT above and this INSERT. The
          // uq_company_application_dedup partial unique index catches this.
          // Recover by re-fetching the now-existing row and converting to UPDATE.
          if (insertErr?.code === '23505' && dedupKey) {
            const recovered = await pool.query(
              `SELECT id FROM public.company_application
                WHERE LOWER(TRIM(COALESCE(trainee_nric, ''))) = $1
                  AND LOWER(TRIM(COALESCE(employer_uen, ''))) = $2
                  AND LOWER(TRIM(COALESCE(course_title, ''))) = $3
                  AND LOWER(TRIM(COALESCE(course_start_date, ''))) = $4
                ORDER BY created_at ASC
                LIMIT 1`,
              [dedupKey.traineeNric, dedupKey.employerUen, dedupKey.courseTitle, dedupKey.startDate]
            );
            const recoveredId = recovered.rows[0]?.id;
            if (recoveredId) {
              const setClause = COLUMNS.map((col, index) => `${col} = $${index + 2}`).join(', ');
              const updRes = await pool.query(
                `UPDATE public.company_application
                    SET ${setClause},
                        auto_enrol_status = 'pending',
                        auto_enrol_error = NULL,
                        updated_at = now()
                  WHERE id = $1
                  RETURNING id`,
                [recoveredId, ...values]
              );
              if (updRes.rows[0]?.id) {
                updated++;
                queuedIds.push(updRes.rows[0].id);
              }
            } else {
              throw insertErr;
            }
          } else {
            throw insertErr;
          }
        }
      }
    }

    if (queuedIds.length > 0) {
      setImmediate(async () => {
        try {
          const { bulkProcessCompanyApplications } = await import('../../../lib/autoEnrolCompanyApplications');
          await bulkProcessCompanyApplications(queuedIds);
        } catch (err) {
          console.error('company application background auto-enrol failed:', err);
          const message = err instanceof Error ? err.message : String(err);
          await pool.query(
            `UPDATE public.company_application
                SET auto_enrol_status = 'failed',
                    auto_enrol_error = $2,
                    updated_at = now()
              WHERE id = ANY($1::uuid[])`,
            [queuedIds, `background: ${message}`]
          ).catch(updateErr => {
            console.error('failed to mark company applications as failed:', updateErr);
          });
        }
      });
    }

    return res.status(200).json({
      inserted,
      updated,
      queued: queuedIds.length,
      insertedIds: queuedIds,
    });
  } catch (err: any) {
    console.error('upload-company-applications error:', err);
    return res.status(500).json({ message: err?.message || 'Failed to insert company applications' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
