import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

import { useLms } from '../contexts/LmsContext';
import { View, TrainerPage } from '@app-types';
import CalendarView from '../components/CalendarView';
import CourseList from '../components/CourseList';
import CreateView from '../components/CreateView';
import { ProfilePage } from '@components/ProfilePage';
import { CourseDetail } from '../components/CourseDetail';
import HelpAndSupportView from '../components/HelpAndSupportView';
import { Icon, IconName } from '../components/ui/Icon';
import TrainerHomePage from '../components/trainer/TrainerHomePage';
import TrainerSidebar from '../components/trainer/TrainerSidebar';
import AssessmentGrading from '../components/trainer/AssessmentGrading';
import PastAttendance from '../components/trainer/PastAttendance';
import PastAssessment from '../components/trainer/PastAssessment';
import EdToolsPage from '../components/trainer/EdToolsPage';
import DataAnalyticsToolsPage from '../components/trainer/DataAnalyticsToolsPage';
import FinanceToolsPage from '../components/trainer/FinanceToolsPage';
import StatToolsPage from '../components/trainer/StatToolsPage';
import DoeToolsPage from '../components/trainer/DoeToolsPage';
import SpcToolsPage from '../components/trainer/SpcToolsPage';
import SustainabilityToolsPage from '../components/trainer/SustainabilityToolsPage';
import LessonDeliveryGuidePage from '../components/trainer/LessonDeliveryGuidePage';
import VirtualToolsPage from '../components/trainer/VirtualToolsPage';
import AssessmentGuidePage from '../components/trainer/AssessmentGuidePage';

const PAGE_LABELS: Record<TrainerPage, string> = {
  [TrainerPage.EAttendance]: 'E-Attendance',
  [TrainerPage.AssessmentGrading]: 'Assessment Grading',
  [TrainerPage.MyClasses]: 'My Classes',
  [TrainerPage.PastAttendance]: 'Past Attendance',
  [TrainerPage.PastAssessment]: 'Past Assessment',
  [TrainerPage.TaskList]: 'Task List',
  [TrainerPage.GenAIAuthoring]: 'GenAI Tools',
  [TrainerPage.EdTools]: 'Ed Tools',
  [TrainerPage.DataAnalyticsTools]: 'Data Analytics Tools',
  [TrainerPage.FinanceTools]: 'Finance Tools',
  [TrainerPage.StatTools]: 'Statistical Tools',
  [TrainerPage.DoeTools]: 'DOE Tools',
  [TrainerPage.SpcTools]: 'SPC Tools',
  [TrainerPage.SustainabilityTools]: 'Sustainability Tools',
  [TrainerPage.VirtualTools]: 'Virtual Tools',
  [TrainerPage.LessonDeliveryGuide]: 'Lesson Delivery Guide',
  [TrainerPage.AssessmentGuide]: 'Assessment Guide',
};

const TrainerLayout: React.FC = () => {
  const { currentView, trainerPage, selectedCourse } = useLms();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

  const renderContent = () => {
    if (currentView === View.Profile) return <ProfilePage />;
    if (currentView === View.HelpAndSupport) return <HelpAndSupportView />;
    if (selectedCourse) return <CourseDetail />;

    switch (trainerPage) {
      case TrainerPage.EAttendance:
        return <TrainerHomePage />;
      case TrainerPage.AssessmentGrading:
        return <AssessmentGrading />;
      case TrainerPage.MyClasses:
        return <CourseList />;
      case TrainerPage.PastAttendance:
        return <PastAttendance />;
      case TrainerPage.PastAssessment:
        return <PastAssessment />;
      case TrainerPage.TaskList:
        return <CalendarView />;
      case TrainerPage.GenAIAuthoring:
        return <CreateView />;
      case TrainerPage.EdTools:
        return <EdToolsPage />;
      case TrainerPage.DataAnalyticsTools:
        return <DataAnalyticsToolsPage />;
      case TrainerPage.FinanceTools:
        return <FinanceToolsPage />;
      case TrainerPage.StatTools:
        return <StatToolsPage />;
      case TrainerPage.DoeTools:
        return <DoeToolsPage />;
      case TrainerPage.SpcTools:
        return <SpcToolsPage />;
      case TrainerPage.SustainabilityTools:
        return <SustainabilityToolsPage />;
      case TrainerPage.VirtualTools:
        return <VirtualToolsPage />;
      case TrainerPage.LessonDeliveryGuide:
        return <LessonDeliveryGuidePage />;
      case TrainerPage.AssessmentGuide:
        return <AssessmentGuidePage />;
      default:
        return <TrainerHomePage />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Sub-header: sidebar toggle + current page breadcrumb */}
      <div className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => {
            setIsSidebarOpen(prev => !prev);
            setIsDesktopSidebarOpen(prev => !prev);
          }}
          className="p-2 -ml-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          title="Toggle sidebar"
        >
          <Icon name={IconName.Menu} className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold truncate">
          {currentView === View.Profile ? 'Profile' : currentView === View.HelpAndSupport ? 'Help & Support' : selectedCourse ? selectedCourse.title : PAGE_LABELS[trainerPage]}
        </h2>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setIsSidebarOpen(false)}
          />
          <div className="relative flex flex-col w-72 max-w-[calc(100%-3rem)] h-full bg-surface shadow-xl">
            <div className="p-4 flex justify-between items-center border-b dark:border-gray-700">
              <h3 className="font-bold">Menu</h3>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 -mr-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                <Icon name={IconName.Close} className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <TrainerSidebar onNavigate={() => setIsSidebarOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        <aside className={`${isDesktopSidebarOpen ? 'hidden md:flex' : 'hidden'} w-64 flex-shrink-0 border-r border-gray-200 dark:border-slate-700 transition-all`}>
          <div className="w-full">
            <TrainerSidebar />
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {renderContent()}
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
};

export default TrainerLayout;
