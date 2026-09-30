import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');

const args = process.argv.slice(2);
const command = args[0] || 'plan';
const getArg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasArg = (name) => args.includes(name);
const asOfDate = getArg('--as-of');
const throughDate = getArg('--through');
const scopeMode = getArg('--scope', 'recent-applications');
const submissionsPath = path.resolve(root, getArg('--submissions', ''));
const rejectedPath = path.resolve(root, getArg('--rejected', ''));
const courseListingPath = path.resolve(root, getArg('--course-listing', ''));
const traqomReportArg = getArg('--traqom-report');
const traqomReportPath = traqomReportArg ? path.resolve(root, traqomReportArg) : null;
const outDir = path.resolve(root, getArg('--outdir', 'outputs/tpg-renewal-sync'));
const planPath = path.resolve(root, getArg('--plan', path.join(path.relative(root, outDir), 'plan.json')));
const includeTrackedApplications = !hasArg('--window-only');

if (!asOfDate) throw new Error('--as-of is required.');
if (!['recent-applications', 'funding-window'].includes(scopeMode)) {
  throw new Error('--scope must be recent-applications or funding-window.');
}
if (scopeMode === 'funding-window' && !throughDate) throw new Error('--through is required for funding-window scope.');
if (scopeMode === 'recent-applications' && (throughDate || hasArg('--window-only'))) {
  throw new Error('--through and --window-only apply only to funding-window scope.');
}
if (!getArg('--submissions') || !getArg('--rejected') || !getArg('--course-listing')) {
  throw new Error('--submissions, --rejected, and --course-listing are required.');
}

const clean = (value) => (value == null ? '' : String(value).trim());
const refKey = (value) => clean(value).toUpperCase();
const decodeEntities = (value) => clean(value)
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');
const titleKey = (value) => decodeEntities(value).replace(/\s+/g, ' ').trim().toLowerCase();
const parseDate = (value) => {
  const s = clean(value);
  if (!s || s === '-') return null;
  let match = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return s;
  throw new Error(`Unrecognized date: ${value}`);
};
const shiftMonths = (isoDate, months) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Invalid ISO date: ${isoDate}`);
  const source = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(source.getTime()) || source.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`Invalid calendar date: ${isoDate}`);
  }
  const monthStart = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  monthStart.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return monthStart.toISOString().slice(0, 10);
};
const applicationCutoffDate = scopeMode === 'recent-applications' ? shiftMonths(asOfDate, -3) : null;
const mapStatus = (value) => {
  const status = clean(value);
  if (!status) return null;
  if (status === 'Approved') return 'Approved';
  if (status === 'Rejected') return 'Rejected/Expired';
  return status;
};
const sha256 = (buffer) => `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
const numberOrNull = (value) => value == null ? null : Number(value);

function dbClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
  });
}

async function readCapture(file, sectionName) {
  const bytes = await fs.readFile(file);
  const capture = JSON.parse(bytes.toString('utf8'));
  const section = capture[sectionName];
  if (!capture.sourceUrl || !capture.scrapedAt || !section || !Array.isArray(section.rows)) {
    throw new Error(`${file} is missing capture metadata or ${sectionName}.rows.`);
  }
  if (section.count !== section.rows.length) throw new Error(`${file} count does not equal rows.length.`);
  if (!Number.isInteger(section.pages) || !Array.isArray(section.pageSummaries) || section.pageSummaries.length !== section.pages) {
    throw new Error(`${file} is missing complete pagination evidence.`);
  }
  return { bytes, capture, section, sha: sha256(bytes) };
}

async function readTraqomReport(file) {
  const bytes = await fs.readFile(file);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  if (workbook.SheetNames.length !== 1) throw new Error('TRAQOM report must contain exactly one sheet.');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const required = [
    'Course Ref Number',
    'Course Renewal (TRAQOM Response Rate (%))',
    'Course Renewal (TRAQOM Quality Rating)',
  ];
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, sheetRows: 1 })[0] || [];
  for (const header of required) {
    if (!headers.includes(header)) throw new Error(`TRAQOM report is missing column: ${header}`);
  }
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const seenRefs = new Set();
  const rows = rawRows.map((row, index) => {
    const courseRef = refKey(row['Course Ref Number']);
    const responseRate = row[required[1]];
    const qualityRating = row[required[2]];
    if (!courseRef || seenRefs.has(courseRef)) {
      throw new Error(`TRAQOM report row ${index + 2} has a blank or duplicate course reference: ${courseRef}`);
    }
    seenRefs.add(courseRef);
    if (typeof responseRate !== 'number' || !Number.isFinite(responseRate) || responseRate < 0 || responseRate > 100 ||
        typeof qualityRating !== 'number' || !Number.isFinite(qualityRating) || qualityRating < 0 || qualityRating > 5) {
      throw new Error(`TRAQOM report row ${index + 2} has an invalid response rate or quality rating.`);
    }
    return { courseRef, responseRate, qualityRating, rowNumber: index + 2 };
  });
  return { path: file, sha256: sha256(bytes), sheetName, rows };
}

