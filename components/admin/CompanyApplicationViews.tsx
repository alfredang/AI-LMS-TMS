import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

export const COMPANY_APPLICATION_COLUMNS = [
  'Course Title*',
  'Course Start Date (DD-MM-YYYY)*',
  'Course Reference Number',
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
  'Email',
  'Tax Invoice',
  'Grant Invoice',
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
      'Email',
      'Tax Invoice',
      'Grant Invoice',
    ],
  },
];

type CompanyApplicationRow = Record<string, string>;

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

const uploadRows = async (rows: CompanyApplicationRow[]): Promise<CompanyUploadResult> => {
  const response = await fetch('/api/admin/upload-company-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
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

const fetchRows = async (): Promise<CompanyApplicationRow[]> => {
  const response = await fetch('/api/admin/fetch-company-applications');
  if (!response.ok) throw new Error(`Failed to load (${response.status})`);
  const data = await response.json();
  return Array.isArray(data.rows) ? data.rows : [];
};

const isCheckedValue = (value: unknown): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

const hasValue = (value: unknown): boolean => String(value ?? '').trim() !== '';

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

// Collapsible "How this works" explainer rendered on both Upload and View
// pages. Each instance gets its own localStorage key so the two pages
// remember the admin's collapse preference independently.
type WorkflowStepType = 'auto' | 'click' | 'external';

interface WorkflowStep {
  title: string;
  description: string;
  icon: IconName;
  type: WorkflowStepType;
}

const STEP_TYPE_LABELS: Record<WorkflowStepType, string> = {
  auto: 'AUTO',
  click: 'CLICK',
  external: 'MANUAL',
};

const STEP_TYPE_BADGE_CLASSES: Record<WorkflowStepType, string> = {
  auto: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50',
  click: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50',
  external: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50',
};

const STEP_TYPE_ACCENT_CLASSES: Record<WorkflowStepType, string> = {
  auto: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
  click: 'bg-gradient-to-br from-blue-500 to-indigo-600',
  external: 'bg-gradient-to-br from-amber-500 to-orange-600',
};

const STEP_TYPE_CARD_CLASSES: Record<WorkflowStepType, string> = {
  auto: 'bg-white dark:bg-gray-800/40 border-emerald-100 dark:border-emerald-800/30 hover:border-emerald-200 dark:hover:border-emerald-700/50',
  click: 'bg-white dark:bg-gray-800/40 border-blue-100 dark:border-blue-800/30 hover:border-blue-200 dark:hover:border-blue-700/50',
  external: 'bg-amber-50/70 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50 hover:border-amber-300 dark:hover:border-amber-600/60',
};

const WorkflowExplainer: React.FC<{
  title: string;
  subtitle?: string;
  steps: WorkflowStep[];
  storageKey: string;
}> = ({ title, subtitle, steps, storageKey }) => {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem(storageKey);
    return stored === 'open';
  });

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? 'open' : 'closed');
      } catch {
        // localStorage may be disabled — non-fatal, the toggle still works in-session.
      }
      return next;
    });
  };

  // Tally of step types — shown as small chips in the header so admins can see
  // at a glance how much of the workflow is automated vs manual.
  const counts = steps.reduce(
    (acc, s) => {
      acc[s.type]++;
      return acc;
    },
    { auto: 0, click: 0, external: 0 } as Record<WorkflowStepType, number>
  );

  return (
    <div className="mb-6 rounded-xl border border-blue-200 dark:border-blue-800/60 bg-gradient-to-br from-blue-50 via-indigo-50/40 to-blue-50 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-blue-950/30 overflow-hidden shadow-sm">
      <button
        onClick={toggle}
        className="w-full p-5 flex items-center justify-between text-left hover:bg-blue-100/30 dark:hover:bg-blue-900/20 transition-colors group"
        aria-expanded={open}
      >
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-500/20">
            <Icon name={IconName.InfoCircle} className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
            {subtitle && (
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">{subtitle}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {counts.auto > 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STEP_TYPE_BADGE_CLASSES.auto}`}>
                  {counts.auto} AUTO
                </span>
              )}
              {counts.click > 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STEP_TYPE_BADGE_CLASSES.click}`}>
                  {counts.click} CLICK
                </span>
              )}
              {counts.external > 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STEP_TYPE_BADGE_CLASSES.external}`}>
                  {counts.external} MANUAL
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400 hidden sm:inline group-hover:text-blue-700 dark:group-hover:text-blue-300">
            {open ? 'Hide' : 'Show'} steps
          </span>
          <Icon
            name={open ? IconName.ChevronUp : IconName.ChevronDown}
            className="w-5 h-5 text-blue-600 dark:text-blue-400"
          />
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1">
          <div className="space-y-2.5">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`flex gap-3 p-3.5 rounded-lg border transition-colors ${STEP_TYPE_CARD_CLASSES[step.type]}`}
              >
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shadow-sm ${STEP_TYPE_ACCENT_CLASSES[step.type]}`}>
                    {i + 1}
                  </div>
                  <Icon
                    name={step.icon}
                    className={`w-4 h-4 ${step.type === 'external' ? 'text-amber-600 dark:text-amber-400' : step.type === 'auto' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <h4 className={`text-sm font-semibold ${step.type === 'external' ? 'text-amber-900 dark:text-amber-100' : 'text-gray-900 dark:text-white'}`}>
                      {step.title}
                    </h4>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STEP_TYPE_BADGE_CLASSES[step.type]}`}>
                      {STEP_TYPE_LABELS[step.type]}
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${step.type === 'external' ? 'text-amber-800 dark:text-amber-200' : 'text-gray-600 dark:text-gray-300'}`}>
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const UPLOAD_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    title: 'Upload the Excel file',
    description: "Rows are dedup'd by NRIC + employer UEN + course title + start date — re-uploading the same row updates instead of duplicating.",
    icon: IconName.Upload,
    type: 'click',
  },
  {
    title: 'Auto-enrol on SSG + add to Google Calendar',
    description: 'Background pipeline POSTs each learner to SSG (returning an ENR-xxxx reference) and adds them to the matching Google Calendar events for the course run.',
    icon: IconName.CheckCircle,
    type: 'auto',
  },
  {
    title: 'Search grants → auto-generate invoice + email',
    description: 'Pipeline searches SSG for any pre-applied grants. If grants exist, the consolidated tax invoice is generated AND emailed to the employer automatically (when the toggle below is ON).',
    icon: IconName.FileText,
    type: 'auto',
  },
  {
    title: 'Continue on the View Company Application page',
    description: 'If no grants exist yet (the normal case), the pipeline stops at enrolment + calendar add. File the grant on the TPGateway portal, then continue from the View page.',
    icon: IconName.ExternalLink,
    type: 'external',
  },
];

