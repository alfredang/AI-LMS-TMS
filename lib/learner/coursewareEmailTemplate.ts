/** Client-safe courseware rendering shared by the scheduled sender and previews. */
export type CoursewareScenario = 'funded' | 'non-funded' | 'unrecognised';
export const COURSEWARE_SCENARIOS: CoursewareScenario[] = ['funded', 'non-funded', 'unrecognised'];
export const COURSEWARE_CONDITIONS = [
  'FUNDED', 'NON_FUNDED', 'UNRECOGNISED', 'SHOW_FUNDED', 'SHOW_NON_FUNDED',
  'HAS_RUN_CODE', 'NO_RUN_CODE', 'HAS_ATTENDANCE_LINK', 'NO_ATTENDANCE_LINK',
] as const;
type Condition = typeof COURSEWARE_CONDITIONS[number];
export const COURSEWARE_VARIABLES = [
  'EMAIL_PURPOSE', 'STUDENT_NAME', 'COURSE_NAME', 'COURSE_CODE', 'COURSE_RUN_CODE',
  'COURSE_DATES', 'COURSE_START_DATE', 'COURSE_START_TIME', 'COURSE_VENUE',
  'DIGITAL_ATTENDANCE_ID', 'E_ATTENDANCE_URL', 'COMPANY_NAME', 'COMPANY_SHORT_NAME',
  'COMPANY_WEBSITE', 'COMPANY_EMAIL', 'COMPANY_PHONE', 'SITE_URL',
] as const;
export interface CoursewareValues {
  courseCode: string;
  courseName: string;
  courseRunCode?: string;
  courseDates?: string;
  courseStartDate?: string;
  courseStartTime?: string;
  courseVenue?: string;
  studentName?: string;
  attendanceId?: string;
  /** Only the sender may establish this from the funded class record. */
  attendanceVerified?: boolean;
  companyName?: string;
  companyShortName?: string;
  companyWebsite?: string;
  companyEmail?: string;
  companyPhone?: string;
  siteUrl?: string;
}
export class CoursewareTemplateError extends Error {}
export const escapeCoursewareHtml = (s: string) => s.replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function coursewareScenario(code: unknown): CoursewareScenario {
  const normalized = String(code ?? '').trim().toUpperCase();
  if (/^TGS-\S+$/.test(normalized)) return 'funded';
  if (/^C(?:-\S+|\d[A-Z0-9-]*)$/.test(normalized)) return 'non-funded';
  return 'unrecognised';
}
export function isConditionalCoursewareTemplate(body: string): boolean {
  return /<!--\s*cw:/i.test(body);
}

