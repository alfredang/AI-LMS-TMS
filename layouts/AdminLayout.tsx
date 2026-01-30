import React, { useState, useEffect } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import AiChatbot from '../components/AiChatbot';
import { useLms } from '../contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import { AdminProfile } from '@app-types/profile';
import { AdminProfileCard } from '../components/common/AdminProfileCard';
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
import OngoingClasses from '../components/admin/OngoingClasses';
import CompletedClasses from '../components/admin/CompletedClasses';
import { getApiUrl } from '@/lib/urlHelpers';
import ClassDetailView from '../components/admin/ClassDetailView';
import { UpcomingClassesTable } from '../components/UpcomingClassesTable';
import { ClassManagerView, AssignTrainerView } from '../components/admin/ClassManagementViews';
import { CreateNewClassView } from '../components/admin/CreateNewClassView';
import EnrollLearners from '../components/admin/EnrollLearners';
import {
  ApplyNewGrantView,
  ViewGrantStatusView,
  SubmitAssessmentView,
  ViewAssessmentsView,
  ApplyNewClaimView,
  UploadCourseRunsView,
  SearchGrantView,
  SearchEnrolmentView,
  ViewEnrolmentView,
  UploadEnrolmentsView
} from '../components/admin/GrantManagementViews';
import { CourseRunView } from '../components/admin/CourseRunView';
import { UploadDirectApplicationView, ViewDirectApplicationView } from '../components/admin/DirectApplicationViews';

// Management Dashboard Component
interface ManagementDashboardProps {
  type: 'class' | 'tpg';
}

