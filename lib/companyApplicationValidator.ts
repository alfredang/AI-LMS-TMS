import pool from './db';
import {
  courseTitlesMatch,
  extractCourseReferenceNumber,
  scoreCourseTitleSimilarity,
} from './courseTitleMatch';

// Per-row validation for the Company Application Excel upload. Block-mode:
// the upload endpoint rejects the whole request if ANY row has issues so the
// admin can fix the Excel and re-upload cleanly. Runs purely against the
// parsed row dict — never touches SSG (course-run-on-SSG checks happen later
// in autoEnrolCompanyApplications and surface via pipeline_warnings).

export interface RowValidationError {
  rowNumber: number;
  traineeName: string;
  traineeNric: string;
  courseTitle: string;
  issues: string[];
  /**
   * Present only when the sole reason this row failed is that its course run
   * couldn't be resolved. Lets the UI offer "did you mean this run?" instead of
   * a dead-end "go fix the Excel". Absent when the row has other problems too —
   * picking a run wouldn't make those rows importable.
   */
  courseRunUnresolved?: {
    /** Echoed back so the client can key its selection to this exact row group. */
    courseTitle: string;
    courseStartDate: string;
    candidates: CourseRunCandidate[];
  };
}

/**
 * An admin's answer to "did you mean this run?" — keyed by the raw Excel values
 * so it applies to every row sharing that (title, date), not just one learner.
 */
export interface CourseRunOverride {
  courseTitle: string;
  courseStartDate: string;
  courseRunId: string;
}

function overrideKey(courseTitle: string, courseStartDate: string): string {
  return `${String(courseTitle || '').trim().toLowerCase()}|${String(courseStartDate || '').trim()}`;
}

// Every asterisk-marked column in the Excel form. Several of these end up in
// the SSG enrolment payload (idType, employer contact phone) — leaving them
// blank either makes the payload invalid or the LMS-side audit incomplete.
const REQUIRED_FIELDS: Array<{ column: string; label: string }> = [
  { column: 'Course Title*', label: 'Course Title' },
  { column: 'Course Start Date (DD-MM-YYYY)*', label: 'Course Start Date' },
  { column: 'Trainee Identity Type*', label: 'Trainee Identity Type' },
  { column: 'Trainee FULL Name as on government ID*', label: 'Trainee Full Name' },
  { column: 'Trainee ID Type*', label: 'Trainee ID Type' },
  { column: 'Trainee NRIC/FIN Number*', label: 'Trainee NRIC/FIN' },
  { column: 'Date of Birth* (DD-MM-YYYY)', label: 'Date of Birth' },
  { column: 'Trainee Company email Address*', label: 'Trainee Email' },
  { column: 'Trainee Mobile Phone Number*', label: 'Trainee Mobile Phone' },
  { column: 'Employer Organization Name*', label: 'Employer Organization Name' },
  { column: 'Employer UEN*', label: 'Employer UEN' },
  { column: 'Employer Contact Name*', label: 'Employer Contact Name' },
  { column: 'Employer Contact Designation*', label: 'Employer Contact Designation' },
  { column: 'Employer Contact Telephone No.*', label: 'Employer Contact Telephone' },
  { column: 'Employer Contact Email Address*', label: 'Employer Contact Email' },
];

// Singapore NRIC/FIN: leading S/T/F/G/M, 7 digits, trailing checksum letter.
const NRIC_PATTERN = /^[STFGMstfgm]\d{7}[A-Za-z]$/;

// Singapore UEN: 9 or 10 chars. Common shapes: NNNNNNNNX (business),
// YYYYNNNNNX (local company), TYYNNNNNNX (organisation). Keep validation
// loose — admins enter pre-existing UENs, not new ones.
const UEN_PATTERN = /^[A-Za-z0-9]{9,10}$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedDate {
  iso: string;
  year: number;
  month: number;
  day: number;
}

// Parse strictly as DD-MM-YYYY (the Excel column header says so). Rejects
// 06-24-1984 (month 24) which would otherwise silently become an Invalid
// Date downstream in the SSG payload.
function parseDdMmYyyy(raw: string): ParsedDate | null {
  const match = raw.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, year, month, day };
}

