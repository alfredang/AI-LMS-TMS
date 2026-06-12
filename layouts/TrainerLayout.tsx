import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useAppVersion } from '@hooks/useAppVersion';
import { useLms } from '../contexts/LmsContext';
import { View, TrainerPage } from '@app-types';
import CalendarView from '../components/CalendarView';
import CourseList from '../components/CourseList';
import CreateView from '../components/CreateView';
import { ProfilePage } from '@components/ProfilePage';
import { CourseDetail } from '../components/CourseDetail';
import HelpAndSupportView from '../components/HelpAndSupportView';
import TrainerHomePage from '../components/trainer/TrainerHomePage';
import TrainerSidebar from '../components/trainer/TrainerSidebar';
import AssessmentGrading from '../components/trainer/AssessmentGrading';
import PastAttendance from '../components/trainer/PastAttendance';
import PastAssessment from '../components/trainer/PastAssessment';
import EdToolsPage from '../components/trainer/EdToolsPage';
import ProjectMgtToolsPage from '../components/trainer/ProjectMgtToolsPage';
import ProblemSolvingToolsPage from '../components/trainer/ProblemSolvingToolsPage';
import CyberSecurityToolsPage from '../components/trainer/CyberSecurityToolsPage';
import DataAnalyticsToolsPage from '../components/trainer/DataAnalyticsToolsPage';
import MLToolsPage from '../components/trainer/MLToolsPage';
import FinanceToolsPage from '../components/trainer/FinanceToolsPage';
import HRToolsPage from '../components/trainer/HRToolsPage';
import StatToolsPage from '../components/trainer/StatToolsPage';
import DoeToolsPage from '../components/trainer/DoeToolsPage';
import SpcToolsPage from '../components/trainer/SpcToolsPage';
import SustainabilityToolsPage from '../components/trainer/SustainabilityToolsPage';
import NetworkingToolsPage from '../components/trainer/NetworkingToolsPage';
import K8sToolsPage from '../components/trainer/K8sToolsPage';
import BlockchainToolsPage from '../components/trainer/BlockchainToolsPage';
import QuantumToolsPage from '../components/trainer/QuantumToolsPage';
import DesignToolsPage from '../components/trainer/DesignToolsPage';
import LessonDeliveryGuidePage from '../components/trainer/LessonDeliveryGuidePage';
import TrainerGuidesPage from '../components/trainer/TrainerGuidesPage';
import VirtualToolsPage from '../components/trainer/VirtualToolsPage';
import AgenticAIToolsPage from '../components/trainer/AgenticAIToolsPage';
import AssessmentGuidePage from '../components/trainer/AssessmentGuidePage';
import TrainingHoursPage from '../components/trainer/TrainingHoursPage';
import PaymentHistoryPage from '../components/trainer/PaymentHistoryPage';

const TrainerLayout: React.FC = () => {
  const { currentView, trainerPage, selectedCourse } = useLms();
  const appVersion = useAppVersion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
      case TrainerPage.TrainingHours:
        return <TrainingHoursPage />;
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
      case TrainerPage.ProjectMgtTools:
        return <ProjectMgtToolsPage />;
      case TrainerPage.ProblemSolvingTools:
        return <ProblemSolvingToolsPage />;
      case TrainerPage.CyberSecurityTools:
        return <CyberSecurityToolsPage />;
      case TrainerPage.DataAnalyticsTools:
        return <DataAnalyticsToolsPage />;
      case TrainerPage.MLTools:
        return <MLToolsPage />;
      case TrainerPage.FinanceTools:
        return <FinanceToolsPage />;
      case TrainerPage.HRTools:
        return <HRToolsPage />;
      case TrainerPage.StatTools:
        return <StatToolsPage />;
      case TrainerPage.DoeTools:
        return <DoeToolsPage />;
      case TrainerPage.SpcTools:
        return <SpcToolsPage />;
      case TrainerPage.SustainabilityTools:
        return <SustainabilityToolsPage />;
      case TrainerPage.NetworkingTools:
        return <NetworkingToolsPage />;
      case TrainerPage.K8sTools:
        return <K8sToolsPage />;
      case TrainerPage.BlockchainTools:
        return <BlockchainToolsPage />;
      case TrainerPage.QuantumTools:
        return <QuantumToolsPage />;
      case TrainerPage.DesignTools:
        return <DesignToolsPage />;
      case TrainerPage.VirtualTools:
        return <VirtualToolsPage />;
      case TrainerPage.AgenticAITools:
        return <AgenticAIToolsPage />;
      case TrainerPage.TrainerGuides:
        return <TrainerGuidesPage />;
      case TrainerPage.LessonDeliveryGuide:
        return <LessonDeliveryGuidePage variant="physical" />;
      case TrainerPage.VirtualClassGuide:
        return <LessonDeliveryGuidePage variant="virtual" />;
      case TrainerPage.AssessmentGuide:
        return <AssessmentGuidePage />;
      case TrainerPage.PaymentHistory:
        return <PaymentHistoryPage />;
      default:
        return <TrainerHomePage />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Sidebar: icon rail when collapsed, full panel when expanded */}
        <div className="flex flex-shrink-0">
          <aside className={`${isSidebarOpen ? 'w-64' : 'w-14'} bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col h-[calc(100vh-64px)] sticky top-[64px] transition-all duration-200`}>
            {/* Toggle arrow at top */}
            <div className={`flex ${isSidebarOpen ? 'justify-end' : 'justify-center'} px-2 py-2 border-b border-gray-200 dark:border-gray-700`}>
              <button
                onClick={() => setIsSidebarOpen(prev => !prev)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                <svg className={`w-5 h-5 transition-transform ${isSidebarOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <TrainerSidebar collapsed={!isSidebarOpen} />
            </div>
            {isSidebarOpen && <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">version {appVersion}</p>}
          </aside>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
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