const ManagementDashboard: React.FC<ManagementDashboardProps> = ({ type }) => {
  const { setAdminPage } = useLms();

  const classManagementLinks: NavBoxProps[] = [
    { title: "View Courses", description: "Browse and manage all course templates.", icon: IconName.BookOpen, onClick: () => setAdminPage(AdminPage.ViewCourses) },
    { title: "View Trainers", description: "View details and assignments for all trainers.", icon: IconName.User, onClick: () => setAdminPage(AdminPage.ViewTrainers) },
    { title: "Upcoming Classes", description: "See all scheduled upcoming classes.", icon: IconName.Calendar, onClick: () => setAdminPage(AdminPage.UpcomingClasses) },
    { title: "Ongoing Classes", description: "Monitor classes that are currently in session.", icon: IconName.Clock, onClick: () => setAdminPage(AdminPage.OngoingClasses) },
    { title: "Completed Classes", description: "Review past classes and their records.", icon: IconName.ClipboardCheck, onClick: () => setAdminPage(AdminPage.CompletedClasses) },
    { title: "Create New Class", description: "Schedule a new class run from a course template.", icon: IconName.Add, onClick: () => setAdminPage(AdminPage.CreateNewClass) },
    { title: "Enroll Learners", description: "Add or remove learners from a specific class.", icon: IconName.MyAccount, onClick: () => setAdminPage(AdminPage.EnrollLearners) },
    { title: "Assign Trainer", description: "Assign or change the trainer for a class.", icon: IconName.SwitchProfile, onClick: () => setAdminPage(AdminPage.AssignTrainer) },
  ];

  const tpgManagementLinks: NavBoxProps[] = [
    { title: "Apply New Grant", description: "Submit new grant applications to SSG for learners.", icon: IconName.Send, onClick: () => setAdminPage(AdminPage.ApplyNewGrant) },
    { title: "Search Grant", description: "Search for grant details using Reference ID.", icon: IconName.Search, onClick: () => setAdminPage(AdminPage.SearchGrant) },
    { title: "View Grant Status", description: "Check the status of submitted grant applications.", icon: IconName.Eye, onClick: () => setAdminPage(AdminPage.ViewGrantStatus) },
    { title: "Submit Assessment", description: "Submit learner assessment results to TPG.", icon: IconName.Upload, onClick: () => setAdminPage(AdminPage.SubmitAssessment) },
    { title: "View Assessments", description: "View official assessment results from TPG.", icon: IconName.ClipboardCheck, onClick: () => setAdminPage(AdminPage.ViewAssessments) },
    { title: "Apply New Claim", description: "Submit new claims to SSG for learners.", icon: IconName.DollarSign, onClick: () => setAdminPage(AdminPage.ApplyNewClaim) },
    { title: "Upload Course Runs", description: "Bulk upload new course runs via Excel to SSG.", icon: IconName.FileText, onClick: () => setAdminPage(AdminPage.UploadCourseRuns) },
    { title: "Upload Enrolments", description: "Bulk upload learner enrolments via Excel to SSG.", icon: IconName.FileText, onClick: () => setAdminPage(AdminPage.UploadEnrolments) },
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

const AdminLayout: React.FC = () => {
  const { currentView, adminPage, currentUser, selectedCourse, editingCourse, selectedCourseRunId, editingCourseRun } = useLms();
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Fetch admin profile data from database
  useEffect(() => {
    const fetchAdminProfile = async () => {
      if (!currentUser?.id) {
        setError('No authenticated user found');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(getApiUrl(`/api/profile-new?userId=${currentUser.id}&role=admin`));

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.success && result.data?.profile) {
          setAdminProfile(result.data.profile);
          setError(null);
        } else {
          throw new Error(result.error || 'Failed to fetch admin profile');
        }
      } catch (err) {
        console.error('Error fetching admin profile:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchAdminProfile();
  }, [currentUser?.id]);

  // Handle full-width views (Profile and Help & Support only)
  if (currentView === View.Profile || currentView === View.HelpAndSupport) {
    const FullWidthContent = () => {
      if (currentView === View.Profile) {
        if (loading) {
          return (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading admin profile...</p>
              </div>
            </div>
          );
        }

        if (error) {
          return (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <h2 className="text-xl font-bold text-red-600 mb-2">Error Loading Profile</h2>
                <p className="text-gray-600 mb-4">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                  Retry
                </button>
              </div>
            </div>
          );
        }

        if (!adminProfile) {
          return (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-2">No Admin Profile Found</h2>
                <p className="text-gray-600">Admin profile data is not available.</p>
              </div>
            </div>
          );
        }

        return <AdminProfileCard profile={adminProfile} />;
      }

      if (currentView === View.HelpAndSupport) {
        return <HelpAndSupportView />;
      }

      return null;
    };

    return (
      <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
        <Header />
        <main className="container mx-auto p-4 sm:p-6 lg:p-8 flex-grow">
          <FullWidthContent />
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
      case AdminPage.ViewCourses:
        return <CourseList />;
      case AdminPage.ViewTrainers:
        return <ViewTrainers />;
      case AdminPage.UpcomingClasses:
        return (
          <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Upcoming Classes</h2>
            <UpcomingClassesTable showTitle={false} showFilters={true} />
          </div>
        );
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
      case AdminPage.ViewAssessments:
        return <ViewAssessmentsView />;
      case AdminPage.ApplyNewClaim:
        return <ApplyNewClaimView />;
      case AdminPage.UploadCourseRuns:
        return <UploadCourseRunsView />;
      case AdminPage.UploadEnrolments:
        return <UploadEnrolmentsView />;
      case AdminPage.ClassDetail:
        return <ClassDetailView courseRunId={selectedCourseRunId || undefined} />;
      case AdminPage.CourseRun:
        return <CourseRunView />;
      case AdminPage.UploadDirectApplication:
        return <UploadDirectApplicationView />;
      case AdminPage.ViewDirectApplication:
        return <ViewDirectApplicationView />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Mobile header and sidebar toggle */}
      <div className="lg:hidden flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-gray-200">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 hover:text-gray-900">
          <Icon name={IconName.Menu} className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold">{adminPage}</h2>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
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

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow">
        <div className="flex flex-row gap-8">
          <aside className="hidden lg:block w-64 flex-shrink-0">
            <Card className="sticky top-24">
              <AdminSidebar />
            </Card>
          </aside>
          <main className="flex-1 min-w-0">
            {renderContent()}
          </main>
        </div>
      </div>

      <Footer />
      <AiChatbot />
    </div>
  );
};

export default AdminLayout;