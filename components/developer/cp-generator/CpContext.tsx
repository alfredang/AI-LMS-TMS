import React, { createContext, useContext, useEffect, useState } from 'react';

// Instruction methods available for CP — labels match Streamlit's
// INSTRUCTION_METHODS_LIST verbatim (alfredang/wsq-casl-cp-generator,
// app/ai_generator.py) so generated content references the same names.
export const INSTRUCTION_METHODS = [
  'Brainstorming',
  'Case studies',
  'Concept formation',
  'Debates',
  'Demonstrations / Modelling',
  'Didactic questions',
  'Discussions',
  'Drill and Practice',
  'Experiments',
  'Explicit teaching (Lecture) & Homework',
  'Field trips',
  'Games',
  'Independent reading',
  'Interactive presentation',
  'Peer teaching / Peer practice',
  'Problem solving',
  'Reflection',
  'Role-play',
  'Simulations',
];

// Assessment methods available for CP — Streamlit-parity labels.
export const ASSESSMENT_METHODS = [
  'Written Exam',
  'Online Test',
  'Project',
  'Assignments',
  'Oral Interview',
  'Demonstration',
  'Practical Exam',
  'Role Play',
  'Oral Questioning',
  'Others: Case Studies',
  'Others: Reflection',
];

// LU Sequencing types
export const LU_SEQUENCING_TYPES = [
  'Step by Step', 'Simple to Complex', 'Part to Part to Part',
  'Part to Whole', 'Spiral',
];

export type CpFramework = 'wsq' | 'casl';

export interface CpState {
  // Framework
  framework: CpFramework;
  setFramework: (f: CpFramework) => void;

  // Course Details (Page 1)
  courseTitle: string;
  setCourseTitle: (v: string) => void;
  courseTopics: string;
  setCourseTopics: (v: string) => void;
  courseDuration: number;
  setCourseDuration: (v: number) => void;
  numTopics: number;
  setNumTopics: (v: number) => void;
  instructionalHours: number;
  setInstructionalHours: (v: number) => void;
  assessmentHours: number;
  setAssessmentHours: (v: number) => void;
  numInstrMethods: number;
  setNumInstrMethods: (v: number) => void;
  numAssessMethods: number;
  setNumAssessMethods: (v: number) => void;
  selectedInstrMethods: string[];
  setSelectedInstrMethods: (v: string[]) => void;
  selectedAssessMethods: string[];
  setSelectedAssessMethods: (v: string[]) => void;
  // WSQ-specific
  tscRefCode: string;
  setTscRefCode: (v: string) => void;
  tscTitle: string;
  setTscTitle: (v: string) => void;
  // CASL-specific
  uniqueSkillName: string;
  setUniqueSkillName: (v: string) => void;

  // Generated content
  aboutCourseText: string;
  setAboutCourseText: (v: string) => void;
  wylText: string;
  setWylText: (v: string) => void;
  bgPartAText: string;
  setBgPartAText: (v: string) => void;
  bgPartBText: string;
  setBgPartBText: (v: string) => void;
  learningOutcomesText: string;
  setLearningOutcomesText: (v: string) => void;
  instrMethodResults: Record<string, string>;
  setInstrMethodResults: (v: Record<string, string>) => void;
  assessMethodResults: Record<string, string>;
  setAssessMethodResults: (v: Record<string, string>) => void;
  luSequencingType: string;
  setLuSequencingType: (v: string) => void;
  luSequencingText: string;
  setLuSequencingText: (v: string) => void;

  // Submit CP
  courseOutlineText: string;
  setCourseOutlineText: (v: string) => void;
  entryRequirementsText: string;
  setEntryRequirementsText: (v: string) => void;
  jobRolesText: string;
  setJobRolesText: (v: string) => void;
  lessonPlanText: string;
  setLessonPlanText: (v: string) => void;
  validationText: string;
  setValidationText: (v: string) => void;

  // Whether the user has clicked "Save Course Details" at least once since
  // the last reset — the summary table on Course Details keys off this.
  hasSavedCourseDetails: boolean;
  setHasSavedCourseDetails: (v: boolean) => void;

  // Reset everything (clears persisted state too)
  reset: () => void;
}

const CpContext = createContext<CpState | null>(null);

export const useCp = () => {
  const ctx = useContext(CpContext);
  if (!ctx) throw new Error('useCp must be used within CpProvider');
  return ctx;
};

// Bump this key when the snapshot shape changes to invalidate old cached data.
const STORAGE_KEY = 'cp-generator-state-v1';

