import React, { createContext, useContext, useState } from 'react';

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

  // Convert Documents
  convertSourceText: string;
  setConvertSourceText: (v: string) => void;
  convertResult: string;
  setConvertResult: (v: string) => void;

  // Audit
  auditDocuments: Record<string, string>;
  setAuditDocuments: (v: Record<string, string>) => void;
  auditResult: string;
  setAuditResult: (v: string) => void;
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
  const [courseData, setCourseData] = useState<CourseData | null>(null);
  const [cpText, setCpText] = useState('');
  const [extractedResult, setExtractedResult] = useState('');
  const [selectedDocType, setSelectedDocType] = useState('ap');
  const [generatedDoc, setGeneratedDoc] = useState('');
  const [numTrainingDays, setNumTrainingDays] = useState(2);
  const [lessonPlanResult, setLessonPlanResult] = useState('');
  const [selectedAssessmentTypes, setSelectedAssessmentTypes] = useState<string[]>([]);
  const [assessmentResults, setAssessmentResults] = useState<Record<string, string>>({});
  const [slidesResult, setSlidesResult] = useState('');
  const [courseUrl, setCourseUrl] = useState('');
  const [brochureResult, setBrochureResult] = useState('');
  const [convertSourceText, setConvertSourceText] = useState('');
  const [convertResult, setConvertResult] = useState('');
  const [auditDocuments, setAuditDocuments] = useState<Record<string, string>>({});
  const [auditResult, setAuditResult] = useState('');

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
      convertSourceText, setConvertSourceText,
      convertResult, setConvertResult,
      auditDocuments, setAuditDocuments,
      auditResult, setAuditResult,
    }}>
      {children}
    </CwContext.Provider>
  );
};