function candidateFrom(row, sourceTab) {
  return {
    sourceTab,
    applicationNo: clean(row['Application Ref. No.']) || null,
    courseRef: clean(row['Course Ref. No.']),
    courseTitle: clean(row['Course Title']),
    normalizedTitle: titleKey(row['Course Title']),
    dateSubmitted: parseDate(row['Date Submitted']),
    rawStatus: clean(row.Status),
    submissionType: clean(row['Submission Type']),
    courseType: clean(row['Course Type']),
    raw: row,
  };
}

async function queryScope() {
  const client = dbClient();
  await client.connect();
  try {
    const result = await client.query(
      `SELECT c.id, c.title, c.course_code, c.new_course_code, c.course_type,
              NULLIF(BTRIM(c.funding_validity), '')::date::text AS funding_validity,
              c.actual_renew_date::text AS actual_renew_date,
              NULLIF(BTRIM(c.renewal_application_no), '') AS renewal_application_no,
              NULLIF(BTRIM(c.renewed_status), '') AS renewed_status,
              NULLIF(BTRIM(c.submission_type), '') AS submission_type,
              c.traqom_response_rate,
              c.traqom_quality_rating,
              COALESCE(array_agg(DISTINCT h.code) FILTER (WHERE h.code IS NOT NULL), '{}') AS history_codes
         FROM public.course c
         LEFT JOIN public.course_code_history h ON h.course_id = c.id
        GROUP BY c.id
        ORDER BY NULLIF(BTRIM(c.funding_validity), '')::date NULLS LAST, c.title, c.id`,
    );
    return { rows: result.rows, allRefs: result.rows };
  } finally {
    await client.end();
  }
}

function selectCandidate(course, candidates, knownTitles = [], refOwners = null) {
  const refs = new Set([
    course.course_code,
    course.new_course_code,
    ...(course.history_codes || []),
  ].map(refKey).filter(Boolean));
  const titles = new Set([course.title, ...knownTitles].map(titleKey).filter(Boolean));
  const priorApp = clean(course.renewal_application_no);
  const matched = candidates.filter((candidate) => {
    if (!candidate.applicationNo) return false;
    if (refOwners && candidate.courseRef) {
      const owners = refOwners.get(refKey(candidate.courseRef));
      if (owners && !owners.has(course.id)) return false;
    }
    return refs.has(refKey(candidate.courseRef))
      || titles.has(candidate.normalizedTitle)
      || (priorApp && priorApp !== 'NOT Found' && priorApp === candidate.applicationNo);
  });
  matched.sort((a, b) => {
    if ((a.dateSubmitted || '') !== (b.dateSubmitted || '')) return (b.dateSubmitted || '').localeCompare(a.dateSubmitted || '');
    if (a.sourceTab !== b.sourceTab) return a.sourceTab === 'Submissions' ? -1 : 1;
    return (b.applicationNo || '').localeCompare(a.applicationNo || '');
  });
  const selected = matched[0] || null;
  if (!selected) return { selected: null, evidence: [], matchedApplications: [] };
  const evidence = [];
  if (refs.has(refKey(selected.courseRef))) evidence.push('exact-course-ref');
  if (titles.has(selected.normalizedTitle)) evidence.push('exact-title');
  if (priorApp && priorApp !== 'NOT Found' && priorApp === selected.applicationNo) evidence.push('exact-application');
  return {
    selected,
    evidence,
    matchedApplications: matched.map((candidate) => ({
      applicationNo: candidate.applicationNo,
      dateSubmitted: candidate.dateSubmitted,
      sourceTab: candidate.sourceTab,
      submissionType: candidate.submissionType,
      rawStatus: candidate.rawStatus,
    })),
  };
}

function makeListingIndexes(courseListing) {
  const byRef = new Map();
  const byTitle = new Map();
  for (const row of courseListing.section.rows) {
    const ref = refKey(row['Course Ref. No.']);
    const title = titleKey(row['Course Title']);
    if (ref) (byRef.get(ref) || byRef.set(ref, []).get(ref)).push(row);
    if (title) (byTitle.get(title) || byTitle.set(title, []).get(title)).push(row);
  }
  return { byRef, byTitle };
}

function selectListing(course, selectedApplication, indexes) {
  const refs = new Set([
    course.course_code,
    course.new_course_code,
    ...(course.history_codes || []),
  ].map(refKey).filter(Boolean));
  const direct = [...refs].flatMap((ref) => indexes.byRef.get(ref) || []);
  const directUnique = [...new Map(direct.map((row) => [refKey(row['Course Ref. No.']), row])).values()];
  if (directUnique.length === 1) return { row: directUnique[0], evidence: 'exact-known-course-ref' };

  const titleCandidates = [];
  const currentTitle = titleKey(course.title);
  const selectedTitle = titleKey(selectedApplication?.courseTitle);
  if (currentTitle) titleCandidates.push(...(indexes.byTitle.get(currentTitle) || []));
  if (selectedTitle) titleCandidates.push(...(indexes.byTitle.get(selectedTitle) || []));
  const unique = [...new Map(titleCandidates.map((row) => [refKey(row['Course Ref. No.']), row])).values()];
  if (unique.length !== 1) return { row: null, evidence: unique.length > 1 ? 'ambiguous-exact-title' : null };
  const row = unique[0];
  const evidence = selectedTitle && titleKey(row['Course Title']) === selectedTitle
    ? 'exact-selected-application-title'
    : 'exact-database-title';
  return { row, evidence };
}

function makeGlobalRefOwnerMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const refs = [row.course_code, row.new_course_code, ...(row.history_codes || [])].map(refKey).filter(Boolean);
    for (const ref of refs) {
      const owners = map.get(ref) || new Set();
      owners.add(row.id);
      map.set(ref, owners);
    }
  }
  return map;
}

function buildRows(dbRows, allRefRows, submissions, rejected, courseListing, traqomReport) {
  const allCandidates = [
    ...submissions.section.rows.map((row) => candidateFrom(row, 'Submissions')),
    ...rejected.section.rows.map((row) => candidateFrom(row, 'Rejected Applications')),
  ];
  const candidates = scopeMode === 'recent-applications'
    ? allCandidates.filter((candidate) => candidate.dateSubmitted >= applicationCutoffDate && candidate.dateSubmitted <= asOfDate)
    : allCandidates;
  const candidateByApplication = new Map(allCandidates.map((candidate) => [candidate.applicationNo, candidate]));
  const listingIndexes = makeListingIndexes(courseListing);
  const refOwners = makeGlobalRefOwnerMap(allRefRows);
  const traqomByCourse = new Map();
  const unmatchedTraqomRefs = [];
  for (const sourceRow of traqomReport?.rows || []) {
    const owners = refOwners.get(sourceRow.courseRef) || new Set();
    if (owners.size === 0) {
      unmatchedTraqomRefs.push(sourceRow.courseRef);
      continue;
    }
    if (owners.size !== 1) throw new Error(`TRAQOM reference ${sourceRow.courseRef} belongs to multiple database courses.`);
    const courseId = [...owners][0];
    if (traqomByCourse.has(courseId)) {
      throw new Error(`Multiple TRAQOM report references resolve to database course ${courseId}.`);
    }
    traqomByCourse.set(courseId, sourceRow);
  }

  const rows = dbRows.map((course) => {
    const traqomMatch = traqomByCourse.get(course.id) || null;
    const knownRefs = [course.course_code, course.new_course_code, ...(course.history_codes || [])].map(refKey).filter(Boolean);
    const knownListingTitles = [...new Set(knownRefs.flatMap((ref) => listingIndexes.byRef.get(ref) || []))]
      .map((row) => row['Course Title']);
    const inWindow = Boolean(
      course.course_type === 'WSQ'
      && course.funding_validity
      && course.funding_validity >= asOfDate
      && course.funding_validity <= throughDate,
    );
    const hasTrackedApplication = /^TPG-/.test(clean(course.renewal_application_no));
    const inRenewalScope = scopeMode === 'recent-applications'
      ? true
      : inWindow || (includeTrackedApplications && hasTrackedApplication);
    const { selected, evidence, matchedApplications = [] } = inRenewalScope
      ? selectCandidate(
        course,
        candidates,
        scopeMode === 'recent-applications' ? knownListingTitles : [],
        scopeMode === 'recent-applications' ? refOwners : null,
      )
      : { selected: null, evidence: [] };
    const listing = scopeMode === 'funding-window'
      ? selectListing(course, selected, listingIndexes)
      : { row: null, evidence: null };
    const priorApp = clean(course.renewal_application_no) || null;
    const before = {
      actualRenewDate: course.actual_renew_date || null,
      renewalApplicationNo: priorApp,
      renewedStatus: course.renewed_status || null,
      submissionType: course.submission_type || null,
      traqomResponseRate: numberOrNull(course.traqom_response_rate),
      traqomQualityRating: numberOrNull(course.traqom_quality_rating),
      newCourseCode: clean(course.new_course_code) || null,
    };

    let desiredRenewal;
    let operation;
    if (scopeMode === 'recent-applications') {
      if (!selected && !traqomMatch) return null;
      if (!selected) {
        desiredRenewal = {
          actualRenewDate: before.actualRenewDate,
          renewalApplicationNo: before.renewalApplicationNo,
          renewedStatus: before.renewedStatus,
          submissionType: before.submissionType,
        };
        operation = 'traqom-only';
      } else {
        if (selected.courseRef && !knownRefs.includes(refKey(selected.courseRef))) {
          const otherOwners = [...(refOwners.get(refKey(selected.courseRef)) || new Set())].filter((id) => id !== course.id);
          if (otherOwners.length) {
            throw new Error(`Application ${selected.applicationNo} has course ref owned by another database course.`);
          }
        }
        const storedApplication = candidateByApplication.get(priorApp);
        const storedApplicationOwners = storedApplication?.courseRef
          ? refOwners.get(refKey(storedApplication.courseRef)) || new Set()
          : new Set();
        const storedApplicationBelongsElsewhere = storedApplicationOwners.size > 0
          && !storedApplicationOwners.has(course.id);
        if (before.actualRenewDate && before.actualRenewDate > selected.dateSubmitted && !storedApplicationBelongsElsewhere) {
          desiredRenewal = {
            actualRenewDate: before.actualRenewDate,
            renewalApplicationNo: before.renewalApplicationNo,
            renewedStatus: before.renewedStatus,
            submissionType: before.submissionType,
          };
          operation = 'stored-newer-than-capture-skipped';
        } else {
          desiredRenewal = {
            actualRenewDate: selected.dateSubmitted,
            renewalApplicationNo: selected.applicationNo,
            renewedStatus: mapStatus(selected.rawStatus),
            submissionType: selected.submissionType || before.submissionType,
          };
          operation = priorApp === selected.applicationNo ? 'already-current'
            : storedApplicationBelongsElsewhere ? 'misassigned-application-corrected'
              : priorApp && priorApp !== 'NOT Found' ? 'superseded-by-newer'
              : 'resolved-unresolved';
        }
      }
    } else if (!inRenewalScope) {
      desiredRenewal = {
        actualRenewDate: before.actualRenewDate,
        renewalApplicationNo: before.renewalApplicationNo,
        renewedStatus: before.renewedStatus,
        submissionType: before.submissionType,
      };
      operation = 'course-code-only';
    } else if (selected) {
      desiredRenewal = {
        actualRenewDate: selected.dateSubmitted,
        renewalApplicationNo: selected.applicationNo,
        renewedStatus: mapStatus(selected.rawStatus),
        submissionType: before.submissionType,
      };
      operation = 'already-current';
      if (priorApp && priorApp !== 'NOT Found' && priorApp !== selected.applicationNo) operation = 'superseded-by-newer';
      else if (!priorApp || priorApp === 'NOT Found') operation = 'resolved-unresolved';
      else if (!evidence.includes('exact-application')) operation = 'missing-prior-recovered';
      else if (!inWindow) operation = 'tracked-application-reconciled';
    } else if (inWindow) {
      desiredRenewal = { actualRenewDate: null, renewalApplicationNo: 'NOT Found', renewedStatus: null, submissionType: before.submissionType };
      operation = priorApp && priorApp !== 'NOT Found' ? 'missing-prior-to-not-found' : 'not-found';
    } else {
      desiredRenewal = {
        actualRenewDate: before.actualRenewDate,
        renewalApplicationNo: before.renewalApplicationNo,
        renewedStatus: before.renewedStatus,
        submissionType: before.submissionType,
      };
      operation = 'tracked-application-not-in-capture-skipped';
    }

    const listingRef = refKey(listing.row?.['Course Ref. No.']);
    const desiredNewCourseCode = scopeMode === 'recent-applications' ? before.newCourseCode : listingRef || before.newCourseCode;
    const conflictingOwners = listingRef
      ? [...(refOwners.get(listingRef) || new Set())].filter((id) => id !== course.id)
      : [];
    const codeConflict = conflictingOwners.length > 0;
    const desired = {
      ...desiredRenewal,
      traqomResponseRate: traqomMatch?.responseRate ?? before.traqomResponseRate,
      traqomQualityRating: traqomMatch?.qualityRating ?? before.traqomQualityRating,
      newCourseCode: codeConflict ? before.newCourseCode : desiredNewCourseCode,
    };
    const renewalChanged = JSON.stringify({
      actualRenewDate: before.actualRenewDate,
      renewalApplicationNo: before.renewalApplicationNo,
      renewedStatus: before.renewedStatus,
    }) !== JSON.stringify({
      actualRenewDate: desired.actualRenewDate,
      renewalApplicationNo: desired.renewalApplicationNo,
      renewedStatus: desired.renewedStatus,
    });
    const codeChanged = before.newCourseCode !== desired.newCourseCode;
    const submitTypeChanged = before.submissionType !== desired.submissionType;
    const traqomChanged = before.traqomResponseRate !== desired.traqomResponseRate
      || before.traqomQualityRating !== desired.traqomQualityRating;

    return {
      id: course.id,
      courseTitle: course.title,
      courseRefs: [course.new_course_code, course.course_code, ...(course.history_codes || [])].map(clean).filter(Boolean),
      courseType: course.course_type,
      fundingValidity: course.funding_validity,
      inWindow,
      inRecentApplicationScope: scopeMode === 'recent-applications' && Boolean(selected),
      hasTrackedApplication,
      inRenewalScope: scopeMode === 'recent-applications' ? Boolean(selected) : inRenewalScope,
      expectedCurrentApplicationNo: priorApp,
      expectedNewCourseCode: before.newCourseCode,
      operation,
      matchEvidence: evidence,
      sourceTab: selected?.sourceTab || null,
      rawStatus: selected?.rawStatus || null,
      selectedApplication: selected,
      traqomReportMatch: traqomMatch ? { courseRef: traqomMatch.courseRef, rowNumber: traqomMatch.rowNumber } : null,
      matchedApplications: scopeMode === 'recent-applications' ? matchedApplications : undefined,
      courseListingMatch: listing.row ? {
        courseRef: clean(listing.row['Course Ref. No.']),
        courseTitle: clean(listing.row['Course Title']),
        validFrom: parseDate(listing.row['Valid From']),
        validTo: parseDate(listing.row['Valid To']),
        evidence: listing.evidence,
      } : null,
      listingMatchIssue: listing.evidence === 'ambiguous-exact-title' ? listing.evidence : null,
      codeConflict: codeConflict ? { target: listingRef, conflictingCourseIds: conflictingOwners } : null,
      before,
      desired,
      renewalChanged,
      submitTypeChanged,
      traqomChanged,
      codeChanged,
      changed: renewalChanged || submitTypeChanged || traqomChanged || codeChanged,
    };
  }).filter((row) => row && (scopeMode === 'recent-applications' || row.inRenewalScope || row.codeChanged));
  if (scopeMode === 'recent-applications') {
    const selectedOwners = new Map();
    for (const row of rows) {
      if (!row.selectedApplication) continue;
      const app = row.selectedApplication.applicationNo;
      const priorOwner = selectedOwners.get(app);
      if (priorOwner && priorOwner !== row.id) throw new Error(`Application ${app} matched multiple database courses.`);
      selectedOwners.set(app, row.id);
    }
  }
  return { rows, unmatchedTraqomRefs, matchedTraqomCourses: traqomByCourse.size };
}

