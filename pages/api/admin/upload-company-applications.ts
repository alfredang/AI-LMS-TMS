import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { validateAndResolveCompanyApplicationRows, type CourseRunOverride } from '../../../lib/companyApplicationValidator';
import { lookupExistingGroupInvoices } from '../../../lib/services/caExistingInvoice';
import { normalizeTraineeIdentityFields } from '../../../lib/traineeIdentity';

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

/**
 * "8/11/2026", "08-11-2026" and "08/11/2026" are the same class. Store and
 * compare one spelling (DD-MM-YYYY, zero-padded) so re-uploading a learner with
 * the date typed differently updates their row instead of creating a second
 * one — which the pipeline would then try to enrol again (SSG: duplicate).
 * Anything not in a day-month-year shape is left exactly as typed.
 */
function canonicalStartDate(raw: unknown): string {
  const value = String(raw ?? '').trim();
  const m = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return value;
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
}

/** Every spelling an existing row may hold for the same DD-MM-YYYY date. */
function startDateSpellings(canonical: string): string[] {
  const m = canonical.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return [canonical.toLowerCase()];
  const [, dd, mm, yyyy] = m;
  const days = Array.from(new Set([dd, String(Number(dd))]));
  const months = Array.from(new Set([mm, String(Number(mm))]));
  const out: string[] = [];
  for (const d of days) for (const mo of months) for (const sep of ['-', '/']) out.push(`${d}${sep}${mo}${sep}${yyyy}`);
  return out;
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

  // How these learners should be billed, chosen in the Enrol Learners popup
  // when the employer already has an invoice for this course run:
  //   auto       — normal pipeline (this is also every Excel upload)
  //   enrol-only — never invoice them here; Finance adds them to the existing
  //                invoice in QuickBooks by hand
  //   replace    — delete the existing invoice and reissue one covering
  //                everyone, once the group is billable
  // Rejected rather than defaulted when unrecognised: billing is not something
  // to guess at.
  const billingMode = String(req.body?.billing?.mode || 'auto').trim();
  if (!['auto', 'enrol-only', 'replace'].includes(billingMode)) {
    return res.status(400).json({ message: "billing.mode must be 'auto', 'enrol-only' or 'replace'" });
  }
  const billingInvoiceRef = String(req.body?.billing?.invoiceRef || '').trim();

  // Per-(employer, course run) answers to "this company already has an invoice
  // for this class — replace it, bill separately, or enrol only?", sent back by
  // the Excel upload popup after this route asked (409 needsBillingChoice).
  // Keyed `${uen lowercased}|${courseRunId}`.
  type GroupBilling = { mode: 'auto' | 'enrol-only' | 'replace'; invoiceRef: string };
  const rawByGroup = req.body?.billingByGroup;
  const billingByGroup: Record<string, GroupBilling> | null =
    rawByGroup && typeof rawByGroup === 'object' && !Array.isArray(rawByGroup) ? {} : null;
  if (billingByGroup) {
    for (const [key, value] of Object.entries(rawByGroup as Record<string, any>)) {
      const mode = String(value?.mode || '').trim();
      if (!['auto', 'enrol-only', 'replace'].includes(mode)) {
        return res.status(400).json({ message: `billingByGroup["${key}"].mode must be 'auto', 'enrol-only' or 'replace'` });
      }
      billingByGroup[key] = { mode: mode as GroupBilling['mode'], invoiceRef: String(value?.invoiceRef || '').trim() };
    }
  }

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
    const { errors: validationErrors, runIdByRow } = await validateAndResolveCompanyApplicationRows(rows, overrides);
    if (validationErrors.length > 0) {
      const resolvable = validationErrors.filter(e => e.courseRunUnresolved).length;
      return res.status(400).json({
        message: resolvable > 0
          ? `${validationErrors.length} row${validationErrors.length === 1 ? ' has' : 's have'} issues — pick the correct course run below, or fix the Excel and re-upload.`
          : `${validationErrors.length} row${validationErrors.length === 1 ? ' has' : 's have'} issues — fix the Excel and re-upload.`,
        validationErrors,
      });
    }

    // Late joiners. An Excel upload used to go straight to the normal pipeline,
    // which cuts a SECOND invoice for a company that already has one for this
    // class. Enrol Learners asks first (Replace / Separate / Enrol only); ask
    // here too, before anything is written. Only when the request came with no
    // billing answer at all — the Enrol Learners path sends `billing`, and the
    // upload popup's retry sends `billingByGroup`.
    const groupKeyByRow: Array<string | null> = rows.map((row, i) => {
      const uen = String(row['Employer UEN*'] || '').trim().toLowerCase();
      const runId = runIdByRow[i];
      return uen && runId ? `${uen}|${runId}` : null;
    });

    if (billingMode === 'auto' && !billingByGroup) {
      const byGroup = new Map<string, { uen: string; runId: string; orgName: string; learners: Array<{ name: string; nric: string }> }>();
      rows.forEach((row, i) => {
        const key = groupKeyByRow[i];
        if (!key) return;
        const g = byGroup.get(key) ?? {
          uen: String(row['Employer UEN*'] || '').trim(),
          runId: String(runIdByRow[i]),
          orgName: String(row['Employer Organization Name*'] || '').trim(),
          learners: [],
        };
        g.learners.push({
          name: String(row['Trainee FULL Name as on government ID*'] || '').trim(),
          nric: String(row['Trainee NRIC/FIN Number*'] || '').trim().toLowerCase(),
        });
        byGroup.set(key, g);
      });

      const needsChoice: any[] = [];
      for (const [key, g] of byGroup) {
        // Learners already on an invoice for this class are a re-upload, not
        // a late joiner — they never trigger the question.
        const onInvoice = await pool.query(
          `SELECT LOWER(TRIM(trainee_nric)) AS nric
             FROM public.company_application
            WHERE LOWER(TRIM(employer_uen)) = LOWER($1)
              AND TRIM(course_run_id)       = $2
              AND ca_cancelled_at IS NULL
              AND COALESCE(invoice_id, '') <> ''`,
          [g.uen, g.runId]
        );
        const invoicedNrics = new Set(onInvoice.rows.map((r: any) => String(r.nric || '')));
        const newLearners = g.learners.filter(l => !invoicedNrics.has(l.nric));
        if (newLearners.length === 0) continue;

        const lookup = await lookupExistingGroupInvoices(g.uen, g.runId);
        if (lookup.invoices.length === 0) continue;
        needsChoice.push({
          key,
          employerOrgName: lookup.employerOrgName || g.orgName,
          employerUen: g.uen,
          courseRunId: g.runId,
          invoices: lookup.invoices,
          canReplace: lookup.canReplace,
          blockedReason: lookup.blockedReason,
          newLearners: newLearners.map(l => l.name || '(unnamed)'),
        });
      }

      if (needsChoice.length > 0) {
        return res.status(409).json({
          needsBillingChoice: true,
          message: `${needsChoice.length} compan${needsChoice.length === 1 ? 'y already has' : 'ies already have'} an invoice for this class — choose how to bill the new learners.`,
          groups: needsChoice,
        });
      }
    }

    const queuedIds: string[] = [];
    const queuedIdsByGroup = new Map<string, string[]>();
    let inserted = 0;
    let updated = 0;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rowGroupKey = groupKeyByRow[rowIndex];
      const queueId = (id: string) => {
        queuedIds.push(id);
        if (rowGroupKey) {
          const list = queuedIdsByGroup.get(rowGroupKey) ?? [];
          list.push(id);
          queuedIdsByGroup.set(rowGroupKey, list);
        }
      };
      const normalizedIdentity = normalizeTraineeIdentityFields({
        nric: row['Trainee NRIC/FIN Number*'],
        idType: row['Trainee ID Type*'],
        identityType: row['Trainee Identity Type*'],
      });
      const normalizedRow: Record<string, string> = {
        ...row,
        'Course Start Date (DD-MM-YYYY)*': canonicalStartDate(row['Course Start Date (DD-MM-YYYY)*']),
        'Trainee ID Type*': normalizedIdentity.idType,
        'Trainee Identity Type*': normalizedIdentity.identityType,
      };
      const dedupKey = makeDedupKey(normalizedRow);
      const debugMap: Record<string, unknown> = {};
      const baseValues = DB_COLUMNS.map(dbCol => {
        const sourceKey = Object.keys(COLUMN_TO_DB).find(k => COLUMN_TO_DB[k] === dbCol)!;
        const raw = normalizedRow[sourceKey];
        const val: any = raw == null || raw === '' ? null : String(raw).trim();
        debugMap[dbCol] = val;
        return val;
      });

      // When the admin resolved this row's course run by hand, persist that
      // choice instead of leaving the pipeline to re-derive it from the same
      // title/date that failed to match in the first place. The employer's
      // original wording is preserved in course_title — we add the answer, we
      // don't rewrite the question.
      // Keyed by the date AS TYPED (not canonicalStartDate) — the picker sends
      // back the raw Excel value it was shown.
      const chosenRun = resolvedRunByKey.get(
        `${String(row['Course Title*'] || '').trim().toLowerCase()}|${String(row['Course Start Date (DD-MM-YYYY)*'] || '').trim()}`
      );
      const COLUMNS = chosenRun ? [...DB_COLUMNS, 'course_run_id', 'course_reference_number'] : DB_COLUMNS;
      const values = chosenRun
        ? [...baseValues, chosenRun.courseRunId, chosenRun.courseCode || null]
        : baseValues;
      // Column names only — the values are NRIC, date of birth and phone
      // numbers, which must not land in the server log.
      console.log('[upload-company-applications] parsed row columns →', Object.keys(row).length,
        'filled:', Object.keys(debugMap).filter(k => debugMap[k] != null).length);

      const existing = dedupKey
        ? await pool.query(
            `SELECT id FROM public.company_application
              WHERE LOWER(TRIM(COALESCE(trainee_nric, ''))) = $1
                AND LOWER(TRIM(COALESCE(employer_uen, ''))) = $2
                AND LOWER(TRIM(COALESCE(course_title, ''))) = $3
                AND LOWER(TRIM(COALESCE(course_start_date, ''))) = ANY($4::text[])
                AND ca_cancelled_at IS NULL
              ORDER BY created_at ASC
              LIMIT 1`,
            [dedupKey.traineeNric, dedupKey.employerUen, dedupKey.courseTitle, startDateSpellings(dedupKey.startDate)]
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
          queueId(result.rows[0].id);
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
            queueId(result.rows[0].id);
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
                  AND LOWER(TRIM(COALESCE(course_start_date, ''))) = ANY($4::text[])
                  AND ca_cancelled_at IS NULL
                ORDER BY created_at ASC
                LIMIT 1`,
              [dedupKey.traineeNric, dedupKey.employerUen, dedupKey.courseTitle, startDateSpellings(dedupKey.startDate)]
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
                queueId(updRes.rows[0].id);
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

    // Stamp the billing choice before the pipeline starts. The invoice sweep at
    // the end of bulkProcessCompanyApplications reads these columns, so setting
    // them after the background job is kicked off would be a race the invoice
    // usually wins.
    if (queuedIds.length > 0 && billingMode !== 'auto') {
      await pool.query(
        `UPDATE public.company_application
            SET billed_manually             = $2,
                billed_manually_invoice_ref = CASE WHEN $2 THEN NULLIF($4, '') ELSE NULL END,
                replace_group_invoice       = $3,
                updated_at                  = now()
          WHERE id = ANY($1::uuid[])`,
        [queuedIds, billingMode === 'enrol-only', billingMode === 'replace', billingInvoiceRef]
      );
      console.log(
        `[upload-company-applications] billing mode '${billingMode}' applied to ${queuedIds.length} row(s)`
      );
    }

    // Per-company answers from the upload popup — same columns as above.
    if (billingByGroup) {
      for (const [key, choice] of Object.entries(billingByGroup)) {
        const ids = queuedIdsByGroup.get(key) || [];
        if (ids.length === 0 || choice.mode === 'auto') continue;
        await pool.query(
          `UPDATE public.company_application
              SET billed_manually             = $2,
                  billed_manually_invoice_ref = CASE WHEN $2 THEN NULLIF($4, '') ELSE NULL END,
                  replace_group_invoice       = $3,
                  updated_at                  = now()
            WHERE id = ANY($1::uuid[])`,
          [ids, choice.mode === 'enrol-only', choice.mode === 'replace', choice.invoiceRef]
        );
        console.log(`[upload-company-applications] billing mode '${choice.mode}' applied to ${ids.length} row(s) in group ${key}`);
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
