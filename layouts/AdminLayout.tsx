import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

import AiChatbot from '../components/AiChatbot';
import SsgAppSelector from '../components/finance/SsgAppSelector';
import { useLms } from '../contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import { ProfilePage } from '../components/ProfilePage';
import HelpAndSupportView from '../components/HelpAndSupportView';
import { AdminDashboard } from '../components/AdminDashboard';
import CourseList from '../components/CourseList';
import { CourseDetail } from '../components/CourseDetail';
import CourseEditor from '../components/CourseEditor';
import { NavBox, NavBoxProps } from '../components/NavBox';
import { IconName } from '../components/ui/Icon';
import { Icon } from '../components/ui/Icon';
import { Card } from '../components/ui/Card';
import AdminSidebar from '../components/admin/AdminSidebar';
import ViewTrainers from '../components/admin/ViewTrainers';
import FundingValidityView from '../components/admin/FundingValidityView';
import ViewLearners from '../components/admin/ViewLearners';
import OngoingClasses from '../components/admin/OngoingClasses';
import CompletedClasses from '../components/admin/CompletedClasses';
import ClassDetailView from '../components/admin/ClassDetailView';
import { UpcomingClassesTable } from '../components/UpcomingClassesTable';
import { ClassManagerView, AssignTrainerView, AssignStudentView, AddCourseView, AddCourseRunView, AutomationLogsView, AssignTrainerLogsView, TrainerFolderLogsView, AutoCreateCertificatesLogView, BackfillEnrollmentsView, FetchUpcomingEnrolmentsView, CourseRunDateSyncLogsView } from '../components/admin/ClassManagementViews';
import { CreateCertificateView, DeleteCertificateView } from '../components/admin/CertificateManagement';
import { SendCertificateSGView } from '../components/admin/SendCertificateSG';
import { SendCertificateGHView } from '../components/admin/SendCertificateGH';
import { CreateNewClassView } from '../components/admin/CreateNewClassView';
import EnrollLearners from '../components/admin/EnrollLearners';
import SearchPastLearners from '../components/admin/SearchPastLearners';
import {
  ApplyNewGrantView,
  ViewGrantStatusView,
  SubmitAssessmentView,
  UpdateAssessmentView,
  ApplyNewClaimView,
  UploadCourseRunsView,
  SearchGrantView,
  SearchEnrolmentView,
  ViewEnrolmentView,
  SearchCourseRunsView,
  ViewCourseRunView,
  SearchAssessmentsView,
  ViewAssessmentView,
  CancelEnrolmentView,
  UpdateEnrolmentView,
  DeleteCourseRunView,
  UpdateEnrolmentFeesView,
  CourseSessionAttendanceView,
  CourseSessionsView
} from '../components/admin/GrantManagementViews';
import EditCourseRunView from '../components/admin/EditCourseRunView';
import { UploadDirectApplicationView, ViewDirectApplicationView, UpdateDirectApplicationView } from '../components/admin/DirectApplicationViews';
import { BulkUploadEnrolmentView } from '../components/admin/BulkEnrolmentViews';
import TrainerAttendanceDashboard from '../components/trainer/TrainerAttendanceDashboard';
import AdminCalendarView from '../components/admin/AdminCalendarView';
import SchedulerView from '../components/admin/SchedulerView';
import AddSessionsView from '../components/admin/AddSessionsView';
import CourseSessionTimingView from '../components/admin/CourseSessionTimingView';

// Management Dashboard Component
interface ManagementDashboardProps {
  type: 'class' | 'tpg';
}

