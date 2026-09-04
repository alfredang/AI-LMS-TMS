import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { ConfirmPopup } from './ConfirmPopup';
import SupportingDocsModal from './SupportingDocsModal';
// Shared with the Direct Application screen so both read the same way.
import { FundingTypeBadge, InvoiceGeneratedOnCell, RenewedOnCell } from './DirectApplicationViews';
import { authHeader } from '../../lib/auth/authHeader';

// Shape returned by GET /api/admin/list-employers (QBO customers ∪ CA history ∪
// UEN alias map). `source` tells us where the record came from: 'qb'/'both' means
// it exists as a QuickBooks customer (invoice can generate); 'history' means it's
// only in our application history and is NOT in QBO yet.
interface EmployerLookupOption {
  id: string;
  employerUen: string;
  employerOrgName: string;
  employerContactName: string;
  employerContactDesignation: string;
  employerContactEmail: string;
  employerContactPhone: string;
  source: 'qb' | 'history' | 'both';
}

export const COMPANY_APPLICATION_COLUMNS = [
  'Course Title*',
  'Course Start Date (DD-MM-YYYY)*',
  'Course Reference Number',
  'Renewal (old to new)',
  'Renewed On',
  'Invoice Generated On',
  'Type',
  'Course Run ID',
  'Trainee Identity Type*',
  'Trainee FULL Name as on government ID*',
  'Trainee ID Type*',
  'Trainee NRIC/FIN Number*',
  'Date of Birth* (DD-MM-YYYY)',
  'Trainee Company email Address*',
  'Trainee Mobile Phone Number*',
  'Trainee Highest Qualification*',
  'Employer Organization Name*',
  'Employer UEN*',
  'Employer Contact Name*',
  'Employer Contact Designation*',
  'Employer Contact Telephone No.*',
  'Employer Contact Email Address*',
  'Have trainee(s) been given SSG funding before for the course applying for?',
  'Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met',
  'Declaration that all grant application information is true and accurate',
  'Consent to receive marketing information via newsletter',
  'Enrolment ID',
  'Enrolment Status',
  'Grant ID (BL)',
  'Amt (BL)',
  'Grant ID',
  'Scheme',
  'Amount',
  'TG Amt',
  'Invoice Doc Number',
  'Tax Invoice',
  'Grant Invoice',
  'Doc Verified',
  'Email',
];

const EXCEL_APPLICATION_COLUMNS = [
  'Course Title*',
  'Course Start Date (DD-MM-YYYY)*',
  'Trainee Identity Type*',
  'Trainee FULL Name as on government ID*',
  'Trainee ID Type*',
  'Trainee NRIC/FIN Number*',
  'Date of Birth* (DD-MM-YYYY)',
  'Trainee Company email Address*',
  'Trainee Mobile Phone Number*',
  'Trainee Highest Qualification*',
  'Employer Organization Name*',
  'Employer UEN*',
  'Employer Contact Name*',
  'Employer Contact Designation*',
  'Employer Contact Telephone No.*',
  'Employer Contact Email Address*',
  'Have trainee(s) been given SSG funding before for the course applying for?',
  'Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met',
  'Declaration that all grant application information is true and accurate',
  'Consent to receive marketing information via newsletter',
];

const COLUMN_DISPLAY_LABELS: Record<string, string> = {
  'Course Title*': 'Course Title',
  'Course Start Date (DD-MM-YYYY)*': 'Start Date',
  'Trainee Identity Type*': 'Identity Type',
  'Trainee FULL Name as on government ID*': 'Name',
  'Trainee ID Type*': 'ID Type',
  'Trainee NRIC/FIN Number*': 'NRIC',
  'Date of Birth* (DD-MM-YYYY)': 'DOB',
  'Trainee Company email Address*': 'Company Email',
  'Trainee Mobile Phone Number*': 'Phone',
  'Trainee Highest Qualification*': 'Highest Qualification',
  'Employer Organization Name*': 'Organization',
  'Employer UEN*': 'UEN',
  'Employer Contact Name*': 'Name',
  'Employer Contact Designation*': 'Designation',
  'Employer Contact Telephone No.*': 'Phone',
  'Employer Contact Email Address*': 'Email',
  'Have trainee(s) been given SSG funding before for the course applying for?': 'SSG Funded Before?',
  'Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met': 'SSG Consent',
  'Declaration that all grant application information is true and accurate': 'Declaration',
  'Consent to receive marketing information via newsletter': 'Marketing Consent',
  'Course Reference Number': 'Course Ref',
  'Renewal (old to new)': 'Renewal (old \u2192 new)',
  'Renewed On': 'Renewed On',
  'Invoice Generated On': 'Invoice Generated On',
  'Type': 'Type',
  'Course Run ID': 'Run ID',
  'Enrolment ID': 'Enrolment ID',
  'Enrolment Status': 'Enrolment Status',
  'Grant ID (BL)': 'Grant ID (BL)',
  'Amt (BL)': 'Amt (BL)',
  'Grant ID': 'Grant ID',
  'Scheme': 'Scheme',
  'Amount': 'Amount',
  'TG Amt': 'TG Amt',
  'Invoice Doc Number': 'Invoice #',
  'Email': 'Email',
  'Tax Invoice': 'Tax Invoice',
  'Grant Invoice': 'Grant Invoice',
  'Doc Verified': 'Doc Verified',
};

const VISIBLE_COLUMNS = COMPANY_APPLICATION_COLUMNS;

const COLUMN_GROUPS: Array<{ label: string; columns: string[]; className: string }> = [
  {
    label: 'COURSE',
    className: 'bg-blue-950 text-blue-300 border-b-2 border-blue-500',
    columns: [
      'Course Title*',
      'Course Start Date (DD-MM-YYYY)*',
      'Course Reference Number',
      'Renewal (old to new)',
      'Renewed On',
      'Invoice Generated On',
      'Type',
      'Course Run ID',
    ],
  },
  {
    label: 'TRAINEE',
    className: 'bg-green-950 text-green-300 border-b-2 border-green-500',
    columns: [
      'Trainee Identity Type*',
      'Trainee FULL Name as on government ID*',
      'Trainee ID Type*',
      'Trainee NRIC/FIN Number*',
      'Date of Birth* (DD-MM-YYYY)',
      'Trainee Company email Address*',
      'Trainee Mobile Phone Number*',
      'Trainee Highest Qualification*',
    ],
  },
  {
    label: 'EMPLOYER',
    className: 'bg-purple-950 text-purple-300 border-b-2 border-purple-500',
    columns: [
      'Employer Organization Name*',
      'Employer UEN*',
      'Employer Contact Name*',
      'Employer Contact Designation*',
      'Employer Contact Telephone No.*',
      'Employer Contact Email Address*',
    ],
  },
  {
    label: 'CONSENT',
    className: 'bg-amber-950 text-amber-300 border-b-2 border-amber-500',
    columns: [
      'Have trainee(s) been given SSG funding before for the course applying for?',
      'Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met',
      'Declaration that all grant application information is true and accurate',
      'Consent to receive marketing information via newsletter',
    ],
  },
  {
    label: 'ENROLMENT',
    className: 'bg-indigo-950 text-indigo-300 border-b-2 border-indigo-500',
    columns: [
      'Enrolment ID',
      'Enrolment Status',
    ],
  },
  {
    label: 'GRANT',
    className: 'bg-rose-950 text-rose-300 border-b-2 border-rose-500',
    columns: [
      'Grant ID (BL)',
      'Amt (BL)',
      'Grant ID',
      'Scheme',
      'Amount',
      'TG Amt',
    ],
  },
  {
    label: 'INVOICE',
    className: 'bg-black text-gray-300 border-b-2 border-gray-500',
    columns: [
      'Invoice Doc Number',
      'Tax Invoice',
      'Grant Invoice',
      'Doc Verified',
      'Email',
    ],
  },
];

export type CompanyApplicationRow = Record<string, string>;

const inputClasses = 'block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500';

const normalize = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\*/g, '')
    .trim()
    .toLowerCase();

// Show only the start date in MM/DD/YYYY format even when the source cell
// contains a date range and/or weekday tag (e.g. "18/22 May 2026 (Mon/Fri)"
// → "05/18/2026").
// PDPA-friendly NRIC display: mask all but the last 4 characters. Singapore
// NRICs are 9 chars (1 letter + 7 digits + 1 letter), so "S1234567A" → "*****567A".
export function maskNric(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '';
  if (value.length <= 4) return value;
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

// Day-month-year format for the Check Supporting Document group header where
// MM/DD/YYYY was confusing admins. e.g. "05/18/2026" → "18 May 2026".
export function formatCourseDateLong(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '';

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const toLong = (dd: string, mmIdx: number, yyyy: string) =>
    `${parseInt(dd, 10)} ${MONTH_NAMES[mmIdx]} ${yyyy}`;

  const textual = value.match(/^(\d{1,2})(?:\s*[\/\-,]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/);
  if (textual) {
    const [, dd, monthName, yyyy] = textual;
    const idx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthName.slice(0, 3).toLowerCase());
    if (idx >= 0) return toLong(dd, idx, yyyy);
  }

  const dmy = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const idx = parseInt(mm, 10) - 1;
    if (idx >= 0 && idx < 12) return toLong(dd, idx, yyyy);
  }

  const ymd = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const [, yyyy, mm, dd] = ymd;
    const idx = parseInt(mm, 10) - 1;
    if (idx >= 0 && idx < 12) return toLong(dd, idx, yyyy);
  }

  return value;
}

function formatStartDate(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '-';

  const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const toMmDdYyyy = (dd: string, mm: string, yyyy: string) =>
    `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}/${yyyy}`;

  const textual = value.match(/^(\d{1,2})(?:\s*[\/\-,]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/);
  if (textual) {
    const [, dd, monthName, yyyy] = textual;
    const mm = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (mm) return toMmDdYyyy(dd, mm, yyyy);
  }

  const dmy = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return toMmDdYyyy(dd, mm, yyyy);
  }

  const ymd = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const [, yyyy, mm, dd] = ymd;
    return toMmDdYyyy(dd, mm, yyyy);
  }

  return value;
}

const columnMatchers: Array<[string, (header: string) => boolean]> = [
  ['Course Title*', h => h.includes('course title')],
  ['Course Start Date (DD-MM-YYYY)*', h => h.includes('course start date') || h.includes('start date')],
  ['Trainee Identity Type*', h => h.includes('trainee identity type') || h.includes('identity type')],
  ['Trainee FULL Name as on government ID*', h => h.includes('trainee full name') || h.includes('full name as on government') || h.includes('full name') || h.includes('government id') || h.includes('trainee name')],
  ['Trainee ID Type*', h => h.includes('trainee id type') || (h.includes('id type') && !h.includes('identity'))],
  ['Trainee NRIC/FIN Number*', h => h.includes('nric') || h.includes('fin number') || h.includes('fin no') || h.includes('nric/fin')],
  ['Date of Birth* (DD-MM-YYYY)', h => h.includes('date of birth') || h === 'dob' || h.includes('birth date')],
  ['Trainee Company email Address*', h => h.includes('company email') || h.includes('trainee company email') || h.includes('trainee email')],
  ['Trainee Mobile Phone Number*', h => h.includes('mobile phone') || h.includes('mobile number') || (h.includes('trainee') && (h.includes('mobile') || (h.includes('phone') && !h.includes('employer'))))],
  ['Trainee Highest Qualification*', h => h.includes('highest qualification') || h.includes('qualification')],
  ['Employer Organization Name*', h => h.includes('employer organization') || h.includes('employer organisation') || h.includes('organization name') || h.includes('organisation name') || h.includes('company name')],
  ['Employer UEN*', h => h.includes('uen')],
  ['Employer Contact Name*', h => h.includes('employer contact name') || h.includes('contact name') || h.includes('contact person')],
  ['Employer Contact Designation*', h => h.includes('contact designation') || h.includes('designation')],
  ['Employer Contact Telephone No.*', h => h.includes('contact telephone') || h.includes('contact phone') || h.includes('contact tel') || (h.includes('employer') && h.includes('telephone'))],
  ['Employer Contact Email Address*', h => h.includes('contact email') || (h.includes('employer') && h.includes('email'))],
  ['Have trainee(s) been given SSG funding before for the course applying for?', h => h.includes('ssg funded before') || h.includes('ssg funding before') || h.includes('funded before') || h.includes('been given ssg') || h.includes('previous ssg') || h.includes('only one ssg') || (h.includes('ssg') && h.includes('applying for'))],
  ['Consent to SSG funding terms, attendance, assessment, and full-fee liability if requirements are not met', h => h.includes('ssg consent') || h.includes('consent to ssg') || h.includes('ssg funding terms') || h.includes('full-fee liability') || h.includes('full fee liability') || h.includes('attendance') || h.includes('full course fee') || h.includes('75%') || h.includes('certified competent') || h.includes('attendance/assessment')],
  ['Declaration that all grant application information is true and accurate', h => h === 'declaration' || h.startsWith('declaration ') || h.endsWith(' declaration') || h.includes('grant declaration') || h.includes('true and accurate') || h.includes('false or misleading') || h.includes('grant application form is true') || h.includes('information given in this grant') || h.includes('deliberately omitted')],
  ['Consent to receive marketing information via newsletter', h => h.includes('marketing consent') || h.includes('marketing') || h.includes('newsletter') || h.includes('unsubscribe')],
];

const getCellText = (value: unknown): string => {
  if (value == null) return '';
  if (value instanceof Date) return value.toLocaleDateString('en-GB');
  return String(value).trim();
};

type CompanyUploadResult = {
  inserted: number;
  updated: number;
  queued: number;
  insertedIds: string[];
};

// Why the background pipeline stopped short of "every row invoiced". Built by
// the poller when it detects a terminal state, so the spinner can be replaced
// by an explanation instead of spinning forever (the invoice is per employer
// group — one learner without a grant holds up the whole group's invoice).
type BackendStallInfo = {
  doneCount: number;
  total: number;
  /** Enrolled, but SSG hasn't produced a grant and they're not marked Not Grant Eligible. */
  awaitingGrant: string[];
  /** Never got an ENR- id — auto-enrol failed for these. */
  notEnrolled: string[];
  /** Rows carrying an auto-enrol error message. */
  failed: string[];
  /** Enrolled + grant settled, but no QBO invoice yet. */
  awaitingInvoice: number;
  /** False when rows are still 'pending' — i.e. we gave up waiting, the worker didn't finish. */
  workerFinished: boolean;
};

export interface CourseRunCandidate {
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  startDate: string;
  endDate: string;
  score: number;
}

export interface RowValidationError {
  rowNumber: number;
  traineeName: string;
  traineeNric: string;
  courseTitle: string;
  issues: string[];
  /** Set when the only problem is an unmatched course run — offer a picker. */
  courseRunUnresolved?: {
    courseTitle: string;
    courseStartDate: string;
    candidates: CourseRunCandidate[];
  };
}

/** The admin's "did you mean this run?" answer for one (title, date) group. */
export interface CourseRunOverride {
  courseTitle: string;
  courseStartDate: string;
  courseRunId: string;
}

// Custom error class so handleUpload can pluck the structured row-level
// validation errors off the rejection and render them in a popup, instead
// of just showing a single string in the red banner.
export class UploadValidationError extends Error {
  validationErrors: RowValidationError[];
  constructor(message: string, validationErrors: RowValidationError[]) {
    super(message);
    this.name = 'UploadValidationError';
    this.validationErrors = validationErrors;
  }
}

const uploadRows = async (
  rows: CompanyApplicationRow[],
  courseRunOverrides: CourseRunOverride[] = [],
): Promise<CompanyUploadResult> => {
  const response = await fetch('/api/admin/upload-company-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, courseRunOverrides }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (Array.isArray(err?.validationErrors) && err.validationErrors.length > 0) {
      throw new UploadValidationError(
        err?.message || 'Excel file has validation issues.',
        err.validationErrors as RowValidationError[],
      );
    }
    throw new Error(err?.message || `Upload failed (${response.status})`);
  }
  const data = await response.json();
  return {
    inserted: data.inserted ?? rows.length,
    updated: data.updated ?? 0,
    queued: data.queued ?? rows.length,
    insertedIds: Array.isArray(data.insertedIds) ? data.insertedIds : [],
  };
};

export const fetchRows = async (): Promise<CompanyApplicationRow[]> => {
  const response = await fetch('/api/admin/fetch-company-applications');
  if (!response.ok) throw new Error(`Failed to load (${response.status})`);
  const data = await response.json();
  return Array.isArray(data.rows) ? data.rows : [];
};

export const isCheckedValue = (value: unknown): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

export const hasValue = (value: unknown): boolean => String(value ?? '').trim() !== '';

const statusCheckboxClass = (checked: boolean, color: 'green' | 'blue' | 'amber') => {
  const accent = color === 'green' ? 'accent-green-600' : color === 'blue' ? 'accent-blue-600' : 'accent-amber-600';
  return `w-3.5 h-3.5 rounded border-gray-300 ${checked ? accent : ''}`;
};

