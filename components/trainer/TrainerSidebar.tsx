import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { TrainerPage, View } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface TrainerSidebarProps {
  onNavigate?: () => void;
}

const NAV_ITEMS: { page: TrainerPage; label: string; icon: IconName }[] = [
  { page: TrainerPage.MyClasses,          label: 'My Classes',          icon: IconName.BookOpen       },
  { page: TrainerPage.EAttendance,        label: 'E-Attendance',        icon: IconName.ClipboardCheck },
  { page: TrainerPage.AssessmentGrading,  label: 'Assessment Grading',  icon: IconName.Award          },
  { page: TrainerPage.PastAttendance,     label: 'Past Attendance',     icon: IconName.ClipboardCheck },
  { page: TrainerPage.PastAssessment,     label: 'Past Assessment',     icon: IconName.Award          },
];

const ED_TOOLS: { page?: TrainerPage; label: string; icon: IconName; href?: string }[] = [
  { label: 'Break Timer',    icon: IconName.Clock,    href: 'https://alfredang.github.io/musical-timer-countdown/' },
  { label: 'Pinboard',       icon: IconName.Bookmark, href: 'https://alfredang.github.io/pinboard/' },
  { label: 'Whiteboard',     icon: IconName.Edit,     href: 'https://alfredang.github.io/whiteboard/' },
  { label: 'Google Meet',    icon: IconName.Video,    href: 'https://meet.google.com/landing' },
  { page: TrainerPage.GenAIAuthoring, label: 'GenAI Authoring', icon: IconName.Create },
];

const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
const inactiveIconClass = 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white';

const TrainerSidebar: React.FC<TrainerSidebarProps> = ({ onNavigate }) => {
  const { trainerPage, setTrainerPage, setCurrentView, setSelectedCourse } = useLms();

  return (
    <div className="flex flex-col h-full bg-surface border-r border-default">

      {/* Nav Items */}
      <div className="flex-1 px-3 py-4">
        <p className="px-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
          Menu
        </p>

        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ page, label, icon }) => (
            <a
              key={page}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setSelectedCourse(null);
                setCurrentView(View.Dashboard);
                setTrainerPage(page);
                onNavigate?.();
              }}
              className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                trainerPage === page
                  ? 'bg-primary/10 text-primary'
                  : inactiveClass
              }`}
            >
              <Icon
                name={icon}
                className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                  trainerPage === page ? 'text-primary' : inactiveIconClass
                }`}
              />
              <span className="truncate">{label}</span>
            </a>
          ))}
        </div>

        {/* Divider — Ed Tools */}
        <div className="mt-4 mb-2 px-2">
          <div className="border-t border-default" />
          <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
            Ed Tools
          </p>
        </div>

        <div className="space-y-0.5">
          {ED_TOOLS.map(({ page, label, icon, href }) =>
            href ? (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
              >
                <Icon name={icon} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${inactiveIconClass}`} />
                <span className="truncate">{label}</span>
                <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            ) : (
              <a
                key={label}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedCourse(null);
                  setCurrentView(View.Dashboard);
                  setTrainerPage(page!);
                  onNavigate?.();
                }}
                className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  trainerPage === page
                    ? 'bg-primary/10 text-primary'
                    : inactiveClass
                }`}
              >
                <Icon
                  name={icon}
                  className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                    trainerPage === page ? 'text-primary' : inactiveIconClass
                  }`}
                />
                <span className="truncate">{label}</span>
              </a>
            )
          )}
        </div>
      </div>

    </div>
  );
};

export default TrainerSidebar;