const VIEW_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    title: 'Confirm enrolment status',
    description: 'The Auto-Enrol Status column should show "enroled" or "grant_found". If a row failed, the reason is in the Auto-Enrol Error column — fix the data and click Re-process Pending to retry.',
    icon: IconName.CheckCircle,
    type: 'auto',
  },
  {
    title: 'File grant application on TPGateway portal',
    description: 'SSG does not expose a grant submission API. Log in to tpgateway.gov.sg and file the grant application manually for each ENR-xxxx reference.',
    icon: IconName.Warning,
    type: 'external',
  },
  {
    title: 'Click "Sync Grants"',
    description: 'Pulls the freshly-filed grant IDs back from SSG into this table. The Grant ID column populates once SSG confirms the grant.',
    icon: IconName.Download,
    type: 'click',
  },
  {
    title: 'Click "Generate Invoice"',
    description: 'Creates the consolidated tax invoice (one per employer × course-run) and per-learner grant invoices billed to WSG. PDFs uploaded to Google Drive.',
    icon: IconName.FileText,
    type: 'click',
  },
  {
    title: 'Click "Send Invoice Email"',
    description: 'Emails the consolidated invoice to the employer contact. Auto-fires immediately after Generate Invoice when the email toggle below is ON.',
    icon: IconName.Mail,
    type: 'click',
  },
];

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

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/admin/ca-email-toggle', { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => {
        if (ctrl.signal.aborted) return;
        if (j?.success) {
          setEmailToggleOn(!!j.value);
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
                ? 'After invoice generation, the consolidated tax invoice will be emailed to the employer contact.'
                : 'Invoices will still be generated and saved to Drive — emails are NOT sent. Safe for testing.'}
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
  const [uploadResult, setUploadResult] = useState<CompanyUploadResult | null>(null);
  const [backendStatus, setBackendStatus] = useState<'idle' | 'processing' | 'complete'>('idle');
  const [backendDoneCount, setBackendDoneCount] = useState(0);
  const [backendProgress, setBackendProgress] = useState(0); // 0..1, finer-grained per-step progress

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
    let attempts = 0;
    const idSet = new Set(ids);

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

        for (const row of matchingRows) {
          const hasError = hasValue(row['Auto-Enrol Error']);
          const hasInvoice = hasValue(row['Invoice ID']);
          const hasGrantId = hasValue(row['Grant ID']);
          const hasGrantInvoice = hasValue(row['Grant Invoice ID']);
          const isIneligible = isCheckedValue(row['Grant Ineligible']);
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
          if (hasValue(row['Enrolment ID'])) stepUnits += 1;
          if (hasGrantId || isTruthy(row['Calendar Added']) || hasInvoice) stepUnits += 1;
          if (isTruthy(row['Calendar Added']) || hasInvoice) stepUnits += 1;
          if (hasInvoice) stepUnits += 1;
          if (grantInvoiceComplete) stepUnits += 1;

          if (hasInvoice && grantInvoiceComplete) rowsFullyDone++;
        }

        setBackendDoneCount(rowsFullyDone);
        setBackendProgress(totalSteps > 0 ? stepUnits / totalSteps : 1);

        if (matchingRows.length >= ids.length && rowsFullyDone >= ids.length) {
          setBackendProgress(1);
          setBackendStatus('complete');
          return;
        }
      } catch (err) {
        console.warn('Failed to poll company application processing:', err);
      }

      if (attempts >= 60) {
        setBackendStatus('complete');
        return;
      }

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

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    setUploadResult(null);
    setBackendStatus('idle');
    setBackendDoneCount(0);
    setBackendProgress(0);
    try {
      const rows = await parseCompanyApplicationRows(file);
      const result = await uploadRows(rows);
      setUploadResult(result);
      pollBackendProcessing(result.insertedIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse company application file.');
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
    setUploadResult(null);
    setBackendStatus('idle');
    setBackendDoneCount(0);
    setBackendProgress(0);
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

      <WorkflowExplainer
        title="How the Company Application Workflow Work"
        subtitle="What happens when you upload — automated steps run in the background, manual steps need your attention."
        steps={UPLOAD_WORKFLOW_STEPS}
        storageKey="ca-workflow-explainer-upload"
      />

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
            <Button onClick={handleUpload} disabled={!file || isUploading}>
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Uploading...
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
          <div className={`w-14 h-14 rounded-full ${backendStatus === 'processing' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-green-100 dark:bg-green-900/30'} flex items-center justify-center mx-auto mb-4`}>
            {backendStatus === 'processing' ? (
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-200 border-t-blue-600" />
            ) : (
              <Icon name={IconName.CheckCircle} className="w-8 h-8 text-green-600 dark:text-green-400" />
            )}
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">
            {backendStatus === 'processing' ? 'Processing Enrolment & Grant Lookup' : 'Upload Complete'}
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
          <div className="flex justify-center gap-3 mt-6">
            <Button variant="secondary" onClick={reset}>Upload Another File</Button>
            <Button onClick={() => setAdminPage(AdminPage.ViewCompanyApplication)}>View Company Application</Button>
          </div>
        </Card>
      )}
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

