import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import AiChatbot from '../components/AiChatbot';
import { useAppVersion } from '@hooks/useAppVersion';
import { useLms } from '../contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import TrainingProviderDashboard from '../components/TrainingProviderDashboard';
import CourseList from '../components/CourseList';
import ProfileView from '../components/ProfileView';
import { CourseDetail } from '../components/CourseDetail';
import { Icon, IconName } from '../components/ui/Icon';
import HelpAndSupportView from '../components/HelpAndSupportView';
import UserManagementView from '../components/training-provider/UserManagementView';
import AdminManagementView from '../components/training-provider/AdminManagementView';
import ApiEndpointsView from '../components/training-provider/ApiEndpointsView';
import DocumentsView from '../components/training-provider/DocumentsView';
import PrivacyPolicyView from '../components/training-provider/PrivacyPolicyView';
import AcceptableUsePolicyView from '../components/training-provider/AcceptableUsePolicyView';
import OtpEmailTemplateView from '../components/training-provider/OtpEmailTemplateView';
import CertificateEmailTemplateView from '../components/training-provider/CertificateEmailTemplateView';
import FeedbackEmailTemplateView from '../components/training-provider/FeedbackEmailTemplateView';
import PasswordResetEmailTemplateView from '../components/training-provider/PasswordResetEmailTemplateView';
import TrainerInvitationEmailTemplateView from '../components/training-provider/TrainerInvitationEmailTemplateView';
import FinalCourseConfirmationEmailTemplateView from '../components/training-provider/FinalCourseConfirmationEmailTemplateView';
import CourseConfirmationEmailTemplateView from '../components/training-provider/CourseConfirmationEmailTemplateView';
import CoursewareAttendanceEmailTemplateView from '../components/training-provider/CoursewareAttendanceEmailTemplateView';
import ProformaInvoiceEmailTemplateView from '../components/training-provider/templates/ProformaInvoiceEmailTemplateView';
import FinanceManagementView from '../components/training-provider/FinanceManagementView';
import TrainingProviderSidebar from '../components/training-provider/TrainingProviderSidebar';
import SchedulerView from '../components/admin/SchedulerView';
import SchedulerSummaryView from '../components/admin/SchedulerSummaryView';
import { AutomationLogsView, TrainerFolderLogsView, CourseRunDateSyncLogsView, UpcomingCourseRunsLogView, CourseConfirmationEmailLogsView, AutoSendTrainerInvitationLogView, AutoSanitiseDataLogView, AutoCreateCertificatesLogView, SyncTrainerTpgLogsView } from '../components/admin/ClassManagementViews';
import TrainerResponseEmailTemplatesView from '../components/training-provider/TrainerResponseEmailTemplatesView';
import WorkflowGuidesView from '../components/training-provider/WorkflowGuidesView';
import WebhooksView from '../components/training-provider/WebhooksView';
import SsgApiSummaryView from '../components/training-provider/SsgApiSummaryView';
import { Card } from '../components/ui/Card';