const ManagementDashboard: React.FC<ManagementDashboardProps> = ({ type }) => {
  const { setAdminPage } = useLms();

  const classManagementLinks: NavBoxProps[] = [
    { title: "View Courses", description: "Browse and manage all course templates.", icon: IconName.BookOpen, onClick: () => setAdminPage(AdminPage.ViewCourses) },
    { title: "View Trainers", description: "View details and assignments for all trainers.", icon: IconName.User, onClick: () => setAdminPage(AdminPage.ViewTrainers) },
    { title: "Funding Validity", description: "Track WSQ course validity dates and renewal planning.", icon: IconName.Calendar, onClick: () => setAdminPage(AdminPage.FundingValidity) },
    { title: "View Learners", description: "View learner profiles, status, and contact details.", icon: IconName.MyAccount, onClick: () => setAdminPage(AdminPage.ViewLearners) },
    { title: "Upcoming Classes", description: "See all scheduled upcoming classes.", icon: IconName.Calendar, onClick: () => setAdminPage(AdminPage.UpcomingClasses) },
    { title: "Ongoing Classes", description: "Monitor classes that are currently in session.", icon: IconName.Clock, onClick: () => setAdminPage(AdminPage.OngoingClasses) },
    { title: "Completed Classes", description: "Review past classes and their records.", icon: IconName.ClipboardCheck, onClick: () => setAdminPage(AdminPage.CompletedClasses) },
    { title: "Create New Class", description: "Schedule a new class run from a course template.", icon: IconName.Add, onClick: () => setAdminPage(AdminPage.CreateNewClass) },
    { title: "Enroll Learners", description: "Add or remove learners from a specific class.", icon: IconName.MyAccount, onClick: () => setAdminPage(AdminPage.EnrollLearners) },
    { title: "Assign Trainer", description: "Assign or change the trainer for a class.", icon: IconName.SwitchProfile, onClick: () => setAdminPage(AdminPage.AssignTrainer) },
  ];

  const tpgManagementLinks: NavBoxProps[] = [
    { title: "Direct Application", description: "Upload and review direct applications before enrolment processing.", icon: IconName.FileText, onClick: () => setAdminPage(AdminPage.TpgDirectApplication) },
    { title: "Course Run", description: "Create, search, view, edit, and upload course runs for SSG workflows.", icon: IconName.Calendar, onClick: () => setAdminPage(AdminPage.TpgCourseRun) },
    { title: "Course Session", description: "Manage session setup, timings, and attendance records for each course run.", icon: IconName.Clock, onClick: () => setAdminPage(AdminPage.TpgCourseSession) },
    { title: "Enrollment", description: "Upload, search, view, and update learner enrolments for course runs.", icon: IconName.MyAccount, onClick: () => setAdminPage(AdminPage.TpgEnrollment) },
    { title: "Grant", description: "Apply, search, and monitor grant submissions and statuses.", icon: IconName.Send, onClick: () => setAdminPage(AdminPage.TpgGrant) },
    { title: "Attendance", description: "Check and manage attendance submissions for all course runs.", icon: IconName.ClipboardCheck, onClick: () => setAdminPage(AdminPage.TpgAttendance) },
    { title: "Assessment", description: "Submit and review learner assessment records and outcomes.", icon: IconName.Upload, onClick: () => setAdminPage(AdminPage.TpgAssessment) },
    { title: "Claims", description: "Submit and manage claims after training and assessment completion.", icon: IconName.DollarSign, onClick: () => setAdminPage(AdminPage.TpgClaims) },
  ];

  const isClass = type === 'class';
  const title = isClass ? 'Class Management' : 'TPG Management';
  const links = isClass ? classManagementLinks : tpgManagementLinks;

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {links.map((link, index) => (
          <NavBox key={index} {...link} />
        ))}
      </div>
    </div>
  );
};

interface AdminSubDashboardProps {
  title: string;
  links: NavBoxProps[];
}

const AdminSubDashboard: React.FC<AdminSubDashboardProps> = ({ title, links }) => (
  <div>
    <h2 className="text-3xl font-bold mb-6 dark:text-white">{title}</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {links.map((link, index) => (
        <NavBox key={index} {...link} />
      ))}
    </div>
  </div>
);

// Convert camelCase enum value → "Title Case" readable label
const formatAdminPageTitle = (page: string): string =>
  page.replace(/([A-Z])/g, ' $1').replace(/^(.)/, c => c.toUpperCase());