const parseCompanyApplicationRows = async (file: File): Promise<CompanyApplicationRow[]> => {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  if (!workbook.SheetNames.length) throw new Error('Excel file has no sheets.');

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const headerRowIndex = rawRows.findIndex(row => {
    const text = row.map(normalize).join(' ');
    return text.includes('course title') && text.includes('employer') && (text.includes('trainee') || text.includes('nric'));
  });

  if (headerRowIndex < 0) {
    throw new Error('Could not find the company application table headers in this workbook.');
  }

  const headerStart = 0;
  const headerEnd = Math.min(rawRows.length - 1, headerRowIndex + 1);
  const maxColumns = Math.max(...rawRows.slice(headerStart, headerEnd + 1).map(row => row.length));
  const headerRow = Array.from({ length: maxColumns }, (_, columnIndex) =>
    rawRows
      .slice(headerStart, headerEnd + 1)
      .map(row => normalize(row[columnIndex]))
      .filter(Boolean)
      .join(' ')
  );

  const takenExcelColumns = new Set<number>();
  const columnIndexes = EXCEL_APPLICATION_COLUMNS.map(column => {
    const matcher = columnMatchers.find(([key]) => key === column)?.[1];
    if (!matcher) return -1;
    const found = headerRow.findIndex(
      (header, excelIdx) => !takenExcelColumns.has(excelIdx) && matcher(header)
    );
    if (found >= 0) takenExcelColumns.add(found);
    return found;
  });

  const unmapped = EXCEL_APPLICATION_COLUMNS.filter((_, i) => columnIndexes[i] < 0);
  if (unmapped.length) {
    console.warn('[CompanyApplication] columns not matched in Excel header:', unmapped);
    console.warn('[CompanyApplication] joined header row used for matching:', headerRow);
  }
  console.log('[CompanyApplication] column → Excel header index map:',
    EXCEL_APPLICATION_COLUMNS.map((col, i) => ({
      expected: col,
      excelHeaderIndex: columnIndexes[i],
      excelHeaderText: columnIndexes[i] >= 0 ? headerRow[columnIndexes[i]] : '(not matched)',
    }))
  );

  const isInstructionText = (value: string): boolean => {
    const v = value.trim().toLowerCase();
    if (!v) return false;
    return (
      v.startsWith('pls ') ||
      v.startsWith('please ') ||
      v.startsWith('example:') ||
      v.startsWith('example ') ||
      v.startsWith('e.g.') ||
      v.startsWith('eg.') ||
      v.startsWith('eg ') ||
      v.startsWith('e.g ')
    );
  };

  const parsedRows: CompanyApplicationRow[] = [];
  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const values = columnIndexes.map(index => index >= 0 ? getCellText(row[index]) : '');
    const hasUserData = values.some(value => value.trim() !== '');
    if (!hasUserData) continue;

    const courseTitleIdx = EXCEL_APPLICATION_COLUMNS.indexOf('Course Title*');
    const courseTitle = courseTitleIdx >= 0 ? values[courseTitleIdx] : '';
    if (isInstructionText(courseTitle)) continue;

    const instructionHits = values.filter(v => isInstructionText(v)).length;
    if (instructionHits >= 2) continue;

    const record: CompanyApplicationRow = {};
    EXCEL_APPLICATION_COLUMNS.forEach((column, index) => {
      record[column] = values[index] || '';
    });
    parsedRows.push(record);
  }

  return parsedRows;
};

// Mirrors DA's "Send Tax Invoice Email to Learner" banner — same look + feel,
// but reads/writes ca_auto_send_invoice_email and the CA CC/BCC columns, and
// labels the recipient as the EMPLOYER (CA invoices are billed to the
// sponsoring company, not the trainee). Rendered on both the Upload and View
// pages so admins always know which mode they're in before triggering a
// generation.
const CaEmailToggleBanner: React.FC = () => {
  const [emailToggleOn, setEmailToggleOn] = useState(false);
  const [emailToggleSaving, setEmailToggleSaving] = useState(false);
  const [invoiceEmailCc, setInvoiceEmailCc] = useState('');
  const [invoiceEmailBcc, setInvoiceEmailBcc] = useState('');
  // The automatic send after invoicing has always gone out WITHOUT waiting for
  // supporting-doc verification, while the manual button refuses without it.
  // That difference used to be hardcoded where nobody could see it.
  const [autoSendRequiresDocs, setAutoSendRequiresDocs] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/admin/ca-email-toggle', { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => {
        if (ctrl.signal.aborted) return;
        if (j?.success) {
          setEmailToggleOn(!!j.value);
          setAutoSendRequiresDocs(!!j.requiresDocVerification);
          setInvoiceEmailCc(j.cc || '');
          setInvoiceEmailBcc(j.bcc || '');
        }
      })
      .catch(() => { /* aborted or network error — keep default off */ });
    return () => ctrl.abort();
  }, []);

  const handleEmailToggle = async () => {
    const next = !emailToggleOn;
    setEmailToggleSaving(true);
    setEmailToggleOn(next);
    try {
      const res = await fetch('/api/admin/ca-email-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Toggle failed');
    } catch (err) {
      setEmailToggleOn(!next);
      alert(`Failed to update setting: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEmailToggleSaving(false);
    }
  };

  const handleAutoSendDocsToggle = async () => {
    const next = !autoSendRequiresDocs;
    setEmailToggleSaving(true);
    setAutoSendRequiresDocs(next);
    try {
      const res = await fetch('/api/admin/ca-email-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requiresDocVerification: next }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Save failed');
    } catch (err) {
      setAutoSendRequiresDocs(!next);
      alert(`Failed to update setting: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEmailToggleSaving(false);
    }
  };

  const handleEmailRecipientsSave = async () => {
    setEmailToggleSaving(true);
    try {
      const res = await fetch('/api/admin/ca-email-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cc: invoiceEmailCc, bcc: invoiceEmailBcc }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Save failed');
      setInvoiceEmailCc(json.cc || '');
      setInvoiceEmailBcc(json.bcc || '');
    } catch (err) {
      alert(`Failed to save recipients: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEmailToggleSaving(false);
    }
  };

  const handlePullEmailRecipientsFromQuickBooks = async () => {
    setEmailToggleSaving(true);
    try {
      const res = await fetch('/api/admin/ca-email-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importFromQuickBooks: true }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Import failed');
      setInvoiceEmailCc(json.cc || '');
      setInvoiceEmailBcc(json.bcc || '');
    } catch (err) {
      alert(`Failed to pull recipients from QuickBooks: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEmailToggleSaving(false);
    }
  };

  return (
    <div className={`mb-6 p-4 rounded-lg border-2 ${emailToggleOn ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center ${emailToggleOn ? 'bg-emerald-100 dark:bg-emerald-800/40' : 'bg-amber-100 dark:bg-amber-800/40'}`}>
            <Icon name={emailToggleOn ? IconName.Mail : IconName.Warning} className={`w-5 h-5 ${emailToggleOn ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`} />
          </div>
          <div>
            <p className={`text-sm font-semibold ${emailToggleOn ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}`}>
              Send Tax Invoice Email to Employer: {emailToggleOn ? 'ON' : 'OFF (test mode)'}
            </p>
            <p className={`text-xs mt-0.5 ${emailToggleOn ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
              {emailToggleOn
                ? 'Send Invoice Email button on View Company Application is armed. Sending still requires all supporting docs verified.'
                : 'Send Invoice Email button on View Company Application is held in test mode — clicks generate nothing. Safe for dry runs.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleEmailToggle}
          disabled={emailToggleSaving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${emailToggleOn ? 'bg-emerald-500 focus:ring-emerald-500' : 'bg-gray-300 dark:bg-gray-600 focus:ring-amber-500'} ${emailToggleSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
          aria-label="Toggle invoice email"
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${emailToggleOn ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* The two send paths follow different rules, and until now only one of
          them said so. The manual button always waits for verified supporting
          docs; the automatic send after invoicing never did. Surfacing it here
          makes the difference a decision instead of a surprise. */}
      {emailToggleOn && (
        <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/60 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              Automatic send waits for verified supporting docs: {autoSendRequiresDocs ? 'YES' : 'NO'}
            </p>
            <p className="text-[11px] mt-0.5 text-emerald-700 dark:text-emerald-300 max-w-2xl">
              {autoSendRequiresDocs
                ? 'The invoice email sent automatically after enrolment now follows the same rule as the manual button — nothing goes out until that learner’s documents are verified.'
                : 'The invoice email sent automatically after enrolment goes out as soon as the invoice exists, even if supporting docs have not been checked. The manual Send Invoice Email button still requires them.'}
            </p>
          </div>
          <button
            onClick={handleAutoSendDocsToggle}
            disabled={emailToggleSaving}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${autoSendRequiresDocs ? 'bg-emerald-500 focus:ring-emerald-500' : 'bg-gray-300 dark:bg-gray-600 focus:ring-amber-500'} ${emailToggleSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            aria-label="Toggle whether the automatic invoice email waits for supporting-doc verification"
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${autoSendRequiresDocs ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">CC recipients</span>
          <input
            type="text"
            value={invoiceEmailCc}
            onChange={(e) => setInvoiceEmailCc(e.target.value)}
            placeholder="finance@example.com, admin@example.com"
            className={inputClasses}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">BCC recipients</span>
          <input
            type="text"
            value={invoiceEmailBcc}
            onChange={(e) => setInvoiceEmailBcc(e.target.value)}
            placeholder="audit@example.com"
            className={inputClasses}
          />
        </label>
        <Button variant="secondary" onClick={handleEmailRecipientsSave} disabled={emailToggleSaving}>
          {emailToggleSaving ? 'Saving...' : 'Save Recipients'}
        </Button>
        <Button variant="outline" onClick={handlePullEmailRecipientsFromQuickBooks} disabled={emailToggleSaving}>
          Pull from QuickBooks
        </Button>
      </div>
    </div>
  );
};

export const UploadCompanyApplicationView: React.FC = () => {
  const { setAdminPage } = useLms();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backendTimerRef = useRef<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<RowValidationError[]>([]);
  const [uploadResult, setUploadResult] = useState<CompanyUploadResult | null>(null);
  const [backendStatus, setBackendStatus] = useState<'idle' | 'processing' | 'complete' | 'stalled'>('idle');
  const [backendDoneCount, setBackendDoneCount] = useState(0);
  const [backendProgress, setBackendProgress] = useState(0); // 0..1, finer-grained per-step progress
  const [backendStall, setBackendStall] = useState<BackendStallInfo | null>(null);
  // Learners the pipeline marked Not Grant Eligible (not a Singapore Citizen or
  // PR). Shown in both the complete and stalled panels — they are billed at the
  // full course fee, which the admin should see without hunting the table.
  const [backendIneligible, setBackendIneligible] = useState<string[]>([]);
  // Course-run confirmation popup. Non-empty = the popup is open and the upload
  // is parked waiting for the admin to confirm a run per course in the file.
  const [runConfirmGroups, setRunConfirmGroups] = useState<CourseRunConfirmGroup[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  // SupportingDocsModal opens when the pipeline finishes (backendStatus
  // flips to 'complete'). Stays mounted until the admin closes it or all
  // rows are verified.
  const [docsModalOpen, setDocsModalOpen] = useState(false);

  const handleFile = (selectedFile?: File | null) => {
    if (!selectedFile) return;
    if (backendTimerRef.current != null) {
      window.clearTimeout(backendTimerRef.current);
      backendTimerRef.current = null;
    }
    const isExcel = selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls') || selectedFile.type.includes('spreadsheet') || selectedFile.type.includes('excel');
    if (!isExcel) {
      setError('Invalid file type. Please upload an Excel file (.xlsx or .xls).');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setError(null);
    setUploadResult(null);
    setBackendStatus('idle');
    setBackendDoneCount(0);
    setBackendProgress(0);
    setBackendStall(null);
    setBackendIneligible([]);
    setRunConfirmGroups([]);
  };

  const pollBackendProcessing = (ids: string[]) => {
    if (backendTimerRef.current != null) {
      window.clearTimeout(backendTimerRef.current);
      backendTimerRef.current = null;
    }
    if (!ids.length) {
      setBackendStatus('complete');
      return;
    }

    setBackendStatus('processing');
    setBackendDoneCount(0);
    setBackendProgress(0);
    setBackendStall(null);
    setBackendIneligible([]);
    setRunConfirmGroups([]);
    let attempts = 0;
    const idSet = new Set(ids);
    const startedAt = Date.now();

    // Hard ceiling on how long we keep the spinner up. The backend's own grant
    // poll is capped at 30 × 30s = 15 min, after which it runs the invoice
    // sweep and stamps a final status on every row. If nothing is settled by
    // then the worker died (deploy/restart mid-run) — show that rather than
    // spinning indefinitely.
    const MAX_POLL_MS = 20 * 60 * 1000;

    // Each row contributes 5 step units: enrol, grant lookup, calendar, main
    // invoice, grant invoice. Step 5 auto-completes for learners without a
    // grant (no Grant ID means no grant invoice is expected), so single-row
    // groups without grants still hit 100% at 4 actual steps.
    const STEPS_PER_ROW = 5;
    const totalSteps = ids.length * STEPS_PER_ROW;

    const isTruthy = (v: unknown) => {
      if (v === true) return true;
      const s = String(v ?? '').trim().toLowerCase();
      return s === 'true' || s === 't' || s === 'yes' || s === '1';
    };

    const poll = async () => {
      attempts++;
      try {
        const rows = await fetchRows();
        const matchingRows = rows.filter(row => idSet.has(String(row.id || '')));

        let stepUnits = 0;
        let rowsFullyDone = 0;
        // Terminal-state bookkeeping — who is blocking, and has the backend
        // worker actually finished (every row stamped a final status)?
        const awaitingGrant: string[] = [];
        const notEnrolled: string[] = [];
        const failedRows: string[] = [];
        const ineligibleNames: string[] = [];
        let awaitingInvoice = 0;
        let stillPending = 0;

        for (const row of matchingRows) {
          const hasError = hasValue(row['Auto-Enrol Error']);
          const hasInvoice = hasValue(row['Invoice ID']);
          const hasGrantId = hasValue(row['Grant ID']);
          const hasGrantInvoice = hasValue(row['Grant Invoice ID']);
          const isIneligible = isCheckedValue(row['Grant Ineligible']);
          const hasEnrolment = hasValue(row['Enrolment ID']);

          // Terminal-state bookkeeping. Collected before the hasError early-out
          // below so an errored row still contributes its reason.
          const traineeName = String(row['Trainee FULL Name as on government ID*'] || '').trim() || '(unnamed)';
          const status = String(row['Auto-Enrol Status'] || '').trim().toLowerCase();
          if (status === '' || status === 'pending') stillPending++;
          if (hasError) failedRows.push(traineeName);
          if (isIneligible && !hasGrantId) ineligibleNames.push(traineeName);
          // A learner billed by hand is not awaiting anything — Finance is
          // adding them to an invoice that already exists in QuickBooks, so
          // their empty Invoice ID is the expected end state, not a stall.
          const isBilledByHand = isCheckedValue(row['Billed Manually']);
          if (!hasEnrolment) notEnrolled.push(traineeName);
          else if (!hasGrantId && !isIneligible) awaitingGrant.push(traineeName);
          else if (!hasInvoice && !isBilledByHand) awaitingInvoice++;

          // Grant invoice is "complete" only when the QBO invoice has
          // actually been created — OR when the learner is explicitly
          // marked Not Grant Eligible (no supplemental invoice expected).
          // The previous "hasInvoice && !hasGrantId" fallback was the bug:
          // it flipped to true the moment the main invoice fired (the
          // grant-invoice step writes its own column afterwards), so the
          // spinner reported "complete" while processGrantInvoicesForGroup
          // was still running.
          const grantInvoiceComplete = hasGrantInvoice || isIneligible;

          // A row that errored out won't get further steps — count as fully done
          // so the spinner doesn't stall waiting for a calendar/invoice that
          // won't come.
          if (hasError) {
            stepUnits += STEPS_PER_ROW;
            rowsFullyDone++;
            continue;
          }

          // Mid-pipeline — count whichever steps have already written their column.
          if (hasEnrolment) stepUnits += 1;
          if (hasGrantId || isTruthy(row['Calendar Added']) || hasInvoice) stepUnits += 1;
          if (isTruthy(row['Calendar Added']) || hasInvoice) stepUnits += 1;
          if (hasInvoice) stepUnits += 1;
          if (grantInvoiceComplete) stepUnits += 1;

          if (hasInvoice && grantInvoiceComplete) rowsFullyDone++;
        }

        setBackendDoneCount(rowsFullyDone);
        setBackendProgress(totalSteps > 0 ? stepUnits / totalSteps : 1);
        setBackendIneligible(ineligibleNames);

        if (matchingRows.length >= ids.length && rowsFullyDone >= ids.length) {
          setBackendProgress(1);
          setBackendStatus('complete');
          // Pipeline finished — open the supporting-docs verification modal.
          // Admin chooses Yes (verify now) or No (skip; close + navigate).
          setDocsModalOpen(true);
          return;
        }

        // Not fully done — but is anything still going to happen? The backend
        // stamps a final auto_enrol_status on every row as its last act, so
        // "no row left pending" means the worker has run to completion and the
        // remaining gaps are permanent until an admin intervenes. Stopping
        // here (instead of polling forever) is the whole point: a group whose
        // invoice is blocked by one grant-less learner would otherwise spin
        // with 0/N indefinitely.
        const workerFinished = matchingRows.length >= ids.length && stillPending === 0;
        const timedOut = Date.now() - startedAt > MAX_POLL_MS;
        if (workerFinished || timedOut) {
          setBackendStall({
            doneCount: rowsFullyDone,
            total: ids.length,
            awaitingGrant,
            notEnrolled,
            failed: failedRows,
            awaitingInvoice,
            workerFinished,
          });
          setBackendStatus('stalled');
          return;
        }
      } catch (err) {
        console.warn('Failed to poll company application processing:', err);
      }

      // No attempt cap — the backend pipeline polls SSG until every row has
      // its grant (or is marked grant_ineligible), so the spinner stays up
      // until everything actually finishes. Cleanup on unmount clears the
      // timer (see useEffect below).
      backendTimerRef.current = window.setTimeout(poll, 2500);
    };

    backendTimerRef.current = window.setTimeout(poll, 1000);
  };

  useEffect(() => {
    return () => {
      if (backendTimerRef.current != null) {
        window.clearTimeout(backendTimerRef.current);
      }
    };
  }, []);

  /**
   * Step 1 of upload: read the file and ask which course run each course in it
   * refers to. NOTHING is written and no pipeline starts until the admin
   * confirms — auto-enrolment, calendar sync and invoicing all happen server-side
   * after the upload POST, so this popup is the last point where a wrong run can
   * be caught for free. Matching the run from the Excel's title+date was the
   * single biggest source of bad imports; the admin knows the run ID, so ask.
   */
  const beginUpload = async () => {
    if (!file) return;
    setIsPreparing(true);
    setError(null);
    setValidationErrors([]);
    try {
      const rows = await parseCompanyApplicationRows(file);
      if (rows.length === 0) {
        setError('No data rows found in that file.');
        return;
      }

      // One question per distinct course in the file, not per learner.
      const groups = new Map<string, { courseTitle: string; courseStartDate: string; rowCount: number }>();
      for (const r of rows) {
        const courseTitle = String((r as any)['Course Title*'] ?? '').trim();
        const courseStartDate = String((r as any)['Course Start Date (DD-MM-YYYY)*'] ?? '').trim();
        const key = `${courseTitle.toLowerCase()}|${courseStartDate}`;
        const found = groups.get(key);
        if (found) found.rowCount++;
        else groups.set(key, { courseTitle, courseStartDate, rowCount: 1 });
      }

      // Advisory suggestions so the admin can click rather than go hunting for
      // the ID. Failure here is non-fatal — they can still type it in.
      let suggestions: Array<{ courseTitle: string; courseStartDate: string; candidates: CourseRunCandidate[] }> = [];
      try {
        const res = await fetch('/api/admin/ca-suggest-course-runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups: Array.from(groups.values()).map(({ courseTitle, courseStartDate }) => ({ courseTitle, courseStartDate })) }),
        });
        const data = await res.json();
        if (res.ok && data?.success) suggestions = data.suggestions ?? [];
      } catch {
        /* suggestions are a convenience, not a requirement */
      }

      setRunConfirmGroups(
        Array.from(groups.values()).map(g => ({
          ...g,
          candidates:
            suggestions.find(
              s => s.courseTitle.trim().toLowerCase() === g.courseTitle.toLowerCase() && s.courseStartDate.trim() === g.courseStartDate,
            )?.candidates ?? [],
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the Excel file.');
    } finally {
      setIsPreparing(false);
    }
  };

  // Step 2: the admin has confirmed a course run per course, so upload for real.
  // `courseRunOverrides` also carries answers from the validation modal's picker
  // when a row still fails afterwards. Re-parses the same file rather than
  // caching the parsed rows — the file is still in state and parsing is cheap.
  const handleUpload = async (courseRunOverrides: CourseRunOverride[] = []) => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    setValidationErrors([]);
    setUploadResult(null);
    setBackendStatus('idle');
    setBackendDoneCount(0);
    setBackendProgress(0);
    setBackendStall(null);
    setBackendIneligible([]);
    setRunConfirmGroups([]);
    try {
      const rows = await parseCompanyApplicationRows(file);
      const result = await uploadRows(rows, courseRunOverrides);
      setUploadResult(result);
      pollBackendProcessing(result.insertedIds);
    } catch (err) {
      if (err instanceof UploadValidationError) {
        setError(err.message);
        setValidationErrors(err.validationErrors);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to parse company application file.');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const reset = () => {
    if (backendTimerRef.current != null) {
      window.clearTimeout(backendTimerRef.current);
      backendTimerRef.current = null;
    }
    setFile(null);
    setError(null);
    setValidationErrors([]);
    setUploadResult(null);
    setBackendStatus('idle');
    setBackendDoneCount(0);
    setBackendProgress(0);
    setBackendStall(null);
    setBackendIneligible([]);
    setRunConfirmGroups([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white leading-tight">Upload Company Application</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Import the employer-sponsored WSQ registration & grant application Excel form.</p>
        </div>
        {uploadResult !== null && (
          <Button variant="ghost" onClick={reset} className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20">
            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />New Upload
          </Button>
        )}
      </div>

      <CaEmailToggleBanner />

      {uploadResult === null ? (
        <Card className="p-6">
          <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 dark:border-amber-400 rounded-lg p-4 mb-6 flex items-start gap-3">
            <Icon name={IconName.InfoCircle} className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-1">Important: For Company Application File</h4>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Upload the employer-sponsored WSQ course registration and grant application Excel form. The table headers will be matched to the View Company Application columns.
              </p>
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => !file && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${isDragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]' : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-900/10'}`}
          >
            <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-colors ${isDragOver ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-700/40'}`}>
              <Icon name={IconName.Upload} className={`w-8 h-8 ${isDragOver ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Upload Company Application</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Drag and drop your Excel file here, or browse from your computer.</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Supported formats: .xlsx, .xls</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            {!file ? (
              <Button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="mt-5" variant="secondary">
                <Icon name={IconName.Folder} className="w-4 h-4 mr-2" />Choose File
              </Button>
            ) : (
              <div className="mt-5 inline-flex items-stretch gap-3 pl-3 pr-2 py-2 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 shadow-sm max-w-full">
                <div className="flex items-center">
                  <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                    <Icon name={IconName.FileText} className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <div className="flex flex-col justify-center min-w-0 text-left">
                  <div className="flex items-center gap-1.5">
                    <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <p className="text-sm font-semibold text-green-800 dark:text-green-200 truncate">{file.name}</p>
                  </div>
                  <p className="text-xs text-green-700/70 dark:text-green-300/70 mt-0.5">
                    {file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(2)} MB`}
                    <span className="mx-1.5 opacity-50">•</span>
                    Ready to upload
                  </p>
                </div>
                <div className="flex items-center gap-1 pl-2 ml-1 border-l border-green-200 dark:border-green-800">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    className="text-xs font-medium text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 hover:underline px-2 py-1"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); setError(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="w-7 h-7 rounded-md hover:bg-green-100 dark:hover:bg-green-900/40 flex items-center justify-center flex-shrink-0 transition-colors"
                    aria-label="Remove file"
                  >
                    <Icon name={IconName.Close} className="w-4 h-4 text-green-700 dark:text-green-300" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <Icon name={IconName.Warning} className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="ghost" onClick={reset}>
              <Icon name={IconName.Close} className="w-4 h-4 mr-2" />Reset
            </Button>
            <Button onClick={() => void beginUpload()} disabled={!file || isUploading || isPreparing}>
              {isUploading || isPreparing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  {isPreparing ? 'Reading file...' : 'Uploading...'}
                </>
              ) : (
                <>
                  <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                </>
              )}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <div className={`w-14 h-14 rounded-full ${backendStatus === 'processing' ? 'bg-blue-100 dark:bg-blue-900/30' : backendStatus === 'stalled' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-green-100 dark:bg-green-900/30'} flex items-center justify-center mx-auto mb-4`}>
            {backendStatus === 'processing' ? (
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-200 border-t-blue-600" />
            ) : backendStatus === 'stalled' ? (
              <Icon name={IconName.Warning} className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            ) : (
              <Icon name={IconName.CheckCircle} className="w-8 h-8 text-green-600 dark:text-green-400" />
            )}
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">
            {backendStatus === 'processing'
              ? 'Processing Enrolment & Grant Lookup'
              : backendStatus === 'stalled'
                ? 'Processing Stopped — Needs Your Attention'
                : 'Upload Complete'}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {uploadResult.inserted} inserted, {uploadResult.updated} updated. {uploadResult.queued} record{uploadResult.queued === 1 ? '' : 's'} queued for enrolment and grant lookup.
          </p>
          {backendStatus === 'processing' && (
            <div className="w-full max-w-md mx-auto mt-6 space-y-2">
              <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>Background progress</span>
                <span>{Math.min(backendDoneCount, uploadResult.queued)} / {uploadResult.queued}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className="h-3 bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round(Math.min(Math.max(backendProgress, 0), 1) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Please keep this page open while SSG enrolment and grant lookup continue.</p>
            </div>
          )}
          {backendStatus === 'complete' && uploadResult.queued > 0 && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-4">Background processing finished. View the table to see enrolment and grant results.</p>
          )}
          {(backendStatus === 'complete' || backendStatus === 'stalled') && backendIneligible.length > 0 && (
            <div className="w-full max-w-2xl mx-auto mt-4 text-left rounded-lg border border-sky-300 dark:border-sky-500/40 bg-sky-50 dark:bg-sky-900/20 p-4">
              <p className="text-sm font-semibold text-sky-800 dark:text-sky-200">
                Not grant eligible ({backendIneligible.length}) — billed at full course fee
              </p>
              <p className="text-sm text-sky-700 dark:text-sky-300 mt-1">{backendIneligible.join(', ')}</p>
              <p className="text-xs text-sky-700 dark:text-sky-300 mt-1">
                SSG funding is for Singapore Citizens and PRs only, so no grant is expected for these learners and the pipeline did not wait for one.
                Override with the <span className="font-semibold">Grant Ineligible</span> toggle on View Company Application if this is wrong.
              </p>
            </div>
          )}
          {backendStatus === 'stalled' && backendStall && (
            <div className="w-full max-w-2xl mx-auto mt-6 text-left space-y-3">
              <div className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  {backendStall.doneCount} of {backendStall.total} record{backendStall.total === 1 ? '' : 's'} fully processed.
                  {backendStall.workerFinished
                    ? ' Enrolment finished, but the run stopped before everything was invoiced:'
                    : ' Background processing is no longer reporting progress:'}
                </p>

                {backendStall.notEnrolled.length > 0 && (
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    <p className="font-medium">Not enrolled with SSG ({backendStall.notEnrolled.length}):</p>
                    <p className="text-amber-700 dark:text-amber-300">{backendStall.notEnrolled.join(', ')}</p>
                    <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">Open the application on View Company Application to see the error, then use Retry Selected.</p>
                  </div>
                )}

                {backendStall.awaitingGrant.length > 0 && (
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    <p className="font-medium">No SSG grant found yet ({backendStall.awaitingGrant.length}):</p>
                    <p className="text-amber-700 dark:text-amber-300">{backendStall.awaitingGrant.join(', ')}</p>
                    <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
                      SSG creates the grant asynchronously after enrolment and it can lag by 15+ minutes. The employer invoice covers the whole group,
                      so it is not generated until every learner has a grant — or is marked <span className="font-semibold">Not Grant Eligible</span>.
                      On View Company Application, click <span className="font-semibold">Sync Grants</span> to re-check, or mark the learner Not Grant Eligible to release the invoice.
                    </p>
                  </div>
                )}

                {backendStall.failed.length > 0 && (
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    <p className="font-medium">Errors reported ({backendStall.failed.length}):</p>
                    <p className="text-amber-700 dark:text-amber-300">{backendStall.failed.join(', ')}</p>
                  </div>
                )}

                {backendStall.notEnrolled.length === 0 && backendStall.awaitingGrant.length === 0 && backendStall.failed.length === 0 && backendStall.awaitingInvoice > 0 && (
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    <p className="font-medium">Awaiting invoice ({backendStall.awaitingInvoice}):</p>
                    <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
                      Enrolment and grants are done but no QuickBooks invoice was created. Use <span className="font-semibold">Generate Invoice</span> on View Company Application.
                    </p>
                  </div>
                )}

                {!backendStall.workerFinished && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Nothing is lost — the rows are saved. This usually means the server restarted mid-run. Re-check from View Company Application (Sync Grants / Retry Selected).
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                It is safe to leave this page — enrolments and grants already recorded are saved.
              </p>
            </div>
          )}
          <div className="flex justify-center gap-3 mt-6">
            <Button variant="secondary" onClick={reset}>Upload Another File</Button>
            <Button onClick={() => setAdminPage(AdminPage.ViewCompanyApplication)}>View Company Application</Button>
          </div>
        </Card>
      )}

      {docsModalOpen && uploadResult && uploadResult.insertedIds.length > 0 && (
        <SupportingDocsModal
          applicationIds={uploadResult.insertedIds}
          onClose={() => {
            setDocsModalOpen(false);
            // Admin chose "No" or closed mid-flow — send them to the View
            // page where they can finish verification later via the
            // "Verify & Send" button.
            setAdminPage(AdminPage.ViewCompanyApplication);
          }}
        />
      )}

      {runConfirmGroups.length > 0 && (
        <CourseRunConfirmModal
          groups={runConfirmGroups}
          fileName={file?.name}
          isUploading={isUploading}
          onCancel={() => setRunConfirmGroups([])}
          onConfirm={(overrides) => {
            setRunConfirmGroups([]);
            void handleUpload(overrides);
          }}
        />
      )}

      {validationErrors.length > 0 && (
        <ValidationErrorsModal
          errors={validationErrors}
          fileName={file?.name}
          isUploading={isUploading}
          onClose={() => setValidationErrors([])}
          onRetryWithRuns={(overrides) => {
            setValidationErrors([]);
            void handleUpload(overrides);
          }}
        />
      )}
    </div>
  );
};

