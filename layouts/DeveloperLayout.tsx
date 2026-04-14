import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useLms } from '../contexts/LmsContext';
import { View, DeveloperPage } from '@app-types';
import CourseList from '../components/CourseList';
import SeoGeneratorView from '../components/developer/SeoGeneratorView';
import CourseEditor from '../components/CourseEditor';
import { CourseDetail } from '../components/CourseDetail';
import ProfileView from '../components/ProfileView';
import HelpAndSupportView from '../components/HelpAndSupportView';
import DeveloperSidebar from '../components/developer/DeveloperSidebar';
import CpGeneratorView from '../components/developer/CpGeneratorView';
import { useAppVersion } from '@hooks/useAppVersion';

const DeveloperLayout: React.FC = () => {
  const { currentView, selectedCourse, editingCourse, developerPage } = useLms();
  const appVersion = useAppVersion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Handle full-width views (Profile and Help & Support)
  if (currentView === View.Profile || currentView === View.HelpAndSupport) {
    return (
      <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
        <Header />
        <main className="container mx-auto p-4 sm:p-6 lg:p-8 flex-grow">
          {currentView === View.Profile ? <ProfileView /> : <HelpAndSupportView />}
        </main>
        <Footer />
      </div>
    );
  }

  const renderContent = () => {
    if (editingCourse) {
      return <CourseEditor />;
    }
    if (selectedCourse) {
      return <CourseDetail />;
    }
    if (currentView === View.Create) {
      return <SeoGeneratorView />;
    }
    if (
      developerPage === DeveloperPage.CpCourseDetails ||
      developerPage === DeveloperPage.CpAboutCourse ||
      developerPage === DeveloperPage.CpWhatYoullLearn ||
      developerPage === DeveloperPage.CpBackgroundA ||
      developerPage === DeveloperPage.CpBackgroundB ||
      developerPage === DeveloperPage.CpLearningOutcomes ||
      developerPage === DeveloperPage.CpInstructionalMethods ||
      developerPage === DeveloperPage.CpAssessmentMethods ||
      developerPage === DeveloperPage.CpLuSequencing ||
      developerPage === DeveloperPage.CpCourseOutline ||
      developerPage === DeveloperPage.CpEntryRequirements ||
      developerPage === DeveloperPage.CpJobRoles ||
      developerPage === DeveloperPage.CpLessonPlan ||
      developerPage === DeveloperPage.CpValidation
    ) {
      return <CpGeneratorView currentStep={developerPage} />;
    }
    return <CourseList />;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Sidebar area: rail is always visible, panel slides in/out */}
        <div className="flex flex-shrink-0">
          {/* Expanded sidebar panel */}
          {isSidebarOpen && (
            <aside className="w-64 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col h-[calc(100vh-64px)] sticky top-[64px]">
              <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                <DeveloperSidebar />
              </div>
              <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">version {appVersion}</p>
            </aside>
          )}
          {/* Thin rail with toggle arrow always visible */}
          <div className="w-8 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 h-[calc(100vh-64px)] sticky top-[64px] relative">
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="fixed top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg className={`w-5 h-5 transition-transform ${isSidebarOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
            {renderContent()}
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
};

export default DeveloperLayout;