const PAGE_LABELS: Partial<Record<AdminPage, string>> = {
  [AdminPage.Dashboard]: 'Admin Dashboard',
  [AdminPage.ClassManagement]: 'Class Management',
  [AdminPage.TpgManagement]: 'TPG Management',
  [AdminPage.TpgDirectApplication]: 'Direct Application',
  [AdminPage.TpgCourseRun]: 'Course Run',
  [AdminPage.TpgCourseSession]: 'Course Session',
  [AdminPage.TpgEnrollment]: 'Enrollment',
  [AdminPage.TpgGrant]: 'Grant',
  [AdminPage.TpgAttendance]: 'Attendance',
  [AdminPage.TpgAssessment]: 'Assessment',
  [AdminPage.TpgClaims]: 'Claims',
  [AdminPage.ViewCourses]: 'View Courses',
  [AdminPage.ViewTrainers]: 'View Trainers',
  [AdminPage.FundingValidity]: 'Funding Validity',
  [AdminPage.ViewLearners]: 'View Learners',
  [AdminPage.UpcomingClasses]: 'Upcoming Classes',
  [AdminPage.OngoingClasses]: 'Ongoing Classes',
  [AdminPage.CompletedClasses]: 'Completed Classes',
  [AdminPage.CreateNewClass]: 'Create New Class',
  [AdminPage.EditClass]: 'Edit Class',
  [AdminPage.EnrollLearners]: 'Enroll Learners',
  [AdminPage.AssignTrainer]: 'Assign Trainer',
  [AdminPage.AddCourse]: 'Add Course',
  [AdminPage.ApplyNewGrant]: 'Apply New Grant',
  [AdminPage.ViewGrantStatus]: 'View Grant Status',
  [AdminPage.SubmitAssessment]: 'Submit Assessment',
  [AdminPage.ApplyNewClaim]: 'Apply New Claim',
  [AdminPage.UploadCourseRuns]: 'Upload Course Runs',
  [AdminPage.UploadEnrolments]: 'Upload Enrolments',
  [AdminPage.SearchGrant]: 'Search Grant',
  [AdminPage.SearchCourseRuns]: 'Search Course Runs',
  [AdminPage.SearchAssessments]: 'Search Assessments',
  [AdminPage.EditCourseRun]: 'Edit Course Run',
  [AdminPage.CancelEnrolment]: 'Cancel Enrolment',
  [AdminPage.UpdateEnrolment]: 'Update Enrolment',
  [AdminPage.DeleteCourseRun]: 'Delete Course Run',
  [AdminPage.ClassDetail]: 'Class Detail',
  [AdminPage.CheckAttendance]: 'Check Attendance',
  [AdminPage.AssignStudent]: 'Assign Learners',
  [AdminPage.SearchPastLearners]: 'Search Past Learners',
  [AdminPage.AutomationLogs]: 'Automation Logging',
  [AdminPage.AssignTrainerLogs]: 'Assign Trainer Log',
  [AdminPage.TrainerFolderLogs]: 'Auto Create Assessment Records Log',
  [AdminPage.CourseRunDateSyncLogs]: 'Course Run Date Sync Log',
  [AdminPage.BackfillEnrollments]: 'Backfill Enrollments',
  [AdminPage.FetchUpcomingEnrolments]: 'Fetch Upcoming Classes Enrolment',
  [AdminPage.CreateCertificate]: 'Create Certificate',
  [AdminPage.DeleteCertificate]: 'Delete Certificate',
  [AdminPage.SendCertificateSG]: 'Send Certificate (SG)',
  [AdminPage.SendCertificateGH]: 'Send Certificate (GH)',
  [AdminPage.Calendar]: 'Calendar',
  [AdminPage.Scheduler]: 'Task Scheduler',
  [AdminPage.AddSessions]: 'Add Sessions',
  [AdminPage.CourseSessionTiming]: 'Course Session Timing',
};