/**
 * Course-run dates come back from /lookup-course-run as full timestamps
 * ("2026-08-11T16:00:00.000Z") because that endpoint selects start_date without
 * ::text. That instant is midnight *Singapore* on the 12th, so truncating the
 * string yields the wrong day. Format in Asia/Singapore instead — and pass
 * already-date-only values straight through.
 */
function sgDateOnly(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const by = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${by.year}-${by.month}-${by.day}`;
}

/** "12-08-2026" → "2026-08-12", for comparing the Excel date to a run's real date. */
function toIsoFromDdMmYyyy(raw: string): string {
  const m = String(raw || '').trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export interface CourseRunConfirmGroup {
  courseTitle: string;
  courseStartDate: string;
  rowCount: number;
  candidates: CourseRunCandidate[];
}

/** A run ID the admin typed, once we've looked it up and know what it is. */
interface VerifiedRun {
  courseRunId: string;
  title: string;
  courseCode: string;
  startDate: string;
  endDate: string;
  source: 'db' | 'ssg';
}

/**
 * Blocks the upload until the admin says which course run each course in the
 * file belongs to. Deliberately a hard gate: once the upload POSTs, the server
 * inserts the rows and immediately kicks off SSG enrolment, calendar sync and
 * invoicing — all of which are painful to undo if the run was wrong.
 */
const CourseRunConfirmModal: React.FC<{
  groups: CourseRunConfirmGroup[];
  fileName?: string;
  isUploading?: boolean;
  onCancel: () => void;
  onConfirm: (overrides: CourseRunOverride[]) => void;
}> = ({ groups, fileName, isUploading, onCancel, onConfirm }) => {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, VerifiedRun>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [lookupError, setLookupError] = useState<Record<string, string>>({});

  const keyOf = (g: CourseRunConfirmGroup) => `${g.courseTitle.toLowerCase()}|${g.courseStartDate}`;

  const verify = async (key: string, rawId: string) => {
    const courseRunId = rawId.trim();
    setLookupError(p => ({ ...p, [key]: '' }));
    setVerified(p => { const n = { ...p }; delete n[key]; return n; });
    if (!courseRunId) return;

    setChecking(p => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`/api/admin/lookup-course-run?courseRunCode=${encodeURIComponent(courseRunId)}`);
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.data) {
        setLookupError(p => ({ ...p, [key]: data?.error || `Course run ${courseRunId} not found.` }));
        return;
      }
      const d = data.data;
      setVerified(p => ({
        ...p,
        [key]: {
          courseRunId: String(d.courseRunCode ?? courseRunId),
          title: String(d.title ?? ''),
          courseCode: String(d.courseCode ?? ''),
          startDate: sgDateOnly(String(d.startDate ?? '')),
          endDate: sgDateOnly(String(d.endDate ?? '')),
          source: data.source === 'ssg' ? 'ssg' : 'db',
        },
      }));
    } catch (err) {
      setLookupError(p => ({ ...p, [key]: err instanceof Error ? err.message : 'Lookup failed.' }));
    } finally {
      setChecking(p => ({ ...p, [key]: false }));
    }
  };

  const pick = (key: string, courseRunId: string) => {
    setTyped(p => ({ ...p, [key]: courseRunId }));
    void verify(key, courseRunId);
  };

  const allConfirmed = groups.every(g => verified[keyOf(g)]);
  const totalRows = groups.reduce((sum, g) => sum + g.rowCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[88vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Confirm the course run</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {totalRows} row{totalRows === 1 ? '' : 's'}{fileName ? ` in ${fileName}` : ''} ·{' '}
            {groups.length} course{groups.length === 1 ? '' : 's'}. Nothing is imported yet — enrolment, calendar and invoicing
            all start once you continue, so check the run is right.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {groups.map(g => {
            const key = keyOf(g);
            const v = verified[key];
            const err = lookupError[key];
            return (
              <div key={key} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{g.courseTitle || '(no course title)'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Excel start date {g.courseStartDate || '(none)'} · {g.rowCount} learner{g.rowCount === 1 ? '' : 's'}
                </p>

                <label className="block mt-3 text-xs font-medium text-gray-700 dark:text-gray-300">Course Run ID</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={typed[key] ?? ''}
                    onChange={e => setTyped(p => ({ ...p, [key]: e.target.value }))}
                    onBlur={e => void verify(key, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void verify(key, (e.target as HTMLInputElement).value); } }}
                    placeholder="e.g. 1404702"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                  <Button variant="secondary" onClick={() => void verify(key, typed[key] ?? '')} disabled={checking[key]}>
                    {checking[key] ? 'Checking…' : 'Check'}
                  </Button>
                </div>

                {err && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</p>}

                {v && (
                  <div className="mt-2 rounded-lg border border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-900/20 p-3">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">{v.title}</p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
                      Run {v.courseRunId}{v.courseCode ? ` · ${v.courseCode}` : ''} · {v.startDate}
                      {v.endDate && v.endDate !== v.startDate ? ` → ${v.endDate}` : ''}
                      {v.source === 'ssg' ? ' · pulled from SSG and added to the LMS' : ''}
                    </p>
                    {v.startDate && g.courseStartDate && v.startDate !== toIsoFromDdMmYyyy(g.courseStartDate) && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Heads up: this run starts {v.startDate}, but the Excel says {g.courseStartDate}. Continuing uses the run above.
                      </p>
                    )}
                  </div>
                )}

                {g.candidates.length > 0 && !v && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Or pick a likely match:</p>
                    <div className="space-y-1.5">
                      {g.candidates.slice(0, 4).map(c => (
                        <button
                          key={c.courseRunId}
                          type="button"
                          onClick={() => pick(key, c.courseRunId)}
                          className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-400 bg-white dark:bg-gray-900"
                        >
                          <span className="block text-sm text-gray-900 dark:text-white truncate">{c.courseTitle}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {c.startDate} · Run {c.courseRunId}
                            {c.courseCode ? ` · ${c.courseCode}` : ''}
                            {c.score >= 0.999 ? ' · course code match' : ` · ${Math.round(c.score * 100)}% title match`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end items-center gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          {!allConfirmed && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mr-auto">
              Confirm a course run for every course to continue.
            </p>
          )}
          <Button variant="secondary" onClick={onCancel} disabled={isUploading}>Cancel</Button>
          <Button
            onClick={() =>
              onConfirm(
                groups.map(g => ({
                  courseTitle: g.courseTitle,
                  courseStartDate: g.courseStartDate,
                  courseRunId: verified[keyOf(g)].courseRunId,
                })),
              )
            }
            disabled={!allConfirmed || isUploading}
          >
            {isUploading ? 'Importing…' : 'Confirm & import'}
          </Button>
        </div>
      </div>
    </div>
  );
};

interface ValidationErrorsModalProps {
  errors: RowValidationError[];
  fileName?: string;
  isUploading?: boolean;
  onClose: () => void;
  onRetryWithRuns?: (overrides: CourseRunOverride[]) => void;
}

const runGroupKey = (courseTitle: string, courseStartDate: string) =>
  `${String(courseTitle || '').trim().toLowerCase()}|${String(courseStartDate || '').trim()}`;

const ValidationErrorsModal: React.FC<ValidationErrorsModalProps> = ({
  errors,
  fileName,
  isUploading,
  onClose,
  onRetryWithRuns,
}) => {
  const totalIssues = errors.reduce((sum, e) => sum + e.issues.length, 0);

  // Ten learners on the same course share one unresolved (title, date) — ask
  // once, not ten times.
  const runGroups = useMemo(() => {
    const map = new Map<string, { courseTitle: string; courseStartDate: string; candidates: CourseRunCandidate[]; rowCount: number }>();
    for (const err of errors) {
      const u = err.courseRunUnresolved;
      if (!u) continue;
      const key = runGroupKey(u.courseTitle, u.courseStartDate);
      const existing = map.get(key);
      if (existing) existing.rowCount++;
      else map.set(key, { courseTitle: u.courseTitle, courseStartDate: u.courseStartDate, candidates: u.candidates || [], rowCount: 1 });
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [errors]);

  const [picked, setPicked] = useState<Record<string, string>>({});

  // Only rows whose sole problem is the course run can be rescued here. If
  // anything else is broken, the Excel still has to be fixed.
  const resolvableRowCount = errors.filter(e => e.courseRunUnresolved).length;
  const blockedRowCount = errors.length - resolvableRowCount;
  const allGroupsPicked = runGroups.length > 0 && runGroups.every(g => picked[g.key]);
  const canRetry = !!onRetryWithRuns && blockedRowCount === 0 && allGroupsPicked;

  const handleRetry = () => {
    if (!onRetryWithRuns) return;
    onRetryWithRuns(
      runGroups
        .filter(g => picked[g.key])
        .map(g => ({ courseTitle: g.courseTitle, courseStartDate: g.courseStartDate, courseRunId: picked[g.key] })),
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
              <Icon name={IconName.Warning} className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Excel has {errors.length} row{errors.length === 1 ? '' : 's'} with issues
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {totalIssues} issue{totalIssues === 1 ? '' : 's'} found{fileName ? ` in ${fileName}` : ''}. Nothing was imported
                {runGroups.length > 0 && blockedRowCount === 0
                  ? ' — pick the correct course run below to continue.'
                  : ' — fix the Excel and re-upload.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            <Icon name={IconName.Close} className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {runGroups.map(group => (
            <div
              key={group.key}
              className="border border-blue-300 dark:border-blue-500/40 rounded-xl p-4 bg-blue-50/60 dark:bg-blue-900/15"
            >
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                No run matched &ldquo;{group.courseTitle}&rdquo; on {group.courseStartDate}
              </p>
              <p className="text-xs text-blue-800 dark:text-blue-300 mt-0.5">
                Affects {group.rowCount} row{group.rowCount === 1 ? '' : 's'}. Did you mean one of these? Runs within 30 days, closest title first.
              </p>

              {group.candidates.length === 0 ? (
                <p className="text-sm text-blue-800 dark:text-blue-300 mt-3">
                  No similar runs found near that date — create the course run first, or fix the title/date in the Excel.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {group.candidates.map(c => {
                    const selected = picked[group.key] === c.courseRunId;
                    return (
                      <button
                        key={c.courseRunId}
                        type="button"
                        onClick={() => setPicked(p => ({ ...p, [group.key]: c.courseRunId }))}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          selected
                            ? 'border-blue-600 bg-blue-100 dark:bg-blue-900/40 dark:border-blue-400'
                            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.courseTitle}</span>
                          {selected && <Icon name={IconName.CheckCircle} className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {c.startDate}{c.endDate && c.endDate !== c.startDate ? ` → ${c.endDate}` : ''} · Run {c.courseRunId}
                          {c.courseCode ? ` · ${c.courseCode}` : ''}
                          {c.score >= 0.999 ? ' · course code match' : ` · ${Math.round(c.score * 100)}% title match`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {errors.map((err) => (
            <div
              key={`${err.rowNumber}-${err.traineeNric}`}
              className="border border-red-200 dark:border-red-900/40 rounded-xl p-4 bg-red-50/50 dark:bg-red-900/10"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded-md">
                  Row {err.rowNumber}
                </span>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{err.traineeName}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">·</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{err.traineeNric}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">·</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{err.courseTitle}</span>
              </div>
              <ul className="space-y-1.5">
                {err.issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                    <span className="text-red-500 dark:text-red-400 mt-0.5">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex justify-end items-center gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          {runGroups.length > 0 && blockedRowCount > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mr-auto text-left">
              {blockedRowCount} row{blockedRowCount === 1 ? '' : 's'} {blockedRowCount === 1 ? 'has' : 'have'} other problems too — those must be fixed in the Excel.
            </p>
          )}
          <Button variant="secondary" onClick={onClose}>Close &amp; Fix Excel</Button>
          {runGroups.length > 0 && blockedRowCount === 0 && (
            <Button onClick={handleRetry} disabled={!canRetry || isUploading}>
              {isUploading ? 'Importing…' : 'Use selected run & import'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

interface InvoiceError {
  groupKey: string;
  employerUen: string;
  employerOrgName: string;
  courseRunId: string;
  error: string;
  isCustomerNotFound: boolean;
}

interface QboSearchResult {
  id: string;
  displayName: string;
  companyName: string;
  fullyQualifiedName: string;
  email: string;
  addressLine: string;
}

interface RescueTarget {
  employerUen: string;
  employerOrgName: string;
  courseRunId: string;
}

const QboCustomerRescueModal: React.FC<{
  target: RescueTarget;
  onClose: () => void;
  onLinked: (summary: string) => void;
}> = ({ target, onClose, onLinked }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<QboSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runSearch = async () => {
    const q = search.trim();
    if (q.length < 2) {
      setMessage('Type at least 2 characters to search.');
      return;
    }
    setIsSearching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/ca-search-qbo-customer?q=${encodeURIComponent(q)}&limit=25`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Search failed (${res.status})`);
      setResults(Array.isArray(data.results) ? data.results : []);
      if ((data.results || []).length === 0) setMessage('No QBO customers matched.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const pick = async (candidate: QboSearchResult) => {
    if (!candidate.displayName) {
      setMessage('Selected customer has no DisplayName — pick a different one.');
      return;
    }
    setIsLinking(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ca-link-employer-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employerUen: target.employerUen,
          qboDisplayName: candidate.displayName,
          courseRunId: target.courseRunId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Link failed (${res.status})`);
      const generated = Number(data.generated) || 0;
      const failed = Number(data.failed) || 0;
      const firstErr = data.errors?.[0]?.error;
      const parts: string[] = [`linked "${candidate.displayName}" to UEN ${target.employerUen}`];
      if (generated) parts.push(`${generated} invoice${generated === 1 ? '' : 's'} generated`);
      if (failed) parts.push(`${failed} still failed${firstErr ? ` — ${firstErr}` : ''}`);
      onLinked(parts.join(' · '));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Link failed.');
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b dark:border-gray-700">
          <h3 className="text-lg font-bold dark:text-white">Link QBO Customer</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Excel employer: <span className="font-semibold">{target.employerOrgName || '(unnamed)'}</span> · UEN {target.employerUen || '(none)'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Search QuickBooks by partial name (try the full legal name, e.g. &quot;polyclinics&quot;). Picking a customer saves the mapping and re-runs the invoice.
          </p>
        </div>
        <div className="p-5 border-b dark:border-gray-700 flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
            placeholder="Search QBO customers..."
            className={inputClasses}
            autoFocus
          />
          <Button onClick={() => void runSearch()} disabled={isSearching || isLinking}>
            {isSearching ? 'Searching...' : 'Search'}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {message && <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">{message}</p>}
          {results.length === 0 && !message && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No results yet — type a search term above (e.g. part of the long-form company name).
            </p>
          )}
          <ul className="space-y-2">
            {results.map(c => (
              <li
                key={c.id}
                className="border dark:border-gray-700 rounded p-3 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-start justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white truncate" title={c.displayName}>{c.displayName}</p>
                  {c.companyName && c.companyName !== c.displayName && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={c.companyName}>
                      Company: {c.companyName}
                    </p>
                  )}
                  {c.fullyQualifiedName && c.fullyQualifiedName !== c.displayName && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={c.fullyQualifiedName}>
                      Full path: {c.fullyQualifiedName}
                    </p>
                  )}
                  {c.email && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={c.email}>Email: {c.email}</p>
                  )}
                  {c.addressLine && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={c.addressLine}>{c.addressLine}</p>
                  )}
                </div>
                <Button
                  onClick={() => void pick(c)}
                  disabled={isLinking}
                  variant="secondary"
                >
                  {isLinking ? 'Linking...' : 'Use this'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 border-t dark:border-gray-700 flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isLinking}>Close</Button>
        </div>
      </div>
    </div>
  );
};