function captureSummary(file, capture, section) {
  return {
    path: file,
    sha256: capture.sha,
    scrapedAt: capture.capture.scrapedAt,
    sourceUrl: capture.capture.sourceUrl,
    rows: section.rows.length,
    reportedTotal: section.count,
    completenessEvidence: `pages=${section.pages}`,
  };
}

async function makePlan() {
  const [submissions, rejected, courseListing, traqomReport] = await Promise.all([
    readCapture(submissionsPath, 'submissions'),
    readCapture(rejectedPath, 'rejectedApplications'),
    readCapture(courseListingPath, 'courseListing'),
    traqomReportPath ? readTraqomReport(traqomReportPath) : Promise.resolve(null),
  ]);
  const scrapeTimes = [submissions, rejected, courseListing].map((capture) => Date.parse(capture.capture.scrapedAt));
  if (scrapeTimes.some(Number.isNaN)) throw new Error('Capture timestamps are missing or invalid.');
  const skewMinutes = (Math.max(...scrapeTimes) - Math.min(...scrapeTimes)) / 60000;
  if (skewMinutes > 180) throw new Error(`Capture timestamps exceed 180 minutes skew (${skewMinutes}).`);

  const { rows: dbRows, allRefs } = await queryScope();
  const { rows, unmatchedTraqomRefs, matchedTraqomCourses } = buildRows(
    dbRows, allRefs, submissions, rejected, courseListing, traqomReport,
  );
  const conflicts = rows.filter((row) => row.codeConflict);
  const recentCandidates = scopeMode === 'recent-applications'
    ? [
      ...submissions.section.rows.map((row) => candidateFrom(row, 'Submissions')),
      ...rejected.section.rows.map((row) => candidateFrom(row, 'Rejected Applications')),
    ].filter((candidate) => candidate.dateSubmitted >= applicationCutoffDate && candidate.dateSubmitted <= asOfDate)
    : [];
  const recentByApplication = new Map();
  for (const candidate of recentCandidates) {
    if (candidate.applicationNo && !recentByApplication.has(candidate.applicationNo)) {
      recentByApplication.set(candidate.applicationNo, candidate);
    }
  }
  const matchedApplicationNos = new Set(rows.flatMap((row) => row.matchedApplications || [])
    .map((application) => application.applicationNo));
  const unmatchedRecentApplications = [...recentByApplication.values()]
    .filter((candidate) => !matchedApplicationNos.has(candidate.applicationNo))
    .map((candidate) => ({
      applicationNo: candidate.applicationNo,
      dateSubmitted: candidate.dateSubmitted,
      sourceTab: candidate.sourceTab,
      courseRef: candidate.courseRef,
      courseTitle: candidate.courseTitle,
      courseType: candidate.courseType,
      submissionType: candidate.submissionType,
      rawStatus: candidate.rawStatus,
      reason: 'no-safe-exact-database-course-match',
    }));
  const plan = {
    schemaVersion: scopeMode === 'recent-applications' ? 4 : 3,
    kind: 'tpg-renewal-and-current-code-database-plan',
    createdAt: new Date().toISOString(),
    scope: {
      timezone: 'Asia/Singapore',
      asOfDate,
      throughDate: scopeMode === 'funding-window' ? throughDate : null,
      applicationCutoffDate,
      inclusive: true,
      windowCourseType: scopeMode === 'funding-window' ? 'WSQ' : 'all database course types',
      trackedApplicationCourseTypes: scopeMode === 'funding-window' ? 'all' : null,
      mode: scopeMode === 'recent-applications'
        ? 'recent-applications'
        : includeTrackedApplications ? 'window-plus-tracked-applications' : 'window-only',
      outOfWindowMissingCaptureBehavior: 'preserve-existing-values',
      maxCaptureSkewMinutes: 180,
      captureSkewMinutes: skewMinutes,
    },
    captures: {
      submissions: captureSummary(submissionsPath, submissions, submissions.section),
      rejectedApplications: captureSummary(rejectedPath, rejected, rejected.section),
      courseListing: captureSummary(courseListingPath, courseListing, courseListing.section),
    },
    traqomReport: traqomReport ? {
      path: traqomReport.path,
      sha256: traqomReport.sha256,
      sheetName: traqomReport.sheetName,
      rows: traqomReport.rows.length,
      matchedCourses: matchedTraqomCourses,
      unmatchedCourseRefs: unmatchedTraqomRefs,
    } : null,
    summary: {
      selectedCourses: rows.length,
      ...(scopeMode === 'recent-applications' ? {
        recentCapturedApplications: recentByApplication.size,
        unmatchedRecentApplications: unmatchedRecentApplications.length,
      } : {}),
      recentApplicationCourses: rows.filter((row) => row.inRecentApplicationScope).length,
      storedNewerThanCaptureSkipped: rows.filter((row) => row.operation === 'stored-newer-than-capture-skipped').length,
      misassignedApplicationsCorrected: rows.filter((row) => row.operation === 'misassigned-application-corrected').length,
      multipleMatchedApplications: rows.filter((row) => (row.matchedApplications?.length || 0) > 1).length,
      renewalScopeCourses: rows.filter((row) => row.inRenewalScope).length,
      courseCodeOnlyCourses: rows.filter((row) => !row.inRenewalScope && row.codeChanged).length,
      inWindow: scopeMode === 'funding-window' ? rows.filter((row) => row.inWindow).length : 0,
      trackedOutsideWindow: scopeMode === 'funding-window' ? rows.filter((row) => row.inRenewalScope && !row.inWindow).length : 0,
      trackedOutsideWindowReconciled: rows.filter((row) => row.operation === 'tracked-application-reconciled').length,
      trackedOutsideWindowSkipped: rows.filter((row) => row.operation === 'tracked-application-not-in-capture-skipped').length,
      wouldUpdate: rows.filter((row) => row.changed).length,
      renewalWouldUpdate: rows.filter((row) => row.renewalChanged).length,
      submissionTypeWouldUpdate: rows.filter((row) => row.submitTypeChanged).length,
      traqomWouldUpdate: rows.filter((row) => row.traqomChanged).length,
      traqomMatchedCourses: matchedTraqomCourses,
      traqomUnmatchedRefs: unmatchedTraqomRefs.length,
      courseCodeWouldUpdate: rows.filter((row) => row.codeChanged).length,
      alreadyCorrect: rows.filter((row) => !row.changed).length,
      supersededByNewer: rows.filter((row) => row.operation === 'superseded-by-newer').length,
      missingPriorRecovered: rows.filter((row) => row.operation === 'missing-prior-recovered').length,
      missingPriorToNotFound: rows.filter((row) => row.operation === 'missing-prior-to-not-found').length,
      resolvedUnresolved: rows.filter((row) => row.operation === 'resolved-unresolved').length,
      notFoundInWindow: rows.filter((row) => row.inWindow && !row.selectedApplication).length,
      statusUnsetInWindow: rows.filter((row) => row.inWindow && !row.desired.renewedStatus).length,
      foundInSubmissions: rows.filter((row) => row.sourceTab === 'Submissions').length,
      foundInRejectedApplications: rows.filter((row) => row.sourceTab === 'Rejected Applications').length,
      listingMatches: rows.filter((row) => row.courseListingMatch).length,
      ambiguousListingTitles: rows.filter((row) => row.listingMatchIssue).length,
      codeConflicts: conflicts.length,
    },
    ...(scopeMode === 'recent-applications' ? { unmatchedRecentApplications } : {}),
    rows,
  };
  plan.planHash = sha256(Buffer.from(JSON.stringify(plan), 'utf8'));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ planPath: path.join(outDir, 'plan.json'), planHash: plan.planHash, scope: plan.scope, summary: plan.summary }, null, 2));
}

