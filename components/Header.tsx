import React, { useState, useRef, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View, UserRole, AdminPage } from '@app-types';
import { Icon, IconName } from './ui/Icon';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';

const ProfileDropdown: React.FC<{onClose: () => void}> = ({onClose}) => {
    const { logout, handleNavigation } = useLms();
      
    const menuItems = [
        { label: 'My Profile', icon: IconName.MyAccount, view: View.Profile },
        { label: 'Help and Support', icon: IconName.Help, view: View.HelpAndSupport },
    ];

    return (
        <div className="absolute top-full right-0 mt-2 w-72 bg-surface rounded-lg shadow-2xl z-50 border border-gray-200 overflow-hidden">
            <div className="p-4 bg-gray-50">
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
                        className="flex items-center space-x-3 px-3 py-2.5 text-sm font-semibold rounded-md text-gray-700 hover:bg-gray-100">
                        <Icon name={item.icon} className="w-5 h-5" />
                        <span>{item.label}</span>
                    </a>
                 ))}
                 <div className="border-t border-gray-200 my-1"></div>
                 <button onClick={logout} className="w-full flex items-center space-x-3 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-md">
                    <Icon name={IconName.Logout} className="w-5 h-5"/>
                    <span>Logout</span>
                </button>
            </div>
        </div>
    );
};

const Header: React.FC = () => {
  const { role, currentView, adminPage, handleNavigation, setAdminPage, resetCreateView, resetAdminView, trainingProviderProfile, currentUserProfile } = useLms();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };

    if (isProfileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileOpen]);

  const classManagementPages = [AdminPage.ViewCourses, AdminPage.ViewTrainers, AdminPage.UpcomingClasses, AdminPage.OngoingClasses, AdminPage.CompletedClasses, AdminPage.CreateNewClass, AdminPage.EditClass, AdminPage.EnrollLearners, AdminPage.AssignTrainer];
  const tpgManagementPages = [AdminPage.ApplyNewGrant, AdminPage.ViewGrantStatus, AdminPage.SubmitAssessment, AdminPage.ViewAssessments, AdminPage.ApplyNewClaim, AdminPage.ViewClaimStatus, AdminPage.UploadCourseRuns];

  const isAdminPageActive = (item: any) => {
    if (currentView !== View.Admin || !('page' in item)) return false;
    if (item.label === 'Admin Dashboard') return adminPage === AdminPage.Dashboard;
    if (item.label === 'Class Management') return classManagementPages.includes(adminPage) || adminPage === AdminPage.ClassManagement;
    if (item.label === 'TPG Management') return tpgManagementPages.includes(adminPage) || adminPage === AdminPage.TpgManagement;
    return false;
  }

  const navConfig = {
    [UserRole.Learner]: [
        { view: View.Dashboard, label: 'Home', icon: IconName.Dashboard },
        { view: View.Courses, label: 'Courses', icon: IconName.Courses },
        { view: View.Calendar, label: 'Task List', icon: IconName.Calendar },
        // { view: View.JobSearch, label: 'Job Search', icon: IconName.Jobs },
    ],
    [UserRole.Trainer]: [
        { view: View.Dashboard, label: 'Home', icon: IconName.Dashboard },
        { view: View.Courses, label: 'My Classes', icon: IconName.Courses },
        { view: View.Calendar, label: 'Task List', icon: IconName.Calendar },
        { view: View.Create, label: 'Trainer GenAI Authoring', icon: IconName.Create },
    ],
    [UserRole.Developer]: [
        { view: View.Dashboard, label: 'Home', icon: IconName.Dashboard },
        { view: View.Courses, label: 'Courses', icon: IconName.Courses },
        { view: View.Create, label: 'Developer GenAI Authoring', icon: IconName.Create },
    ],
    [UserRole.Admin]: [
        { view: View.Admin, label: 'Admin Dashboard', icon: IconName.Admin, page: AdminPage.Dashboard },
        { view: View.Admin, label: 'Class Management', icon: IconName.Courses, page: AdminPage.ClassManagement },
        { view: View.Admin, label: 'TPG Management', icon: IconName.DollarSign, page: AdminPage.TpgManagement },
    ],
    [UserRole.TrainingProvider]: [
        { view: View.Dashboard, label: 'Analytics', icon: IconName.Analytics },
        { view: View.Courses, label: 'Courses', icon: IconName.Courses },
    ]
  };

  const navItems = navConfig[role];

  return (
    <header className="bg-surface shadow-sm sticky top-0 z-30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <img src={ensureAbsoluteImageUrl(trainingProviderProfile?.companyLogoUrl || '/images/default-company-logo.png')} alt="Company Logo" className="w-8 h-8 rounded-md" />
              <span className="text-xl font-bold text-on-surface">{trainingProviderProfile?.companyShortname || 'Training Provider'}</span>
            </div>
            <nav className="hidden md:flex items-center space-x-6">
            {navItems.map(item => (
                <a
                key={item.label}
                href="#"
                onClick={(e) => { 
                    e.preventDefault(); 
                    
                    if (role === UserRole.Admin && 'page' in item) {
                        if (item.page === AdminPage.Dashboard) {
                            resetAdminView();
                        }
                        setAdminPage(item.page);
                    }
                    
                    if (item.view === View.Create && currentView === item.view) {
                    resetCreateView();
                    } else {
                    handleNavigation(item.view);
                    }
                }}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    (role === UserRole.Admin && isAdminPageActive(item)) || (role !== UserRole.Admin && currentView === item.view)
                    ? 'bg-primary text-white' 
                    : 'text-on-surface hover:bg-gray-100 hover:text-primary'
                }`}
                >
                <Icon name={item.icon} className="w-5 h-5" />
                <span>{item.label}</span>
                </a>
            ))}
            </nav>
          </div>

          <div className="flex items-center">
            <div className="relative" ref={profileRef}>
                <button onClick={() => setIsProfileOpen(prev => !prev)} className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center ring-2 ring-offset-2 ring-primary overflow-hidden">
                    {(role === UserRole.TrainingProvider && trainingProviderProfile?.companyLogoUrl) ? (
                        <img src={ensureAbsoluteImageUrl(trainingProviderProfile.companyLogoUrl)} alt={trainingProviderProfile.companyShortname} className="w-full h-full object-cover" />
                    ) : currentUserProfile?.profilePictureUrl ? (
                        <img src={ensureAbsoluteImageUrl(currentUserProfile.profilePictureUrl)} alt={currentUserProfile.name} className="w-full h-full object-cover" />
                    ) : (
                        <Icon name={IconName.User} className="w-6 h-6 text-gray-600" />
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