/** Limited HTML-comment blocks; no expression evaluation or template execution. */
function blocks(source: string, flags: Partial<Record<Condition, boolean>>): string {
  const marker = /<!--\s*cw:(?:if\s+([A-Z_]+)|(end))\s*-->/g;
  const stack: boolean[] = [];
  let output = '', cursor = 0;
  for (const match of source.matchAll(marker)) {
    const chunk = source.slice(cursor, match.index);
    if (/<!--\s*cw:/i.test(chunk)) throw new CoursewareTemplateError('Invalid courseware conditional marker.');
    if (stack.every(Boolean)) output += chunk;
    if (match[1]) {
      if (!COURSEWARE_CONDITIONS.includes(match[1] as Condition)) throw new CoursewareTemplateError(`Unknown courseware condition: ${match[1]}`);
      if (stack.length >= 12) throw new CoursewareTemplateError('Courseware conditions are nested too deeply.');
      stack.push(!!flags[match[1] as Condition]);
    } else if (!stack.length) throw new CoursewareTemplateError('Courseware end marker has no opening condition.');
    else stack.pop();
    cursor = match.index! + match[0].length;
  }
  const tail = source.slice(cursor);
  if (/<!--\s*cw:/i.test(tail)) throw new CoursewareTemplateError('Invalid courseware conditional marker.');
  if (stack.length) throw new CoursewareTemplateError('Courseware condition is missing its end marker.');
  return output + tail;
}
export function validateCoursewareTemplate(subject: string, body: string): void {
  if (subject.length > 1000 || body.length > 250000) throw new CoursewareTemplateError('Courseware template is too large.');
  if (/<!--\s*cw:/i.test(subject)) throw new CoursewareTemplateError('Use variables, not conditional blocks, in the subject.');
  blocks(body, {});
  // Preserve old ordinary HTML, including historical third-party placeholders.
  if (isConditionalCoursewareTemplate(body)) {
    for (const m of (subject + body).matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)) {
      if (!COURSEWARE_VARIABLES.includes(m[1] as typeof COURSEWARE_VARIABLES[number]))
        throw new CoursewareTemplateError(`Unknown courseware variable: ${m[1]}`);
    }
  }
}
export function coursewareDates(start: string, end?: string): string {
  return !end || start === end ? start : `${start} - ${end}`;
}
export function renderCoursewareEmail(subject: string, body: string, data: CoursewareValues) {
  validateCoursewareTemplate(subject, body);
  const scenario = coursewareScenario(data.courseCode);
  const runCode = String(data.courseRunCode || '').trim();
  const attendanceId = String(data.attendanceId || '').trim();
  // A C-code/MMS identifier must never become an SWDA attendance link.
  const attendanceUrl = scenario !== 'non-funded' && data.attendanceVerified && /^[1-9]\d{3,11}$/.test(attendanceId)
    ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${attendanceId}` : '';
  const flags: Record<Condition, boolean> = {
    FUNDED: scenario === 'funded', NON_FUNDED: scenario === 'non-funded', UNRECOGNISED: scenario === 'unrecognised',
    SHOW_FUNDED: scenario !== 'non-funded', SHOW_NON_FUNDED: scenario !== 'funded',
    HAS_RUN_CODE: !!runCode, NO_RUN_CODE: !runCode,
    HAS_ATTENDANCE_LINK: !!attendanceUrl, NO_ATTENDANCE_LINK: !attendanceUrl,
  };
  const values: Record<string, string> = {
    EMAIL_PURPOSE: scenario === 'funded' ? 'Course Materials, Attendance and WSQ Assessment'
      : scenario === 'non-funded' ? 'Course Materials and Class Access' : 'Course Materials and Login Guidance',
    STUDENT_NAME: data.studentName || '', COURSE_NAME: data.courseName,
    COURSE_CODE: data.courseCode || 'Please confirm with your trainer', COURSE_RUN_CODE: runCode || 'Please confirm with your trainer',
    COURSE_DATES: data.courseDates || '', COURSE_START_DATE: data.courseStartDate || '',
    COURSE_START_TIME: data.courseStartTime || '', COURSE_VENUE: data.courseVenue || '',
    DIGITAL_ATTENDANCE_ID: attendanceId, E_ATTENDANCE_URL: attendanceUrl,
    COMPANY_NAME: data.companyName || 'Training Provider', COMPANY_SHORT_NAME: data.companyShortName || data.companyName || 'Training Provider',
    COMPANY_WEBSITE: data.companyWebsite || '', COMPANY_EMAIL: data.companyEmail || '', COMPANY_PHONE: data.companyPhone || '', SITE_URL: data.siteUrl || '',
  };
  // Resolve conditions BEFORE values. Replacement is single-pass, so inserted data cannot introduce executable markers or variables.
  const htmlSource = /<[a-z][\s\S]*>/i.test(body);
  const replace = (source: string, html: boolean) => source.replace(/\{([A-Z][A-Z0-9_]*)\}/g,
    (all, key) => Object.hasOwn(values, key) ? (html ? escapeCoursewareHtml(values[key]) : values[key]) : all);
  const renderedBody = replace(blocks(body, flags), htmlSource);
  const html = `<div style="font-family:Arial,sans-serif;color:#333;">${htmlSource ? renderedBody : escapeCoursewareHtml(renderedBody).replace(/\r\n|\r|\n/g, '<br>')}</div>`;
  return { scenario, subject: replace(subject, false).replace(/[\r\n]+/g, ' ').trim(), html, body: renderedBody };
}
export function coursewareSample(scenario: CoursewareScenario, company: Partial<CoursewareValues> = {}): CoursewareValues {
  return {
    courseName: scenario === 'funded' ? 'Multi AI Agents Workflow for Content Creation'
      : scenario === 'non-funded' ? 'Microsoft 365 Administrator Training (MS-102)' : 'Example Training Course',
    courseCode: scenario === 'funded' ? 'TGS-SAMPLE' : scenario === 'non-funded' ? 'C251' : 'EXAMPLE-UNCONFIRMED',
    courseRunCode: 'SAMPLE-ONLY', courseDates: 'Sample class dates', studentName: 'Example Learner',
    attendanceVerified: false, companyName: 'Training Provider', ...company,
  };
}
