import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useLms } from '../contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import { Icon, IconName } from '../components/ui/Icon';
import FinanceSidebar from '../components/finance/FinanceSidebar';
import FinanceManagementView from '../components/training-provider/FinanceManagementView';
import {
  SearchGrantView,
  ViewGrantStatusView,
} from '../components/admin/GrantManagementViews';

const FinanceLayout: React.FC = () => {
  const { currentView, adminPage } = useLms();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      setIsDesktopSidebarCollapsed(prev => !prev);
    } else {
      setIsMobileSidebarOpen(true);
    }
  };

  const renderContent = () => {
    if (currentView === View.Admin) {
      switch (adminPage) {
        case AdminPage.SearchGrant:
          return <SearchGrantView />;
        case AdminPage.ViewGrantStatus:
          return <ViewGrantStatusView />;
      }
    }
    return <FinanceManagementView />;
  };

  const getPageTitle = () => {
    if (currentView === View.Admin) {
      switch (adminPage) {
        case AdminPage.SearchGrant: return 'Search Grant';
        case AdminPage.ViewGrantStatus: return 'View Grant';
      }
    }
    return 'Finance Management';
  };

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
              <FinanceSidebar onNavigate={() => setIsMobileSidebarOpen(false)} />
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
              <FinanceSidebar />
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
    </div>
  );
};

export default FinanceLayout;
