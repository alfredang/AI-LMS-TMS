// The TPGateway "Bulk Upload" enrolment file (SWDA Enrolment Upload Template V1.2, kept at
// public/ssg_templates/Enrolment_Upload_Template_V1.2.xlsx). One row per learner, in the
// template's column order; every value is text so dates and phone numbers reach TPGateway
// exactly as written (DD-MM-YYYY, no dropped leading zeros).

export const UPLOAD_TEMPLATE_URL = '/ssg_templates/Enrolment_Upload_Template_V1.2.xlsx';
export const UPLOAD_TEMPLATE_SHEET = 'Enrolment Upload Template';

/** Header row of the template's upload tab (kept letter for letter: TPGateway reads the CSV by it). */
export const UPLOAD_TEMPLATE_HEADERS = [
  'Trainee ID Type *',
  'Trainee ID *',
  'Date of Birth (DD-MM-YYYY or DD/MM/YYYY format) *',
  'Trainee Name (as on government ID)',
  'Course Run*',
  'Trainee Email *',
  'Trainee Phone Country Code (+xx) *',
  'Trainee Phone Area Code ',
  'Trainee Phone *',
  'Sponsorship Type *',
  'Employer UEN (mandatory if sponsorship type = employer)',
  'Employer Contact Name  (mandatory if sponsorship type = employer)',
  'Employer Phone Country Code (+xx)  (mandatory if sponsorship type = employer)',
  'Employer Phone Area Code',
  'Employer Phone  (mandatory if sponsorship type = employer)',
  'Employer Contact Email  (mandatory if sponsorship type = employer)',
  'Course Fee Discount Amount (where applicable)',
  'Fee Collection Status',
  'Bundle Code (mandatory if sponsorship type = individual for SCTP course)',
] as const;

export interface UploadLearner {
  traineeName: string;
  nric: string;
  dateOfBirth: string; // YYYY-MM-DD
  email: string;
  contactNumber: string;
  sponsorshipType: 'Individual' | 'Employer' | string;
  employerUen?: string | null;
  employerContactName?: string | null;
  employerContactEmail?: string | null;
  employerContactNumber?: string | null;
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
/** A local number without the 65 prefix (TPGateway takes the country code in its own column). */
const localPhone = (v: unknown) => {
  const d = digits(v);
  return d.length === 10 && d.startsWith('65') ? d.slice(2) : d;
};
/** YYYY-MM-DD → DD-MM-YYYY (the only order TPGateway reads correctly). */
export const toTemplateDate = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/**
 * Template rows for the learners, plus what is still missing per learner (a mandatory cell that
 * would make TPGateway reject the row). `courseRunId` is the SSG course run id, e.g. 1490174.
 */
export function buildEnrolmentUploadRows(learners: UploadLearner[], courseRunId: string): { rows: string[][]; issues: string[] } {
  const issues: string[] = [];
  const rows = learners.map((l) => {
    const nric = String(l.nric || '').trim().toUpperCase();
    const employer = l.sponsorshipType === 'Employer';
    const row = [
      /^[ST]/.test(nric) ? 'NRIC' : /^[FGM]/.test(nric) ? 'FIN' : 'Others',
      nric,
      toTemplateDate(l.dateOfBirth),
      String(l.traineeName || '').trim().slice(0, 66),
      String(courseRunId || '').trim(),
      String(l.email || '').trim(),
      '65',
      '',
      localPhone(l.contactNumber),
      employer ? 'Employer' : 'Individual',
      employer ? String(l.employerUen || '').trim().toUpperCase() : '',
      employer ? String(l.employerContactName || '').trim().slice(0, 66) : '',
      employer ? '65' : '',
      '',
      employer ? localPhone(l.employerContactNumber) : '',
      employer ? String(l.employerContactEmail || '').trim() : '',
      '',
      // Left blank, TPGateway defaults to this; written out so the file says what will be recorded.
      'Pending Payment',
      '',
    ];
    const missing: string[] = [];
    if (!row[1]) missing.push('NRIC/FIN');
    if (!row[2]) missing.push('date of birth');
    if (!row[5]) missing.push('email');
    if (!row[8]) missing.push('phone');
    if (employer) {
      if (!row[10]) missing.push('employer UEN');
      if (!row[11]) missing.push('employer contact name');
      if (!row[14]) missing.push('employer phone');
      if (!row[15]) missing.push('employer contact email');
    }
    if (missing.length) issues.push(`${row[3] || nric}: ${missing.join(', ')}`);
    return row;
  });
  return { rows, issues };
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** The upload tab as CSV (comma delimited), the format TPGateway's Bulk Upload takes. */
export function enrolmentUploadCsv(rows: string[][]): string {
  return [UPLOAD_TEMPLATE_HEADERS as readonly string[], ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
