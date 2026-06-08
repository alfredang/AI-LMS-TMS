import React, { useState } from 'react';
import { useAppVersion } from '@hooks/useAppVersion';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { ProfilePage } from '../components/ProfilePage';
import HelpAndSupportView from '../components/HelpAndSupportView';
import PayoutListView from '../components/payroll/PayoutListView';
import PayrollSettingsView from '../components/payroll/PayrollSettingsView';
import { Icon, IconName } from '../components/ui/Icon';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types/index';

type PayrollPage = 'payouts' | 'settings';

const PayrollLayout: React.FC = () => {
  const { currentView } = useLms();
  const appVersion = useAppVersion();
  const [page, setPage] = useState<PayrollPage>('payouts');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  if (currentView === View.Profile || currentView === View.HelpAndSupport) {
    return (
      <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
        <Header />
        <main className="flex-1">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {currentView === View.Profile ? <ProfilePage /> : <HelpAndSupportView />}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const NavItem: React.FC<{ target: PayrollPage; label: string; icon: IconName }> = ({ target, label, icon }) => {
    const active = page === target;
    return (
      <button
        type="button"
        onClick={() => setPage(target)}
        title={isSidebarOpen ? undefined : label}
        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
          isSidebarOpen ? '' : 'justify-center'
        } ${
          active
            ? 'bg-gradient-to-r from-primary to-primary/80 text-white shadow-sm shadow-primary/20'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700/70'
        }`}
      >
        <Icon name={icon} className={`w-5 h-5 flex-shrink-0 ${active ? '' : 'text-primary/70'}`} />
        {isSidebarOpen && <span>{label}</span>}
      </button>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />
      <div className="flex flex-1">
        <div className="flex flex-shrink-0">
          <aside
            className={`${isSidebarOpen ? 'w-64' : 'w-14'} bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col h-[calc(100vh-64px)] sticky top-[64px] transition-all duration-200`}
          >
            <div
              className={`flex ${isSidebarOpen ? 'justify-end' : 'justify-center'} px-2 py-2 border-b border-gray-200 dark:border-gray-700`}
            >
              <button
                onClick={() => setIsSidebarOpen((p) => !p)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                <svg
                  className={`w-5 h-5 transition-transform ${isSidebarOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {isSidebarOpen && (
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Payroll
                </div>
              )}
              <NavItem target="payouts" label="Payout List" icon={IconName.DollarSign} />
              <NavItem target="settings" label="Payout Tier Settings" icon={IconName.Settings} />
            </div>
            {isSidebarOpen && (
              <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">
                version {appVersion}
              </p>
            )}
          </aside>
        </div>

        <main className="flex-1 overflow-x-hidden">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {page === 'payouts' && <PayoutListView />}
            {page === 'settings' && <PayrollSettingsView />}
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
};

export default PayrollLayout;