const AdminLayout: React.FC = () => {
  const { currentView, adminPage, selectedCourse, editingCourse, courseEditMode, selectedCourseRunId, editingCourseRun, setAdminPage } = useLms();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

  const tpgSubDashboards: Partial<Record<AdminPage, NavBoxProps[]>> = {
    [AdminPage.TpgDirectApplication]: [
      { title: "Upload Direct Application", description: "Import direct application records into the system.", icon: IconName.Upload, onClick: () => setAdminPage(AdminPage.UploadDirectApplication) },
      { title: "View Direct Application", description: "Review and manage uploaded direct application records.", icon: IconName.Eye, onClick: () => setAdminPage(AdminPage.ViewDirectApplication) },
    ],
    [AdminPage.TpgCourseRun]: [
      { title: "Create New Class", description: "Create a new course run for TPG workflows.", icon: IconName.Add, onClick: () => setAdminPage(AdminPage.CreateNewClass) },
      { title: "Search Course Runs", description: "Search existing course runs by code, title, or schedule.", icon: IconName.Search, onClick: () => setAdminPage(AdminPage.SearchCourseRuns) },
      { title: "View Course Run", description: "Open the course run detail view.", icon: IconName.Eye, onClick: () => setAdminPage(AdminPage.ViewCourseRun) },
      { title: "Edit Course Run", description: "Update course run details and trainer assignments.", icon: IconName.Create, onClick: () => setAdminPage(AdminPage.EditCourseRun) },
      { title: "Upload Course Runs", description: "Bulk upload course runs to SSG using Excel.", icon: IconName.FileText, onClick: () => setAdminPage(AdminPage.UploadCourseRuns) },
      { title: "Delete Course Run", description: "Remove an uploaded course run record.", icon: IconName.Delete, onClick: () => setAdminPage(AdminPage.DeleteCourseRun) },
    ],
    [AdminPage.TpgCourseSession]: [
      { title: "Add Sessions", description: "Create the session schedule for a course run.", icon: IconName.Add, onClick: () => setAdminPage(AdminPage.AddSessions) },
      { title: "Course Sessions", description: "Review the full session list for each course run.", icon: IconName.Calendar, onClick: () => setAdminPage(AdminPage.CourseSessions) },
      { title: "Course Session Attendance", description: "Check session-level attendance details.", icon: IconName.ClipboardCheck, onClick: () => setAdminPage(AdminPage.CourseSessionAttendance) },
    ],
    [AdminPage.TpgEnrollment]: [
      { title: "Enroll Learners", description: "Assign learners to a course run.", icon: IconName.MyAccount, onClick: () => setAdminPage(AdminPage.EnrollLearners) },
      { title: "Upload Enrolments", description: "Bulk upload enrolments using Excel.", icon: IconName.FileText, onClick: () => setAdminPage(AdminPage.UploadEnrolments) },
      { title: "Search Enrolment", description: "Search enrolment records by learner or class.", icon: IconName.Search, onClick: () => setAdminPage(AdminPage.SearchEnrolment) },
      { title: "View Enrolment", description: "Open the detailed enrolment record.", icon: IconName.Eye, onClick: () => setAdminPage(AdminPage.ViewEnrolment) },
      { title: "Update Enrolment", description: "Edit learner enrolment details.", icon: IconName.Create, onClick: () => setAdminPage(AdminPage.UpdateEnrolment) },
      { title: "Cancel Enrolment", description: "Cancel an enrolment that should not proceed.", icon: IconName.Delete, onClick: () => setAdminPage(AdminPage.CancelEnrolment) },
      { title: "Update Enrolment Fees", description: "Adjust the fee details for a learner enrolment.", icon: IconName.DollarSign, onClick: () => setAdminPage(AdminPage.UpdateEnrolmentFees) },
    ],
    [AdminPage.TpgGrant]: [
      { title: "Search Grant", description: "Search submitted grants by reference ID.", icon: IconName.Search, onClick: () => setAdminPage(AdminPage.SearchGrant) },
      { title: "View Grant Status", description: "Review grant submission statuses.", icon: IconName.Eye, onClick: () => setAdminPage(AdminPage.ViewGrantStatus) },
    ],
    [AdminPage.TpgAttendance]: [
      { title: "Check Attendance", description: "View and manage e-attendance for course runs.", icon: IconName.ClipboardCheck, onClick: () => setAdminPage(AdminPage.CheckAttendance) },
    ],
    [AdminPage.TpgAssessment]: [
      { title: "Submit Assessment", description: "Submit learner assessment results to TPG.", icon: IconName.Upload, onClick: () => setAdminPage(AdminPage.SubmitAssessment) },
      { title: "Update Assessment", description: "Update previously submitted assessment results.", icon: IconName.Create, onClick: () => setAdminPage(AdminPage.UpdateAssessment) },
      { title: "Search Assessments", description: "Search assessment records and submission history.", icon: IconName.Search, onClick: () => setAdminPage(AdminPage.SearchAssessments) },
      { title: "View Assessment", description: "Open a submitted assessment record.", icon: IconName.Eye, onClick: () => setAdminPage(AdminPage.ViewAssessment) },
    ],
    [AdminPage.TpgClaims]: [
      { title: "Apply New Claim", description: "Submit a new claim after training and assessment completion.", icon: IconName.DollarSign, onClick: () => setAdminPage(AdminPage.ApplyNewClaim) },
    ],
  };

  // Handle full-width views (Profile and Help & Support only)
  if (currentView === View.Profile || currentView === View.HelpAndSupport) {
    return (
      <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
        <Header />
        <main className="container mx-auto p-4 sm:p-6 lg:p-8 flex-grow">
          {currentView === View.Profile ? <ProfilePage /> : <HelpAndSupportView />}
        </main>
        <Footer />
        <AiChatbot />
      </div>
    );
  }

  // For all other admin views, show the sidebar layout

  const renderContent = () => {
    // Handle course editing state (similar to DeveloperLayout)
    if (editingCourse) {
      return <CourseEditor />;
    }

    // Handle course detail view (similar to DeveloperLayout)
    if (selectedCourse && (adminPage === AdminPage.ViewCourses)) {
      return <CourseDetail />;
    }

    // Handle admin page routing
    switch (adminPage) {
      case AdminPage.Dashboard:
        return <AdminDashboard />;
      case AdminPage.ClassManagement:
        return <ManagementDashboard type="class" />;
      case AdminPage.TpgManagement:
        return <ManagementDashboard type="tpg" />;
      case AdminPage.TpgDirectApplication:
      case AdminPage.TpgCourseRun:
      case AdminPage.TpgCourseSession:
      case AdminPage.TpgEnrollment:
      case AdminPage.TpgGrant:
      case AdminPage.TpgAttendance:
      case AdminPage.TpgAssessment:
      case AdminPage.TpgClaims:
        return <AdminSubDashboard title={PAGE_LABELS[adminPage] || formatAdminPageTitle(adminPage)} links={tpgSubDashboards[adminPage] || []} />;
      case AdminPage.ViewCourses:
        return <CourseList />;
      case AdminPage.ViewTrainers:
        return <ViewTrainers />;
      case AdminPage.FundingValidity:
        return <FundingValidityView />;
      case AdminPage.ViewLearners:
        return <ViewLearners />;
      case AdminPage.UpcomingClasses:
        return <UpcomingClassesTable showTitle={true} showFilters={true} />;
      case AdminPage.OngoingClasses:
        return <OngoingClasses />;
      case AdminPage.CompletedClasses:
        return <CompletedClasses />;
      case AdminPage.CreateNewClass:
        return <CreateNewClassView />;
      case AdminPage.EditClass:
        return <ClassManagerView courseToEdit={editingCourseRun} />;
      case AdminPage.EnrollLearners:
        return <EnrollLearners />;
      case AdminPage.AssignTrainer:
        return <AssignTrainerView />;
      case AdminPage.AssignStudent:
        return <AssignStudentView />;
      case AdminPage.SearchPastLearners:
        return <SearchPastLearners />;
      case AdminPage.AddCourse:
        return <AddCourseView />;
      case AdminPage.AddCourseRun:
        return <AddCourseRunView />;
      case AdminPage.ApplyNewGrant:
        return <ApplyNewGrantView />;
      case AdminPage.SearchGrant:
        return <SearchGrantView />;
      case AdminPage.SearchEnrolment:
        return <SearchEnrolmentView />;
      case AdminPage.ViewEnrolment:
        return <ViewEnrolmentView />;
      case AdminPage.ViewGrantStatus:
        return <ViewGrantStatusView />;
      case AdminPage.SubmitAssessment:
        return <SubmitAssessmentView />;
      case AdminPage.UpdateAssessment:
        return <UpdateAssessmentView />;
      case AdminPage.UpdateEnrolmentFees:
        return <UpdateEnrolmentFeesView />;
      case AdminPage.ApplyNewClaim:
        return <ApplyNewClaimView />;
      case AdminPage.UploadCourseRuns:
        return <UploadCourseRunsView />;
      case AdminPage.UploadEnrolments:
        return <BulkUploadEnrolmentView />;
      case AdminPage.SearchCourseRuns:
        return <SearchCourseRunsView />;
      case AdminPage.ViewCourseRun:
        return <ViewCourseRunView />;
      case AdminPage.EditCourseRun:
        return <EditCourseRunView />;
      case AdminPage.SearchAssessments:
        return <SearchAssessmentsView />;
      case AdminPage.ViewAssessment:
        return <ViewAssessmentView />;
      case AdminPage.CancelEnrolment:
        return <CancelEnrolmentView />;
      case AdminPage.UpdateEnrolment:
        return <UpdateEnrolmentView />;
      case AdminPage.DeleteCourseRun:
        return <DeleteCourseRunView />;
      case AdminPage.CourseSessionAttendance:
        return <CourseSessionAttendanceView />;
      case AdminPage.CourseSessions:
        return <CourseSessionsView />;
      case AdminPage.AddSessions:
        return <AddSessionsView />;
      case AdminPage.CourseSessionTiming:
        return <CourseSessionTimingView />;
      case AdminPage.ClassDetail:
        return <ClassDetailView courseRunId={selectedCourseRunId || undefined} />;
      case AdminPage.UploadDirectApplication:
        return <UploadDirectApplicationView />;
      case AdminPage.ViewDirectApplication:
        return <ViewDirectApplicationView />;
      case AdminPage.UpdateDirectApplication:
        return <UpdateDirectApplicationView />;
      case AdminPage.CheckAttendance:
        return (
          <div className="max-w-4xl mx-auto">
            <TrainerAttendanceDashboard isAdminMode />
          </div>
        );
      case AdminPage.AutomationLogs:
        return <AutomationLogsView />;
      case AdminPage.AssignTrainerLogs:
        return <AssignTrainerLogsView />;
      case AdminPage.TrainerFolderLogs:
        return <TrainerFolderLogsView />;
      case AdminPage.AutoCreateCertificatesLog:
        return <AutoCreateCertificatesLogView />;
      case AdminPage.CourseRunDateSyncLogs:
        return <CourseRunDateSyncLogsView />;
      case AdminPage.BackfillEnrollments:
        return <BackfillEnrollmentsView />;
      case AdminPage.FetchUpcomingEnrolments:
        return <FetchUpcomingEnrolmentsView />;
      case AdminPage.CreateCertificate:
        return <CreateCertificateView />;
      case AdminPage.DeleteCertificate:
        return <DeleteCertificateView />;
      case AdminPage.SendCertificateSG:
        return <SendCertificateSGView />;
      case AdminPage.SendCertificateGH:
        return <SendCertificateGHView />;
      case AdminPage.Calendar:
        return <AdminCalendarView />;
      case AdminPage.Scheduler:
        return <SchedulerView />;
      default:
        return <AdminDashboard />;
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
          {editingCourse
            ? (courseEditMode === 'create' ? 'Create Course' : courseEditMode === 'view' ? 'Course Info' : 'Edit Course')
            : (selectedCourse && adminPage === AdminPage.ViewCourses
                ? 'Course Detail'
                : (PAGE_LABELS[adminPage] ?? formatAdminPageTitle(adminPage)))}
        </h2>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setIsSidebarOpen(false)}
          />

          {/* Sidebar Panel */}
          <div className="relative flex flex-col w-72 max-w-[calc(100%-3rem)] h-full bg-surface shadow-xl">
            <div className="p-4 flex justify-between items-center border-b">
              <h3 className="font-bold">Admin Menu</h3>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 -mr-2 text-gray-600 hover:text-gray-900"
              >
                <Icon name={IconName.Close} className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AdminSidebar onNavigate={() => setIsSidebarOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Desktop Sidebar - toggled by hamburger button */}
        <aside className={`${isDesktopSidebarOpen ? 'hidden md:flex' : 'hidden'} w-64 flex-shrink-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700`}>
          <div className="w-full">
            <AdminSidebar />
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className={`container mx-auto px-4 sm:px-6 lg:px-8 ${editingCourse ? 'pt-3 pb-8' : 'py-8'}`}>
            {[AdminPage.CreateNewClass, AdminPage.SearchCourseRuns, AdminPage.ViewCourseRun, AdminPage.EditCourseRun, AdminPage.UploadCourseRuns, AdminPage.DeleteCourseRun, AdminPage.AddSessions, AdminPage.CourseSessionTiming, AdminPage.CourseSessions, AdminPage.EnrollLearners, AdminPage.UploadEnrolments, AdminPage.SearchEnrolment, AdminPage.ViewEnrolment, AdminPage.UpdateEnrolment, AdminPage.CancelEnrolment, AdminPage.UpdateEnrolmentFees, AdminPage.CourseSessionAttendance, AdminPage.CheckAttendance, AdminPage.SubmitAssessment, AdminPage.UpdateAssessment, AdminPage.SearchAssessments, AdminPage.ViewAssessment, AdminPage.SearchGrant, AdminPage.ViewGrantStatus].includes(adminPage) && <SsgAppSelector />}
            {renderContent()}
          </div>
        </main>
      </div>

      <Footer />
      <AiChatbot />
    </div>
  );
};

export default AdminLayout;
