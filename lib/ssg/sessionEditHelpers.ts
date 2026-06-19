/**
 * Shared, framework-agnostic helpers for editing SSG course-run SESSIONS.
 *
 * Extracted from components/admin/ClassManagementViews.tsx so the (buried) Edit
 * Class → Sessions tab AND the new top-level "Reschedule & Cancel" page build the
 * exact same SSG payloads — single source of truth, no divergence.
 *
 * The SSG run-edit endpoint (`/api/ssg/courses/courseRuns/{runId}?action=update-sessions
 * | delete-sessions`) expects a FLAT body carrying the run window + venue +
 * registration fields (not just the session). Those run-detail fields come from
 * `ssgApiResponse.data.course.run` (fetched via `GET /api/ssg/courses?runId=`).
 */
import { OptionalSelector } from './models/course-runs';

// ── Date helpers ──────────────────────────────────────────────────────────────

/** SSG date (YYYYMMDD) → HTML date (YYYY-MM-DD). Passes through YYYY-MM-DD. */
export const convertSsgDateToHtml = (ssgDate: number | string): string => {
  if (!ssgDate) return '';
  const dateStr = ssgDate.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
  }
  return '';
};

/** HTML date (YYYY-MM-DD) → SSG numeric date (YYYYMMDD). */
export const convertHtmlDateToSsg = (htmlDate: string): number => {
  if (!htmlDate) return 0;
  return parseInt(htmlDate.replace(/-/g, ''));
};

/** Human schedule-info string from a run window. */
export const generateScheduleInfo = (startDate: string, endDate: string): string => {
  if (!startDate || !endDate) return 'Course dates not specified';
  return `${startDate} - ${endDate}`;
};

// ── Mode of training ──────────────────────────────────────────────────────────

export const modeOfTrainingOptions = [
  { value: '1', label: '1 - Classroom' },
  { value: '2', label: '2 - Asynchronous eLearning' },
  { value: '3', label: '3 - In-house' },
  { value: '4', label: '4 - On-the-Job' },
  { value: '5', label: '5 - Blended Learning' },
  { value: '6', label: '6 - Synchronous eLearning' },
  { value: '7', label: '7 - Practical / Traineeship' },
  { value: '8', label: '8 - Assessment' },
  { value: '9', label: '9 - Virtual Classroom' },
];

export const getModeLabel = (modeValue: string | number): string => {
  const mode = modeOfTrainingOptions.find((o) => o.value === String(modeValue));
  return mode ? mode.label : `Mode ${modeValue}`;
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** A session row, as carried by the Sessions tab / class-sessions endpoint. */
export interface EditableSession {
  id?: string;                 // SSG sessionId (required for update/delete)
  startDate?: string;          // YYYY-MM-DD or YYYYMMDD
  endDate?: string;
  startTime?: string;          // HH:mm
  endTime?: string;
  modeOfTraining?: string | number;
  venue?: any;
}

/** Optional form-level overrides (the Edit tab's editFormData); empty for the new page. */
export type RunFormOverrides = Partial<{
  openingRegistrationDate: string;
  closingRegistrationDate: string;
  courseStartDate: string;
  courseEndDate: string;
  block: string; street: string; floor: string; unit: string; building: string;
  postalCode: string; room: string;
  wheelChairAccess: OptionalSelector;
  courseVacancy: { code: string; description: string };
}>;

// ── Run window (the SSG "Overflow rule") ──────────────────────────────────────

/**
 * SSG rejects a session outside the run window, so the window must be widened to
 * cover a session moved past its edge. YYYY-MM-DD compares lexically.
 */
export function computeRunWindow(runData: any, overrides: RunFormOverrides, sessStart: string, sessEnd: string) {
  const origRunStart = (runData?.courseStartDate ?? runData?.courseDates?.start)
    ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start)
    : (overrides.courseStartDate || '');
  const origRunEnd = (runData?.courseEndDate ?? runData?.courseDates?.end)
    ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end)
    : (overrides.courseEndDate || '');
  const newRunStart = (sessStart && (!origRunStart || sessStart < origRunStart)) ? sessStart : origRunStart;
  const newRunEnd = (sessEnd && (!origRunEnd || sessEnd > origRunEnd)) ? sessEnd : origRunEnd;
  const runDatesChanged = (newRunStart !== origRunStart) || (newRunEnd !== origRunEnd);
  return { origRunStart, origRunEnd, newRunStart, newRunEnd, runDatesChanged };
}