// Pre-fetches all course_runs that could match anything in this upload, so we
// do one query for N rows instead of N queries. Returns a lookup function the
// per-row validator calls.
async function buildCourseRunResolver(
  rows: Array<Record<string, string>>,
): Promise<(title: string, isoStartDate: string) => boolean> {
  const startDates = new Set<string>();
  for (const row of rows) {
    const raw = String(row['Course Start Date (DD-MM-YYYY)*'] || '').trim();
    const parsed = parseDdMmYyyy(raw);
    if (parsed) startDates.add(parsed.iso);
  }
  if (startDates.size === 0) {
    return () => false;
  }

  const result = await pool.query(
    `SELECT c.title::text AS title, c.course_code::text AS course_code, cr.start_date::text AS start_date
       FROM public.course_run cr
       JOIN public.course c ON c.id = cr.course_id
      WHERE cr.start_date::date = ANY($1::date[])`,
    [Array.from(startDates)],
  );

  const byDate = new Map<string, Array<{ title: string; courseCode: string }>>();
  for (const r of result.rows) {
    const iso = String(r.start_date).slice(0, 10);
    const arr = byDate.get(iso) || [];
    arr.push({ title: String(r.title || ''), courseCode: String(r.course_code || '') });
    byDate.set(iso, arr);
  }

  return (title, isoStartDate) => {
    const candidates = byDate.get(isoStartDate);
    if (!candidates || candidates.length === 0) return false;

    // A TGS code pasted into the title (e.g. "WSQ - Process and Design FMEA
    // (TGS-2023037830)") is exact and survives renames — prefer it over any
    // amount of title comparison.
    const code = extractCourseReferenceNumber(title);
    if (code && candidates.some(c => c.courseCode.trim().toUpperCase() === code)) return true;

    return candidates.some(c => courseTitlesMatch(c.title, title));
  };
}

export interface CourseRunCandidate {
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  startDate: string;
  endDate: string;
  /** 0..1 title similarity, for display and ordering. */
  score: number;
}

/**
 * How far either side of the stated start date we look for a plausible run.
 * 45 rather than 30: the case that prompted this had a 12 Sep date for a class
 * that ran 12 Aug — 31 days out, which a 30-day window misses by a day.
 */
const CANDIDATE_DATE_WINDOW_DAYS = 45;
// Popular courses run weekly, so a single course can fill the list. 8 keeps
// roughly a month of runs visible for the winning course.
const MAX_CANDIDATES_PER_ROW = 8;

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Find runs the admin might have meant, for a (title, date) that didn't resolve.
 *
 * Searches a date window rather than the exact date on purpose: when an upload
 * fails, the date is as likely to be wrong as the title (the case that prompted
 * this had BOTH wrong — a 12 Sep date for a class that ran 12 Aug), and an
 * exact-date search would return nothing at all to choose from.
 */
export async function findCourseRunCandidates(
  title: string,
  isoStartDate: string,
): Promise<CourseRunCandidate[]> {
  const from = shiftIso(isoStartDate, -CANDIDATE_DATE_WINDOW_DAYS);
  const to = shiftIso(isoStartDate, CANDIDATE_DATE_WINDOW_DAYS);

  const result = await pool.query(
    `SELECT cr.course_run_id::text AS course_run_id,
            c.title::text          AS title,
            c.course_code::text    AS course_code,
            cr.start_date::text    AS start_date,
            cr.end_date::text      AS end_date
       FROM public.course_run cr
       JOIN public.course c ON c.id = cr.course_id
      WHERE cr.start_date::date BETWEEN $1::date AND $2::date
        AND COALESCE(cr.is_deleted, false) = false
        AND cr.course_run_id IS NOT NULL`,
    [from, to],
  );

  const code = extractCourseReferenceNumber(title);
  const scored = result.rows.map((r: any) => {
    const courseCode = String(r.course_code || '').trim().toUpperCase();
    // A matching TGS code is certainty, not similarity — pin it to the top.
    const score = code && courseCode === code ? 1 : scoreCourseTitleSimilarity(r.title, title);
    return {
      courseRunId: String(r.course_run_id),
      courseTitle: String(r.title || ''),
      courseCode: String(r.course_code || ''),
      startDate: String(r.start_date || '').slice(0, 10),
      endDate: String(r.end_date || '').slice(0, 10),
      score,
    };
  });

  return scored
    .filter(c => c.score > 0.2) // below this the words barely overlap — noise
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Same relevance: prefer the run closest to the date they gave.
      const da = Math.abs(Date.parse(a.startDate) - Date.parse(isoStartDate));
      const db = Math.abs(Date.parse(b.startDate) - Date.parse(isoStartDate));
      return da - db;
    })
    .slice(0, MAX_CANDIDATES_PER_ROW);
}

