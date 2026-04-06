import React, { useState, useRef, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View, UserRole, AdminPage, TrainerPage } from '@app-types';
import { Icon, IconName } from './ui/Icon';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';
import { getFileUrl } from '@/lib/urlHelpers';

// Helper to get display name for a role
const getRoleDisplayName = (role: UserRole): string => {
  switch (role) {
    case UserRole.Learner: return 'Learner';
    case UserRole.Trainer: return 'Trainer';
    case UserRole.Developer: return 'Developer';
    case UserRole.Admin: return 'Admin';
    case UserRole.Finance: return 'Finance';
    case UserRole.TrainingProvider: return 'Training Provider';
    default: return role;
  }
};

// Helper to get role icon
const getRoleIcon = (role: UserRole): string => {
  switch (role) {
    case UserRole.Learner: return '📚';
    case UserRole.Trainer: return '👨‍🏫';
    case UserRole.Developer: return '💻';
    case UserRole.Admin: return '⚙️';
    case UserRole.Finance: return '💰';
    case UserRole.TrainingProvider: return '🏢';
    default: return '👤';
  }
};

// Role switcher dropdown component
const RoleSwitcher: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { role, userRoles, switchRole } = useLms();

  const handleRoleSwitch = async (newRole: UserRole) => {
    if (newRole !== role) {
      try {
        await switchRole(newRole);
      } catch (error) {
        console.error('Failed to switch role:', error);
      }
    }
    onClose();
  };

  return (
    <div className="absolute top-full right-0 mt-2 w-56 bg-surface rounded-lg shadow-2xl z-50 border border-default overflow-hidden">
      <div className="px-3 py-2 bg-surface-elevated border-b border-default">
        <p className="text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Switch Role</p>
      </div>
      <div className="p-2">
        {userRoles.map((r) => (
          <button
            key={r}
            onClick={() => handleRoleSwitch(r)}
            className={`w-full flex items-center space-x-3 px-3 py-2.5 text-sm rounded-md transition-colors ${r === role
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
          >
            <span className="text-lg">{getRoleIcon(r)}</span>
            <span>{getRoleDisplayName(r)}</span>
            {r === role && (
              <svg className="w-4 h-4 ml-auto text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

const ProfileDropdown: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { logout, handleNavigation, role } = useLms();

  const profileLabel = role === UserRole.TrainingProvider ? 'Company Setting' : 'My Profile';
  const menuItems = [
    { label: profileLabel, icon: IconName.MyAccount, view: View.Profile },
    ...(role === UserRole.Learner ? [
      { label: 'Billing History', icon: IconName.DollarSign, view: View.BillingHistory },
      { label: 'Certificate History', icon: IconName.Award, view: View.CertificateHistory },
    ] : []),
    { label: 'Help and Support', icon: IconName.Help, view: View.HelpAndSupport },
  ];

  return (
    <div className="absolute top-full right-0 mt-2 w-72 bg-surface rounded-lg shadow-2xl z-50 border border-default overflow-hidden">
      <div className="p-4 bg-surface-elevated">
        {menuItems.map(item => (
          <a
            href="#"
            key={item.label}
            onClick={(e) => {
              e.preventDefault();
              if (item.view) {
                handleNavigation(item.view);
              } else {
                alert(`${item.label} clicked`);
              }
              onClose();
            }}
            className="flex items-center space-x-3 px-3 py-2.5 text-sm font-semibold rounded-md text-on-surface hover:bg-gray-100 dark:hover:bg-gray-700/60">
            <Icon name={item.icon} className="w-5 h-5" />
            <span>{item.label}</span>
          </a>
        ))}
        <div className="border-t border-default my-1"></div>
        <button onClick={logout} className="w-full flex items-center space-x-3 px-3 py-2.5 text-sm font-semibold text-on-surface hover:bg-gray-100 dark:hover:bg-gray-700/60 rounded-md">
          <Icon name={IconName.Logout} className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};

const Header: React.FC = () => {
  const { role, userRoles, currentView, adminPage, trainerPage, financePage, setFinancePage, handleNavigation, setAdminPage, setTrainerPage, setSelectedCourse, resetCreateView, resetAdminView, trainingProviderProfile, currentUserProfile, logout } = useLms();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isRoleSwitcherOpen, setIsRoleSwitcherOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const roleSwitcherRef = useRef<HTMLDivElement>(null);

  // Check if user has multiple roles
  const hasMultipleRoles = userRoles.length > 1;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (roleSwitcherRef.current && !roleSwitcherRef.current.contains(event.target as Node)) {
        setIsRoleSwitcherOpen(false);
      }
    };

    if (isProfileOpen || isRoleSwitcherOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileOpen, isRoleSwitcherOpen]);

  const classManagementPages = [AdminPage.ViewCourses, AdminPage.ViewTrainers, AdminPage.FundingValidity, AdminPage.UpcomingClasses, AdminPage.OngoingClasses, AdminPage.CompletedClasses, AdminPage.CreateNewClass, AdminPage.EditClass, AdminPage.EnrollLearners, AdminPage.AssignTrainer];
  const tpgManagementPages = [
    AdminPage.TpgDirectApplication,
    AdminPage.TpgCourseRun,
    AdminPage.TpgCourseSession,
    AdminPage.TpgEnrollment,
    AdminPage.TpgGrant,
    AdminPage.TpgAttendance,
    AdminPage.TpgAssessment,
    AdminPage.TpgClaims,
    AdminPage.UploadDirectApplication,
    AdminPage.ViewDirectApplication,
    AdminPage.UpdateDirectApplication,
    AdminPage.SearchCourseRuns,
    AdminPage.ViewCourseRun,
    AdminPage.EditCourseRun,
    AdminPage.UploadCourseRuns,
    AdminPage.DeleteCourseRun,
    AdminPage.AddSessions,
    AdminPage.CourseSessionTiming,
    AdminPage.CourseSessions,
    AdminPage.CourseSessionAttendance,
    AdminPage.UploadEnrolments,
    AdminPage.SearchEnrolment,
    AdminPage.ViewEnrolment,
    AdminPage.UpdateEnrolment,
    AdminPage.CancelEnrolment,
    AdminPage.UpdateEnrolmentFees,
    AdminPage.ApplyNewGrant,
    AdminPage.SearchGrant,
    AdminPage.ViewGrantStatus,
    AdminPage.CheckAttendance,
    AdminPage.SubmitAssessment,
    AdminPage.UpdateAssessment,
    AdminPage.SearchAssessments,
    AdminPage.ViewAssessment,
    AdminPage.ApplyNewClaim,
  ];

  const isAdminPageActive = (item: any) => {
    if (currentView !== View.Admin || !('page' in item)) return false;
    if (item.label === 'Admin Dashboard') return adminPage === AdminPage.Dashboard;
    if (item.label === 'Class Management') return classManagementPages.includes(adminPage) || adminPage === AdminPage.ClassManagement;
    if (item.label === 'TPG Management') return tpgManagementPages.includes(adminPage) || adminPage === AdminPage.TpgManagement;
    return false;
  }

  const navConfig = {
    [UserRole.Learner]: [
      { view: View.Courses, label: 'Certificate Delivery', icon: IconName.Award, href: 'https://goo.gl/R2eumq' },
      { view: View.Courses, label: 'TRAQOM Survey', icon: IconName.ClipboardCheck, href: 'https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr' },
    ],
    [UserRole.Trainer]: [
      { view: View.Dashboard, label: 'My Classes', icon: IconName.BookOpen, trainerPage: TrainerPage.MyClasses },
      { view: View.Dashboard, label: 'E-Attendance', icon: IconName.ClipboardCheck, trainerPage: TrainerPage.EAttendance },
      { view: View.Dashboard, label: 'Ed Tools', icon: IconName.BookOpen, trainerPage: TrainerPage.EdTools },
      { view: View.Dashboard, label: 'GenAI Tools', icon: IconName.Create, trainerPage: TrainerPage.GenAIAuthoring },
    ],
    [UserRole.Developer]: [
      { view: View.Courses, label: 'Courses', icon: IconName.Courses },
      { view: View.Create, label: 'Developer GenAI Authoring', icon: IconName.Create },
    ],
    [UserRole.Admin]: [
      { view: View.Admin, label: 'Admin Dashboard', icon: IconName.Admin, page: AdminPage.Dashboard },
      { view: View.Admin, label: 'Class Management', icon: IconName.Courses, page: AdminPage.ClassManagement },
      { view: View.Admin, label: 'TPG Management', icon: IconName.DollarSign, page: AdminPage.TpgManagement },
    ],
    [UserRole.Finance]: [
      { view: View.Finance, label: 'Financial Dashboard', icon: IconName.DollarSign, financePage: 'dashboard' },
      { view: View.Finance, label: 'TPG Management', icon: IconName.Settings, financePage: 'tpgManagement' },
      { view: View.Finance, label: 'Claim Management', icon: IconName.ClipboardCheck, financePage: 'claimCheck' },
    ],
    [UserRole.TrainingProvider]: []
  };

  const navItems = navConfig[role];

  return (
    <header className="bg-surface shadow-sm sticky top-0 z-30">
      <div className="container mx-auto px-3 sm:px-4 lg:px-6">
        <div className="grid grid-cols-3 items-center h-14 sm:h-16">
          {/* Left Section: Logo + Company Name */}
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            <img
              src={trainingProviderProfile?.companyLogoUrl ? (trainingProviderProfile.companyLogoUrl.startsWith('http') ? trainingProviderProfile.companyLogoUrl : getFileUrl(trainingProviderProfile.companyLogoUrl)) : '/images/default-company-logo.png'}
              alt="Company Logo"
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-cover ring-2 ring-primary ring-offset-1 ring-offset-surface flex-shrink-0"
            />
            <span className="text-base sm:text-lg lg:text-xl font-bold text-on-surface hidden sm:block">
              {trainingProviderProfile?.companyShortname || trainingProviderProfile?.companyName || 'Training Provider'}
            </span>
          </div>

          {/* Center Section: Navigation - Always visible */}
          <nav className="flex items-center justify-center space-x-1 sm:space-x-1.5 xl:space-x-2">
            {navItems.map(item => {
              // External link (opens in new tab)
              if ('href' in item && item.href) {
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center space-x-1 px-2 sm:px-2.5 xl:px-3 py-2 rounded-md text-xs xl:text-sm font-medium transition-colors whitespace-nowrap text-on-surface hover:bg-surface-elevated hover:text-primary"
                  >
                    <Icon name={item.icon} className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                    <span className="hidden lg:inline">{item.label}</span>
                  </a>
                );
              }

              // Trainer page navigation
              const isTrainerItem = 'trainerPage' in item && item.trainerPage;
              const isFinanceItem = 'financePage' in item && item.financePage;
              const isActive = isTrainerItem
                ? trainerPage === item.trainerPage
                : isFinanceItem
                  ? false
                  : (role === UserRole.Admin && isAdminPageActive(item)) || (role !== UserRole.Admin && currentView === item.view);

              return (
                <a
                  key={item.label}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();

                    if (isTrainerItem) {
                      setSelectedCourse(null);
                      setTrainerPage(item.trainerPage);
                      handleNavigation(View.Dashboard);
                      return;
                    }

                    if (role === UserRole.Admin && 'page' in item) {
                      if (item.page === AdminPage.Dashboard) {
                        resetAdminView();
                      }
                      setAdminPage(item.page);
                    }

                    if (role === UserRole.Finance && 'financePage' in item) {
                      setFinancePage(item.financePage);
                    }

                    if (item.view === View.Create && currentView === item.view) {
                      resetCreateView();
                    } else {
                      handleNavigation(item.view);
                    }
                  }}
                  className={`flex items-center justify-center space-x-1 px-2 sm:px-2.5 xl:px-3 py-2 rounded-md text-xs xl:text-sm font-medium transition-colors whitespace-nowrap ${isActive
                    ? 'bg-primary text-white'
                    : 'text-on-surface hover:bg-surface-elevated hover:text-primary'
                    }`}
                >
                  <Icon name={item.icon} className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                  <span className="hidden lg:inline">{item.label}</span>
                </a>
              );
            })}
          </nav>

          {/* Right Section: Actions */}
          <div className="flex items-center justify-end space-x-1.5 sm:space-x-2">

            {/* Role Switcher - only show if user has multiple roles */}
            {hasMultipleRoles && (
              <div className="relative" ref={roleSwitcherRef}>
                <button
                  onClick={() => setIsRoleSwitcherOpen(prev => !prev)}
                  className="flex items-center space-x-1 sm:space-x-2 px-2 sm:px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors border border-gray-200 dark:border-gray-700"
                  title="Switch Role"
                >
                  <Icon name={IconName.Eye} className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                  <span className="hidden md:inline text-on-surface-secondary text-xs">View As:</span>
                  <span className="font-semibold truncate max-w-[80px] sm:max-w-none">{getRoleDisplayName(role)}</span>
                  <svg className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform flex-shrink-0 ${isRoleSwitcherOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isRoleSwitcherOpen && <RoleSwitcher onClose={() => setIsRoleSwitcherOpen(false)} />}
              </div>
            )}

            {/* Profile Button (all roles) */}
            <div className="relative" ref={profileRef}>
              <button onClick={() => setIsProfileOpen(prev => !prev)} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-200 flex items-center justify-center ring-2 ring-offset-1 ring-primary overflow-hidden flex-shrink-0">
                {currentUserProfile?.profilePictureUrl ? (
                  <img src={ensureAbsoluteImageUrl(currentUserProfile.profilePictureUrl)} alt={currentUserProfile.name} className="w-full h-full object-cover" />
                ) : (
                  <Icon name={IconName.User} className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600" />
                )}
              </button>
              {isProfileOpen && <ProfileDropdown onClose={() => setIsProfileOpen(false)} />}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
