import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import AiChatbot from '../components/AiChatbot';
import { useLms } from '../contexts/LmsContext';
import { View } from '@app-types';
import TrainingProviderDashboard from '../components/TrainingProviderDashboard';
import CourseList from '../components/CourseList';
import ProfileView from '../components/ProfileView';
import { CourseDetail } from '../components/CourseDetail';
import { Icon, IconName } from '../components/ui/Icon';
import HelpAndSupportView from '../components/HelpAndSupportView';

const TrainingProviderLayout: React.FC = () => {
  const { currentView, selectedCourse } = useLms();

  console.log(`🎯 TrainingProviderLayout - Current View: ${currentView}`);
  console.log(`📋 TrainingProviderLayout - Selected Course: ${selectedCourse}`);

  const renderContent = () => {
    console.log(`🔄 Rendering content for view: ${currentView}`);
    
    // If a course is selected, show course detail
    if (selectedCourse) {
      console.log(`🎓 TrainingProviderLayout - Showing CourseDetail because selectedCourse exists`);
      return <CourseDetail />;
    }
    
    if (currentView === View.Profile) {
      return <ProfileView />;
    }
    
    if (currentView === View.HelpAndSupport) {
      return <HelpAndSupportView />;
    }
    
    // Default views when no course is selected
    switch (currentView) {
      case View.Dashboard:
        return <TrainingProviderDashboard />;
      case View.Courses:
        return <CourseList />;
      default:
        return <TrainingProviderDashboard />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />
      {selectedCourse && (
        <div className="lg:hidden flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-gray-200 bg-surface">
            <button onClick={() => {/* TODO: Implement mobile menu */}} className="p-2 -ml-2 text-gray-600 hover:text-gray-900">
                <Icon name={IconName.Menu} className="w-6 h-6" />
            </button>
            <h2 className="text-lg font-bold truncate">{selectedCourse.title}</h2>
        </div>
      )}
      <main className="container mx-auto p-4 sm:p-6 lg:p-8 flex-grow">
        {renderContent()}
      </main>
      <Footer />
      <AiChatbot />
    </div>
  );
};

export default TrainingProviderLayout;