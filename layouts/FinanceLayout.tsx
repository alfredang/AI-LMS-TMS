import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import AiChatbot from '../components/AiChatbot';
import { Icon, IconName } from '../components/ui/Icon';
import FinanceManagementView from '../components/training-provider/FinanceManagementView';
import AllCourseRunsView from '../components/finance/AllCourseRunsView';
import {
  SearchGrantView,
  ViewGrantStatusView,
  SubmitAssessmentView,
  UpdateAssessmentView,
  UploadCourseRunsView,
  SearchCourseRunsView,
  SearchEnrolmentView,
  ViewEnrolmentView,
  ViewCourseRunView,
  SearchAssessmentsView,
  ViewAssessmentView,
  CancelEnrolmentView,
  UpdateEnrolmentView,
  DeleteCourseRunView,
  UpdateEnrolmentFeesView,
  CourseSessionAttendanceView,
  CourseSessionsView,
} from '../components/admin/GrantManagementViews';
import { CreateNewClassView } from '../components/admin/CreateNewClassView';
import EditCourseRunView from '../components/admin/EditCourseRunView';
import AddSessionsView from '../components/admin/AddSessionsView';
import CourseSessionTimingView from '../components/admin/CourseSessionTimingView';
import EnrollLearners from '../components/admin/EnrollLearners';
import { BulkUploadEnrolmentView } from '../components/admin/BulkEnrolmentViews';
import TrainerAttendanceDashboard from '../components/trainer/TrainerAttendanceDashboard';

import ClaimCheckView from '../components/training-provider/ClaimCheckView';
import GrantCalculatorView from '../components/finance/GrantCalculatorView';
import ViewClaimView from '../components/finance/ViewClaimView';
import CancelClaimView from '../components/finance/CancelClaimView';
import UploadDocumentView from '../components/finance/UploadDocumentView';

import { ProfilePage } from '../components/ProfilePage';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types/index';

type FinancePage =
  | 'dashboard' | 'allCourseRuns'
  | 'grantCalculator' | 'searchGrant' | 'viewGrant'
  | 'claimCheck' | 'viewClaim' | 'cancelClaim' | 'uploadDocument'
  // TPG Management
  | 'tpgCreateClass' | 'tpgSearchCourseRuns' | 'tpgViewCourseRun' | 'tpgEditCourseRun' | 'tpgUploadCourseRuns' | 'tpgDeleteCourseRun'
  | 'tpgAddSessions' | 'tpgSessionTiming' | 'tpgCourseSessions'
  | 'tpgEnrollLearners' | 'tpgUploadEnrolments' | 'tpgSearchEnrolment' | 'tpgViewEnrolment' | 'tpgUpdateEnrolment' | 'tpgCancelEnrolment' | 'tpgUpdateEnrolmentFees'
  | 'tpgSessionAttendance' | 'tpgCheckAttendance'
  | 'tpgSubmitAssessment' | 'tpgUpdateAssessment' | 'tpgSearchAssessments' | 'tpgViewAssessment'
  | 'tpgSearchGrant' | 'tpgViewGrantStatus';