const TrainingProviderLayout: React.FC = () => {
  const { currentView, selectedCourse, adminPage, setAdminPage } = useLms();
  const appVersion = useAppVersion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const renderContent = () => {
    // If a course is selected, show course detail
    if (selectedCourse) {
      return <CourseDetail />;
    }

    // Handle scheduler log pages (shared with admin layout)
    if (currentView === View.Scheduler) {
      switch (adminPage) {
        case AdminPage.AutomationLogs: return <AutomationLogsView />;
        case AdminPage.TrainerFolderLogs: return <TrainerFolderLogsView />;
        case AdminPage.AutoCreateCertificatesLog: return <AutoCreateCertificatesLogView />;
        case AdminPage.CourseRunDateSyncLogs: return <CourseRunDateSyncLogsView />;
        case AdminPage.UpcomingCourseRunsLog: return <UpcomingCourseRunsLogView />;
        case AdminPage.SyncTrainerTpgLogs: return <SyncTrainerTpgLogsView />;
        case AdminPage.CourseConfirmationEmailLogs: return <CourseConfirmationEmailLogsView />;
        case AdminPage.AutoSendTrainerInvitationLog: return <AutoSendTrainerInvitationLogView />;
        case AdminPage.AutoSanitiseDataLog: return <AutoSanitiseDataLogView />;
      }
    }

    switch (currentView) {
      case View.Dashboard:
        return <TrainingProviderDashboard />;
      case View.Courses:
        return <CourseList />;
      case View.UserManagement:
        return <UserManagementView />;
      case View.AdminManagement:
        return <AdminManagementView />;
      case View.Profile:
        return <ProfileView />;
      case View.HelpAndSupport:
        return <HelpAndSupportView />;
      case View.ApiEndpoints:
        return <ApiEndpointsView />;
      case View.Documents:
        return <DocumentsView />;
      case View.PrivacyPolicy:
        return <PrivacyPolicyView />;
      case View.AcceptableUsePolicy:
        return <AcceptableUsePolicyView />;
      case View.OtpEmailTemplate:
        return <OtpEmailTemplateView />;
      case View.CertificateEmailTemplate:
        return <CertificateEmailTemplateView />;
      case View.FeedbackEmailTemplate:
        return <FeedbackEmailTemplateView />;
      case View.PasswordResetEmailTemplate:
        return <PasswordResetEmailTemplateView />;
      case View.TrainerInvitationEmailTemplate:
        return <TrainerInvitationEmailTemplateView />;
      case View.TrainerResponseEmailTemplates:
        return <TrainerResponseEmailTemplatesView />;
      case View.WorkflowGuides:
        return <WorkflowGuidesView initialWorkflowId={selectedWorkflowId || undefined} />;
      case View.FinalCourseConfirmationEmailTemplate:
        return <FinalCourseConfirmationEmailTemplateView />;
      case View.CourseConfirmationEmailTemplate:
        return <CourseConfirmationEmailTemplateView />;
      case View.CoursewareAttendanceEmailTemplate:
        return <CoursewareAttendanceEmailTemplateView />;
      case View.ProformaInvoiceEmailTemplate:
        return <ProformaInvoiceEmailTemplateView />;
      case View.FinanceManagement:
        return <FinanceManagementView />;
      case View.Scheduler:
        return <SchedulerView />;
      case View.SchedulerSummary:
        return <SchedulerSummaryView />;
      case View.Webhooks:
        return <WebhooksView />;
      case View.SsgApiSummary:
        return <SsgApiSummaryView />;
      default:
        return <TrainingProviderDashboard />;
    }
  };

  // Get current page title for mobile header
  const getPageTitle = () => {
    if (selectedCourse) return selectedCourse.title;
    switch (currentView) {
      case View.Dashboard: return 'Dashboard';
      case View.Courses: return 'Courses';
      case View.UserManagement: return 'User Management';
      case View.AdminManagement: return 'Role Management';
      case View.Profile: return 'Company Setting';
      case View.HelpAndSupport: return 'Help & Support';
      case View.ApiEndpoints: return 'API Endpoints';
      case View.Documents: return 'Documents';
      case View.PrivacyPolicy: return 'Privacy Policy';
      case View.AcceptableUsePolicy: return 'Acceptable Use Policy';
      case View.OtpEmailTemplate: return 'OTP Email Template';
      case View.CertificateEmailTemplate: return 'Certificate Email Template';
      case View.FeedbackEmailTemplate: return 'Feedback Email Template';
      case View.PasswordResetEmailTemplate: return 'Password Reset Email Template';
      case View.TrainerInvitationEmailTemplate: return 'Trainer Invitation Email Template';
      case View.TrainerResponseEmailTemplates: return 'Trainer Accept/Decline Email Templates';
      case View.WorkflowGuides: return 'Workflow Guides';
      case View.FinalCourseConfirmationEmailTemplate: return 'Final Course Confirmation Email Template';
      case View.CourseConfirmationEmailTemplate: return 'Course Confirmation Email Template';
      case View.CoursewareAttendanceEmailTemplate: return 'Courseware and Attendance Taking Email Template';
      case View.ProformaInvoiceEmailTemplate: return 'Proforma Invoice Email Template';
      case View.FinanceManagement: return 'Finance Management';
      case View.Scheduler: return 'Task Scheduler';
      case View.SchedulerSummary: return 'Schedule Summary';
      case View.Webhooks: return 'Webhooks';
      case View.SsgApiSummary: return 'SSG API Summary';
      default: return 'Dashboard';
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Sidebar: collapsible */}
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
              {isSidebarOpen && <TrainingProviderSidebar onSelectWorkflow={setSelectedWorkflowId} />}
            </div>
            {isSidebarOpen && <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">version {appVersion}</p>}
          </aside>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {renderContent()}
          </div>
        </main>
      </div>

      <Footer />
      <AiChatbot />
    </div>
  );
};

export default TrainingProviderLayout;