import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import AiChatbot from '../components/AiChatbot';
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

const PAGE_LABELS: Record<TrainerPage, string> = {
  [TrainerPage.EAttendance]: 'E-Attendance',
  [TrainerPage.MyClasses]: 'My Classes',
  [TrainerPage.TaskList]: 'Task List',
  [TrainerPage.GenAIAuthoring]: 'Trainer GenAI Authoring',
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
      case TrainerPage.MyClasses:
        return <CourseList />;
      case TrainerPage.TaskList:
        return <CalendarView />;
      case TrainerPage.GenAIAuthoring:
        return <CreateView />;
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
          <div className="relative flex flex-col w-64 max-w-[calc(100%-3rem)] h-full shadow-xl">
            <div className="flex justify-end px-3 pt-3">
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
              >
                <Icon name={IconName.Close} className="w-5 h-5" />
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
      <AiChatbot />
    </div>
  );
};

export default TrainerLayout;
