import React from 'react';
import Header from '../components/Header';
import AiChatbot from '../components/AiChatbot';
import { useLms } from '../contexts/LmsContext';
import { View } from '@app-types';
import WelcomeDashboard from '../components/WelcomeDashboard';
import CourseList from '../components/CourseList';
import CalendarView from '../components/CalendarView';
import CreateView from '../components/CreateView';
import { ProfilePage } from '@components/ProfilePage';
import { CourseDetail } from '../components/CourseDetail';
import HelpAndSupportView from '../components/HelpAndSupportView';
import { Icon, IconName } from '../components/ui/Icon';

const TrainerLayout: React.FC = () => {
  const { currentView, selectedCourse } = useLms();

  console.log(`🎯 TrainerLayout - Current View: ${currentView}`);
  console.log(`📋 TrainerLayout - Selected Course: ${selectedCourse}`);

  const renderContent = () => {
    console.log(`🔄 Rendering content for view: ${currentView}`);
    
    // If a course is selected, show course detail
    if (selectedCourse) {
      console.log(`🎓 TrainerLayout - Showing CourseDetail because selectedCourse exists`);
      return <CourseDetail />;
    }
    
    if (currentView === View.Profile) {
      return <ProfilePage />;
    }
    
    if (currentView === View.HelpAndSupport) {
      return <HelpAndSupportView />;
    }
    
    // Default views when no course is selected
    switch (currentView) {
      case View.Dashboard:
        return <WelcomeDashboard />;
      case View.Courses:
        return <CourseList />;
      case View.Calendar:
        return <CalendarView />;
      case View.Create:
        return <CreateView />;
      default:
        return <WelcomeDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background font-sans text-on-surface">
      <Header />
      {selectedCourse && (
        <div className="lg:hidden flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-gray-200 bg-surface">
            <button onClick={() => {/* TODO: Implement mobile menu */}} className="p-2 -ml-2 text-gray-600 hover:text-gray-900">
                <Icon name={IconName.Menu} className="w-6 h-6" />
            </button>
            <h2 className="text-lg font-bold truncate">{selectedCourse.title}</h2>
        </div>
      )}
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>
      <AiChatbot />
    </div>
  );
};

export default TrainerLayout;
