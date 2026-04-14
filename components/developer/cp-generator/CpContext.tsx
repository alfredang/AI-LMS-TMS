import React, { createContext, useContext, useState } from 'react';

// Instruction methods available for CP
export const INSTRUCTION_METHODS = [
  'Brainstorming', 'Case studies', 'Concept formation', 'Debates',
  'Demonstrations/Modelling', 'Didactic questions', 'Discussions',
  'Drill and Practice', 'Experiments', 'Explicit teaching', 'Field trips',
  'Games', 'Independent reading', 'Interactive presentation', 'Peer teaching',
  'Problem solving', 'Reflection', 'Role-play', 'Simulations',
];

// Assessment methods available for CP
export const ASSESSMENT_METHODS = [
  'Written Exam', 'Online Test', 'Project', 'Assignments', 'Oral Interview',
  'Demonstration', 'Practical Exam', 'Role Play', 'Oral Questioning',
  'Case Studies', 'Reflection',
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
}

const CpContext = createContext<CpState | null>(null);

export const useCp = () => {
  const ctx = useContext(CpContext);
  if (!ctx) throw new Error('useCp must be used within CpProvider');
  return ctx;
};

export const CpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [framework, setFramework] = useState<CpFramework>('wsq');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseTopics, setCourseTopics] = useState('');
  const [courseDuration, setCourseDuration] = useState(16);
  const [numTopics, setNumTopics] = useState(4);
  const [instructionalHours, setInstructionalHours] = useState(12);
  const [assessmentHours, setAssessmentHours] = useState(4);
  const [numInstrMethods, setNumInstrMethods] = useState(3);
  const [numAssessMethods, setNumAssessMethods] = useState(0);
  const [selectedInstrMethods, setSelectedInstrMethods] = useState<string[]>([]);
  const [selectedAssessMethods, setSelectedAssessMethods] = useState<string[]>([]);
  const [tscRefCode, setTscRefCode] = useState('');
  const [tscTitle, setTscTitle] = useState('');
  const [uniqueSkillName, setUniqueSkillName] = useState('');

  const [aboutCourseText, setAboutCourseText] = useState('');
  const [wylText, setWylText] = useState('');
  const [bgPartAText, setBgPartAText] = useState('');
  const [bgPartBText, setBgPartBText] = useState('');
  const [learningOutcomesText, setLearningOutcomesText] = useState('');
  const [instrMethodResults, setInstrMethodResults] = useState<Record<string, string>>({});
  const [assessMethodResults, setAssessMethodResults] = useState<Record<string, string>>({});
  const [luSequencingType, setLuSequencingType] = useState('Step by Step');
  const [luSequencingText, setLuSequencingText] = useState('');

  const [courseOutlineText, setCourseOutlineText] = useState('');
  const [entryRequirementsText, setEntryRequirementsText] = useState('');
  const [jobRolesText, setJobRolesText] = useState('');
  const [lessonPlanText, setLessonPlanText] = useState('');
  const [validationText, setValidationText] = useState('');

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
    }}>
      {children}
    </CpContext.Provider>
  );
};
