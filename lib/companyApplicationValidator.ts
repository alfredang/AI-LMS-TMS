import pool from './db';

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

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\bwsq\b/g, '')
    .trim();
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
    `SELECT c.title::text AS title, cr.start_date::text AS start_date
       FROM public.course_run cr
       JOIN public.course c ON c.id = cr.course_id
      WHERE cr.start_date::date = ANY($1::date[])`,
    [Array.from(startDates)],
  );

  const byDate = new Map<string, string[]>();
  for (const r of result.rows) {
    const iso = String(r.start_date).slice(0, 10);
    const arr = byDate.get(iso) || [];
    arr.push(String(r.title || ''));
    byDate.set(iso, arr);
  }

  return (title, isoStartDate) => {
    const candidates = byDate.get(isoStartDate);
    if (!candidates || candidates.length === 0) return false;
    const target = normalizeTitle(title);
    if (!target) return false;
    return candidates.some(candidate => {
      const c = normalizeTitle(candidate);
      return c === target || c.includes(target) || target.includes(c);
    });
  };
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
  if (title && startParsed) {
    if (!resolveCourseRun(title, startParsed.iso)) {
      issues.push(`No course run found in the LMS for "${title}" on ${startParsed.iso} — create the course run first, or fix the title/date in the Excel`);
    }
  }

  if (issues.length === 0) return null;

  return {
    rowNumber,
    traineeName: get('Trainee FULL Name as on government ID*') || '(no name)',
    traineeNric: nric || '(no NRIC)',
    courseTitle: title || '(no course title)',
    issues,
  };
}

export async function validateCompanyApplicationRows(
  rows: Array<Record<string, string>>,
): Promise<RowValidationError[]> {
  if (rows.length === 0) return [];
  const resolveCourseRun = await buildCourseRunResolver(rows);
  const errors: RowValidationError[] = [];
  for (let i = 0; i < rows.length; i++) {
    const err = validateRow(rows[i], i + 1, resolveCourseRun); // 1-based data-row index (header row not counted)
    if (err) errors.push(err);
  }
  return errors;
}
