import React from 'react';
import { DeveloperPage } from '@app-types';
import { CwProvider } from './courseware-generator/CwContext';
import CwExtractCourseInfo from './courseware-generator/CwExtractCourseInfo';
import CwGenerateApFgLg from './courseware-generator/CwGenerateApFgLg';
import CwGenerateLessonPlan from './courseware-generator/CwGenerateLessonPlan';
import CwGenerateAssessment from './courseware-generator/CwGenerateAssessment';
import CwGenerateSlides from './courseware-generator/CwGenerateSlides';
import CwGenerateBrochure from './courseware-generator/CwGenerateBrochure';
import CwCoursewareAudit from './courseware-generator/CwCoursewareAudit';

interface CwGeneratorViewProps {
  currentStep: DeveloperPage;
}

const CwGeneratorView: React.FC<CwGeneratorViewProps> = ({ currentStep }) => {
  return (
    <CwProvider>
      <CwGeneratorInner currentStep={currentStep} />
    </CwProvider>
  );
};

const CwGeneratorInner: React.FC<CwGeneratorViewProps> = ({ currentStep }) => {
  switch (currentStep) {
    case DeveloperPage.CwExtractCourseInfo:
      return <CwExtractCourseInfo />;
    case DeveloperPage.CwGenerateApFgLg:
      return <CwGenerateApFgLg />;
    case DeveloperPage.CwGenerateLessonPlan:
      return <CwGenerateLessonPlan />;
    case DeveloperPage.CwGenerateAssessment:
      return <CwGenerateAssessment />;
    case DeveloperPage.CwGenerateSlides:
      return <CwGenerateSlides />;
    case DeveloperPage.CwGenerateBrochure:
      return <CwGenerateBrochure />;
    case DeveloperPage.CwCoursewareAudit:
      return <CwCoursewareAudit />;
    default:
      return <CwExtractCourseInfo />;
  }
};

export default CwGeneratorView;