const DeleteConfirmModal: React.FC<{
  rows: CompanyApplicationRow[];
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ rows, isDeleting, onConfirm, onClose }) => {
  const count = rows.length;

  // Esc-to-close. Skipped while a delete is in flight so the user can't dismiss
  // the modal mid-request and lose track of the in-progress action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDeleting, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => { if (!isDeleting) onClose(); }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden ring-1 ring-red-200/60 dark:ring-red-900/40"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative px-6 py-5 border-b dark:border-gray-800 bg-gradient-to-br from-red-50 via-white to-white dark:from-red-950/30 dark:via-gray-900 dark:to-gray-900">
          <span className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-red-500 via-red-400 to-red-500" />
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/40 ring-1 ring-red-200 dark:ring-red-800/60 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Icon name={IconName.Warning} className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                  Delete {count} Company Application row{count === 1 ? '' : 's'}?
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 ring-1 ring-red-300/60 dark:ring-red-800/60">
                  Destructive
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                For rows with an Enrolment ID this <strong className="text-red-700 dark:text-red-300">cancels the live TPGateway enrolment</strong>,
                removes its grant, and voids the QBO invoice (only when no other learner shares it), then deletes the row.
                A <strong className="text-gray-800 dark:text-gray-200">consolidated invoice</strong> shared with other learners is
                <strong className="text-gray-800 dark:text-gray-200"> not</strong> voided — you'll be told to adjust it manually in QuickBooks.
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50/60 dark:bg-gray-950/40">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Rows to delete
            </p>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {count} selected
            </span>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto shadow-sm">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Trainee</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">NRIC</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Employer</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Course</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Enrolment</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {rows.map((r, i) => {
                  const nric = String(r['Trainee NRIC/FIN Number*'] || '').trim();
                  const maskedNric = nric ? maskNric(nric) : '-';
                  return (
                    <tr key={r.id || i} className="hover:bg-red-50/40 dark:hover:bg-red-900/10 transition-colors">
                      <td
                        className="px-4 py-2.5 font-semibold text-gray-900 dark:text-gray-100 max-w-[160px] truncate"
                        title={r['Trainee FULL Name as on government ID*']}
                      >
                        {r['Trainee FULL Name as on government ID*'] || '(unnamed)'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {maskedNric}
                      </td>
                      <td
                        className="px-4 py-2.5 text-gray-700 dark:text-gray-300 max-w-[150px] truncate"
                        title={r['Employer Organization Name*']}
                      >
                        {r['Employer Organization Name*'] || '-'}
                      </td>
                      <td
                        className="px-4 py-2.5 text-gray-700 dark:text-gray-300 max-w-[180px] truncate"
                        title={r['Course Title*']}
                      >
                        {r['Course Title*'] || '-'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {r['Enrolment ID'] || '-'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {r['Invoice Doc Number'] || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-4 border-t dark:border-gray-800 flex items-center justify-between gap-3 bg-white dark:bg-gray-900">
          <p className="text-[11px] text-gray-500 dark:text-gray-500 hidden sm:flex items-center gap-1.5">
            Press <kbd className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 font-mono text-[10px] text-gray-600 dark:text-gray-400">Esc</kbd> to cancel
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting || count === 0}
              className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg text-white bg-red-600 hover:bg-red-700 shadow-md shadow-red-900/30 ring-1 ring-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white mr-2" />
                  Deleting...
                </>
              ) : (
                <>
                  <Icon name={IconName.Delete} className="w-3.5 h-3.5 mr-1.5" />
                  Confirm Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PipelineWarning {
  step: string;
  error: string;
  at: string;
}

function parseRowWarnings(row: CompanyApplicationRow): PipelineWarning[] {
  const raw = row._pipeline_warnings;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const ViewCompanyApplicationView: React.FC = () => {
  const [rows, setRows] = useState<CompanyApplicationRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStuckOnly, setShowStuckOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "Is this company already in QuickBooks?" lookup shown under the info banner.
  // An employer must be a QBO customer before the consolidated invoice can be
  // generated, so admins can check here before enrolling under a new company.
  const [qbCompanyQuery, setQbCompanyQuery] = useState('');
  const [qbEmployers, setQbEmployers] = useState<EmployerLookupOption[]>([]);
  const [qbEmployersLoading, setQbEmployersLoading] = useState(false);
  const [qbEmployersError, setQbEmployersError] = useState<string | null>(null);
  const [showPii, setShowPii] = useState(false);
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  // Employer enrolments that are enrolled but not yet registered as Company
  // Applications (the "Synced Enrolments" gap) — surfaced as a banner so they
  // are never silently invisible on this view.
  // Popup used by Auto-Process for both the "nothing to do" guard and any
  // API/network error. Inline messages were easy to miss next to the four
  // action buttons; admins asked for a blocking popup so they actually see
  // when nothing ran (either because every selected row was already
  // finished, or because the pipeline crashed).
  const [autoProcessPopup, setAutoProcessPopup] = useState<{
    tone: 'warning' | 'danger';
    title: string;
    subtitle?: string;
    message: string;
  } | null>(null);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  // Tracks the hovered invoice group so all rows sharing an Invoice ID
  // highlight together. CSS `hover:` only paints the <tr> the cursor is on,
  // but the Invoice # / Tax Invoice cells use rowSpan and are DOM-attached
  // to the FIRST row of their group — so without this, hovering any row
  // except the first leaves the merged cells dark, producing a jagged
  // "half-highlighted" block. Group key falls back to row id when a row
  // has no invoice yet (one-row group).
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);
  const [rowErrorPopup, setRowErrorPopup] = useState<CompanyApplicationRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [invoiceErrors, setInvoiceErrors] = useState<InvoiceError[]>([]);
  const [rescueTarget, setRescueTarget] = useState<RescueTarget | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  // Target page size — actual page may be larger if an invoice group of >20
  // learners would otherwise be split across pages. See pageBoundaries below.
  const itemsPerPage = 20;
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [brokenDocumentKeys, setBrokenDocumentKeys] = useState<Set<string>>(new Set());
  const [verifyingDocumentKey, setVerifyingDocumentKey] = useState<string | null>(null);
  // Toast state mirrors DirectApplicationViews.tsx so CA + DA show errors
  // identically. toastVisible drives the slide-in animation; toastMsg is
  // cleared 300ms after the slide-out completes so the DOM unmounts cleanly.
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = React.useCallback((message: string, isError = false) => {
    setToastMsg(message);
    setToastIsError(isError);
    setToastVisible(true);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
      window.setTimeout(() => setToastMsg(null), 300);
    }, 5000);
  }, []);
  // Custom confirm popup for the "send invoice email" action — replaces the
  // native window.confirm so the prompt matches the rest of the app's UI.
  const [confirmSendInvoiceOpen, setConfirmSendInvoiceOpen] = useState(false);
  // Confirm popup for the "generate invoice" action — same custom-modal
  // treatment so all three header buttons share the same UX shape.
  const [confirmGenerateInvoiceOpen, setConfirmGenerateInvoiceOpen] = useState(false);
  // Billing granularity chosen in the Generate Invoice popup. Consolidated is
  // the default (one invoice per employer x course-run); per-learner exists
  // because admin sometimes has to bill a single person on their own.
  const [invoiceMode, setInvoiceMode] = useState<'consolidated' | 'per-learner'>('consolidated');
  // List of pre-check problems blocking a Send Invoice Email attempt. Surfaced
  // as a popup instead of a cramped inline message so admins can read each
  // reason on its own line.
  const [sendBlockedReasons, setSendBlockedReasons] = useState<string[] | null>(null);

  const getDocumentKey = (row: CompanyApplicationRow, kind: 'main' | 'grant') => `${row.id || ''}:${kind}`;

  const handleViewDocument = async (row: CompanyApplicationRow, kind: 'main' | 'grant') => {
    const key = getDocumentKey(row, kind);
    const linkCol = kind === 'grant' ? 'Grant Invoice Drive Link' : 'Invoice Drive Link';
    const fileIdCol = kind === 'grant' ? 'Grant Invoice Drive File ID' : 'Invoice Drive File ID';
    const url = String(row[linkCol] || '').trim();
    const fileId = String(row[fileIdCol] || '').trim();
    const applicationId = String(row.id || '').trim();

    if (!url && !fileId) {
      setBrokenDocumentKeys(prev => new Set(prev).add(key));
      showToast('Document may have been deleted', true);
      return;
    }

    setVerifyingDocumentKey(key);
    try {
      const params = new URLSearchParams({ applicationId, documentType: kind });
      if (url) params.set('url', url);
      if (fileId) params.set('fileId', fileId);
      const res = await fetch(`/api/admin/ca-verify-drive?${params.toString()}`);
      const json = await res.json();
      if (json.valid) {
        window.open(url || `https://drive.google.com/file/d/${fileId}/view`, '_blank', 'noopener');
      } else {
        setBrokenDocumentKeys(prev => new Set(prev).add(key));
        showToast('Document may have been deleted', true);
        void reloadRows();
      }
    } catch {
      // Network glitch — let the user try in a new tab.
      window.open(url || `https://drive.google.com/file/d/${fileId}/view`, '_blank', 'noopener');
    } finally {
      setVerifyingDocumentKey(null);
    }
  };

  // Clear any broken-document keys whose row now reports valid Drive data
  // (e.g. after a successful Generate Invoice retry). Without this the
  // "Unavailable" badge would persist even though the row is healthy again.
  useEffect(() => {
    if (brokenDocumentKeys.size === 0) return;
    const next = new Set<string>();
    for (const key of brokenDocumentKeys) {
      const sepIdx = key.lastIndexOf(':');
      if (sepIdx < 0) continue;
      const rowId = key.slice(0, sepIdx);
      const kind = key.slice(sepIdx + 1);
      const row = rows.find(r => String(r.id || '') === rowId);
      if (!row) {
        next.add(key); // row not loaded yet — preserve until we know
        continue;
      }
      const fileIdCol = kind === 'grant' ? 'Grant Invoice Drive File ID' : 'Invoice Drive File ID';
      const linkCol = kind === 'grant' ? 'Grant Invoice Drive Link' : 'Invoice Drive Link';
      const stillEmpty = !String(row[fileIdCol] || '').trim() && !String(row[linkCol] || '').trim();
      if (stillEmpty) next.add(key);
    }
    if (next.size !== brokenDocumentKeys.size) {
      setBrokenDocumentKeys(next);
    }
  }, [rows, brokenDocumentKeys]);

  // Group key for "select all from the same upload". Same employer + same
  // course run = same Excel upload in practice — that's also the tuple every
  // invoice rolls up by. Recurring companies that come back later for a
  // different course or run get a different key automatically, so they stay
  // independent. Empty UEN/run falls back to single-row toggle.
  const groupKeyForRow = (row: CompanyApplicationRow): string | null => {
    const uen = String(row['Employer UEN*'] || '').trim().toLowerCase();
    const runId = String(row['Course Run ID'] || '').trim().toLowerCase();
    return uen && runId ? `${uen}::${runId}` : null;
  };

  const toggleRowSelected = (id: string, opts?: { singleRow?: boolean }) => {
    const target = rows.find(r => String(r.id || '') === id);
    const groupKey = target && !opts?.singleRow ? groupKeyForRow(target) : null;

    const idsToToggle: string[] = groupKey
      ? rows
          .filter(r => groupKeyForRow(r) === groupKey)
          .map(r => String(r.id || ''))
          .filter(Boolean)
      : [id];

    setSelectedIds(prev => {
      const next = new Set(prev);
      const wasSelected = prev.has(id);
      // Mirror the clicked row's transition across the whole group: if the
      // clicked row was checked, uncheck everything in the group; otherwise
      // check everything. Keeps the click target's state authoritative.
      if (wasSelected) {
        idsToToggle.forEach(g => next.delete(g));
      } else {
        idsToToggle.forEach(g => next.add(g));
      }
      return next;
    });
  };

  // How many employer enrolments are enrolled but not yet registered as CA rows.
  const reloadRows = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const fetched = await fetchRows();
      setRows(fetched);
    } catch (err) {
      console.error('Failed to load company applications:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load company applications.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) {
      setDeleteMessage('Select at least one row first.');
      return;
    }
    setDeleteMessage(null);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    setDeleteMessage(null);
    try {
      const res = await fetch('/api/admin/ca-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const parts: string[] = [`Deleted ${data.deleted} row${data.deleted === 1 ? '' : 's'} (any linked enrolment/grant/invoice was cancelled).`];
      if (data.failedCount > 0) {
        const firstErr = Array.isArray(data.results)
          ? data.results.find((r: any) => !r.deleted && r.error)?.error
          : null;
        parts.push(`${data.failedCount} row${data.failedCount === 1 ? '' : 's'} left in place${firstErr ? ` — ${firstErr}` : ''}.`);
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        parts.push(...data.warnings);
      }
      setDeleteMessage(parts.join(' '));
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      void reloadRows();
    } catch (err) {
      console.error('Delete failed:', err);
      setDeleteMessage(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setIsDeleting(false);
    }
  };

  const generateInvoiceForSelected = () => {
    if (selectedIds.size === 0) {
      setInvoiceMessage('Select at least one row first.');
      return;
    }
    setInvoiceMessage(null);
    // Always reopen on the safe default rather than inheriting the last run's
    // choice — a sticky "per-learner" would silently split a later batch.
    setInvoiceMode('consolidated');
    setConfirmGenerateInvoiceOpen(true);
  };

  const executeGenerateInvoice = async () => {
    setConfirmGenerateInvoiceOpen(false);
    setIsGeneratingInvoice(true);
    setInvoiceMessage(null);
    setInvoiceErrors([]);
    try {
      const res = await fetch('/api/admin/ca-generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: Array.from(selectedIds), mode: invoiceMode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const generated = Number(data.generated) || 0;
      const alreadyInvoiced = Number(data.skippedAlreadyInvoiced) || 0;
      const notEnrolled = Number(data.skippedNotEnrolled) || 0;
      const awaitingGrants = Number(data.skippedAwaitingGrants) || 0;
      const failed = Number(data.failed) || 0;
      const replaced = Number(data.replacedGroups) || 0;
      const billedByHand = Number(data.skippedBilledManually) || 0;
      // The backend counts per group, and in per-learner mode a group IS one
      // learner — so name the unit after the mode the user actually picked.
      const unit = invoiceMode === 'per-learner' ? 'learner' : 'group';
      const parts: string[] = [];
      if (generated) parts.push(`${generated} invoice${generated === 1 ? '' : 's'} generated`);
      if (replaced) parts.push(`${replaced} existing invoice${replaced === 1 ? '' : 's'} replaced to cover a late joiner`);
      if (billedByHand) parts.push(`${billedByHand} learner${billedByHand === 1 ? '' : 's'} billed by hand — left for QuickBooks`);
      if (alreadyInvoiced) parts.push(`${alreadyInvoiced} ${unit}${alreadyInvoiced === 1 ? '' : 's'} already invoiced — left alone`);
      if (notEnrolled) parts.push(`${notEnrolled} ${unit}${notEnrolled === 1 ? '' : 's'} skipped (not yet enrolled with SSG)`);
      if (awaitingGrants) parts.push(`${awaitingGrants} ${unit}${awaitingGrants === 1 ? '' : 's'} awaiting grants — click "Sync Grants" after stakeholders apply in the SSG portal`);
      if (failed) parts.push(`${failed} failed`);

      // Treat the all-already-invoiced case as an explicit block: nothing
      // happened because every selected group already has an invoice.
      if (generated === 0 && failed === 0 && replaced === 0 && billedByHand === 0 && alreadyInvoiced > 0 && notEnrolled === 0 && awaitingGrants === 0) {
        setInvoiceMessage(
          `⚠ ${alreadyInvoiced} ${unit}${alreadyInvoiced === 1 ? '' : 's'} already invoiced — cannot regenerate. Open the existing invoice via the Tax Invoice column, or delete it in QBO first if you need to regenerate.`
        );
      } else {
        setInvoiceMessage(
          parts.length === 0
            ? 'Nothing to do — selected rows are not yet enrolled.'
            : parts.join(' · ')
        );
      }
      setInvoiceErrors(Array.isArray(data.errors) ? data.errors : []);
      void reloadRows();
      window.setTimeout(() => void reloadRows(), 3000);
    } catch (err) {
      console.error('Generate invoice failed:', err);
      setInvoiceMessage(err instanceof Error ? err.message : 'Generate invoice failed.');
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const sendInvoiceEmailForSelected = async () => {
    if (selectedIds.size === 0) {
      setEmailMessage('Select at least one row first.');
      return;
    }
    // Hard gate before opening the send confirm popup: every selected row
    // must have a tax invoice, a grant invoice (if the learner is grant-
    // eligible), and a verified supporting doc. Verification happens
    // exclusively on the Check Supporting Document page now — surface the
    // missing pieces in one clear message so the admin knows what to do.
    const selectedRows = rows.filter(r => selectedIds.has(String(r.id || '')));
    const missingInvoice: string[] = [];
    const missingGrantInvoice: string[] = [];
    const missingDocVerified: string[] = [];
    for (const r of selectedRows) {
      const learnerLabel = String(r['Trainee FULL Name as on government ID*'] || r.id || '').trim() || '(unnamed)';
      // Billed by hand — there is no LMS invoice to email, and there never
      // will be. Reporting them as "missing tax invoice" would send the admin
      // to Generate Invoice, which is the duplicate they chose to avoid.
      if (isCheckedValue(r['Billed Manually'])) continue;
      const hasInvoice = hasValue(r['Invoice ID']) && hasValue(r['Invoice Doc Number']);
      const hasInvoicePdf = hasValue(r['Invoice Drive Link']) || hasValue(r['Invoice Drive File ID']);
      if (!hasInvoice || !hasInvoicePdf) {
        missingInvoice.push(learnerLabel);
      }
      // Grant invoice only required when the learner has a grant AND is not
      // marked grant-ineligible. Ineligible learners pay full fee — no
      // supplemental WSG invoice expected.
      const needsGrantInvoice = hasValue(r['Grant ID']) && !isCheckedValue(r['Grant Ineligible']);
      if (needsGrantInvoice) {
        const hasGrantInvoice = hasValue(r['Grant Invoice ID']);
        const hasGrantInvoicePdf = hasValue(r['Grant Invoice Drive Link']) || hasValue(r['Grant Invoice Drive File ID']);
        if (!hasGrantInvoice || !hasGrantInvoicePdf) missingGrantInvoice.push(learnerLabel);
      }
      const docVerified = String(r['Supporting Doc Verification Status'] || '').trim().toLowerCase() === 'verified';
      if (!docVerified) missingDocVerified.push(learnerLabel);
    }

    const problems: string[] = [];
    if (missingInvoice.length > 0) {
      problems.push(
        `${missingInvoice.length} row${missingInvoice.length === 1 ? '' : 's'} missing tax invoice — click Generate Invoice first.`
      );
    }
    if (missingGrantInvoice.length > 0) {
      problems.push(
        `${missingGrantInvoice.length} row${missingGrantInvoice.length === 1 ? '' : 's'} missing grant invoice — click Generate Invoice (after Sync Grants if needed).`
      );
    }
    if (missingDocVerified.length > 0) {
      problems.push(
        `${missingDocVerified.length} row${missingDocVerified.length === 1 ? '' : 's'} not yet verified — go to Check Supporting Document.`
      );
    }
    if (problems.length > 0) {
      setEmailMessage(null);
      setSendBlockedReasons(problems);
      return;
    }
    setConfirmSendInvoiceOpen(true);
  };

  const executeSendInvoiceEmail = async () => {
    setConfirmSendInvoiceOpen(false);
    setIsSendingEmail(true);
    setEmailMessage(null);
    try {
      const res = await fetch('/api/admin/ca-send-invoice-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      // Master toggle off → server returns toggleDisabled:true with all-zero
      // counts. Surface that explicitly so admin doesn't think the rows were
      // empty when actually the send was held back on purpose.
      if (data.toggleDisabled) {
        setEmailMessage('Held in test mode — master send toggle is OFF. No emails sent.');
        void reloadRows();
        return;
      }
      const parts: string[] = [];
      if (data.sent) parts.push(`${data.sent} invoice${data.sent === 1 ? '' : 's'} emailed`);
      if (data.skippedAlreadySent) parts.push(`${data.skippedAlreadySent} already sent — skipped`);
      if (data.skippedMissingEmail) parts.push(`${data.skippedMissingEmail} missing employer email`);
      if (data.skippedNoInvoice) parts.push(`${data.skippedNoInvoice} row${data.skippedNoInvoice === 1 ? '' : 's'} not yet invoiced`);
      if (data.skippedNotVerified) parts.push(`${data.skippedNotVerified} row${data.skippedNotVerified === 1 ? '' : 's'} not yet verified`);
      if (data.failed) parts.push(`${data.failed} failed`);
      const firstFailure = data.failures?.[0]?.error;
      setEmailMessage(
        parts.length === 0
          ? 'Nothing to send.'
          : firstFailure
            ? `${parts.join(' · ')} — ${firstFailure}`
            : parts.join(' · ')
      );
      void reloadRows();
    } catch (err) {
      console.error('Send invoice email failed:', err);
      setEmailMessage(err instanceof Error ? err.message : 'Send invoice email failed.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const onRescueLinked = (summary: string) => {
    setRescueTarget(null);
    setInvoiceMessage(summary);
    setInvoiceErrors(prev =>
      prev.filter(e => !(e.employerUen === rescueTarget?.employerUen && e.courseRunId === rescueTarget?.courseRunId))
    );
    void reloadRows();
    window.setTimeout(() => void reloadRows(), 2000);
  };

  // Toggle a single learner's grant eligibility. When marked ineligible,
  // the invoice guard treats the row as if it had a grant — so the group
  // can still be invoiced and the employer pays full fee for that learner.
  const toggleGrantEligibility = async (applicationId: string, makeIneligible: boolean) => {
    try {
      const res = await fetch('/api/admin/ca-toggle-grant-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, ineligible: makeIneligible }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      void reloadRows();
    } catch (err) {
      alert(`Failed to update grant eligibility: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Un-mark a learner that was enrolled as "billed by hand". Only ever used to
  // correct a mistake — the flag is normally set at enrolment time, when the
  // admin chose to add them to an invoice that already existed. Clearing it
  // puts them back in the queue for a normal invoice.
  const clearManualBilling = async (applicationId: string) => {
    try {
      const res = await fetch('/api/admin/ca-toggle-manual-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, billedManually: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      void reloadRows();
    } catch (err) {
      alert(`Failed to update billing: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Run the full CA pipeline (SSG enrol → grant lookup + course-run sweep →
  // Google Calendar add → auto-invoice) for the selected rows. Replaces the
  // separate Sync Grants / Sync Calendar buttons — every stage is idempotent,
  // so re-running over already-processed rows just re-confirms them. The
  // invoice sweep is guarded server-side to bill only enroled + grant-settled
  // rows; awaiting-grant rows are reported as pending grant.
  const runPipeline = async () => {
    if (selectedIds.size === 0) return;

    // "Fully done" = SSG enroled AND grant settled (granted or explicitly
    // ineligible) AND calendar added AND invoiced. Re-running Auto-Process on rows that
    // already pass all four stages is a no-op at the lib level but burns
    // SSG/Google API quota and produces a confusing "0 enroled, 0 with
    // grant" summary that looks like a failure. Filter on the frontend so
    // the call only ships rows that still need work; if everything passes,
    // surface a blocking popup instead of silently doing nothing.
    const selectedRows = rows.filter(r => selectedIds.has(String(r.id || '')));
    const isFullyDone = (r: CompanyApplicationRow) => {
      const enroled = hasValue(r['Enrolment ID']);
      const grantSettled =
        hasValue(r['Grant ID']) ||
        hasValue(r['Grant ID (BL)']) ||
        isCheckedValue(r['Grant Ineligible']);
      const calAdded = isCheckedValue(r['Calendar Added']);
      const invoiced = hasValue(r['Invoice ID']);
      // A row that actually enrolled but is still stamped 'failed' is a stale
      // status left over from a first pass that finished before SSG returned the
      // enrolment id. Don't treat it as done — let Auto-Process re-run so the
      // server-side status flip reclassifies it and clears the stale error.
      const staleFailed =
        enroled && String(r['Auto-Enrol Status'] || '').trim().toLowerCase() === 'failed';
      if (staleFailed) return false;
      return enroled && grantSettled && calAdded && invoiced;
    };
    const pendingRows = selectedRows.filter(r => !isFullyDone(r));

    if (pendingRows.length === 0) {
      setAutoProcessPopup({
        tone: 'warning',
        title: 'Nothing to auto-process',
        subtitle: `${selectedRows.length} selected row${selectedRows.length === 1 ? '' : 's'} already finished`,
        message: `Every selected row is already enroled with SSG, has a grant ID (or is marked grant-ineligible), is on the Google Calendar, and has an invoice. Auto-Process can't run again because there's nothing left to do for these rows. Pick rows whose Enrol / Grant / Cal / Invoice tick is still missing.`,
      });
      return;
    }

    setIsRunningPipeline(true);
    setPipelineMessage(null);
    try {
      const res = await fetch('/api/admin/ca-run-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: pendingRows.map(r => String(r.id || '')) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      await reloadRows();
      const processed = Number(data.processed || 0);
      const enroled = Number(data.enroled || 0);
      const granted = Number(data.granted || 0);
      const failed = Number(data.failed || 0);
      const skipped = selectedRows.length - pendingRows.length;
      const parts: string[] = [`${processed} row${processed === 1 ? '' : 's'} processed`];
      parts.push(`${enroled} enroled`);
      parts.push(`${granted} with grant`);
      const inv = data.invoice;
      if (inv) {
        parts.push(`${Number(inv.generated || 0)} invoice${Number(inv.generated || 0) === 1 ? '' : 's'} generated`);
        const awaiting = Number(inv.skippedAwaitingGrants || 0);
        if (awaiting > 0) parts.push(`${awaiting} invoice${awaiting === 1 ? '' : 's'} pending grant`);
        const invFailed = Number(inv.failed || 0);
        if (invFailed > 0) parts.push(`${invFailed} invoice${invFailed === 1 ? '' : 's'} failed`);
      }
      if (skipped > 0) parts.push(`${skipped} already-done row${skipped === 1 ? '' : 's'} skipped`);
      if (failed > 0) parts.push(`${failed} failed — check row error popups`);
      setPipelineMessage(parts.join(' · '));

      // Surface WHY invoices didn't generate — otherwise Auto-Process silently
      // skips (awaiting grant / not enrolled / QBO customer) and looks broken.
      const invGenerated = Number(inv?.generated || 0);
      const invSkipReasons = Number(inv?.skippedAwaitingGrants || 0) + Number(inv?.skippedNotEnrolled || 0) + Number(inv?.failed || 0);
      const invErrors: string[] = Array.isArray(inv?.errors)
        ? inv.errors.map((e: any) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e)))
        : [];
      if (invGenerated === 0 && (invSkipReasons > 0 || invErrors.length > 0)) {
        setAutoProcessPopup({
          tone: 'warning',
          title: 'Enrolment done — but no invoice was generated',
          subtitle: inv?.note || 'Some invoice group(s) were skipped.',
          message: [
            inv?.note,
            ...invErrors,
            'Grants land asynchronously (seconds to ~15 min). Click "Sync Grants", then "Generate Invoice" — or mark full-fee learners "Not Grant Eligible" so they invoice without a grant.',
          ]
            .filter(Boolean)
            .join('\n\n'),
        });
      }
    } catch (err) {
      console.error('Auto-Process failed:', err);
      setAutoProcessPopup({
        tone: 'danger',
        title: 'Auto-Process failed',
        subtitle: `${pendingRows.length} row${pendingRows.length === 1 ? '' : 's'} were not processed`,
        message: err instanceof Error ? err.message : 'Unknown error — check the server console for details.',
      });
    } finally {
      setIsRunningPipeline(false);
    }
  };

  useEffect(() => {
    void reloadRows();
  }, []);

  // Load the merged employer list once (QBO customers ∪ CA history) for the
  // "check if a company is in QuickBooks" lookup. Best-effort — the tab still
  // works if this fails.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setQbEmployersLoading(true);
      setQbEmployersError(null);
      try {
        const res = await fetch('/api/admin/list-employers');
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(data.employers)) {
          setQbEmployers(data.employers as EmployerLookupOption[]);
        } else {
          setQbEmployersError(data?.message || 'Failed to load companies');
        }
      } catch (e: any) {
        if (!cancelled) setQbEmployersError(e?.message || 'Failed to load companies');
      } finally {
        if (!cancelled) setQbEmployersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Client-side filter over the loaded employer list (name or UEN substring).
  const qbCompanyMatches = useMemo(() => {
    const q = qbCompanyQuery.trim().toLowerCase();
    if (!q) return [];
    return qbEmployers
      .filter(e =>
        e.employerOrgName.toLowerCase().includes(q) ||
        e.employerUen.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [qbCompanyQuery, qbEmployers]);

  // Auto-refresh polling removed — was reloading rows every 5s while any row
  // was in-progress, which the admin found disruptive. Refresh is now manual
  // via the Refresh button (or Retry Selected, which reloads on completion).

  const stuckRowCount = useMemo(
    () => rows.filter(r => r._stuck === '1').length,
    [rows],
  );

  // Companies holding more than one invoice for the same class. Derived from
  // the rows already on screen rather than a new endpoint, and keyed on
  // (employer, course run) — the same pair the invoice itself is grouped by.
  const splitInvoiceGroups = useMemo(() => {
    const byGroup = new Map<string, { employer: string; courseRunId: string; docNumbers: Set<string> }>();
    for (const r of rows) {
      const invoiceId = String(r['Invoice ID'] || '').trim();
      if (!invoiceId) continue;
      const uen = String(r['Employer UEN*'] || '').trim();
      const runId = String(r['Course Run ID'] || '').trim();
      if (!uen || !runId) continue;
      const key = `${uen}::${runId}`;
      const entry = byGroup.get(key) ?? {
        employer: String(r['Employer Organization Name*'] || '').trim() || uen,
        courseRunId: runId,
        docNumbers: new Set<string>(),
      };
      entry.docNumbers.add(String(r['Invoice Doc Number'] || '').trim() || invoiceId);
      byGroup.set(key, entry);
    }
    return Array.from(byGroup.entries())
      .filter(([, v]) => v.docNumbers.size > 1)
      .map(([key, v]) => ({
        key,
        employer: v.employer,
        courseRunId: v.courseRunId,
        docNumbers: Array.from(v.docNumbers).sort(),
      }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const queryMatched = query
      ? rows.filter(row => VISIBLE_COLUMNS.some(column => (row[column] || '').toLowerCase().includes(query)))
      : rows;
    const matched = showStuckOnly
      ? queryMatched.filter(row => row._stuck === '1')
      : queryMatched;
    // Sort so rows sharing the same Invoice ID are adjacent — keeps the
    // (employer, course-run) groups together so the Invoice # / Tax Invoice
    // cell-merging below picks them up. Within a group, trainee name is the
    // tiebreaker. Rows without an invoice yet sort first (newest uploads
    // first via created_at fallback through the original DB ORDER BY).
    return [...matched].sort((a, b) => {
      const ia = (a['Invoice ID'] || '').trim();
      const ib = (b['Invoice ID'] || '').trim();
      if (ia !== ib) {
        if (!ia) return -1;
        if (!ib) return 1;
        return ia.localeCompare(ib);
      }
      const na = (a['Trainee FULL Name as on government ID*'] || '').trim();
      const nb = (b['Trainee FULL Name as on government ID*'] || '').trim();
      return na.localeCompare(nb);
    });
  }, [rows, searchQuery, showStuckOnly]);

  React.useEffect(() => { setCurrentPage(1); }, [searchQuery, showStuckOnly]);

  // Group-aware page boundaries: target ~itemsPerPage rows per page, but
  // never split an invoice group (rows sharing an Invoice ID) across pages,
  // because the Invoice # / Tax Invoice cells use rowSpan and would render
  // incorrectly if the group were broken. A single group larger than the
  // target gets its own page.
  const pageBoundaries = useMemo(() => {
    const pages: Array<{ start: number; end: number }> = [];
    if (filteredRows.length === 0) return pages;
    let pageStart = 0;
    let i = 0;
    while (i < filteredRows.length) {
      const inv = (filteredRows[i]['Invoice ID'] || '').trim();
      let groupEnd = i + 1;
      if (inv) {
        while (groupEnd < filteredRows.length && (filteredRows[groupEnd]['Invoice ID'] || '').trim() === inv) {
          groupEnd++;
        }
      }
      const currentPageSize = i - pageStart;
      const groupSize = groupEnd - i;
      if (currentPageSize > 0 && currentPageSize + groupSize > itemsPerPage) {
        pages.push({ start: pageStart, end: i });
        pageStart = i;
      }
      i = groupEnd;
    }
    if (pageStart < filteredRows.length) {
      pages.push({ start: pageStart, end: filteredRows.length });
    }
    return pages;
  }, [filteredRows]);

  const totalPages = Math.max(1, pageBoundaries.length);
  const safePage = Math.min(currentPage, totalPages);
  const currentBoundary = pageBoundaries[safePage - 1] || { start: 0, end: 0 };
  const startIndex = currentBoundary.start;
  const endIndex = currentBoundary.end;
  const paginatedRows = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex],
  );

  // For each row on the current page, compute whether its Invoice # / Tax
  // Invoice cells should render with rowSpan (first row in a consolidated
  // group) or be skipped entirely (merged into the row above it). Computed
  // per-page so rowSpan indexes match what's actually rendered — an invoice
  // group that crosses a page boundary will be visually split.
  const invoiceGroupMeta = useMemo(() => {
    const meta: Array<{ isFirst: boolean; size: number }> = [];
    let i = 0;
    while (i < paginatedRows.length) {
      const inv = (paginatedRows[i]['Invoice ID'] || '').trim();
      if (!inv) {
        meta.push({ isFirst: true, size: 1 });
        i++;
        continue;
      }
      let j = i + 1;
      while (j < paginatedRows.length && (paginatedRows[j]['Invoice ID'] || '').trim() === inv) {
        j++;
      }
      const size = j - i;
      for (let k = i; k < j; k++) {
        meta.push({ isFirst: k === i, size });
      }
      i = j;
    }
    return meta;
  }, [paginatedRows]);

  const enroledCount = rows.filter(row => hasValue(row['Enrolment ID'])).length;
  const calendarAddedCount = rows.filter(row => isCheckedValue(row['Calendar Added'])).length;
  const invoiceCreatedCount = rows.filter(row => hasValue(row['Invoice ID'])).length;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold dark:text-white leading-tight">View Company Application</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Track enrolment, calendar, and invoice status across uploaded company applications.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 flex items-center gap-4 border-l-4 border-blue-500 hover:shadow-lg transition-shadow">
          <div className="w-11 h-11 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.Building} className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-blue-600 leading-none">{rows.length}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Company Applications</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-4 border-l-4 border-green-500 hover:shadow-lg transition-shadow">
          <div className="w-11 h-11 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-green-600 leading-none">{enroledCount}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Enrolled</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-4 border-l-4 border-indigo-500 hover:shadow-lg transition-shadow">
          <div className="w-11 h-11 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.Calendar} className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-indigo-600 leading-none">{calendarAddedCount}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Added to Calendar</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-4 border-l-4 border-amber-500 hover:shadow-lg transition-shadow">
          <div className="w-11 h-11 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.FileText} className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-amber-600 leading-none">{invoiceCreatedCount}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Invoice Created</p>
          </div>
        </Card>
      </div>

      <CaEmailToggleBanner />

      {/* A company holding more than one invoice for the same class. It happens
          legitimately — two upload batches, per-learner mode, a late joiner —
          and everything downstream copes, but until now nothing ever said so.
          Finding out meant noticing two rows in the Invoice # column. */}
      {splitInvoiceGroups.length > 0 && (
        <div className="mb-6 p-4 rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 flex-shrink-0 rounded-full bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center">
              <Icon name={IconName.Warning} className="w-5 h-5 text-amber-600 dark:text-amber-300" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {splitInvoiceGroups.length} compan{splitInvoiceGroups.length === 1 ? 'y has' : 'ies have'} more than one invoice for the same class
              </p>
              <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">
                The amounts are correct — each learner is billed once. But the employer receives several
                invoices for one class, and each one is emailed separately.
              </p>
              <ul className="mt-2 space-y-1">
                {splitInvoiceGroups.slice(0, 6).map(g => (
                  <li key={g.key} className="text-xs text-amber-800 dark:text-amber-200">
                    <span className="font-semibold">{g.employer}</span>
                    <span className="opacity-75"> · run {g.courseRunId} · </span>
                    <span className="font-mono">{g.docNumbers.join(', ')}</span>
                  </li>
                ))}
                {splitInvoiceGroups.length > 6 && (
                  <li className="text-xs text-amber-700 dark:text-amber-300">
                    …and {splitInvoiceGroups.length - 6} more.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* QuickBooks company lookup — check BEFORE enrolling whether an employer
          is already a QBO customer. A company that isn't in QuickBooks yet
          (source 'history') will make the consolidated invoice fail until it's
          created there, so this lets admins catch it up front. */}
      <Card className="p-6 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.Building} className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Check if a company is in QuickBooks</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              A company must already be a QuickBooks customer for its consolidated invoice to generate. Search before enrolling under it.
            </p>
          </div>
        </div>
        <div className="relative mt-3">
          <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="search-qb-company"
            type="text"
            value={qbCompanyQuery}
            onChange={(e) => setQbCompanyQuery(e.target.value)}
            placeholder="Search company name or UEN…"
            className={`${inputClasses} pl-9`}
          />
        </div>

        {qbEmployersLoading && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Loading companies from QuickBooks…</p>
        )}
        {qbEmployersError && (
          <p className="text-xs text-red-500 mt-2">Couldn’t load companies: {qbEmployersError}</p>
        )}

        {qbCompanyQuery.trim() && !qbEmployersLoading && (
          qbCompanyMatches.length > 0 ? (
            <ul className="mt-3 max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
              {qbCompanyMatches.map((e) => {
                const inQb = e.source === 'qb' || e.source === 'both';
                return (
                  <li key={e.id} className="px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{e.employerOrgName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {e.employerUen ? `UEN ${e.employerUen}` : 'No UEN on record'}
                        {e.employerContactEmail ? ` · ${e.employerContactEmail}` : ''}
                      </p>
                    </div>
                    {inQb ? (
                      <span className="inline-flex items-center gap-1 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5" />
                        In QuickBooks
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        title="Only in application history — not a QuickBooks customer yet. Add it in QuickBooks before enrolling or the invoice will fail."
                      >
                        <Icon name={IconName.Warning} className="w-3.5 h-3.5" />
                        Not in QuickBooks
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              No company matches “{qbCompanyQuery.trim()}”. If this is a new company, add it in QuickBooks first — otherwise its consolidated invoice will fail when you enrol under it.
            </div>
          )
        )}
      </Card>

      {/* The "Register all" banner used to sit here. It promoted every synced
          employer enrolment in one click, taking the employer name from
          learner_profile.company — which is blank for most learners, so a stray
          click on 22 Aug 2026 added 1,952 rows with no employer, none of which
          can ever be invoiced. Adding to this list now happens on All Synced
          Enrolments, where the admin picks the employer deliberately. */}

      <Card className="p-6 mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="search-company-application" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Search Applications</label>
            <div className="relative">
              <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="search-company-application" type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by trainee, employer, course, UEN, or email..." className={`${inputClasses} pl-9`} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowStuckOnly(v => !v)}
            title={
              stuckRowCount === 0
                ? 'No rows need attention — every application is either complete or progressing normally.'
                : 'Show only applications that failed or have non-blocking pipeline warnings (calendar / native enrol / partial grant sync).'
            }
            className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              showStuckOnly
                ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 dark:border-red-400'
                : stuckRowCount > 0
                  ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20'
                  : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400 cursor-default'
            }`}
            disabled={stuckRowCount === 0 && !showStuckOnly}
          >
            <Icon name={IconName.Warning} className="w-4 h-4 mr-2" />
            {showStuckOnly ? 'Showing stuck only' : `Needs attention (${stuckRowCount})`}
          </button>
          <Button onClick={() => void reloadRows()} disabled={isLoading}>
            {isLoading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Loading...
              </div>
            ) : (
              <>
                <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                Refresh
              </>
            )}
          </Button>
        </div>
        {loadError && <p className="text-red-500 text-sm mt-3">{loadError}</p>}
      </Card>

      {isLoading && (
        <div className="flex justify-center py-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-300">Fetching company applications from database...</p>
          </div>
        </div>
      )}

      {!isLoading && (
      <Card className="p-0">
        <div className="p-6 border-b flex justify-between items-start dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 rounded-t-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Icon name={IconName.Users} className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold dark:text-white">Company Applications</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Showing {filteredRows.length === 0 ? 0 : startIndex + 1}-{endIndex} of {filteredRows.length} applications</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void runPipeline()}
                disabled={isRunningPipeline || selectedIds.size === 0}
                title="Auto-process the selected rows: SSG enrolment (if missing) → grant lookup + course-run sweep → Google Calendar add. Idempotent — already-done stages just re-confirm. Invoice stays on its own button."
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-purple-600 hover:bg-purple-700 shadow-sm shadow-purple-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isRunningPipeline ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Sync} className="w-3.5 h-3.5 mr-1.5" />
                    Auto-Process
                  </>
                )}
              </button>
              <button
                onClick={() => void generateInvoiceForSelected()}
                disabled={isGeneratingInvoice || selectedIds.size === 0}
                title="Generate one consolidated QuickBooks invoice per (employer, course) group for the selected rows. Skips groups that already have an invoice."
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-orange-600 hover:bg-orange-700 shadow-sm shadow-orange-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGeneratingInvoice ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.FileText} className="w-3.5 h-3.5 mr-1.5" />
                    Generate Invoice
                  </>
                )}
              </button>
              <button
                onClick={() => void sendInvoiceEmailForSelected()}
                disabled={isSendingEmail || selectedIds.size === 0}
                title="Email the consolidated main tax invoice to the EMPLOYER contact for the selected rows. All selected rows must already be verified on the Check Supporting Document page. Already-sent invoices are skipped."
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 ring-1 ring-indigo-400/50 shadow-md shadow-indigo-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSendingEmail ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Mail} className="w-3.5 h-3.5 mr-1.5" />
                    Send Invoice
                  </>
                )}
              </button>
              <button
                onClick={() => void deleteSelected()}
                disabled={isDeleting || selectedIds.size === 0}
                title="Temporary admin cleanup: delete the selected Company Application rows. Does NOT remove the LMS enrolment, invoice, or Drive files — those must be cleaned manually if needed."
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-red-600 hover:bg-red-700 shadow-sm shadow-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Delete} className="w-3.5 h-3.5 mr-1.5" />
                    Delete Selected
                  </>
                )}
              </button>
            </div>
            {pipelineMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{pipelineMessage}</p>
            )}
            {emailMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{emailMessage}</p>
            )}
            {invoiceMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{invoiceMessage}</p>
            )}
            {deleteMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{deleteMessage}</p>
            )}
            {invoiceErrors.length > 0 && (
              <div className="mt-1 max-w-md text-right space-y-1">
                {invoiceErrors.map((e, i) => (
                  <div key={`${e.groupKey}-${i}`} className="text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 rounded p-2 bg-red-50/50 dark:bg-red-900/10 text-left">
                    <p>
                      <span className="font-semibold">{e.employerOrgName || '(unnamed)'}</span>
                      {e.employerUen ? ` · UEN ${e.employerUen}` : ''}
                    </p>
                    <p className="mt-0.5 break-words">{e.error}</p>
                    {e.isCustomerNotFound && e.employerUen && (
                      <button
                        type="button"
                        onClick={() => setRescueTarget({
                          employerUen: e.employerUen,
                          employerOrgName: e.employerOrgName,
                          courseRunId: e.courseRunId,
                        })}
                        className="mt-2 inline-flex items-center px-2 py-1 text-[11px] font-medium rounded border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      >
                        Search QBO &amp; Link
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {rescueTarget && (
          <QboCustomerRescueModal
            target={rescueTarget}
            onClose={() => setRescueTarget(null)}
            onLinked={onRescueLinked}
          />
        )}
        {autoProcessPopup && (
          <ConfirmPopup
            tone={autoProcessPopup.tone}
            icon={autoProcessPopup.tone === 'danger' ? IconName.Warning : IconName.CheckCircle}
            title={autoProcessPopup.title}
            subtitle={autoProcessPopup.subtitle}
            confirmLabel="Got it"
            confirmIcon={IconName.CheckCircle}
            hideCancel
            onConfirm={() => setAutoProcessPopup(null)}
            onCancel={() => setAutoProcessPopup(null)}
          >
            <p className="text-sm text-gray-700 dark:text-gray-200">{autoProcessPopup.message}</p>
          </ConfirmPopup>
        )}
        {sendBlockedReasons && (
          <ConfirmPopup
            tone="warning"
            icon={IconName.Warning}
            title="Can't send invoice email yet"
            subtitle={`${sendBlockedReasons.length} blocker${sendBlockedReasons.length === 1 ? '' : 's'} on the selected rows`}
            confirmLabel="Got it"
            confirmIcon={IconName.CheckCircle}
            hideCancel
            onConfirm={() => setSendBlockedReasons(null)}
            onCancel={() => setSendBlockedReasons(null)}
          >
            <ul className="space-y-2 text-sm">
              {sendBlockedReasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Icon name={IconName.Warning} className="w-4 h-4 mt-0.5 flex-shrink-0 text-orange-500 dark:text-orange-400" />
                  <span className="text-gray-700 dark:text-gray-200">{reason}</span>
                </li>
              ))}
            </ul>
          </ConfirmPopup>
        )}
        {confirmSendInvoiceOpen && (
          <ConfirmPopup
            tone="primary"
            icon={IconName.Mail}
            title="Send tax invoice email?"
            subtitle={`${selectedIds.size} selected row${selectedIds.size === 1 ? '' : 's'} · emails go to each EMPLOYER contact`}
            confirmLabel="Send invoice email"
            busyLabel="Sending…"
            busy={isSendingEmail}
            onConfirm={() => void executeSendInvoiceEmail()}
            onCancel={() => setConfirmSendInvoiceOpen(false)}
          >
            <p>
              One consolidated email is sent per unique invoice. Already-sent invoices are skipped automatically (idempotent).
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tip: if the master &quot;send invoice emails&quot; toggle is OFF, the send is held — no email actually leaves.
            </p>
          </ConfirmPopup>
        )}
        {confirmGenerateInvoiceOpen && (() => {
          const selectedRows = rows.filter(r => selectedIds.has(String(r.id || '')));
          const totalSelected = selectedRows.length;
          const withInvoice = selectedRows.filter(r => hasValue(r['Invoice ID'])).length;
          const withGrantInvoice = selectedRows.filter(r => hasValue(r['Grant Invoice ID'])).length;
          const allInvoiced = totalSelected > 0 && withInvoice === totalSelected;
          const groupKeyOf = (r: any) => {
            const uen = String(r['Employer UEN*'] || '').trim();
            const runId = String(r['Course Run ID'] || '').trim();
            return `${uen}::${runId}`;
          };
          const groupCount = new Set(selectedRows.map(groupKeyOf)).size;
          // Invoices these employers already hold for this course run, sitting
          // on rows you did NOT tick. This is the late joiner blind spot: tick
          // only the new learner and every count above reads zero, so the
          // popup used to say nothing at all while about to cut a second
          // invoice for a class that already had one.
          const selectedGroupKeys = new Set(selectedRows.map(groupKeyOf));
          const priorInvoiceDocs = Array.from(new Set(
            rows
              .filter(r =>
                selectedGroupKeys.has(groupKeyOf(r)) &&
                !selectedIds.has(String(r.id || '')) &&
                hasValue(r['Invoice ID'])
              )
              .map(r => String(r['Invoice Doc Number'] || r['Invoice ID'] || '').trim())
              .filter(Boolean)
          ));
          // Rows that will actually be billed — already-invoiced ones are left
          // alone, so they don't count toward the invoice tally either way.
          const toBill = totalSelected - withInvoice;
          const perLearner = invoiceMode === 'per-learner';
          const newInvoiceCount = perLearner ? toBill : groupCount;
          return (
            <ConfirmPopup
              tone="warning"
              icon={IconName.FileText}
              title="Generate QuickBooks invoice?"
              subtitle={
                perLearner
                  ? `${totalSelected} selected row${totalSelected === 1 ? '' : 's'} · one invoice per learner`
                  : `${totalSelected} selected row${totalSelected === 1 ? '' : 's'} · ${groupCount} (employer × course-run) group${groupCount === 1 ? '' : 's'}`
              }
              confirmLabel="Generate invoice"
              busyLabel="Generating…"
              busy={isGeneratingInvoice}
              disableConfirm={allInvoiced}
              confirmDisabledHint={allInvoiced ? 'Nothing to generate — every selected row already has an invoice.' : undefined}
              onConfirm={() => void executeGenerateInvoice()}
              onCancel={() => setConfirmGenerateInvoiceOpen(false)}
            >
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">How should this be billed?</p>
                {([
                  {
                    value: 'consolidated' as const,
                    label: 'One consolidated invoice per group',
                    hint: `Learners from the same employer on the same course run share a single tax invoice. ${groupCount} invoice${groupCount === 1 ? '' : 's'} for this selection.`,
                  },
                  {
                    value: 'per-learner' as const,
                    label: 'One invoice per learner',
                    hint: 'Each selected learner is billed separately — use this when only one person should be on the invoice.',
                  },
                ]).map(opt => {
                  const active = invoiceMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setInvoiceMode(opt.value)}
                      disabled={isGeneratingInvoice}
                      className={`w-full text-left flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                        active
                          ? 'border-orange-400 dark:border-orange-500/70 bg-orange-50 dark:bg-orange-900/20'
                          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-3.5 h-3.5 rounded-full border-[3px] flex-shrink-0 ${
                          active
                            ? 'border-orange-500 dark:border-orange-400'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className={`block text-xs font-semibold ${active ? 'text-orange-800 dark:text-orange-200' : 'text-gray-700 dark:text-gray-200'}`}>
                          {opt.label}
                        </span>
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400">{opt.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pre-check on selected rows</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 dark:text-gray-300">Already has tax invoice (Invoice #)</span>
                  <span className={`font-mono font-semibold ${withInvoice > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {withInvoice} / {totalSelected}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 dark:text-gray-300">Already has grant invoice</span>
                  <span className={`font-mono font-semibold ${withGrantInvoice > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {withGrantInvoice} / {totalSelected}
                  </span>
                </div>
              </div>
              {priorInvoiceDocs.length > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200 dark:ring-amber-800/60 p-2.5 text-xs text-amber-700 dark:text-amber-300 inline-flex items-start gap-1.5">
                  <Icon name={IconName.Warning} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    This employer already has {priorInvoiceDocs.length === 1 ? 'an invoice' : `${priorInvoiceDocs.length} invoices`} for this course
                    run — <span className="font-mono font-semibold">{priorInvoiceDocs.join(', ')}</span>.
                    {' '}Generating now creates <span className="font-semibold">another separate invoice</span>. To put this learner on the
                    existing one instead, add them in QuickBooks and mark them
                    {' '}<span className="font-semibold">Billed by hand</span> on the View page.
                  </span>
                </div>
              )}
              {allInvoiced ? (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200 dark:ring-amber-800/60 p-2.5 text-xs text-amber-700 dark:text-amber-300 inline-flex items-start gap-1.5">
                  <Icon name={IconName.Warning} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>Every selected row already has an invoice. Nothing new will be generated.</span>
                </div>
              ) : withInvoice > 0 ? (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200 dark:ring-amber-800/60 p-2.5 text-xs text-amber-700 dark:text-amber-300 inline-flex items-start gap-1.5">
                  <Icon name={IconName.Warning} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    {withInvoice} of {totalSelected} selected row{totalSelected === 1 ? '' : 's'} already invoiced — those learners are left alone (no duplicates).
                    {' '}The remaining {toBill} will be billed{perLearner ? ` on ${toBill} separate invoice${toBill === 1 ? '' : 's'}` : ''}.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {perLearner
                    ? `${newInvoiceCount} separate tax invoice${newInvoiceCount === 1 ? '' : 's'} will be created in QuickBooks — one per selected learner.`
                    : 'A consolidated tax invoice will be created in QuickBooks for each (employer × course-run) group in your selection.'}
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tip: {perLearner ? 'learners' : 'groups'} whose grants are still awaiting application get flagged and skipped — sync grants first if so.
              </p>
            </ConfirmPopup>
          );
        })()}
        {deleteConfirmOpen && (
          <DeleteConfirmModal
            rows={rows.filter(r => selectedIds.has(String(r.id || '')))}
            isDeleting={isDeleting}
            onConfirm={() => void confirmDelete()}
            onClose={() => setDeleteConfirmOpen(false)}
          />
        )}
        {toastMsg && (
          <div className={`fixed top-5 right-5 z-[9999] max-w-sm w-full transition-all duration-300 ${toastVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}>
            <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl shadow-lg border backdrop-blur-sm ${toastIsError ? 'bg-red-950/90 border-red-800/40 text-red-200' : 'bg-emerald-950/90 border-emerald-800/40 text-emerald-200'}`}>
              <div className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${toastIsError ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                {toastIsError
                  ? <Icon name={IconName.Close} className="w-3 h-3 text-red-400" />
                  : <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <p className="text-sm leading-snug">{toastMsg}</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-max w-full divide-y divide-gray-200 dark:divide-gray-600 text-[11px]">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th colSpan={5} className="bg-gray-200 dark:bg-gray-900" />
                {COLUMN_GROUPS.map(group => (
                  <th
                    key={group.label}
                    colSpan={group.columns.length}
                    className={`px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide ${group.className}`}
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={paginatedRows.length > 0 && paginatedRows.every(r => selectedIds.has(String(r.id || '')))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(paginatedRows.map(r => String(r.id || '')).filter(Boolean)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 cursor-pointer"
                  />
                </th>
                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="SSG Enrolment Done">Enrol</th>
                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Added to Google Calendar">Cal</th>
                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Invoice Generated">Inv</th>
                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Grant status — click to mark a learner as ineligible (bill at full fee) when SSG won't issue any grant for them">Grant</th>
                {VISIBLE_COLUMNS.map((column) => {
                  const isPiiColumn = column === 'Trainee NRIC/FIN Number*' || column === 'Date of Birth* (DD-MM-YYYY)';
                  const label = COLUMN_DISPLAY_LABELS[column] ?? column.replace(/\*/g, '').trim();
                  return (
                    <th key={column} className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">
                      {label}
                      {isPiiColumn && (
                        <button
                          onClick={() => setShowPii(v => !v)}
                          className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500"
                          title={showPii ? 'Hide sensitive info' : 'Show sensitive info'}
                        >
                          <Icon name={showPii ? IconName.Eye : IconName.EyeOff} className="w-3 h-3" />
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
              {paginatedRows.length > 0 ? paginatedRows.map((row, index) => {
                const groupMeta = invoiceGroupMeta[index] || { isFirst: true, size: 1 };
                const isStuck = row._stuck === '1';
                const warnings = isStuck ? parseRowWarnings(row) : [];
                const warningTooltip = warnings.length > 0
                  ? warnings.map(w => `[${w.step}] ${w.error}`).join('\n')
                  : '';
                const groupKey = (row['Invoice ID'] || '').trim() || String(row.id || `idx-${index}`);
                const isHovered = hoveredGroupKey === groupKey;
                return (
                <tr
                  key={`${row.id || index}-${index}`}
                  onMouseEnter={() => setHoveredGroupKey(groupKey)}
                  onMouseLeave={() => setHoveredGroupKey(prev => (prev === groupKey ? null : prev))}
                  className={
                    isStuck
                      ? isHovered
                        ? 'bg-red-100/70 dark:bg-red-900/25'
                        : 'bg-red-50/60 dark:bg-red-900/15'
                      : isHovered
                        ? 'bg-gray-50 dark:bg-gray-600'
                        : ''
                  }
                >
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(String(row.id || ''))}
                        onClick={(e) => {
                          // Hold Alt to toggle just this row instead of the
                          // whole (employer × course-run) group. Escape hatch
                          // for "send to 10 of these 11 trainees".
                          if (e.altKey) {
                            e.preventDefault();
                            toggleRowSelected(String(row.id || ''), { singleRow: true });
                          }
                        }}
                        onChange={() => toggleRowSelected(String(row.id || ''))}
                        disabled={!row.id}
                        title="Click to select all rows from the same employer × course run · Alt-click to select just this row"
                        className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 cursor-pointer"
                      />
                      {isStuck && (
                        <button
                          type="button"
                          onClick={() => setRowErrorPopup(row)}
                          title={
                            warnings.length > 0
                              ? `Click for details — pipeline warnings:\n${warningTooltip}`
                              : hasValue(row['Auto-Enrol Error'])
                                ? `Click for details — auto-enrol failed:\n${row['Auto-Enrol Error']}`
                                : 'Click for details'
                          }
                          aria-label="Show auto-enrol error details"
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 cursor-pointer"
                        >
                          <Icon name={IconName.Warning} className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={hasValue(row['Enrolment ID'])}
                      readOnly
                      className={statusCheckboxClass(hasValue(row['Enrolment ID']), 'green')}
                      title={hasValue(row['Enrolment ID']) ? `Enrolled: ${row['Enrolment ID']}` : 'Not enrolled yet'}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={isCheckedValue(row['Calendar Added'])}
                      readOnly
                      className={statusCheckboxClass(isCheckedValue(row['Calendar Added']), 'blue')}
                      title={isCheckedValue(row['Calendar Added']) ? 'Added to calendar' : 'Not added to calendar yet'}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={hasValue(row['Invoice ID'])}
                      readOnly
                      className={statusCheckboxClass(hasValue(row['Invoice ID']), 'amber')}
                      title={hasValue(row['Invoice ID']) ? `Invoice: ${row['Invoice ID']}` : 'No invoice generated'}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {(() => {
                      const hasGrant = hasValue(row['Grant ID']) || hasValue(row['Grant ID (BL)']);
                      const isIneligible = isCheckedValue(row['Grant Ineligible']);
                      const applicationId = String(row.id || '');
                      if (hasGrant) {
                        return (
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                            title={`Grant issued: ${row['Grant ID'] || row['Grant ID (BL)']}`}
                          >
                            <Icon name={IconName.CheckCircle} className="w-3 h-3" />
                          </span>
                        );
                      }
                      if (isIneligible) {
                        return (
                          <button
                            type="button"
                            onClick={() => void toggleGrantEligibility(applicationId, false)}
                            disabled={!applicationId}
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50"
                            title="Marked Not Grant Eligible — will be billed at full fee. Click to un-mark."
                          >
                            <Icon name={IconName.Close} className="w-3 h-3" />
                          </button>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (!applicationId) return;
                            if (window.confirm('Mark this learner as Not Grant Eligible? They will be billed at full course fee in the consolidated invoice.')) {
                              void toggleGrantEligibility(applicationId, true);
                            }
                          }}
                          disabled={!applicationId}
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400"
                          title="Awaiting grant — click to mark as Not Grant Eligible (bill at full fee)"
                        >
                          <span className="text-[10px] font-bold">?</span>
                        </button>
                      );
                    })()}
                  </td>
                  {VISIBLE_COLUMNS.map(column => {
                    if (column === 'Invoice Generated On') {
                      return (
                        <td key={column} className="px-2 py-1.5 whitespace-nowrap text-[11px]">
                          <InvoiceGeneratedOnCell
                            docNumber={row['Invoice Doc Number']}
                            renewedOn={row._course_renewed_on}
                          />
                        </td>
                      );
                    }
                    if (column === 'Renewed On') {
                      return (
                        <td key={column} className="px-2 py-1.5 whitespace-nowrap text-[11px]">
                          <RenewedOnCell
                            renewedOn={row._course_renewed_on}
                            exact={row._course_renewed_on_exact === '1'}
                          />
                        </td>
                      );
                    }
                    if (column === 'Type') {
                      return (
                        <td key={column} className="px-2 py-1.5 whitespace-nowrap">
                          <FundingTypeBadge
                            courseType={row._course_type}
                            currentCode={row._course_current_code}
                            rowCode={row['Course Reference Number']}
                          />
                        </td>
                      );
                    }
                    if (column === 'Renewal (old to new)') {
                      // Blank unless the course has actually moved on: repeating
                      // the same code twice on every unrenewed row would bury the
                      // ones that matter.
                      const previous = String(row._course_previous_code || '').trim();
                      const current = String(row._course_current_code || '').trim();
                      if (!previous || !current || previous.toUpperCase() === current.toUpperCase()) {
                        return <td key={column} className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-400 dark:text-gray-500">-</td>;
                      }
                      const rowRef = String(row['Course Reference Number'] || '').trim().toUpperCase();
                      const onPrevious = rowRef === previous.toUpperCase();
                      const onCurrent = rowRef === current.toUpperCase();
                      return (
                        <td key={column} className="px-2 py-1.5 whitespace-nowrap font-mono">
                          <span
                            className="inline-flex items-center gap-1"
                            title={`This course was renewed from ${previous} to ${current}. This group is enrolled under ${rowRef || '(no reference)'}.`}
                          >
                            <span className={onPrevious ? 'font-bold text-teal-700 dark:text-teal-400' : 'text-gray-400 dark:text-gray-500'}>{previous}</span>
                            <span className="text-gray-400 text-[9px]" aria-hidden>&rarr;</span>
                            <span className={onCurrent ? 'font-bold text-teal-700 dark:text-teal-400' : 'text-gray-400 dark:text-gray-500'}>{current}</span>
                          </span>
                        </td>
                      );
                    }
                    if (column === 'Amt (BL)' || column === 'Amount' || column === 'TG Amt') {
                      const raw = (row[column] || '').trim();
                      const num = Number(raw);
                      const display = raw !== '' && Number.isFinite(num) && num > 0
                        ? `$${num.toFixed(2)}`
                        : '-';
                      return (
                        <td
                          key={column}
                          className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300"
                          title={display}
                        >
                          {display}
                        </td>
                      );
                    }
                    if (column === 'Course Start Date (DD-MM-YYYY)*') {
                      const raw = (row[column] || '').trim();
                      const display = formatStartDate(raw);
                      return (
                        <td
                          key={column}
                          className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300"
                          title={raw || '-'}
                        >
                          {display}
                        </td>
                      );
                    }
                    if (column === 'Date of Birth* (DD-MM-YYYY)') {
                      const raw = (row[column] || '').trim();
                      if (!raw) return <td key={column} className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">-</td>;
                      const formatted = raw.replace(/-/g, '/');
                      const year = raw.match(/(\d{4})/)?.[1] || '';
                      const display = showPii ? formatted : (year ? `**/**/${year}` : '****');
                      return (
                        <td
                          key={column}
                          className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono"
                          title={showPii ? formatted : 'Toggle visibility via header eye icon'}
                        >
                          {display}
                        </td>
                      );
                    }
                    if (column === 'Trainee NRIC/FIN Number*') {
                      const raw = (row[column] || '').trim();
                      if (!raw) return <td key={column} className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">-</td>;
                      const display = showPii ? raw : maskNric(raw);
                      return (
                        <td
                          key={column}
                          className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono"
                          title={showPii ? raw : 'Toggle visibility via header eye icon'}
                        >
                          {display}
                        </td>
                      );
                    }
                    if (column === 'Email') {
                      // Email state is per-invoice (shared across the
                      // consolidated group) — merge cells the same way Tax
                      // Invoice / Invoice # do.
                      if (!groupMeta.isFirst) return null;
                      const sentAt = String(row['Invoice Sent At'] || '').trim();
                      const sentTo = String(row['Invoice Sent To'] || '').trim();
                      const rowSpan = groupMeta.size > 1 ? groupMeta.size : undefined;
                      return (
                        <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap text-center align-middle">
                          {sentAt ? (
                            <span
                              className="relative inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-900/30 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-700/60"
                              title={`Sent${sentTo ? ` to ${sentTo}` : ''} on ${new Date(sentAt).toLocaleString('en-SG')}`}
                            >
                              <Icon name={IconName.Mail} className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-gray-700" />
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-transparent"
                              title="Not sent to employer"
                            >
                              <Icon name={IconName.Mail} className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                            </span>
                          )}
                        </td>
                      );
                    }
                    if (column === 'Doc Verified') {
                      const status = String(row['Supporting Doc Verification Status'] || '').trim().toLowerCase();
                      const hasDoc = !!String(row['Supporting Doc Drive Link'] || '').trim();
                      const link = String(row['Supporting Doc Drive Link'] || '').trim();
                      let badge: { text: string; icon: IconName; className: string };
                      if (status === 'verified') {
                        badge = {
                          text: 'Verified',
                          icon: IconName.CheckCircle,
                          className: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300/60',
                        };
                      } else if (status === 'mismatch') {
                        badge = {
                          text: 'Mismatch',
                          icon: IconName.Warning,
                          className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-300/60',
                        };
                      } else if (hasDoc) {
                        badge = {
                          text: 'Pending',
                          icon: IconName.Eye,
                          className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300/60',
                        };
                      } else {
                        badge = {
                          text: 'No Doc',
                          icon: IconName.Upload,
                          className: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 ring-1 ring-gray-300/60',
                        };
                      }
                      const inner = (
                        <>
                          <Icon name={badge.icon} className="w-3 h-3 mr-1" />
                          {badge.text}
                        </>
                      );
                      return (
                        <td key={column} className="px-2 py-1.5 whitespace-nowrap text-center">
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.className} hover:opacity-80 transition-opacity`}
                              title="Open supporting document"
                            >
                              {inner}
                            </a>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.className}`}>
                              {inner}
                            </span>
                          )}
                        </td>
                      );
                    }
                    if (column === 'Tax Invoice' || column === 'Grant Invoice') {
                      const kind: 'main' | 'grant' = column === 'Grant Invoice' ? 'grant' : 'main';
                      const isGrant = kind === 'grant';
                      // Tax Invoice is consolidated → merge across the group.
                      // Grant Invoice is per-learner → never merged.
                      if (!isGrant && !groupMeta.isFirst) return null;
                      const link = (row[isGrant ? 'Grant Invoice Drive Link' : 'Invoice Drive Link'] || '').trim();
                      const fileId = (row[isGrant ? 'Grant Invoice Drive File ID' : 'Invoice Drive File ID'] || '').trim();
                      const key = getDocumentKey(row, kind);
                      const isBroken = brokenDocumentKeys.has(key);
                      const hasAny = !!(link || fileId);
                      const rowSpan = !isGrant && groupMeta.size > 1 ? groupMeta.size : undefined;

                      if (isBroken) {
                        return (
                          <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap align-middle">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                <Icon name={IconName.Warning} className="w-3 h-3" />
                                Unavailable
                              </span>
                              <span className="text-[9px] text-gray-500 dark:text-gray-400">Document may have been deleted</span>
                            </div>
                          </td>
                        );
                      }

                      if (!hasAny) {
                        // Billed by hand: there is no LMS invoice and there
                        // never will be. A bare dash reads as "missing", which
                        // is what sends someone to Generate Invoice and creates
                        // the duplicate the admin chose to avoid.
                        if (!isGrant && isCheckedValue(row['Billed Manually'])) {
                          return (
                            <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap align-middle">
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                title="Added to an existing invoice in QuickBooks by hand — the LMS will never invoice this learner."
                              >
                                In QuickBooks
                              </span>
                            </td>
                          );
                        }
                        return <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap text-gray-400 align-middle">-</td>;
                      }

                      const colorClass = isGrant
                        ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40'
                        : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40';
                      const isChecking = verifyingDocumentKey === key;

                      return (
                        <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap align-middle">
                          <button
                            type="button"
                            onClick={() => void handleViewDocument(row, kind)}
                            disabled={isChecking}
                            className={`inline-flex items-center px-2 py-1 text-[10px] font-medium rounded disabled:opacity-60 ${colorClass}`}
                            title={`Open ${isGrant ? 'grant' : 'tax'} invoice PDF in Google Drive`}
                          >
                            {isChecking ? (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-1" />
                            ) : (
                              <Icon name={IconName.FileText} className="w-3 h-3 mr-1" />
                            )}
                            {isChecking ? 'Checking...' : 'View'}
                          </button>
                        </td>
                      );
                    }
                    if (column === 'Invoice Doc Number') {
                      // Cell is merged across all rows in the consolidated
                      // group — skip rendering on non-first rows so the cell
                      // above us spans down.
                      if (!groupMeta.isFirst) return null;
                      const docNumber = (row['Invoice Doc Number'] || '').trim();
                      const invoiceId = (row['Invoice ID'] || '').trim();
                      const driveFileId = (row['Invoice Drive File ID'] || '').trim();
                      const driveLink = (row['Invoice Drive Link'] || '').trim();
                      const display = docNumber || invoiceId;
                      const taxInvoiceBroken = brokenDocumentKeys.has(getDocumentKey(row, 'main'));
                      const taxInvoicePresent = !!(driveFileId || driveLink) && !taxInvoiceBroken;
                      const rowSpan = groupMeta.size > 1 ? groupMeta.size : undefined;
                      if (!display || !taxInvoicePresent) {
                        if (isCheckedValue(row['Billed Manually'])) {
                          const manualRef = (row['Billed Manually Invoice Ref'] || '').trim();
                          return (
                            <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap align-middle">
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm('Un-mark this learner as billed by hand? They will be invoiced normally by the LMS, which may create a second invoice for this class.')) {
                                    void clearManualBilling(String(row.id || ''));
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                title={manualRef
                                  ? `Billed by hand on invoice ${manualRef}. Click to un-mark.`
                                  : 'Billed by hand in QuickBooks. Click to un-mark.'}
                              >
                                By hand{manualRef ? <span className="font-mono opacity-80">· {manualRef}</span> : null}
                              </button>
                            </td>
                          );
                        }
                        return <td key={column} rowSpan={rowSpan} className="px-2 py-1.5 whitespace-nowrap text-gray-400 align-middle">-</td>;
                      }
                      return (
                        <td
                          key={column}
                          rowSpan={rowSpan}
                          className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-500 dark:text-gray-300 align-middle"
                          title={docNumber ? `DocNumber: ${docNumber}${invoiceId ? ` · QBO Invoice ID: ${invoiceId}` : ''}` : `QBO Invoice ID: ${invoiceId}`}
                        >
                          {display}
                        </td>
                      );
                    }
                    if (column === 'Enrolment Status') {
                      const status = (row['Enrolment Status'] || '').trim();
                      return (
                        <td key={column} className="px-2 py-1.5 whitespace-nowrap">
                          {status ? (
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                                status === 'Confirmed'
                                  ? 'bg-green-100 text-green-800'
                                  : status === 'Not Found'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {status}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column}
                        className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 max-w-[220px] truncate"
                        title={row[column] || '-'}
                      >
                        {row[column] || '-'}
                      </td>
                    );
                  })}
                </tr>
              ); }) : (
                <tr>
                  <td colSpan={VISIBLE_COLUMNS.length + 5} className="p-12 text-center text-gray-500 dark:text-gray-400">
                    <Icon name={IconName.FileText} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p>No company application records yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between dark:border-gray-700">
            <div className="text-sm text-gray-500 dark:text-gray-400">Page {safePage} of {totalPages}</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600"
              >Previous</button>
              {(() => {
                const pages: (number | string)[] = [];
                if (totalPages <= 5) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
                else if (safePage <= 3) { for (let i = 1; i <= 4; i++) pages.push(i); pages.push('...'); pages.push(totalPages); }
                else if (safePage >= totalPages - 2) { pages.push(1); pages.push('...'); for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i); }
                else { pages.push(1); pages.push('...'); pages.push(safePage - 1); pages.push(safePage); pages.push(safePage + 1); pages.push('...'); pages.push(totalPages); }
                return pages.map((page, idx) => typeof page === 'number' ? (
                  <button
                    key={idx}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1 text-sm border rounded ${safePage === page ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100 dark:hover:bg-gray-700 dark:border-gray-600'}`}
                  >{page}</button>
                ) : <span key={idx} className="px-2 text-gray-400">...</span>);
              })()}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600"
              >Next</button>
            </div>
          </div>
        )}
      </Card>
      )}

      {rowErrorPopup && (
        <RowErrorPopup row={rowErrorPopup} onClose={() => setRowErrorPopup(null)} />
      )}
    </div>
  );
};

interface RowErrorPopupProps {
  row: CompanyApplicationRow;
  onClose: () => void;
}

const RowErrorPopup: React.FC<RowErrorPopupProps> = ({ row, onClose }) => {
  const warnings = parseRowWarnings(row);
  const autoEnrolError = String(row['Auto-Enrol Error'] || '').trim();
  // "Auto-enrol failed" used to be hardcoded here, so a row that hit a warning,
  // recovered and went on to invoice still announced a failure. Say that only
  // when the pipeline actually gave up.
  const hasFailed = row._failed === '1';
  const title = hasFailed ? 'Auto-enrol failed' : 'Warnings from earlier attempts';
  const traineeName = String(row['Trainee FULL Name as on government ID*'] || '').trim() || '(no name)';
  const courseTitle = String(row['Course Title*'] || '').trim() || '(no course title)';
  const employerOrg = String(row['Employer Organization Name*'] || '').trim();
  const startDate = String(row['Course Start Date (DD-MM-YYYY)*'] || '').trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${hasFailed ? 'bg-red-100 dark:bg-red-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
              <Icon name={IconName.Warning} className={`w-5 h-5 ${hasFailed ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {traineeName}
                {employerOrg ? ` · ${employerOrg}` : ''}
                {courseTitle ? ` · ${courseTitle}` : ''}
                {startDate ? ` · ${startDate}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            <Icon name={IconName.Close} className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {autoEnrolError && (
            <div className="border border-red-200 dark:border-red-900/40 rounded-xl p-4 bg-red-50/50 dark:bg-red-900/10">
              <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">Enrolment error</h3>
              <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap break-words">{autoEnrolError}</p>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="border border-amber-200 dark:border-amber-900/40 rounded-xl p-4 bg-amber-50/50 dark:bg-amber-900/10">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
                Pipeline warnings ({warnings.length})
              </h3>
              <ul className="space-y-2">
                {warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-800 dark:text-amber-200">
                    <span className="font-medium">[{w.step}]</span>{' '}
                    <span className="whitespace-pre-wrap break-words">{w.error}</span>
                    {w.at && (
                      <span className="block text-xs text-amber-700/70 dark:text-amber-300/70 mt-0.5">
                        {new Date(w.at).toLocaleString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!autoEnrolError && warnings.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              No specific error message was recorded. Check the server logs around the upload time for details.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};

// CheckSupportingDocumentView moved to './CheckSupportingDocumentView.tsx'.
// Kept this re-export so external imports (AdminLayout) don't need to change.
export { CheckSupportingDocumentView } from './CheckSupportingDocumentView';


