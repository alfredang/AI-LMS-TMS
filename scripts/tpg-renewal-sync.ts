import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  addCalendarMonths,
  buildRenewalPlan,
  canonicalizeTpgRows,
  computePlanHash,
  inspectCaptureDocument,
  normalizeDate,
  RENEWAL_PLAN_SCHEMA_VERSION,
  RenewalPlanError,
  statesEqual,
  verifyPlanHash,
  type CourseSnapshot,
  type RenewalPlanRow,
  type RenewalState,
} from '../lib/tpg/renewalSync';

const { Client } = pg;
const projectRoot = process.cwd();

interface CliArgs {
  command: string;
  values: Map<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): CliArgs {
  const command = argv[0] ?? 'help';
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new RenewalPlanError(`Unexpected argument: ${token}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) flags.add(token.slice(2));
    else {
      values.set(token.slice(2), next);
      index += 1;
    }
  }
  return { command, values, flags };
}

function required(args: CliArgs, key: string): string {
  const value = args.values.get(key);
  if (!value) throw new RenewalPlanError(`Missing required option --${key}.`);
  return value;
}

function resolveFile(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function singaporeDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function sha256File(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
}

function databaseClient(): pg.Client {
  dotenv.config({ path: path.join(projectRoot, '.env.local') });
  dotenv.config({ path: path.join(projectRoot, '.env') });
  if (!process.env.DATABASE_URL) throw new RenewalPlanError('DATABASE_URL is not configured.');
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15_000,
  });
}

async function queryCourses(
  client: pg.Client,
  asOfDate: string,
  throughDate: string,
  courseType: string,
): Promise<CourseSnapshot[]> {
  const result = await client.query(
    `SELECT id::text, title, course_code, new_course_code, course_type::text,
            funding_validity,
            actual_renew_date::text AS actual_renew_date,
            NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
            NULLIF(BTRIM(renewed_status), '') AS renewed_status
     FROM public.course
     WHERE course_type::text = $1
     ORDER BY title, id`,
    [courseType],
  );

  const selected: CourseSnapshot[] = [];
  for (const raw of result.rows) {
    const fundingValidity = normalizeDate(raw.funding_validity, `${raw.title} funding validity`);
    if (!fundingValidity || fundingValidity < asOfDate || fundingValidity > throughDate) continue;
    selected.push({
      id: raw.id,
      title: raw.title ?? '',
      course_code: raw.course_code ?? null,
      new_course_code: raw.new_course_code ?? null,
      course_type: raw.course_type,
      funding_validity: fundingValidity,
      actual_renew_date: normalizeDate(raw.actual_renew_date, `${raw.title} actual renewal date`),
      renewal_application_no: raw.renewal_application_no ?? null,
      renewed_status: raw.renewed_status ?? null,
    });
  }
  return selected;
}

async function planCommand(args: CliArgs): Promise<void> {
  const submissionsPath = resolveFile(required(args, 'submissions'));
  const rejectedPath = resolveFile(required(args, 'rejected'));
  const asOfDate = normalizeDate(args.values.get('as-of') ?? singaporeDate(), 'as-of date')!;
  const throughDate = normalizeDate(args.values.get('through') ?? addCalendarMonths(asOfDate, 3), 'through date')!;
  const courseType = args.values.get('course-type') ?? 'WSQ';
  const maxCaptureSkewMinutes = Number(args.values.get('max-capture-skew-minutes') ?? '180');
  if (!Number.isFinite(maxCaptureSkewMinutes) || maxCaptureSkewMinutes < 0) {
    throw new RenewalPlanError('--max-capture-skew-minutes must be a non-negative number.');
  }
  if (throughDate < asOfDate) throw new RenewalPlanError('Through date cannot be earlier than as-of date.');
  const defaultOutput = path.join('outputs', `tpg-renewal-sync-${asOfDate}`, 'plan.json');
  const outputPath = resolveFile(args.values.get('out') ?? defaultOutput);

  const [submissionsDocument, rejectedDocument] = await Promise.all([
    readJson(submissionsPath), readJson(rejectedPath),
  ]);
  const submissions = inspectCaptureDocument(submissionsDocument, 'Submissions');
  const rejected = inspectCaptureDocument(rejectedDocument, 'Rejected Applications');
  const incomplete = [
    !submissions.complete ? `Submissions: ${submissions.completenessEvidence}` : null,
    !rejected.complete ? `Rejected Applications: ${rejected.completenessEvidence}` : null,
  ].filter((value): value is string => Boolean(value));
  if (incomplete.length) {
    throw new RenewalPlanError(
      'Refusing to plan database changes because absence is not proven by complete captures.',
      incomplete,
    );
  }
  if (!submissions.scrapedAt || !rejected.scrapedAt) {
    throw new RenewalPlanError('Both complete captures must include scrapedAt timestamps.');
  }
  const submissionTime = Date.parse(submissions.scrapedAt);
  const rejectedTime = Date.parse(rejected.scrapedAt);
  if (!Number.isFinite(submissionTime) || !Number.isFinite(rejectedTime)) {
    throw new RenewalPlanError('One or both capture scrapedAt timestamps are invalid.');
  }
  const captureSkewMinutes = Math.abs(submissionTime - rejectedTime) / 60_000;
  if (captureSkewMinutes > maxCaptureSkewMinutes) {
    throw new RenewalPlanError(
      `Capture timestamps are ${captureSkewMinutes.toFixed(1)} minutes apart; maximum allowed is ${maxCaptureSkewMinutes}.`,
    );
  }

  const sourceRows = [
    ...canonicalizeTpgRows(submissions.rows, 'Submissions'),
    ...canonicalizeTpgRows(rejected.rows, 'Rejected Applications'),
  ];
  const client = databaseClient();
  await client.connect();
  let courses: CourseSnapshot[];
  try {
    await client.query('BEGIN READ ONLY');
    courses = await queryCourses(client, asOfDate, throughDate, courseType);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  const built = buildRenewalPlan(courses, sourceRows);
  const createdAt = new Date().toISOString();
  const unsignedPlan = {
    schemaVersion: RENEWAL_PLAN_SCHEMA_VERSION,
    kind: 'tpg-renewal-database-plan',
    createdAt,
    scope: {
      timezone: 'Asia/Singapore',
      asOfDate,
      throughDate,
      inclusive: true,
      courseType,
      maxCaptureSkewMinutes,
      captureSkewMinutes,
    },
    captures: {
      submissions: {
        path: path.relative(projectRoot, submissionsPath),
        sha256: await sha256File(submissionsPath),
        scrapedAt: submissions.scrapedAt,
        sourceUrl: submissions.sourceUrl,
        rows: submissions.rows.length,
        reportedTotal: submissions.reportedTotal,
        completenessEvidence: submissions.completenessEvidence,
      },
      rejectedApplications: {
        path: path.relative(projectRoot, rejectedPath),
        sha256: await sha256File(rejectedPath),
        scrapedAt: rejected.scrapedAt,
        sourceUrl: rejected.sourceUrl,
        rows: rejected.rows.length,
        reportedTotal: rejected.reportedTotal,
        completenessEvidence: rejected.completenessEvidence,
      },
    },
    summary: built.summary,
    rows: built.rows,
  };
  const plan = { ...unsignedPlan, planHash: computePlanHash(unsignedPlan) };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, planHash: plan.planHash, ...built.summary }, null, 2));
}

function stateFromDatabase(row: Record<string, unknown>): RenewalState {
  return {
    actualRenewDate: normalizeDate(row.actual_renew_date, 'database actual renewal date'),
    renewalApplicationNo: String(row.renewal_application_no ?? '').trim() || null,
    renewedStatus: String(row.renewed_status ?? '').trim() || null,
  };
}

async function applyCommand(args: CliArgs): Promise<void> {
  const planPath = resolveFile(required(args, 'plan'));
  const confirmedHash = required(args, 'confirm-plan-hash');
  const planDocument = await readJson(planPath);
  if (!planDocument || typeof planDocument !== 'object' || Array.isArray(planDocument)) {
    throw new RenewalPlanError('Plan file must contain a JSON object.');
  }
  const plan = planDocument as Record<string, unknown>;
  if (plan.schemaVersion !== RENEWAL_PLAN_SCHEMA_VERSION || plan.kind !== 'tpg-renewal-database-plan') {
    throw new RenewalPlanError('Unsupported renewal plan schema or kind.');
  }
  if (!verifyPlanHash(plan)) throw new RenewalPlanError('Plan hash is invalid; the plan was modified after generation.');
  if (plan.planHash !== confirmedHash) throw new RenewalPlanError('Confirmed hash does not match the plan hash.');
  if (!Array.isArray(plan.rows)) throw new RenewalPlanError('Plan does not contain a rows array.');
  const rows = plan.rows as RenewalPlanRow[];
  const defaultAudit = path.join(path.dirname(planPath), `apply-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const auditPath = resolveFile(args.values.get('audit') ?? defaultAudit);
  await fs.mkdir(path.dirname(auditPath), { recursive: true });

  const client = databaseClient();
  await client.connect();
  let committed = false;
  const auditRows: Array<Record<string, unknown>> = [];
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('tpg-renewal-sync-v1'))`);

    for (const item of rows) {
      const result = await client.query(
        `SELECT id::text, title, course_code, new_course_code, course_type::text,
                funding_validity,
                actual_renew_date::text AS actual_renew_date,
                NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
                NULLIF(BTRIM(renewed_status), '') AS renewed_status
         FROM public.course
         WHERE id = $1
         FOR UPDATE`,
        [item.id],
      );
      if (result.rowCount !== 1) throw new RenewalPlanError(`${item.courseTitle} no longer matches exactly one database row.`);
      const current = result.rows[0] as Record<string, unknown>;
      const currentRefs = [current.new_course_code, current.course_code]
        .map((value) => String(value ?? '').trim().toUpperCase())
        .filter(Boolean);
      if (
        current.title !== item.courseTitle
        || current.course_type !== item.courseType
        || normalizeDate(current.funding_validity, `${item.courseTitle} funding validity`) !== item.fundingValidity
        || JSON.stringify([...new Set(currentRefs)].sort()) !== JSON.stringify([...item.courseRefs].sort())
      ) {
        throw new RenewalPlanError(`${item.courseTitle} identity/scope fields changed after the plan was generated.`);
      }

      const currentState = stateFromDatabase(current);
      const alreadyApplied = statesEqual(currentState, item.desired);
      if (!alreadyApplied && !statesEqual(currentState, item.before)) {
        throw new RenewalPlanError(`${item.courseTitle} renewal fields changed after the plan was generated.`);
      }

      if (!alreadyApplied && item.changed) {
        await client.query(
          `UPDATE public.course
           SET actual_renew_date = $2::date,
               renewal_application_no = $3,
               renewed_status = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [item.id, item.desired.actualRenewDate, item.desired.renewalApplicationNo, item.desired.renewedStatus],
        );
      }

      const verification = await client.query(
        `SELECT actual_renew_date::text AS actual_renew_date,
                NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
                NULLIF(BTRIM(renewed_status), '') AS renewed_status
         FROM public.course WHERE id = $1`,
        [item.id],
      );
      const after = stateFromDatabase(verification.rows[0]);
      if (!statesEqual(after, item.desired)) {
        throw new RenewalPlanError(`Post-update verification failed for ${item.courseTitle}.`);
      }
      auditRows.push({
        id: item.id,
        courseTitle: item.courseTitle,
        operation: item.operation,
        before: currentState,
        desired: item.desired,
        after,
        action: alreadyApplied || !item.changed ? 'already-correct' : 'updated',
      });
    }

    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    const failedAudit = {
      schemaVersion: 1,
      kind: 'tpg-renewal-database-apply-audit',
      createdAt: new Date().toISOString(),
      committed: false,
      planPath: path.relative(projectRoot, planPath),
      planHash: plan.planHash,
      summary: {
        matchedBeforeFailure: auditRows.length,
        updated: 0,
        failed: 1,
      },
      error: error instanceof Error ? error.message : String(error),
      rows: auditRows,
    };
    await fs.writeFile(auditPath, `${JSON.stringify(failedAudit, null, 2)}\n`, 'utf8').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  const audit = {
    schemaVersion: 1,
    kind: 'tpg-renewal-database-apply-audit',
    createdAt: new Date().toISOString(),
    committed,
    planPath: path.relative(projectRoot, planPath),
    planHash: plan.planHash,
    summary: {
      matched: auditRows.length,
      updated: auditRows.filter((row) => row.action === 'updated').length,
      alreadyCorrect: auditRows.filter((row) => row.action === 'already-correct').length,
      failed: 0,
    },
    rows: auditRows,
  };
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ auditPath, ...audit.summary, committed }, null, 2));
}

function printHelp(): void {
  console.log(`TPG renewal database synchronizer

Plan (read-only database access):
  npm run tpg:renewal-sync -- plan \\
    --submissions scratch/tpg-submissions-all-types-YYYY-MM-DD.json \\
    --rejected scratch/tpg-rejected-applications-YYYY-MM-DD.json \\
    [--as-of YYYY-MM-DD] [--through YYYY-MM-DD] \\
    [--max-capture-skew-minutes 180] [--out outputs/.../plan.json]

Apply the exact reviewed plan atomically:
  npm run tpg:renewal-sync -- apply \\
    --plan outputs/.../plan.json \\
    --confirm-plan-hash sha256:<hash> \\
    [--audit outputs/.../apply-audit.json]

Both captures must prove complete coverage. Apply changes only actual_renew_date,
renewal_application_no, and renewed_status, with optimistic locking and verification.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help') || args.command === 'help' || args.command === '--help') printHelp();
  else if (args.command === 'plan') await planCommand(args);
  else if (args.command === 'apply') await applyCommand(args);
  else throw new RenewalPlanError(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
