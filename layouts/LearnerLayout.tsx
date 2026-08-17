import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Icon, IconName } from '../components/ui/Icon';
import { useAppVersion } from '@hooks/useAppVersion';
import { useLms } from '../contexts/LmsContext';
import { View } from '@app-types';
import CourseList from '../components/CourseList';
import MyCalendarView from '../components/MyCalendarView';
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
  { view: View.Calendar, label: 'My Calendar', icon: IconName.Calendar },
  { view: View.Profile, label: 'My Profile', icon: IconName.MyAccount },
  { view: View.GrantCalculator, label: 'Grant Calculator', icon: IconName.Calculator },
  { view: View.BillingHistory, label: 'Billing History', icon: IconName.DollarSign },
  { view: View.CertificateHistory, label: 'Certificate History', icon: IconName.Award },
];

// Mirrors ED_TOOL_ITEMS in components/trainer/TrainerSidebar.tsx — keep in sync.
const ED_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Ice Breaker',    icon: IconName.Users,    href: 'https://alfredang.github.io/ice-breaker/' },
  { label: 'Pinboard',       icon: IconName.Bookmark, href: 'https://alfredang.github.io/pinboard/' },
  { label: 'Break Timer',    icon: IconName.Clock,    href: 'https://alfredang.github.io/musical-timer-countdown/' },
  { label: 'Word Cloud',     icon: IconName.Cloud,    href: 'https://alfredang.github.io/wordcloud/' },
  { label: 'Flash Cards',    icon: IconName.FileText,  href: 'https://alfredang.github.io/flashcard/' },
  { label: 'Live Q&A',       icon: IconName.Help,     href: 'https://alfredang.github.io/live-qna/' },
  { label: 'Whiteboard',     icon: IconName.Edit,     href: 'https://alfredang.github.io/whiteboard/' },
  { label: 'QR Code Generator', icon: IconName.QrCode, href: 'https://alfredang.github.io/qrcodegenerator/' },
  { label: 'Padlet',         icon: IconName.Bookmark, href: 'https://alfredang.github.io/padlet/' },
  { label: 'Collaborative Note', icon: IconName.FileText, href: 'https://alfredang.github.io/collabnote/' },
  { label: 'Collaborative Flow', icon: IconName.Link, href: 'https://alfredang.github.io/collabflow/' },
  { label: 'Collaborative Kanban', icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/kanban/' },
  { label: 'Live Poll',      icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/livepoll/' },
  { label: 'MindMaps', icon: IconName.Link, href: 'https://alfredang.github.io/mindmapping/' },
  { label: 'Spinning Wheel', icon: IconName.Spinner,  href: 'https://alfredang.github.io/spinning-wheel/' },
];

const LearnerLayout: React.FC = () => {
  const { currentView, selectedCourse, handleNavigation } = useLms();
  const appVersion = useAppVersion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edToolsOpen, setEdToolsOpen] = useState(false);

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
        return <MyCalendarView role="learner" />;
      case View.Courses:
      case View.Dashboard:
      default:
        return <CourseList />;
    }
  };

  const activeClass = 'bg-primary/10 text-primary font-semibold';
  const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
  const subItemClass = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

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

              {/* Divider — Tools */}
              <div className="mt-4 mb-2 px-2">
                <div className="border-t border-gray-200 dark:border-gray-700" />
                {isSidebarOpen && (
                  <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 select-none">
                    Tools
                  </p>
                )}
              </div>

              {/* Ed Tools — expandable */}
              <button
                onClick={() => setEdToolsOpen(prev => !prev)}
                title={!isSidebarOpen ? 'Ed Tools' : undefined}
                className={`group flex items-center ${isSidebarOpen ? 'gap-3 px-3' : 'justify-center px-0'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
              >
                <Icon
                  name={IconName.BookOpen}
                  className="w-[18px] h-[18px] flex-shrink-0 text-gray-400 dark:text-gray-500 transition-colors"
                />
                {isSidebarOpen && <span className="truncate">Ed Tools</span>}
                {isSidebarOpen && (
                  <Icon
                    name={IconName.ChevronDown}
                    className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                      edToolsOpen ? 'rotate-0' : '-rotate-90'
                    } text-gray-400 dark:text-gray-500`}
                  />
                )}
              </button>

              {isSidebarOpen && edToolsOpen && (
                <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
                  {ED_TOOL_ITEMS.map(({ label, icon, href }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${subItemClass}`}
                    >
                      <Icon name={icon} className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
                      <span className="truncate">{label}</span>
                      <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ))}
                </div>
              )}
            </div>
            {isSidebarOpen && <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">version {appVersion}</p>}
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