type CpSnapshot = Omit<
  CpState,
  | 'setFramework' | 'setCourseTitle' | 'setCourseTopics' | 'setCourseDuration'
  | 'setNumTopics' | 'setInstructionalHours' | 'setAssessmentHours'
  | 'setNumInstrMethods' | 'setNumAssessMethods' | 'setSelectedInstrMethods'
  | 'setSelectedAssessMethods' | 'setTscRefCode' | 'setTscTitle'
  | 'setUniqueSkillName' | 'setAboutCourseText' | 'setWylText'
  | 'setBgPartAText' | 'setBgPartBText' | 'setLearningOutcomesText'
  | 'setInstrMethodResults' | 'setAssessMethodResults' | 'setLuSequencingType'
  | 'setLuSequencingText' | 'setCourseOutlineText' | 'setEntryRequirementsText'
  | 'setJobRolesText' | 'setLessonPlanText' | 'setValidationText'
  | 'setHasSavedCourseDetails' | 'reset'
>;

const DEFAULT_SNAPSHOT: CpSnapshot = {
  framework: 'wsq',
  courseTitle: '',
  courseTopics: '',
  courseDuration: 16,
  numTopics: 4,
  instructionalHours: 12,
  assessmentHours: 4,
  numInstrMethods: 3,
  numAssessMethods: 0,
  selectedInstrMethods: [],
  selectedAssessMethods: [],
  tscRefCode: '',
  tscTitle: '',
  uniqueSkillName: '',
  aboutCourseText: '',
  wylText: '',
  bgPartAText: '',
  bgPartBText: '',
  learningOutcomesText: '',
  instrMethodResults: {},
  assessMethodResults: {},
  luSequencingType: 'Step by Step',
  luSequencingText: '',
  courseOutlineText: '',
  entryRequirementsText: '',
  jobRolesText: '',
  lessonPlanText: '',
  validationText: '',
  hasSavedCourseDetails: false,
};

