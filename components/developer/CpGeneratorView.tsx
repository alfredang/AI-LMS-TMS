import React from 'react';
import { DeveloperPage } from '@app-types';
import { CpProvider } from './cp-generator/CpContext';
import CpCourseDetails from './cp-generator/CpCourseDetails';
import CpContentGenerator from './cp-generator/CpContentGenerator';

interface CpGeneratorViewProps {
  currentStep: DeveloperPage;
}

const CpGeneratorView: React.FC<CpGeneratorViewProps> = ({ currentStep }) => {
  return (
    <CpProvider>
      <CpGeneratorInner currentStep={currentStep} />
    </CpProvider>
  );
};

const CpGeneratorInner: React.FC<CpGeneratorViewProps> = ({ currentStep }) => {
  switch (currentStep) {
    case DeveloperPage.CpCourseDetails:
      return <CpCourseDetails />;
    case DeveloperPage.CpAboutCourse:
      return <CpContentGenerator section="about_course" title="About This Course" description="Generate a professional 80-120 word course description." />;
    case DeveloperPage.CpWhatYoullLearn:
      return <CpContentGenerator section="what_youll_learn" title="What You'll Learn" description="Generate 3-5 bullet-point learning outcomes (40-60 words each)." />;
    case DeveloperPage.CpBackgroundA:
      return <CpContentGenerator section="background_a" title="Background Part A" description="Generate 2-3 paragraphs on targeted sectors, industry pressures, and skills gaps." />;
    case DeveloperPage.CpBackgroundB:
      return <CpContentGenerator section="background_b" title="Background Part B" description="Generate content on performance gaps, identification methodologies, and learner benefits." />;
    case DeveloperPage.CpLearningOutcomes:
      return <CpContentGenerator section="learning_outcomes" title="Learning Outcomes" description="Generate one learning outcome per topic in T1/LO1 format." />;
    case DeveloperPage.CpInstructionalMethods:
      return <CpContentGenerator section="instructional_methods" title="Instructional Methods" description="Generate elaboration for each selected instructional method (250-400 words each)." />;
    case DeveloperPage.CpAssessmentMethods:
      return <CpContentGenerator section="assessment_methods" title="Assessment Methods" description="Generate elaboration for each selected assessment method (100-200 words each)." />;
    case DeveloperPage.CpLuSequencing:
      return <CpContentGenerator section="lu_sequencing" title="LU Sequencing Rationale" description="Generate justification for the topic sequencing approach." />;
    case DeveloperPage.CpCourseOutline:
      return <CpContentGenerator section="course_outline" title="Course Outline" description="Generate a structured course outline (max 2000 characters)." />;
    case DeveloperPage.CpEntryRequirements:
      return <CpContentGenerator section="entry_requirements" title="Minimum Entry Requirements" description="Generate knowledge, skills, attitude, experience, and age group requirements." />;
    case DeveloperPage.CpJobRoles:
      return <CpContentGenerator section="job_roles" title="Job Roles" description="Generate exactly 10 SSG-aligned job roles." />;
    case DeveloperPage.CpLessonPlan:
      return <CpContentGenerator section="lesson_plan" title="Lesson Plan" description="Generate a day-by-day lesson plan schedule." />;
    case DeveloperPage.CpValidation:
      return <CpContentGenerator section="validation" title="Course Validation" description="Generate 5 distinct survey response sets for course validation." />;
    default:
      return <CpCourseDetails />;
  }
};

export default CpGeneratorView;
