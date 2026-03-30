import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface FinanceSidebarProps {
  onNavigate?: () => void;
}

const FinanceSidebar: React.FC<FinanceSidebarProps> = ({ onNavigate }) => {
  const { currentView, setCurrentView, adminPage, setAdminPage } = useLms();
  const [grantOpen, setGrantOpen] = useState(false);

  const activeClass = 'bg-primary/10 text-primary font-semibold';
  const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
  const subItemActiveClass = 'bg-primary/10 text-primary font-semibold';
  const subItemInactiveClass = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

  const navigateToView = (view: View) => {
    setCurrentView(view);
    onNavigate?.();
  };

  const navigateToAdminPage = (page: AdminPage) => {
    setCurrentView(View.Admin);
    setAdminPage(page);
    onNavigate?.();
  };

  return (
    <div className="flex flex-col h-full bg-surface border-r border-default">
      <div className="flex-1 px-3 py-4 space-y-1">

        {/* Finance Management */}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); navigateToView(View.FinanceManagement); }}
          className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
            currentView === View.FinanceManagement ? activeClass : inactiveClass
          }`}
        >
          <Icon name={IconName.DollarSign} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${currentView === View.FinanceManagement ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
          <span className="truncate">Finance Management</span>
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
                onClick={(e) => { e.preventDefault(); navigateToAdminPage(AdminPage.SearchGrant); }}
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  currentView === View.Admin && adminPage === AdminPage.SearchGrant ? subItemActiveClass : subItemInactiveClass
                }`}
              >
                <Icon name={IconName.Search} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${currentView === View.Admin && adminPage === AdminPage.SearchGrant ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                <span className="truncate">Search Grant</span>
              </a>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); navigateToAdminPage(AdminPage.ViewGrantStatus); }}
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  currentView === View.Admin && adminPage === AdminPage.ViewGrantStatus ? subItemActiveClass : subItemInactiveClass
                }`}
              >
                <Icon name={IconName.Eye} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${currentView === View.Admin && adminPage === AdminPage.ViewGrantStatus ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                <span className="truncate">View Grant</span>
              </a>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default FinanceSidebar;