async function insertChangeLog(client, courseId, field, label, oldValue, newValue) {
  if ((oldValue ?? null) === (newValue ?? null)) return;
  await client.query(
    `INSERT INTO public.course_change_log
       (course_id, field, field_label, old_value, new_value, changed_by, changed_by_name, note)
     VALUES ($1, $2, $3, $4, $5, NULL, 'TPG renewal sync', $6)`,
    [courseId, field, label, oldValue, newValue,
      scopeMode === 'recent-applications' ? 'Verified stored TPG capture synchronization' : 'Verified live TPG synchronization'],
  );
}

async function applyPlan() {
  const confirm = getArg('--confirm-plan-hash');
  if (!confirm) throw new Error('--confirm-plan-hash is required for apply.');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const { planHash, ...unsigned } = plan;
  const actualHash = sha256(Buffer.from(JSON.stringify(unsigned), 'utf8'));
  if (actualHash !== planHash || confirm !== planHash) {
    throw new Error(`Plan hash mismatch. expected=${planHash} actual=${actualHash} confirm=${confirm}`);
  }
  if (plan.schemaVersion !== (scopeMode === 'recent-applications' ? 4 : 3)) {
    throw new Error('Plan schema version is not supported by this synchronizer. Generate a new plan.');
  }
  if (plan.summary.codeConflicts) throw new Error(`Plan contains ${plan.summary.codeConflicts} course-code conflicts.`);
  const expectedMode = scopeMode === 'recent-applications'
    ? 'recent-applications'
    : includeTrackedApplications ? 'window-plus-tracked-applications' : 'window-only';
  if (plan.scope.mode !== expectedMode || plan.scope.asOfDate !== asOfDate ||
      plan.scope.throughDate !== (scopeMode === 'funding-window' ? throughDate : null)) {
    throw new Error('Plan scope does not match the apply command.');
  }
  const expectedCaptures = [
    { file: submissionsPath, section: 'submissions', planned: plan.captures.submissions },
    { file: rejectedPath, section: 'rejectedApplications', planned: plan.captures.rejectedApplications },
    { file: courseListingPath, section: 'courseListing', planned: plan.captures.courseListing },
  ];
  for (const { file, section, planned } of expectedCaptures) {
    const current = await readCapture(file, section);
    if (path.resolve(planned.path) !== file || current.sha !== planned.sha256) {
      throw new Error(`Stored ${section} capture differs from the reviewed plan.`);
    }
  }
  if (Boolean(plan.traqomReport) !== Boolean(traqomReportPath)) {
    throw new Error('TRAQOM report selection differs from the reviewed plan.');
  }
  if (traqomReportPath) {
    const currentReport = await readTraqomReport(traqomReportPath);
    if (path.resolve(plan.traqomReport.path) !== traqomReportPath || currentReport.sha256 !== plan.traqomReport.sha256) {
      throw new Error('TRAQOM workbook differs from the reviewed plan.');
    }
  }

  const client = dbClient();
  await client.connect();
  let committed = false;
  const appliedRows = [];
  try {
    await client.query('BEGIN');
    for (const item of plan.rows) {
      const currentResult = await client.query(
        `SELECT id, title, course_code, NULLIF(BTRIM(new_course_code), '') AS new_course_code,
                actual_renew_date::text AS actual_renew_date,
                NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
                NULLIF(BTRIM(renewed_status), '') AS renewed_status,
                NULLIF(BTRIM(submission_type), '') AS submission_type,
                traqom_response_rate,
                traqom_quality_rating
           FROM public.course WHERE id = $1 FOR UPDATE`,
        [item.id],
      );
      if (currentResult.rowCount !== 1) throw new Error(`${item.id} did not match exactly one course.`);
      const current = currentResult.rows[0];
      const currentApp = clean(current.renewal_application_no) || null;
      const currentNewCode = clean(current.new_course_code) || null;
      if (currentApp !== item.expectedCurrentApplicationNo) throw new Error(`Renewal application optimistic lock failed for ${item.courseTitle}.`);
      if (currentNewCode !== item.expectedNewCourseCode) throw new Error(`Current course-code optimistic lock failed for ${item.courseTitle}.`);

      const before = {
        actualRenewDate: current.actual_renew_date || null,
        renewalApplicationNo: currentApp,
        renewedStatus: current.renewed_status || null,
        submissionType: current.submission_type || null,
        traqomResponseRate: numberOrNull(current.traqom_response_rate),
        traqomQualityRating: numberOrNull(current.traqom_quality_rating),
        newCourseCode: currentNewCode,
      };
      if (JSON.stringify(before) !== JSON.stringify(item.before)) {
        throw new Error(`Course fields changed after planning for ${item.courseTitle}.`);
      }
      const desired = item.desired;
      const changed = JSON.stringify(before) !== JSON.stringify(desired);
      if (changed) {
        await insertChangeLog(client, item.id, 'renewedStatus', 'Renewal Status', before.renewedStatus, desired.renewedStatus);
        await insertChangeLog(client, item.id, 'submissionType', 'Submit Type', before.submissionType, desired.submissionType);
        await insertChangeLog(client, item.id, 'traqomResponseRate', 'TRAQOM %', before.traqomResponseRate, desired.traqomResponseRate);
        await insertChangeLog(client, item.id, 'traqomQualityRating', 'TRAQOM Rating', before.traqomQualityRating, desired.traqomQualityRating);
        await insertChangeLog(client, item.id, 'newCourseCode', 'Course Code (Current)', before.newCourseCode, desired.newCourseCode);
        await client.query(
          `UPDATE public.course
              SET actual_renew_date = $2::date,
                  renewal_application_no = $3,
                  renewed_status = $4,
                  new_course_code = $5,
                  submission_type = $6,
                  traqom_response_rate = $7,
                  traqom_quality_rating = $8,
                  updated_at = NOW()
            WHERE id = $1`,
          [item.id, desired.actualRenewDate, desired.renewalApplicationNo, desired.renewedStatus, desired.newCourseCode,
            desired.submissionType, desired.traqomResponseRate, desired.traqomQualityRating],
        );
      }

      if (item.codeChanged) {
        const validFrom = item.courseListingMatch?.validFrom || null;
        await client.query(
          `UPDATE public.course_code_history
              SET is_current = false,
                  valid_to = COALESCE(valid_to, CASE WHEN $2::date IS NULL THEN NULL ELSE $2::date - 1 END),
                  updated_at = NOW()
            WHERE course_id = $1 AND is_current AND code <> $3`,
          [item.id, validFrom, desired.newCourseCode],
        );
        await client.query(
          `INSERT INTO public.course_code_history (course_id, code, valid_from, valid_to, is_current, note)
           VALUES ($1, $2, $3::date, NULL, true, 'TPG renewal sync')
           ON CONFLICT (code) DO UPDATE
                 SET valid_from = COALESCE(EXCLUDED.valid_from, public.course_code_history.valid_from),
                     valid_to = NULL,
                     is_current = true,
                     updated_at = NOW(),
                     note = 'TPG renewal sync'`,
          [item.id, desired.newCourseCode, validFrom],
        );
      }

      const verifyResult = await client.query(
        `SELECT actual_renew_date::text AS actual_renew_date,
                NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
                NULLIF(BTRIM(renewed_status), '') AS renewed_status,
                NULLIF(BTRIM(submission_type), '') AS submission_type,
                traqom_response_rate,
                traqom_quality_rating,
                NULLIF(BTRIM(new_course_code), '') AS new_course_code
           FROM public.course WHERE id = $1`,
        [item.id],
      );
      const verify = verifyResult.rows[0];
      const after = {
        actualRenewDate: verify.actual_renew_date || null,
        renewalApplicationNo: verify.renewal_application_no || null,
        renewedStatus: verify.renewed_status || null,
        submissionType: verify.submission_type || null,
        traqomResponseRate: numberOrNull(verify.traqom_response_rate),
        traqomQualityRating: numberOrNull(verify.traqom_quality_rating),
        newCourseCode: verify.new_course_code || null,
      };
      if (JSON.stringify(after) !== JSON.stringify(desired)) throw new Error(`Post-write verification failed for ${item.courseTitle}.`);
      if (item.codeChanged) {
        const history = await client.query(
          `SELECT code FROM public.course_code_history WHERE course_id = $1 AND is_current`,
          [item.id],
        );
        if (history.rowCount !== 1 || refKey(history.rows[0].code) !== refKey(desired.newCourseCode)) {
          throw new Error(`Course-code history verification failed for ${item.courseTitle}.`);
        }
      }
      appliedRows.push({
        id: item.id,
        courseTitle: item.courseTitle,
        courseRefs: item.courseRefs,
        operation: item.operation,
        sourceTab: item.sourceTab,
        before,
        desired,
        after,
        renewalChanged: item.renewalChanged,
        submitTypeChanged: item.submitTypeChanged,
        traqomChanged: item.traqomChanged,
        codeChanged: item.codeChanged,
        action: changed ? 'updated' : 'already-correct',
      });
    }
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  const audit = {
    status: 'committed-and-verified',
    mode: 'applied',
    committed,
    createdAt: new Date().toISOString(),
    planPath,
    planHash,
    scope: plan.scope,
    summary: {
      matched: appliedRows.length,
      updated: appliedRows.filter((row) => row.action === 'updated').length,
      renewalUpdated: appliedRows.filter((row) => row.renewalChanged).length,
      submissionTypeUpdated: appliedRows.filter((row) => row.submitTypeChanged).length,
      traqomUpdated: appliedRows.filter((row) => row.traqomChanged).length,
      courseCodeUpdated: appliedRows.filter((row) => row.codeChanged).length,
      alreadyCorrect: appliedRows.filter((row) => row.action === 'already-correct').length,
      failed: 0,
      foundInSubmissions: appliedRows.filter((row) => row.sourceTab === 'Submissions').length,
      foundInRejectedApplications: appliedRows.filter((row) => row.sourceTab === 'Rejected Applications').length,
      notFoundInWindow: appliedRows.filter((row) => row.operation === 'not-found' || row.operation === 'missing-prior-to-not-found').length,
      statusUnsetInWindow: appliedRows.filter((row) => row.operation === 'not-found' || row.operation === 'missing-prior-to-not-found').length,
      supersededByNewer: appliedRows.filter((row) => row.operation === 'superseded-by-newer').length,
      misassignedApplicationsCorrected: appliedRows.filter((row) => row.operation === 'misassigned-application-corrected').length,
      storedNewerThanCaptureSkipped: appliedRows.filter((row) => row.operation === 'stored-newer-than-capture-skipped').length,
      missingPriorRecovered: appliedRows.filter((row) => row.operation === 'missing-prior-recovered').length,
      trackedOutsideWindowReconciled: appliedRows.filter((row) => row.operation === 'tracked-application-reconciled').length,
      trackedOutsideWindowSkipped: appliedRows.filter((row) => row.operation === 'tracked-application-not-in-capture-skipped').length,
    },
    rows: appliedRows,
  };
  const auditPath = path.join(outDir, 'apply-audit.json');
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ auditPath, planHash, committed, summary: audit.summary }, null, 2));
}

if (command === 'plan') await makePlan();
else if (command === 'apply') await applyPlan();
else throw new Error(`Unknown command ${command}. Use plan or apply.`);