function validateRow(
  row: Record<string, string>,
  rowNumber: number,
  resolveCourseRun: (title: string, isoStartDate: string) => boolean,
): RowValidationError | null {
  const issues: string[] = [];
  const get = (col: string) => String(row[col] ?? '').trim();

  for (const { column, label } of REQUIRED_FIELDS) {
    if (!get(column)) issues.push(`${label} is empty`);
  }

  const nric = get('Trainee NRIC/FIN Number*');
  if (nric && !NRIC_PATTERN.test(nric)) {
    issues.push(`Trainee NRIC/FIN "${nric}" is not a valid Singapore NRIC/FIN format (expected e.g. S1234567A)`);
  }

  const uen = get('Employer UEN*');
  if (uen && !UEN_PATTERN.test(uen)) {
    issues.push(`Employer UEN "${uen}" is not a valid UEN format (expected 9-10 alphanumeric characters)`);
  }

  const traineeEmail = get('Trainee Company email Address*');
  if (traineeEmail && !EMAIL_PATTERN.test(traineeEmail)) {
    issues.push(`Trainee Email "${traineeEmail}" is not a valid email address`);
  }

  const employerEmail = get('Employer Contact Email Address*');
  if (employerEmail && !EMAIL_PATTERN.test(employerEmail)) {
    issues.push(`Employer Contact Email "${employerEmail}" is not a valid email address`);
  }

  const dobRaw = get('Date of Birth* (DD-MM-YYYY)');
  let dobParsed: ParsedDate | null = null;
  if (dobRaw) {
    dobParsed = parseDdMmYyyy(dobRaw);
    if (!dobParsed) {
      issues.push(`Date of Birth "${dobRaw}" is not a valid DD-MM-YYYY date (check that the day/month aren't swapped)`);
    } else {
      const now = new Date();
      if (dobParsed.year < 1900 || dobParsed.year > now.getUTCFullYear()) {
        issues.push(`Date of Birth year ${dobParsed.year} is out of plausible range (1900-${now.getUTCFullYear()})`);
      }
    }
  }

  const startRaw = get('Course Start Date (DD-MM-YYYY)*');
  let startParsed: ParsedDate | null = null;
  if (startRaw) {
    startParsed = parseDdMmYyyy(startRaw);
    if (!startParsed) {
      issues.push(`Course Start Date "${startRaw}" is not a valid DD-MM-YYYY date (check that the day/month aren't swapped)`);
    }
  }

  const title = get('Course Title*');
  let courseRunUnresolved = false;
  if (title && startParsed) {
    if (!resolveCourseRun(title, startParsed.iso)) {
      courseRunUnresolved = true;
      issues.push(`No course run found in the LMS for "${title}" on ${startParsed.iso} — pick the correct run below, or fix the title/date in the Excel`);
    }
  }

  if (issues.length === 0) return null;

  return {
    rowNumber,
    traineeName: get('Trainee FULL Name as on government ID*') || '(no name)',
    traineeNric: nric || '(no NRIC)',
    courseTitle: title || '(no course title)',
    issues,
    // Only offer the picker when the run is the ONLY thing wrong — resolving it
    // on a row that also has, say, a bad NRIC would still fail on re-submit.
    ...(courseRunUnresolved && issues.length === 1
      ? { courseRunUnresolved: { courseTitle: title, courseStartDate: startRaw, candidates: [] } }
      : {}),
  };
}

export async function validateCompanyApplicationRows(
  rows: Array<Record<string, string>>,
  overrides: CourseRunOverride[] = [],
): Promise<RowValidationError[]> {
  if (rows.length === 0) return [];

  // Rows the admin has already answered "did you mean this run?" for.
  const overridden = new Set(overrides.map(o => overrideKey(o.courseTitle, o.courseStartDate)));

  const baseResolve = await buildCourseRunResolver(rows);
  const errors: RowValidationError[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowKey = overrideKey(row['Course Title*'], row['Course Start Date (DD-MM-YYYY)*']);
    const resolve = overridden.has(rowKey) ? () => true : baseResolve;
    const err = validateRow(row, i + 1, resolve); // 1-based data-row index (header row not counted)
    if (err) errors.push(err);
  }

  // Attach "did you mean" candidates. Done here, after validation, so the
  // window query only runs when something actually failed — and once per
  // distinct (title, date) rather than once per learner.
  const needCandidates = errors.filter(e => e.courseRunUnresolved);
  if (needCandidates.length > 0) {
    const byKey = new Map<string, CourseRunCandidate[]>();
    for (const err of needCandidates) {
      const { courseTitle, courseStartDate } = err.courseRunUnresolved!;
      const key = overrideKey(courseTitle, courseStartDate);
      if (!byKey.has(key)) {
        const parsed = parseDdMmYyyy(courseStartDate);
        byKey.set(key, parsed ? await findCourseRunCandidates(courseTitle, parsed.iso) : []);
      }
      err.courseRunUnresolved!.candidates = byKey.get(key)!;
    }
  }

  return errors;
}
