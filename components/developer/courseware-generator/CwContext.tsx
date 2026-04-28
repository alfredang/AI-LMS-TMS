import React, { createContext, useContext, useState, useEffect } from 'react';

// localStorage-backed state — persists CP extraction across navigation AND
// browser refresh. Lazy-init reads the saved value on mount; an effect
// writes back on change. Auto-expires after 7 days so stale extractions
// don't linger forever. Designed for the Courseware Generator's extracted
// course info (extractedResult / courseData / cpText) so users can flip
// between Generate Slides / AP-FG-LG / Lesson Plan etc. without losing
// their extracted CP — and refresh without losing it either.
const STORAGE_NS = 'cw_ext_v1';
const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadPersisted<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_NS}:${key}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { v: T; t: number };
    if (!parsed || typeof parsed.t !== 'number') return fallback;
    if (Date.now() - parsed.t > STORAGE_TTL_MS) {
      window.localStorage.removeItem(`${STORAGE_NS}:${key}`);
      return fallback;
    }
    return parsed.v;
  } catch {
    return fallback;
  }
}

function savePersisted<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_NS}:${key}`, JSON.stringify({ v: value, t: Date.now() }));
  } catch {
    // localStorage full / disabled — silent no-op (state still works in memory).
  }
}

function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [state, setState] = useState<T>(() => loadPersisted(key, initial));
  useEffect(() => {
    savePersisted(key, state);
  }, [key, state]);
  return [state, setState];
}

export function clearPersistedExtraction(): void {
  if (typeof window === 'undefined') return;
  for (const k of ['courseData', 'cpText', 'extractedResult']) {
    try { window.localStorage.removeItem(`${STORAGE_NS}:${k}`); } catch {}
  }
}

// Assessment types available
export const ASSESSMENT_TYPES = [
  { key: 'saq', label: 'Short Answer Questions (SAQ)' },
  { key: 'pp', label: 'Practical Performance (PP)' },
  { key: 'cs', label: 'Case Study (CS)' },
  { key: 'prj', label: 'Project (PRJ)' },
  { key: 'asgn', label: 'Assignment (ASGN)' },
  { key: 'oi', label: 'Oral Interview (OI)' },
  { key: 'dem', label: 'Demonstration (DEM)' },
  { key: 'rp', label: 'Role Play (RP)' },
  { key: 'oq', label: 'Oral Questioning (OQ)' },
];

// Document types for AP/FG/LG generation
export const DOCUMENT_TYPES = [
  { key: 'ap', label: 'Assessment Plan (AP)' },
  { key: 'fg', label: 'Facilitator Guide (FG)' },
  { key: 'lg', label: 'Learner Guide (LG)' },
];

// Document types for audit
export const AUDIT_DOCUMENT_TYPES = [
  { key: 'cp', label: 'Course Proposal (CP)' },
  { key: 'ap', label: 'Assessment Plan (AP)' },
  { key: 'fg', label: 'Facilitator Guide (FG)' },
  { key: 'lg', label: 'Learner Guide (LG)' },
  { key: 'lp', label: 'Lesson Plan (LP)' },
];

// Courseware doc types selectable per uploaded audit file. Mirrors
// AUDIT_DOC_TYPES in lib/cw-audit.ts.
export const AUDIT_COURSEWARE_DOC_TYPES = ['AP', 'ASR', 'FG', 'LG', 'LP'] as const;
export type AuditCoursewareDocType = (typeof AUDIT_COURSEWARE_DOC_TYPES)[number];

// Field keys + labels for the audit checklist UI (must stay aligned with
// AUDIT_FIELD_KEYS / AUDIT_FIELD_LABELS in lib/cw-audit.ts).
export const AUDIT_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'tgs_ref_code', label: 'TGS Reference Code' },
  { key: 'course_title', label: 'Course Title' },
  { key: 'company_name', label: 'Company Name' },
  { key: 'tsc_ref_code', label: 'TSC Reference Code' },
  { key: 'tsc_title', label: 'TSC Title' },
  { key: 'training_hours', label: 'Training Hours' },
  { key: 'assessment_hours', label: 'Assessment Hours' },
  { key: 'total_hours', label: 'Total Hours' },
  { key: 'learning_outcomes', label: 'Learning Outcomes' },
  { key: 'topics', label: 'Topics' },
  { key: 'assessment_methods', label: 'Assessment Methods' },
  { key: 'instructional_methods', label: 'Instructional Methods' },
];

// Per-uploaded-doc entry held in audit state: the actual File for upload
// + the type the user chose from the dropdown.
export interface AuditDocEntry {
  file: File;
  docType: AuditCoursewareDocType;
}

// Shape of /api/developer/cw-audit response — kept here so the UI can
// render strongly-typed result data.
export interface AuditFieldComparison {
  field: string;
  label: string;
  status: 'match' | 'mismatch' | 'missing' | 'na';
  expected: string | string[] | null;
  got: string | string[] | null;
}
export interface AuditDocComparison {
  fileName: string;
  docType: AuditCoursewareDocType;
  fields: AuditFieldComparison[];
  passCount: number;
  failCount: number;
  missingCount: number;
}
export interface AuditResultPayload {
  cpFields: Record<string, any>;
  tgsCode: string | null;
  comparisons: AuditDocComparison[];
  summary: {
    totalDocs: number;
    totalFields: number;
    totalPass: number;
    totalFail: number;
    totalMissing: number;
  };
}

export interface LearningUnit {
  luTitle: string;
  topics: { title: string; bulletPoints: string[] }[];
  learningOutcome: string;
  kStatements: { id: string; description: string }[];
  aStatements: { id: string; description: string }[];
  assessmentMethods: string[];
  instructionalMethods: string[];
}

export interface CourseData {
  organisationName: string;
  courseTitle: string;
  tgsRefNo: string;
  tscCode: string;
  tscTitle: string;
  totalTrainingHours: string;
  totalAssessmentHours: string;
  courseOverview: string;
  learningUnits: LearningUnit[];
  assessmentMethodsDetails: {
    method: string;
    abbreviation: string;
    totalHours: string;
  }[];
}

export interface CwState {
  // Company selection
  selectedCompanyId: string;
  setSelectedCompanyId: (v: string) => void;
  selectedCompanyName: string;
  setSelectedCompanyName: (v: string) => void;

  // Extracted course data (shared across all pages)
  courseData: CourseData | null;
  setCourseData: (v: CourseData | null) => void;

  // CP text (raw uploaded content)
  cpText: string;
  setCpText: (v: string) => void;

  // Extract Course Info
  extractedResult: string;
  setExtractedResult: (v: string) => void;

  // Generate AP/FG/LG
  selectedDocType: string;
  setSelectedDocType: (v: string) => void;
  generatedDoc: string;
  setGeneratedDoc: (v: string) => void;

  // Lesson Plan
  numTrainingDays: number;
  setNumTrainingDays: (v: number) => void;
  lessonPlanResult: string;
  setLessonPlanResult: (v: string) => void;

  // Assessment
  selectedAssessmentTypes: string[];
  setSelectedAssessmentTypes: (v: string[]) => void;
  assessmentResults: Record<string, string>;
  setAssessmentResults: (v: Record<string, string>) => void;

  // Slides
  slidesResult: string;
  setSlidesResult: (v: string) => void;

  // Brochure
  courseUrl: string;
  setCourseUrl: (v: string) => void;
  brochureResult: string;
  setBrochureResult: (v: string) => void;

  // Audit — file-upload-based (Streamlit-parity).
  auditCpFile: File | null;
  setAuditCpFile: (v: File | null) => void;
  auditTgsCode: string;
  setAuditTgsCode: (v: string) => void;
  auditDocs: AuditDocEntry[];
  setAuditDocs: (v: AuditDocEntry[]) => void;
  auditChecklist: string[];
  setAuditChecklist: (v: string[]) => void;
  auditResultData: AuditResultPayload | null;
  setAuditResultData: (v: AuditResultPayload | null) => void;
}

const CwContext = createContext<CwState | null>(null);

export const useCw = () => {
  const ctx = useContext(CwContext);
  if (!ctx) throw new Error('useCw must be used within CwProvider');
  return ctx;
};

export const CwProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedCompanyName, setSelectedCompanyName] = useState('');
  // Persist extraction state across navigation + browser refresh.
  // CP file (binary) is NOT stored — only the parsed text + structured
  // courseData + the AI-extracted JSON result.
  const [courseData, setCourseData] = usePersistentState<CourseData | null>('courseData', null);
  const [cpText, setCpText] = usePersistentState<string>('cpText', '');
  const [extractedResult, setExtractedResult] = usePersistentState<string>('extractedResult', '');
  const [selectedDocType, setSelectedDocType] = useState('ap');
  const [generatedDoc, setGeneratedDoc] = useState('');
  const [numTrainingDays, setNumTrainingDays] = useState(2);
  const [lessonPlanResult, setLessonPlanResult] = useState('');
  const [selectedAssessmentTypes, setSelectedAssessmentTypes] = useState<string[]>([]);
  const [assessmentResults, setAssessmentResults] = useState<Record<string, string>>({});
  const [slidesResult, setSlidesResult] = useState('');
  const [courseUrl, setCourseUrl] = useState('');
  const [brochureResult, setBrochureResult] = useState('');
  const [auditCpFile, setAuditCpFile] = useState<File | null>(null);
  const [auditTgsCode, setAuditTgsCode] = useState('');
  const [auditDocs, setAuditDocs] = useState<AuditDocEntry[]>([]);
  const [auditChecklist, setAuditChecklist] = useState<string[]>(AUDIT_FIELD_OPTIONS.map((f) => f.key));
  const [auditResultData, setAuditResultData] = useState<AuditResultPayload | null>(null);

  return (
    <CwContext.Provider value={{
      selectedCompanyId, setSelectedCompanyId,
      selectedCompanyName, setSelectedCompanyName,
      courseData, setCourseData,
      cpText, setCpText,
      extractedResult, setExtractedResult,
      selectedDocType, setSelectedDocType,
      generatedDoc, setGeneratedDoc,
      numTrainingDays, setNumTrainingDays,
      lessonPlanResult, setLessonPlanResult,
      selectedAssessmentTypes, setSelectedAssessmentTypes,
      assessmentResults, setAssessmentResults,
      slidesResult, setSlidesResult,
      courseUrl, setCourseUrl,
      brochureResult, setBrochureResult,
      auditCpFile, setAuditCpFile,
      auditTgsCode, setAuditTgsCode,
      auditDocs, setAuditDocs,
      auditChecklist, setAuditChecklist,
      auditResultData, setAuditResultData,
    }}>
      {children}
    </CwContext.Provider>
  );
};
