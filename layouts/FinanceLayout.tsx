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
} from '../components/admin/GrantManagementViews';

import ClaimCheckView from '../components/training-provider/ClaimCheckView';

import { ProfilePage } from '../components/ProfilePage';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types/index';

type FinancePage = 'dashboard' | 'allCourseRuns' | 'searchGrant' | 'viewGrant' | 'claimCheck';

const FinanceLayout: React.FC = () => {
  const { currentView } = useLms();
  const [page, setPage] = useState<FinancePage>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [usefulLinksOpen, setUsefulLinksOpen] = useState(false);

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
      case 'searchGrant':
        return <SearchGrantView />;
      case 'viewGrant':
        return <ViewGrantStatusView />;
      case 'claimCheck':
        return <ClaimCheckView />;
      default:
        return <FinanceManagementView />;
    }
  };

  const getPageTitle = () => {
    switch (page) {
      case 'allCourseRuns': return 'All Course Runs';
      case 'searchGrant': return 'Search Grant';
      case 'viewGrant': return 'View Grant';
      case 'claimCheck': return 'Check / Add Claim';
      default: return 'Finance Management';
    }
  };

  const activeClass = 'bg-primary/10 text-primary font-semibold';
  const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800">
      <div className="flex-1 px-3 py-4 space-y-1">
        {/* Finance Management */}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); navigateTo('dashboard'); }}
          className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
            page === 'dashboard' ? activeClass : inactiveClass
          }`}
        >
          <Icon name={IconName.DollarSign} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${page === 'dashboard' ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
          <span className="truncate">Finance Management</span>
        </a>

        {/* All Course Runs */}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); navigateTo('allCourseRuns'); }}
          className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
            page === 'allCourseRuns' ? activeClass : inactiveClass
          }`}
        >
          <Icon name={IconName.FileText} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${page === 'allCourseRuns' ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
          <span className="truncate">All Course Runs</span>
        </a>

        {/* Quickbooks */}
        <a
          href="https://quickbooks.intuit.com/sg/"
          target="_blank"
          rel="noopener noreferrer"
          className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
        >
          <Icon name={IconName.DollarSign} className="w-[18px] h-[18px] flex-shrink-0 transition-colors text-gray-400 dark:text-gray-500" />
          <span className="truncate">Quickbooks</span>
          <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>

        {/* Grant Management — collapsible */}
        <div className="pt-3">
          <button
            onClick={() => setGrantOpen(prev => !prev)}
            className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none"
          >
            <span>Grant Management</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 transition-transform duration-200 ${grantOpen ? 'rotate-0' : '-rotate-90'}`}
            />
          </button>

          {grantOpen && (
            <div className="space-y-0.5">
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); navigateTo('searchGrant'); }}
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  page === 'searchGrant' ? activeClass : inactiveClass
                }`}
              >
                <Icon name={IconName.Search} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${page === 'searchGrant' ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                <span className="truncate">Search Grant</span>
              </a>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); navigateTo('viewGrant'); }}
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  page === 'viewGrant' ? activeClass : inactiveClass
                }`}
              >
                <Icon name={IconName.Eye} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${page === 'viewGrant' ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                <span className="truncate">View Grant</span>
              </a>
            </div>
          )}
        </div>

        {/* Claim Management */}
        <div className="pt-3">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); navigateTo('claimCheck'); }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              page === 'claimCheck' ? activeClass : inactiveClass
            }`}
          >
            <Icon name={IconName.ClipboardCheck} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${page === 'claimCheck' ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
            <span className="truncate">Check / Add Claim</span>
          </a>
        </div>

        {/* Useful Links — collapsible */}
        <div className="pt-3">
          <button
            onClick={() => setUsefulLinksOpen(prev => !prev)}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
          >
            <Icon name={IconName.ExternalLink} className="w-[18px] h-[18px] flex-shrink-0 transition-colors text-gray-400 dark:text-gray-500" />
            <span className="truncate">Useful Links</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${usefulLinksOpen ? 'rotate-0' : '-rotate-90'} text-gray-400 dark:text-gray-500`}
            />
          </button>

          {usefulLinksOpen && (
            <div className="space-y-0.5 ml-4">
              {[
                { label: 'GeBiz', href: 'https://www.gebiz.gov.sg/' },
                { label: 'Bizfile', href: 'https://www.bizfile.gov.sg/' },
                { label: 'CPF', href: 'https://www.cpf.gov.sg/member' },
              ].map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
                >
                  <Icon name={IconName.Link} className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="truncate">{label}</span>
                  <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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