// ── Payload builders (flat shape expected by the API route) ────────────────────

const regOpening = (runData: any, o: RunFormOverrides) =>
  (runData?.registrationOpeningDate ?? runData?.registrationDates?.opening)
    ? convertSsgDateToHtml(runData.registrationOpeningDate ?? runData.registrationDates?.opening)
    : (o.openingRegistrationDate || '');
const regClosing = (runData: any, o: RunFormOverrides) =>
  (runData?.registrationClosingDate ?? runData?.registrationDates?.closing)
    ? convertSsgDateToHtml(runData.registrationClosingDate ?? runData.registrationDates?.closing)
    : (o.closingRegistrationDate || '');

interface BuildArgs {
  courseReferenceNumber: string;
  runData: any;                 // ssgApiResponse.data.course.run
  session: EditableSession;
  currentUserEmail: string;
  overrides?: RunFormOverrides;
}

/** Map one session into the flat update-session shape the API route expects. */
function mapUpdateSession(session: EditableSession, runData: any, o: RunFormOverrides) {
  return {
    action: 'update',
    sessionId: session.id || '',
    startDate: session.startDate ? String(session.startDate).replace(/-/g, '') : '',
    endDate: session.endDate ? String(session.endDate).replace(/-/g, '') : '',
    startTime: session.startTime || '',
    endTime: session.endTime || '',
    modeOfTraining: session.modeOfTraining || '',
    sessionBlock: session.venue?.block || o.block || runData?.venue?.block || '',
    sessionStreet: session.venue?.street || o.street || runData?.venue?.street || '',
    sessionFloor: session.venue?.floor || o.floor || runData?.venue?.floor || '',
    sessionUnit: session.venue?.unit || o.unit || runData?.venue?.unit || '',
    sessionBuilding: session.venue?.building || o.building || runData?.venue?.building || '',
    sessionPostalCode: session.venue?.postalCode || o.postalCode || runData?.venue?.postalCode || '',
    sessionRoom: session.venue?.room || o.room || runData?.venue?.room || '',
  };
}

/** Flat body for `action=update-sessions` covering one OR many sessions. */
export function buildUpdateSessionsPayload(
  args: Omit<BuildArgs, 'session'> & { sessions: EditableSession[]; newRunStart: string; newRunEnd: string }
) {
  const { courseReferenceNumber, runData, sessions, currentUserEmail, newRunStart, newRunEnd } = args;
  const o: RunFormOverrides = args.overrides || {};
  return {
    courseReferenceNumber,
    openingRegistrationDate: regOpening(runData, o),
    closingRegistrationDate: regClosing(runData, o),
    // Widened to encompass the session(s) (SSG rejects sessions outside the run window).
    courseStartDate: newRunStart,
    courseEndDate: newRunEnd,
    scheduleInfoTypeCode: '01',
    scheduleInfoTypeDescription: 'Description',
    block: o.block || runData?.venue?.block || '',
    street: o.street || runData?.venue?.street || '',
    floor: o.floor || runData?.venue?.floor || '',
    unit: o.unit || runData?.venue?.unit || '',
    building: o.building || runData?.venue?.building || '',
    postalCode: o.postalCode || runData?.venue?.postalCode || '',
    room: o.room || runData?.venue?.room || '',
    wheelChairAccess: o.wheelChairAccess || (runData?.venue?.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO),
    courseAdminEmail: currentUserEmail,
    courseVacancy: o.courseVacancy || runData?.courseVacancy || { code: 'A', description: 'Available' },
    fileName: '',
    fileContent: '',
    sessions: sessions.map((s) => mapUpdateSession(s, runData, o)),
  };
}

