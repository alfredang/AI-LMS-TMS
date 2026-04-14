import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Icon, IconName } from '../components/ui/Icon';
import { useAppVersion } from '@hooks/useAppVersion';
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
  { view: View.Courses, label: 'My Classes', icon: IconName.Courses },
  { view: View.Profile, label: 'My Profile', icon: IconName.MyAccount },
  { view: View.GrantCalculator, label: 'Grant Calculator', icon: IconName.Calculator },
  { view: View.BillingHistory, label: 'Billing History', icon: IconName.DollarSign },
  { view: View.CertificateHistory, label: 'Certificate History', icon: IconName.Award },
  { view: View.Courses, label: 'Certificate Delivery', icon: IconName.Award, href: 'https://docs.google.com/forms/d/e/1FAIpQLSegSnbaBMlH3ghEskSPDqI19lbkVx05zFPdHvP9Ltf3Nlv6EQ/viewform' },
  { view: View.Courses, label: 'TRAQOM Survey', icon: IconName.ClipboardCheck, href: 'https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr' },
];

const LearnerLayout: React.FC = () => {
  const { currentView, selectedCourse, handleNavigation } = useLms();
  const appVersion = useAppVersion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navigateTo = (view: View) => {
    handleNavigation(view);
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

  const activeClass = 'bg-primary/10 text-primary font-semibold';
  const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Sidebar: icon rail when collapsed, full panel when expanded */}
        <div className="flex flex-shrink-0">
          <aside className={`${isSidebarOpen ? 'w-64' : 'w-14'} bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col h-[calc(100vh-64px)] sticky top-[64px] transition-all duration-200`}>
            <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1" style={{ scrollbarWidth: 'none' }}>
              {sidebarItems.map((item) => {
                const isActive = !item.href && currentView === item.view && !selectedCourse;
                return (
                  <a
                    key={item.label}
                    href={item.href || '#'}
                    target={item.href ? '_blank' : undefined}
                    rel={item.href ? 'noopener noreferrer' : undefined}
                    onClick={item.href ? undefined : (e) => { e.preventDefault(); navigateTo(item.view); }}
                    title={!isSidebarOpen ? item.label : undefined}
                    className={`group flex items-center ${isSidebarOpen ? 'gap-3 px-3' : 'justify-center px-0'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
                      isActive ? activeClass : inactiveClass
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                        isActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500'
                      }`}
                    />
                    {isSidebarOpen && <span className="truncate">{item.label}</span>}
                  </a>
                );
              })}
            </div>
            {isSidebarOpen && <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">version {appVersion}</p>}
            {/* Toggle arrow — fixed at viewport center, always visible */}
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="fixed top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors z-10"
              title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg className={`w-5 h-5 transition-transform ${isSidebarOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </aside>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
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