function loadInitialSnapshot(): CpSnapshot {
  if (typeof window === 'undefined') return DEFAULT_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SNAPSHOT;
    const parsed = JSON.parse(raw) as Partial<CpSnapshot>;
    return { ...DEFAULT_SNAPSHOT, ...parsed };
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

export const CpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initial] = useState<CpSnapshot>(loadInitialSnapshot);

  const [framework, setFramework] = useState<CpFramework>(initial.framework);
  const [courseTitle, setCourseTitle] = useState(initial.courseTitle);
  const [courseTopics, setCourseTopics] = useState(initial.courseTopics);
  const [courseDuration, setCourseDuration] = useState(initial.courseDuration);
  const [numTopics, setNumTopics] = useState(initial.numTopics);
  const [instructionalHours, setInstructionalHours] = useState(initial.instructionalHours);
  const [assessmentHours, setAssessmentHours] = useState(initial.assessmentHours);
  const [numInstrMethods, setNumInstrMethods] = useState(initial.numInstrMethods);
  const [numAssessMethods, setNumAssessMethods] = useState(initial.numAssessMethods);
  const [selectedInstrMethods, setSelectedInstrMethods] = useState<string[]>(initial.selectedInstrMethods);
  const [selectedAssessMethods, setSelectedAssessMethods] = useState<string[]>(initial.selectedAssessMethods);
  const [tscRefCode, setTscRefCode] = useState(initial.tscRefCode);
  const [tscTitle, setTscTitle] = useState(initial.tscTitle);
  const [uniqueSkillName, setUniqueSkillName] = useState(initial.uniqueSkillName);

  const [aboutCourseText, setAboutCourseText] = useState(initial.aboutCourseText);
  const [wylText, setWylText] = useState(initial.wylText);
  const [bgPartAText, setBgPartAText] = useState(initial.bgPartAText);
  const [bgPartBText, setBgPartBText] = useState(initial.bgPartBText);
  const [learningOutcomesText, setLearningOutcomesText] = useState(initial.learningOutcomesText);
  const [instrMethodResults, setInstrMethodResults] = useState<Record<string, string>>(initial.instrMethodResults);
  const [assessMethodResults, setAssessMethodResults] = useState<Record<string, string>>(initial.assessMethodResults);
  const [luSequencingType, setLuSequencingType] = useState(initial.luSequencingType);
  const [luSequencingText, setLuSequencingText] = useState(initial.luSequencingText);

  const [courseOutlineText, setCourseOutlineText] = useState(initial.courseOutlineText);
  const [entryRequirementsText, setEntryRequirementsText] = useState(initial.entryRequirementsText);
  const [jobRolesText, setJobRolesText] = useState(initial.jobRolesText);
  const [lessonPlanText, setLessonPlanText] = useState(initial.lessonPlanText);
  const [validationText, setValidationText] = useState(initial.validationText);

  const [hasSavedCourseDetails, setHasSavedCourseDetails] = useState(initial.hasSavedCourseDetails);

  // Persist a serialised snapshot whenever any field changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot: CpSnapshot = {
      framework, courseTitle, courseTopics, courseDuration, numTopics,
      instructionalHours, assessmentHours, numInstrMethods, numAssessMethods,
      selectedInstrMethods, selectedAssessMethods, tscRefCode, tscTitle,
      uniqueSkillName, aboutCourseText, wylText, bgPartAText, bgPartBText,
      learningOutcomesText, instrMethodResults, assessMethodResults,
      luSequencingType, luSequencingText, courseOutlineText,
      entryRequirementsText, jobRolesText, lessonPlanText, validationText,
      hasSavedCourseDetails,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Quota exceeded or private-mode — accept loss of persistence rather than crashing.
    }
  }, [
    framework, courseTitle, courseTopics, courseDuration, numTopics,
    instructionalHours, assessmentHours, numInstrMethods, numAssessMethods,
    selectedInstrMethods, selectedAssessMethods, tscRefCode, tscTitle,
    uniqueSkillName, aboutCourseText, wylText, bgPartAText, bgPartBText,
    learningOutcomesText, instrMethodResults, assessMethodResults,
    luSequencingType, luSequencingText, courseOutlineText,
    entryRequirementsText, jobRolesText, lessonPlanText, validationText,
    hasSavedCourseDetails,
  ]);

  const reset = () => {
    setFramework(DEFAULT_SNAPSHOT.framework);
    setCourseTitle(DEFAULT_SNAPSHOT.courseTitle);
    setCourseTopics(DEFAULT_SNAPSHOT.courseTopics);
    setCourseDuration(DEFAULT_SNAPSHOT.courseDuration);
    setNumTopics(DEFAULT_SNAPSHOT.numTopics);
    setInstructionalHours(DEFAULT_SNAPSHOT.instructionalHours);
    setAssessmentHours(DEFAULT_SNAPSHOT.assessmentHours);
    setNumInstrMethods(DEFAULT_SNAPSHOT.numInstrMethods);
    setNumAssessMethods(DEFAULT_SNAPSHOT.numAssessMethods);
    setSelectedInstrMethods(DEFAULT_SNAPSHOT.selectedInstrMethods);
    setSelectedAssessMethods(DEFAULT_SNAPSHOT.selectedAssessMethods);
    setTscRefCode(DEFAULT_SNAPSHOT.tscRefCode);
    setTscTitle(DEFAULT_SNAPSHOT.tscTitle);
    setUniqueSkillName(DEFAULT_SNAPSHOT.uniqueSkillName);
    setAboutCourseText(DEFAULT_SNAPSHOT.aboutCourseText);
    setWylText(DEFAULT_SNAPSHOT.wylText);
    setBgPartAText(DEFAULT_SNAPSHOT.bgPartAText);
    setBgPartBText(DEFAULT_SNAPSHOT.bgPartBText);
    setLearningOutcomesText(DEFAULT_SNAPSHOT.learningOutcomesText);
    setInstrMethodResults(DEFAULT_SNAPSHOT.instrMethodResults);
    setAssessMethodResults(DEFAULT_SNAPSHOT.assessMethodResults);
    setLuSequencingType(DEFAULT_SNAPSHOT.luSequencingType);
    setLuSequencingText(DEFAULT_SNAPSHOT.luSequencingText);
    setCourseOutlineText(DEFAULT_SNAPSHOT.courseOutlineText);
    setEntryRequirementsText(DEFAULT_SNAPSHOT.entryRequirementsText);
    setJobRolesText(DEFAULT_SNAPSHOT.jobRolesText);
    setLessonPlanText(DEFAULT_SNAPSHOT.lessonPlanText);
    setValidationText(DEFAULT_SNAPSHOT.validationText);
    setHasSavedCourseDetails(DEFAULT_SNAPSHOT.hasSavedCourseDetails);
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  };

  return (
    <CpContext.Provider value={{
      framework, setFramework,
      courseTitle, setCourseTitle,
      courseTopics, setCourseTopics,
      courseDuration, setCourseDuration,
      numTopics, setNumTopics,
      instructionalHours, setInstructionalHours,
      assessmentHours, setAssessmentHours,
      numInstrMethods, setNumInstrMethods,
      numAssessMethods, setNumAssessMethods,
      selectedInstrMethods, setSelectedInstrMethods,
      selectedAssessMethods, setSelectedAssessMethods,
      tscRefCode, setTscRefCode,
      tscTitle, setTscTitle,
      uniqueSkillName, setUniqueSkillName,
      aboutCourseText, setAboutCourseText,
      wylText, setWylText,
      bgPartAText, setBgPartAText,
      bgPartBText, setBgPartBText,
      learningOutcomesText, setLearningOutcomesText,
      instrMethodResults, setInstrMethodResults,
      assessMethodResults, setAssessMethodResults,
      luSequencingType, setLuSequencingType,
      luSequencingText, setLuSequencingText,
      courseOutlineText, setCourseOutlineText,
      entryRequirementsText, setEntryRequirementsText,
      jobRolesText, setJobRolesText,
      lessonPlanText, setLessonPlanText,
      validationText, setValidationText,
      hasSavedCourseDetails, setHasSavedCourseDetails,
      reset,
    }}>
      {children}
    </CpContext.Provider>
  );
};
