import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { TrainerPage, View } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface TrainerSidebarProps {
  onNavigate?: () => void;
}

const NAV_ITEMS: { page: TrainerPage; label: string; icon: IconName }[] = [
  { page: TrainerPage.EAttendance,    label: 'E-Attendance',    icon: IconName.ClipboardCheck },
  { page: TrainerPage.MyClasses,      label: 'My Classes',      icon: IconName.BookOpen       },
  { page: TrainerPage.GenAIAuthoring, label: 'GenAI Authoring', icon: IconName.Create         },
];

const TrainerSidebar: React.FC<TrainerSidebarProps> = ({ onNavigate }) => {
  const { trainerPage, setTrainerPage, setCurrentView } = useLms();

  return (
    <div className="flex flex-col h-full bg-surface border-r border-default">

      {/* Nav Items */}
      <div className="flex-1 px-3 py-4">
        <p className="px-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
          Menu
        </p>

        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ page, label, icon }) => {
            const isActive = trainerPage === page;
            return (
              <a
                key={page}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentView(View.Dashboard);
                  setTrainerPage(page);
                  onNavigate?.();
                }}
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-secondary hover:bg-surface-elevated hover:text-on-surface'
                }`}
              >
                <Icon
                  name={icon}
                  className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                    isActive ? 'text-primary' : 'text-subtle group-hover:text-on-surface'
                  }`}
                />
                <span className="truncate">{label}</span>
              </a>
            );
          })}
        </div>
      </div>

    </div>
  );
};

export default TrainerSidebar;
