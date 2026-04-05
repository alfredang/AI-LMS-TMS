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
import GrantCalculatorView from '../components/finance/GrantCalculatorView';
import ViewClaimView from '../components/finance/ViewClaimView';
import CancelClaimView from '../components/finance/CancelClaimView';
import UploadDocumentView from '../components/finance/UploadDocumentView';

import { ProfilePage } from '../components/ProfilePage';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types/index';

type FinancePage = 'dashboard' | 'allCourseRuns' | 'grantCalculator' | 'searchGrant' | 'viewGrant' | 'claimCheck' | 'viewClaim' | 'cancelClaim' | 'uploadDocument';

const FinanceLayout: React.FC = () => {
  const { currentView } = useLms();
  const [page, setPage] = useState<FinancePage>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    grantManagement: true,
    claimManagement: true,
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

  const sidebarContent = (
    <nav className="space-y-6 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
      <NavItem target="dashboard" label="Finance Management" />
      <NavItem target="allCourseRuns" label="All Course Runs" />

      <NavSection title="Grant Management" sectionKey="grantManagement">
        <NavItem target="grantCalculator" label="Grant Calculator" isSubItem />
        <NavItem target="searchGrant" label="Search Grant" isSubItem />
        <NavItem target="viewGrant" label="View Grant" isSubItem />
      </NavSection>

      <NavSection title="Claim Management" sectionKey="claimManagement">
        <NavItem target="claimCheck" label="Check / Add Claim" isSubItem />
        <NavItem target="viewClaim" label="View Claim" isSubItem />
        <NavItem target="cancelClaim" label="Cancel Claim" isSubItem />
        <NavItem target="uploadDocument" label="Upload Supporting Document" isSubItem />
      </NavSection>

      <a
        href="https://quickbooks.intuit.com/sg/"
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${inactiveClass}`}
      >
        Quickbooks
        <svg className="w-3 h-3 ml-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>

      <NavSection title="Useful Links" sectionKey="usefulLinks">
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
