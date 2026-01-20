import React from 'react';
import Header from '../components/Header';
import AiChatbot from '../components/AiChatbot';
import { useLms } from '../contexts/LmsContext';
import { View } from '../types';
import WelcomeDashboard from '../components/WelcomeDashboard';
import CourseList from '../components/CourseList';
import CalendarView from '../components/CalendarView';
import { ProfilePage } from '@components/ProfilePage';
import { CourseDetail } from '../components/CourseDetail';
import HelpAndSupportView from '../components/HelpAndSupportView';

const LearnerLayout: React.FC = () => {
  const { currentView, selectedCourse } = useLms();

  console.log(`🎯 LearnerLayout - Current View: ${currentView}`);
  console.log(`📋 LearnerLayout - Selected Course: ${selectedCourse}`);

  const renderContent = () => {
    console.log(`🔄 Rendering content for view: ${currentView}`);
    
    // THIS CHECK HAS PRIORITY - if a course is selected, show course detail
    if (selectedCourse) {
      console.log(`🎓 LearnerLayout - Showing CourseDetail because selectedCourse exists`);
      return <CourseDetail />;
    }
    
    if (currentView === View.Profile) {
      return <ProfilePage />;
    }
    
    if (currentView === View.HelpAndSupport) {
      return <HelpAndSupportView />;
    }
    
    // Only reach this switch if no course is selected
    switch (currentView) {
      case View.Dashboard:
        return <WelcomeDashboard />;
      case View.Courses:
        return <CourseList />;
      case View.Calendar:
        return <CalendarView />;
      default:
        return <WelcomeDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background font-sans text-on-surface">
      <Header />
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        {renderContent()}
      </main>
      <AiChatbot />
    </div>
  );
};

export default LearnerLayout;
