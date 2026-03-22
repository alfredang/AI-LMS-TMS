import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useLms } from '../contexts/LmsContext';
import { View } from '@app-types';
import CourseList from '../components/CourseList';
import CreateView from '../components/CreateView';
import CourseEditor from '../components/CourseEditor';
import { CourseDetail } from '../components/CourseDetail';
import ProfileView from '../components/ProfileView';
import HelpAndSupportView from '../components/HelpAndSupportView';

const DeveloperLayout: React.FC = () => {
  const { currentView, selectedCourse, editingCourse, setEditingCourse } = useLms();

  const renderContent = () => {
    if (currentView === View.Profile) {
      return <ProfileView />;
    }
    if (currentView === View.HelpAndSupport) {
      return <HelpAndSupportView />;
    }
    if (editingCourse) {
      return <CourseEditor />;
    }
    if (selectedCourse) {
      return <CourseDetail />;
    }
    switch (currentView) {
      case View.Dashboard:
        return <CourseList />; // Default view for developer is course list
      case View.Courses:
        return <CourseList />;
      case View.Create:
        return <CreateView />;
      default:
        return <CourseList />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />
      <div className="flex flex-grow">
        {/* Main content area */}
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
          {renderContent()}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default DeveloperLayout;