const FinanceLayout: React.FC = () => {
  const { currentView } = useLms();
  const [page, setPage] = useState<FinancePage>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    claimManagement: true,
    tpgManagement: false,
    tpgCourseRun: false,
    tpgSession: false,
    tpgEnrolment: false,
    tpgAttendance: false,
    tpgAssessment: false,
    tpgGrant: false,
    usefulLinks: true,
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setIsDesktopSidebarCollapsed(prev => !prev);
    } else {
      setIsMobileSidebarOpen(true);
    }
  };

  const navigateTo = (p: FinancePage) => {
    setPage(p);
    setIsMobileSidebarOpen(false);
  };

  const renderContent = () => {
    switch (page) {
      case 'allCourseRuns':
        return <AllCourseRunsView />;
      case 'grantCalculator':
        return <GrantCalculatorView />;
      case 'searchGrant':
        return <SearchGrantView />;
      case 'viewGrant':
        return <ViewGrantStatusView />;
      case 'claimCheck':
        return <ClaimCheckView />;
      case 'viewClaim':
        return <ViewClaimView />;
      case 'cancelClaim':
        return <CancelClaimView />;
      case 'uploadDocument':
        return <UploadDocumentView />;
      // TPG Management — Course Run
      case 'tpgCreateClass': return <CreateNewClassView />;
      case 'tpgSearchCourseRuns': return <SearchCourseRunsView />;
      case 'tpgViewCourseRun': return <ViewCourseRunView />;
      case 'tpgEditCourseRun': return <EditCourseRunView />;
      case 'tpgUploadCourseRuns': return <UploadCourseRunsView />;
      case 'tpgDeleteCourseRun': return <DeleteCourseRunView />;
      // TPG Management — Session
      case 'tpgAddSessions': return <AddSessionsView />;
      case 'tpgSessionTiming': return <CourseSessionTimingView />;
      case 'tpgCourseSessions': return <CourseSessionsView />;
      // TPG Management — Enrolment
      case 'tpgEnrollLearners': return <EnrollLearners />;
      case 'tpgUploadEnrolments': return <BulkUploadEnrolmentView />;
      case 'tpgSearchEnrolment': return <SearchEnrolmentView />;
      case 'tpgViewEnrolment': return <ViewEnrolmentView />;
      case 'tpgUpdateEnrolment': return <UpdateEnrolmentView />;
      case 'tpgCancelEnrolment': return <CancelEnrolmentView />;
      case 'tpgUpdateEnrolmentFees': return <UpdateEnrolmentFeesView />;
      // TPG Management — Attendance
      case 'tpgSessionAttendance': return <CourseSessionAttendanceView />;
      case 'tpgCheckAttendance': return <div className="max-w-6xl mx-auto"><TrainerAttendanceDashboard /></div>;
      // TPG Management — Assessment
      case 'tpgSubmitAssessment': return <SubmitAssessmentView />;
      case 'tpgUpdateAssessment': return <UpdateAssessmentView />;
      case 'tpgSearchAssessments': return <SearchAssessmentsView />;
      case 'tpgViewAssessment': return <ViewAssessmentView />;
      // TPG Management — Grant
      case 'tpgSearchGrant': return <SearchGrantView />;
      case 'tpgViewGrantStatus': return <ViewGrantStatusView />;
      default:
        return <FinanceManagementView />;
    }
  };

  const getPageTitle = () => {
    switch (page) {
      case 'allCourseRuns': return 'All Course Runs';
      case 'grantCalculator': return 'Grant Calculator';
      case 'searchGrant': return 'Search Grant';
      case 'viewGrant': return 'View Grant';
      case 'claimCheck': return 'Check / Add Claim';
      case 'viewClaim': return 'View Claim';
      case 'cancelClaim': return 'Cancel Claim';
      case 'uploadDocument': return 'Upload Supporting Document';
      case 'tpgCreateClass': return 'Create New Class';
      case 'tpgSearchCourseRuns': return 'Search Course Runs';
      case 'tpgViewCourseRun': return 'View Course Run';
      case 'tpgEditCourseRun': return 'Edit Course Run';
      case 'tpgUploadCourseRuns': return 'Upload Course Runs';
      case 'tpgDeleteCourseRun': return 'Delete Course Run';
      case 'tpgAddSessions': return 'Add Sessions';
      case 'tpgSessionTiming': return 'Session Timing';
      case 'tpgCourseSessions': return 'Course Sessions';
      case 'tpgEnrollLearners': return 'Enroll Learners';
      case 'tpgUploadEnrolments': return 'Upload Enrolments';
      case 'tpgSearchEnrolment': return 'Search Enrolment';
      case 'tpgViewEnrolment': return 'View Enrolment';
      case 'tpgUpdateEnrolment': return 'Update Enrolment';
      case 'tpgCancelEnrolment': return 'Cancel Enrolment';
      case 'tpgUpdateEnrolmentFees': return 'Update Enrolment Fees';
      case 'tpgSessionAttendance': return 'Session Attendance';
      case 'tpgCheckAttendance': return 'Check Attendance';
      case 'tpgSubmitAssessment': return 'Submit Assessment';
      case 'tpgUpdateAssessment': return 'Update Assessment';
      case 'tpgSearchAssessments': return 'Search Assessments';
      case 'tpgViewAssessment': return 'View Assessment';
      case 'tpgSearchGrant': return 'Search Grant';
      case 'tpgViewGrantStatus': return 'View Grant Status';
      default: return 'Finance Management';
    }
  };

  const activeClass = 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500';
  const inactiveClass = 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white';

  const NavItem = ({ target, label, isSubItem = false }: { target: FinancePage; label: string; isSubItem?: boolean }) => (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); navigateTo(target); }}
      className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isSubItem ? 'pl-8' : ''} ${
        page === target ? activeClass : inactiveClass
      }`}
    >
      {label}
    </a>
  );

  const NavSection = ({ title, sectionKey, children }: { title: string; sectionKey: string; children: React.ReactNode }) => (
    <div>
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between px-3 py-1 group cursor-pointer"
      >
        <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">{title}</h3>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${openSections[sectionKey] ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {openSections[sectionKey] && (
        <div className="mt-2 space-y-1">
          {children}
        </div>
      )}
    </div>
  );

  const SubSection = ({ title, sectionKey, children }: { title: string; sectionKey: string; children: React.ReactNode }) => (
    <div>
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between pl-8 pr-3 py-1.5 group cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md"
      >
        <span className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wider">{title}</span>
        <svg
          className={`w-3 h-3 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${openSections[sectionKey] ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {openSections[sectionKey] && <div className="space-y-1">{children}</div>}
    </div>
  );

  const sidebarContent = (
    <nav className="space-y-6 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
      <NavItem target="dashboard" label="Dashboard" />
      <NavItem target="allCourseRuns" label="All Course Runs" />

      <NavSection title="TPG Management" sectionKey="tpgManagement">
        <SubSection title="Course Run" sectionKey="tpgCourseRun">
          <NavItem target="tpgCreateClass" label="Create New Class" isSubItem />
          <NavItem target="tpgSearchCourseRuns" label="Search Course Runs" isSubItem />
          <NavItem target="tpgViewCourseRun" label="View Course Run" isSubItem />
          <NavItem target="tpgEditCourseRun" label="Edit Course Run" isSubItem />
          <NavItem target="tpgUploadCourseRuns" label="Upload Course Runs" isSubItem />
          <NavItem target="tpgDeleteCourseRun" label="Delete Course Run" isSubItem />
        </SubSection>

        <SubSection title="Session" sectionKey="tpgSession">
          <NavItem target="tpgAddSessions" label="Add Sessions" isSubItem />
          <NavItem target="tpgSessionTiming" label="Session Timing" isSubItem />
          <NavItem target="tpgCourseSessions" label="Course Sessions" isSubItem />
        </SubSection>

        <SubSection title="Enrolment" sectionKey="tpgEnrolment">
          <NavItem target="tpgEnrollLearners" label="Enroll Learners" isSubItem />
          <NavItem target="tpgUploadEnrolments" label="Upload Enrolments" isSubItem />
          <NavItem target="tpgSearchEnrolment" label="Search Enrolment" isSubItem />
          <NavItem target="tpgViewEnrolment" label="View Enrolment" isSubItem />
          <NavItem target="tpgUpdateEnrolment" label="Update Enrolment" isSubItem />
          <NavItem target="tpgCancelEnrolment" label="Cancel Enrolment" isSubItem />
          <NavItem target="tpgUpdateEnrolmentFees" label="Update Enrolment Fees" isSubItem />
        </SubSection>

        <SubSection title="Attendance" sectionKey="tpgAttendance">
          <NavItem target="tpgSessionAttendance" label="Session Attendance" isSubItem />
          <NavItem target="tpgCheckAttendance" label="Check Attendance" isSubItem />
        </SubSection>

        <SubSection title="Assessment" sectionKey="tpgAssessment">
          <NavItem target="tpgSubmitAssessment" label="Submit Assessment" isSubItem />
          <NavItem target="tpgUpdateAssessment" label="Update Assessment" isSubItem />
          <NavItem target="tpgSearchAssessments" label="Search Assessments" isSubItem />
          <NavItem target="tpgViewAssessment" label="View Assessment" isSubItem />
        </SubSection>

        <SubSection title="Grant" sectionKey="tpgGrant">
          <NavItem target="grantCalculator" label="Grant Calculator" isSubItem />
          <NavItem target="tpgSearchGrant" label="Search Grant" isSubItem />
          <NavItem target="tpgViewGrantStatus" label="View Grant Status" isSubItem />
        </SubSection>
      </NavSection>

      <NavSection title="Claim Management" sectionKey="claimManagement">
        <NavItem target="claimCheck" label="Check / Add Claim" isSubItem />
        <NavItem target="viewClaim" label="View Claim" isSubItem />
        <NavItem target="cancelClaim" label="Cancel Claim" isSubItem />
        <NavItem target="uploadDocument" label="Upload Supporting Document" isSubItem />
      </NavSection>

      <NavSection title="Useful Links" sectionKey="usefulLinks">
        {[
          { label: 'Quickbooks', href: 'https://quickbooks.intuit.com/sg/' },
          { label: 'Vendors@gov', href: 'https://www.vendors.gov.sg/' },
          { label: 'GeBiz', href: 'https://www.gebiz.gov.sg/' },
          { label: 'Bizfile', href: 'https://www.bizfile.gov.sg/' },
          { label: 'CPF', href: 'https://www.cpf.gov.sg/member' },
        ].map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center rounded-md pl-8 py-2 text-sm font-medium transition-colors ${inactiveClass}`}
          >
            {label}
            <svg className="w-3 h-3 ml-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
      </NavSection>
    </nav>
  );

  // Profile view — full width, no sidebar
  if (currentView === View.Profile) {
    return (
      <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
        <Header />
        <main className="flex-1">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <ProfilePage />
          </div>
        </main>
        <Footer />
        <AiChatbot />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Mobile header and sidebar toggle */}
      <div className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <button onClick={handleToggleSidebar} className="p-2 -ml-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
          <Icon name={IconName.Menu} className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold truncate">{getPageTitle()}</h2>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={() => setIsMobileSidebarOpen(false)} />
          <div className="relative flex flex-col w-72 max-w-[calc(100%-3rem)] h-full bg-surface shadow-xl">
            <div className="p-4 flex justify-between items-center border-b dark:border-gray-700">
              <h3 className="font-bold">Menu</h3>
              <button onClick={() => setIsMobileSidebarOpen(false)} className="p-2 -mr-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                <Icon name={IconName.Close} className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sidebarContent}
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Desktop Sidebar */}
        {!isDesktopSidebarCollapsed && (
          <aside className="hidden md:flex w-64 flex-shrink-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700">
            <div className="w-full">
              {sidebarContent}
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden">
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

export default FinanceLayout;