export const ViewCompanyApplicationView: React.FC = () => {
  const [rows, setRows] = useState<CompanyApplicationRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPii, setShowPii] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessMessage, setReprocessMessage] = useState<string | null>(null);
  const [isSyncingGrants, setIsSyncingGrants] = useState(false);
  const [grantSyncMessage, setGrantSyncMessage] = useState<string | null>(null);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [invoiceErrors, setInvoiceErrors] = useState<InvoiceError[]>([]);
  const [rescueTarget, setRescueTarget] = useState<RescueTarget | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [brokenDocumentKeys, setBrokenDocumentKeys] = useState<Set<string>>(new Set());
  const [verifyingDocumentKey, setVerifyingDocumentKey] = useState<string | null>(null);
  const [docToast, setDocToast] = useState<string | null>(null);

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
      setDocToast('Document may have been deleted');
      window.setTimeout(() => setDocToast(null), 4000);
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
        setDocToast('Document may have been deleted');
        window.setTimeout(() => setDocToast(null), 4000);
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

  const toggleRowSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

  const generateInvoiceForSelected = async () => {
    if (selectedIds.size === 0) {
      setInvoiceMessage('Select at least one row first.');
      return;
    }
    setIsGeneratingInvoice(true);
    setInvoiceMessage(null);
    setInvoiceErrors([]);
    try {
      const res = await fetch('/api/admin/ca-generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: Array.from(selectedIds) }),
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
      const parts: string[] = [];
      if (generated) parts.push(`${generated} invoice${generated === 1 ? '' : 's'} generated`);
      if (alreadyInvoiced) parts.push(`${alreadyInvoiced} group${alreadyInvoiced === 1 ? '' : 's'} already invoiced — cannot regenerate`);
      if (notEnrolled) parts.push(`${notEnrolled} group${notEnrolled === 1 ? '' : 's'} skipped (not yet enrolled with SSG)`);
      if (awaitingGrants) parts.push(`${awaitingGrants} group${awaitingGrants === 1 ? '' : 's'} awaiting grants — click "Sync Grants" after stakeholders apply in the SSG portal`);
      if (failed) parts.push(`${failed} failed`);

      // Surface auto-send result so admins know whether the email actually
      // fired. Only present when the training_provider toggle is ON; null
      // otherwise. Failures are best-effort — invoices are still generated.
      if (data.emailSummary) {
        const sent = Number(data.emailSummary.sent) || 0;
        const emailFailed = Number(data.emailSummary.failed) || 0;
        const skippedAlready = Number(data.emailSummary.skippedAlreadySent) || 0;
        const skippedMissing = Number(data.emailSummary.skippedMissingEmail) || 0;
        if (sent) parts.push(`${sent} email${sent === 1 ? '' : 's'} auto-sent to employer`);
        if (skippedAlready) parts.push(`${skippedAlready} email${skippedAlready === 1 ? '' : 's'} already sent — skipped`);
        if (skippedMissing) parts.push(`${skippedMissing} skipped (missing employer email)`);
        if (emailFailed) parts.push(`${emailFailed} email${emailFailed === 1 ? '' : 's'} failed to send`);
      }
      if (data.emailError) {
        parts.push(`auto-send error: ${data.emailError}`);
      }

      // Treat the all-already-invoiced case as an explicit block: nothing
      // happened because every selected group already has an invoice.
      if (generated === 0 && failed === 0 && alreadyInvoiced > 0 && notEnrolled === 0 && awaitingGrants === 0) {
        setInvoiceMessage(
          `⚠ ${alreadyInvoiced} invoice${alreadyInvoiced === 1 ? '' : 's'} already generated — cannot regenerate. Open the existing invoice via the Tax Invoice column, or delete it in QBO first if you need to regenerate.`
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
    if (!window.confirm(
      'Send the consolidated tax invoice email to the EMPLOYER contact for the selected rows?\n\n' +
      'Make sure supporting documents have been reviewed first. Already-sent invoices will be skipped.'
    )) return;
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
      const parts: string[] = [];
      if (data.sent) parts.push(`${data.sent} invoice${data.sent === 1 ? '' : 's'} emailed`);
      if (data.skippedAlreadySent) parts.push(`${data.skippedAlreadySent} already sent — skipped`);
      if (data.skippedMissingEmail) parts.push(`${data.skippedMissingEmail} missing employer email`);
      if (data.skippedNoInvoice) parts.push(`${data.skippedNoInvoice} row${data.skippedNoInvoice === 1 ? '' : 's'} not yet invoiced`);
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

  // Sweep SSG grants by courseRunId for every current/future company_application
  // row, upsert into ssg_grants, and backfill ca.grant_id. This is the catch-up
  // mechanism for grants stakeholders apply manually in the SSG portal — SSG
  // has no grant application API as of 2026-05, so this button is how those
  // grants reach the LMS.
  const syncGrants = async () => {
    setIsSyncingGrants(true);
    setGrantSyncMessage(null);
    try {
      const res = await fetch('/api/admin/ca-sync-grants', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const upserted = Number(data.totalGrantsUpserted) || 0;
      const runs = Number(data.runsProcessed) || 0;
      const errors = Array.isArray(data.errors) ? data.errors.length : 0;
      const parts = [`${upserted} grant${upserted === 1 ? '' : 's'} synced across ${runs} course run${runs === 1 ? '' : 's'}`];
      if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
      setGrantSyncMessage(parts.join(' · '));
      void reloadRows();
    } catch (err) {
      console.error('Sync grants failed:', err);
      setGrantSyncMessage(err instanceof Error ? err.message : 'Sync grants failed.');
    } finally {
      setIsSyncingGrants(false);
    }
  };

  const reprocessPending = async () => {
    setIsReprocessing(true);
    setReprocessMessage(null);
    try {
      const res = await fetch('/api/admin/auto-enrol-company-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const queued = Number(data.queued) || 0;
      setReprocessMessage(
        queued === 0
          ? 'No pending or failed rows to process.'
          : `Re-processing ${queued} row${queued === 1 ? '' : 's'} in the background. The table will refresh automatically as rows complete.`
      );
      // Kick off polling-style refresh: reload now and again after a few seconds
      void reloadRows();
      window.setTimeout(() => void reloadRows(), 4000);
      window.setTimeout(() => void reloadRows(), 10000);
    } catch (err) {
      console.error('Re-process failed:', err);
      setReprocessMessage(err instanceof Error ? err.message : 'Re-process failed.');
    } finally {
      setIsReprocessing(false);
    }
  };

  useEffect(() => {
    void reloadRows();
  }, []);

  useEffect(() => {
    // Keep polling while ANY row is still progressing through the pipeline:
    //   - status pending / no enrolment yet → still enrolling
    //   - enrolled + grant_id present but no main invoice yet → invoice in flight
    //   - main invoice present but grant invoice missing (and learner is
    //     grant-eligible) → grant invoice in flight
    // A row that errored stops the polling for itself (won't progress).
    // Capped at MAX_POLL_ATTEMPTS so a genuinely-stuck row can't poll forever.
    const hasProcessingRows = rows.some(row => {
      const status = String(row['Auto-Enrol Status'] || '').trim().toLowerCase();
      const hasError = hasValue(row['Auto-Enrol Error']);
      if (hasError) return false;
      if (status === 'pending') return true;
      if (!hasValue(row['Enrolment ID'])) return true;

      const hasMainInvoice = hasValue(row['Invoice ID']);
      const hasGrantId = hasValue(row['Grant ID']);
      const hasGrantInvoice = hasValue(row['Grant Invoice ID']);
      const isIneligible = isCheckedValue(row['Grant Ineligible']);

      // Waiting for main invoice (grant arrived, invoice not yet generated)
      if (hasGrantId && !hasMainInvoice) return true;
      // Waiting for grant invoice (main done, grant invoice pending, learner is eligible)
      if (hasMainInvoice && hasGrantId && !hasGrantInvoice && !isIneligible) return true;
      return false;
    });
    if (!hasProcessingRows) return undefined;

    const MAX_POLL_ATTEMPTS = 60; // 60 × 5s = 5 minutes ceiling
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        window.clearInterval(timer);
        return;
      }
      void reloadRows();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matched = query
      ? rows.filter(row => VISIBLE_COLUMNS.some(column => (row[column] || '').toLowerCase().includes(query)))
      : rows;
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
  }, [rows, searchQuery]);

  // For each row, compute whether its Invoice # / Tax Invoice cells should
  // render with rowSpan (first row in a consolidated group) or be skipped
  // entirely (merged into the row above it).
  const invoiceGroupMeta = useMemo(() => {
    const meta: Array<{ isFirst: boolean; size: number }> = [];
    let i = 0;
    while (i < filteredRows.length) {
      const inv = (filteredRows[i]['Invoice ID'] || '').trim();
      if (!inv) {
        meta.push({ isFirst: true, size: 1 });
        i++;
        continue;
      }
      let j = i + 1;
      while (j < filteredRows.length && (filteredRows[j]['Invoice ID'] || '').trim() === inv) {
        j++;
      }
      const size = j - i;
      for (let k = i; k < j; k++) {
        meta.push({ isFirst: k === i, size });
      }
      i = j;
    }
    return meta;
  }, [filteredRows]);

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

      <WorkflowExplainer
        title="How the Company Application Workflow Work"
        subtitle="From uploaded data to sent invoice — the manual TPGateway step is the only one outside the TMS."
        steps={VIEW_WORKFLOW_STEPS}
        storageKey="ca-workflow-explainer-view"
      />

      <CaEmailToggleBanner />

      <Card className="p-6 mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="search-company-application" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Search Applications</label>
            <div className="relative">
              <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="search-company-application" type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by trainee, employer, course, UEN, or email..." className={`${inputClasses} pl-9`} />
            </div>
          </div>
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Showing {filteredRows.length === 0 ? 0 : 1}-{filteredRows.length} of {filteredRows.length} applications</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void reprocessPending()}
                disabled={isReprocessing}
                title="Finds rows that still have an unfinished step (SSG enrolment, calendar add, or grant lookup) and finishes what's missing"
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isReprocessing ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Sync} className="w-3.5 h-3.5 mr-1.5" />
                    Sync Now
                  </>
                )}
              </button>
              <button
                onClick={() => void syncGrants()}
                disabled={isSyncingGrants}
                title="Pull grants from SSG for every current/future course run. Use after stakeholders apply grants in the SSG portal."
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-500 text-purple-700 dark:text-purple-300 hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSyncingGrants ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-2" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Sync} className="w-3.5 h-3.5 mr-1.5" />
                    Sync Grants
                  </>
                )}
              </button>
              <button
                onClick={() => void generateInvoiceForSelected()}
                disabled={isGeneratingInvoice || selectedIds.size === 0}
                title="Generate one consolidated QuickBooks invoice per (employer, course) group for the selected rows. Skips groups that already have an invoice."
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                title="Email the consolidated main tax invoice to the EMPLOYER contact for the selected rows. One email per shared invoice. Skips already-sent invoices. Grant invoices are never emailed."
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingEmail ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Mail} className="w-3.5 h-3.5 mr-1.5" />
                    Send Invoice Email
                  </>
                )}
              </button>
            </div>
            {reprocessMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{reprocessMessage}</p>
            )}
            {grantSyncMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{grantSyncMessage}</p>
            )}
            {emailMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{emailMessage}</p>
            )}
            {invoiceMessage && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-right">{invoiceMessage}</p>
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
        {docToast && (
          <div className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg shadow-lg bg-red-600 text-white text-sm">
            {docToast}
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
                    checked={filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(String(r.id || '')))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(filteredRows.map(r => String(r.id || '')).filter(Boolean)));
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
              {filteredRows.length > 0 ? filteredRows.map((row, index) => { const groupMeta = invoiceGroupMeta[index] || { isFirst: true, size: 1 }; return (
                <tr key={`${row.id || index}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(String(row.id || ''))}
                      onChange={() => toggleRowSelected(String(row.id || ''))}
                      disabled={!row.id}
                      className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 cursor-pointer"
                    />
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
                      const display = showPii ? raw : (raw.length >= 4 ? `${raw.charAt(0)}****${raw.slice(-3)}` : '****');
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
      </Card>
      )}
    </div>
  );
};
