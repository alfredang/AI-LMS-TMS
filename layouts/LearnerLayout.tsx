import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Icon, IconName } from '../components/ui/Icon';
import { useLms } from '../contexts/LmsContext';
import { View } from '@app-types';
import CourseList from '../components/CourseList';
import CalendarView from '../components/CalendarView';
import { ProfilePage } from '@components/ProfilePage';
import { CourseDetail } from '../components/CourseDetail';
import HelpAndSupportView from '../components/HelpAndSupportView';
import BillingHistoryView from '../components/BillingHistoryView';
import CertificateHistoryView from '../components/CertificateHistoryView';
import LearnerGrantCalculatorView from '../components/LearnerGrantCalculatorView';

interface NavItem {
  view: View;
  label: string;
  icon: IconName;
  href?: string;
}

const sidebarItems: NavItem[] = [
  { view: View.Courses, label: 'My Courses', icon: IconName.Courses },
  { view: View.Profile, label: 'My Profile', icon: IconName.MyAccount },
  { view: View.GrantCalculator, label: 'Grant Calculator', icon: IconName.Calculator },
  { view: View.BillingHistory, label: 'Billing History', icon: IconName.DollarSign },
  { view: View.CertificateHistory, label: 'Certificate History', icon: IconName.Award },
  { view: View.Courses, label: 'Certificate Delivery', icon: IconName.Award, href: 'https://docs.google.com/forms/d/e/1FAIpQLSegSnbaBMlH3ghEskSPDqI19lbkVx05zFPdHvP9Ltf3Nlv6EQ/viewform' },
  { view: View.Courses, label: 'TRAQOM Survey', icon: IconName.ClipboardCheck, href: 'https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr' },
];

const LearnerLayout: React.FC = () => {
  const { currentView, selectedCourse, handleNavigation } = useLms();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setIsDesktopSidebarCollapsed(prev => !prev);
    } else {
      setIsMobileSidebarOpen(true);
    }
  };

  const navigateTo = (view: View) => {
    handleNavigation(view);
    setIsMobileSidebarOpen(false);
  };

  const renderContent = () => {
    if (selectedCourse) {
      return <CourseDetail />;
    }

    switch (currentView) {
      case View.Profile:
        return <ProfilePage />;
      case View.HelpAndSupport:
        return <HelpAndSupportView />;
      case View.GrantCalculator:
        return <LearnerGrantCalculatorView />;
      case View.BillingHistory:
        return <BillingHistoryView />;
      case View.CertificateHistory:
        return <CertificateHistoryView />;
      case View.Calendar:
        return <CalendarView />;
      case View.Courses:
      case View.Dashboard:
      default:
        return <CourseList />;
    }
  };

  const getPageTitle = () => {
    if (selectedCourse) return 'Course Detail';
    const item = sidebarItems.find(i => i.view === currentView);
    return item?.label || 'My Courses';
  };

  const activeClass = 'bg-primary/10 text-primary font-semibold';
  const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800">
      <div className="flex-1 px-3 py-4 space-y-1">
        {sidebarItems.map((item) => {
          const isActive = !item.href && currentView === item.view && !selectedCourse;
          return (
            <a
              key={item.label}
              href={item.href || '#'}
              target={item.href ? '_blank' : undefined}
              rel={item.href ? 'noopener noreferrer' : undefined}
              onClick={item.href ? undefined : (e) => { e.preventDefault(); navigateTo(item.view); }}
              className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                isActive ? activeClass : inactiveClass
              }`}
            >
              <Icon
                name={item.icon}
                className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                  isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500'
                }`}
              />
              <span className="truncate">{item.label}</span>
            </a>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Sub-header with sidebar toggle and page title */}
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
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            {renderContent()}
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
};

export default LearnerLayout;