/** Flat body for `action=update-sessions` (one session, action="update"). */
export function buildUpdateSessionPayload(
  args: BuildArgs & { newRunStart: string; newRunEnd: string }
) {
  const { session, ...rest } = args;
  return buildUpdateSessionsPayload({ ...rest, sessions: [session] });
}

/** Flat body for `action=delete-sessions` (one session, action="delete"). */
export function buildDeleteSessionPayload(args: BuildArgs) {
  const { courseReferenceNumber, runData, session, currentUserEmail } = args;
  const o: RunFormOverrides = args.overrides || {};
  const courseStartDate = (runData?.courseStartDate ?? runData?.courseDates?.start)
    ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (o.courseStartDate || '');
  const courseEndDate = (runData?.courseEndDate ?? runData?.courseDates?.end)
    ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (o.courseEndDate || '');
  return {
    courseReferenceNumber,
    openingRegistrationDate: regOpening(runData, o),
    closingRegistrationDate: regClosing(runData, o),
    courseStartDate,
    courseEndDate,
    scheduleInfoTypeCode: '01',
    scheduleInfoTypeDescription: 'Description',
    scheduleInfo: generateScheduleInfo(courseStartDate, courseEndDate),
    block: o.block || runData?.venue?.block || '',
    street: o.street || runData?.venue?.street || '',
    floor: o.floor || runData?.venue?.floor || '',
    unit: o.unit || runData?.venue?.unit || '',
    building: o.building || runData?.venue?.building || '',
    postalCode: o.postalCode || runData?.venue?.postalCode || '',
    room: o.room || runData?.venue?.room || '',
    wheelChairAccess: o.wheelChairAccess || (runData?.venue?.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO),
    courseAdminEmail: currentUserEmail,
    courseVacancy: o.courseVacancy || runData?.courseVacancy || { code: 'A', description: 'Available' },
    fileName: '',
    fileContent: '',
    sessions: [
      {
        action: 'delete',
        sessionId: session.id || '',
        startDate: session.startDate ? String(session.startDate) : '20251025',
        endDate: session.endDate ? String(session.endDate) : '20251025',
        startTime: session.startTime || '15:30',
        endTime: session.endTime || '18:30',
        modeOfTraining: session.modeOfTraining || '8',
        sessionBlock: session.venue?.block || '12',
        sessionStreet: session.venue?.street || 'WOODLANDS SQUARE',
        sessionFloor: session.venue?.floor || '07',
        sessionUnit: session.venue?.unit || '85-87',
        sessionBuilding: session.venue?.building || 'WOODS SQUARE',
        sessionPostalCode: session.venue?.postalCode || '737715',
        sessionRoom: session.venue?.room || 'Tertiary Courses Training Venue',
      },
    ],
  };
}

/** Flat body for `action=delete-sessions` covering one OR many sessions (e.g. a whole day). */
export function buildDeleteSessionsPayload(
  args: Omit<BuildArgs, 'session'> & { sessions: EditableSession[] }
) {
  const { sessions, ...rest } = args;
  const base = buildDeleteSessionPayload({ ...rest, session: sessions[0] });
  return {
    ...base,
    sessions: sessions.map((s) => ({
      action: 'delete',
      sessionId: s.id || '',
      startDate: s.startDate ? String(s.startDate) : '20251025',
      endDate: s.endDate ? String(s.endDate) : '20251025',
      startTime: s.startTime || '15:30',
      endTime: s.endTime || '18:30',
      modeOfTraining: s.modeOfTraining || '8',
      sessionBlock: s.venue?.block || '12',
      sessionStreet: s.venue?.street || 'WOODLANDS SQUARE',
      sessionFloor: s.venue?.floor || '07',
      sessionUnit: s.venue?.unit || '85-87',
      sessionBuilding: s.venue?.building || 'WOODS SQUARE',
      sessionPostalCode: s.venue?.postalCode || '737715',
      sessionRoom: s.venue?.room || 'Tertiary Courses Training Venue',
    })),
  };
}
