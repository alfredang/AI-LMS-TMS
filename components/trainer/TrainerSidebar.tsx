import React, { useState } from 'react';
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
  { page: TrainerPage.AssessmentGuide,   label: 'Assessment Guide',    icon: IconName.BookOpen        },
];

const ED_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Ice Breaker',    icon: IconName.Users,    href: 'https://alfredang.github.io/ice-breaker/' },
  { label: 'Pinboard',       icon: IconName.Bookmark, href: 'https://alfredang.github.io/pinboard/' },
  { label: 'Break Timer',    icon: IconName.Clock,    href: 'https://alfredang.github.io/musical-timer-countdown/' },
  { label: 'Word Cloud',     icon: IconName.Cloud,    href: 'https://alfredang.github.io/wordcloud/' },
  { label: 'Flash Cards',    icon: IconName.FileText,  href: 'https://alfredang.github.io/flashcard/' },
  { label: 'Live Q&A',       icon: IconName.Help,     href: 'https://alfredang.github.io/live-qna/' },
  { label: 'Whiteboard',     icon: IconName.Edit,     href: 'https://alfredang.github.io/whiteboard/' },
  { label: 'Collaborative Note', icon: IconName.FileText, href: 'https://alfredang.github.io/collabnote/' },
  { label: 'Collaborative Flow', icon: IconName.Link, href: 'https://alfredang.github.io/collabflow/' },
  { label: 'Collaborative Kanban', icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/kanban/' },
  { label: 'Live Poll',      icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/livepoll/' },
  { label: 'Spinning Wheel', icon: IconName.Spinner,  href: 'https://alfredang.github.io/spinning-wheel/' },
  { label: '5 Whys',         icon: IconName.Help,     href: 'https://alfredang.github.io/5whys/' },
  { label: 'Fishbone Diagram', icon: IconName.Link,  href: 'https://alfredang.github.io/fishbone/' },
  { label: 'Pareto Chart',    icon: IconName.Link,   href: 'https://alfredang.github.io/paretochart/' },
  { label: 'System Thinking', icon: IconName.Link,   href: 'https://alfredang.github.io/systemloop/' },
  { label: 'Mock Data Generator', icon: IconName.FileText, href: 'https://alfredang.github.io/mockdatagen/' },
];

const VIRTUAL_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Google Meet',      icon: IconName.Video, href: 'https://meet.google.com/landing' },
  { label: 'Microsoft Teams',  icon: IconName.Video, href: 'https://www.microsoft.com/en-sg/microsoft-teams/log-in' },
  { label: 'Zoom',             icon: IconName.Video, href: 'https://www.zoom.com/' },
];

const DATA_ANALYTICS_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Pivot Visualization', icon: IconName.Analytics, href: 'https://alfredang.github.io/novapivot/' },
];

const FINANCE_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Tax Calculator', icon: IconName.Analytics, href: 'https://alfredang.github.io/novataxsg/' },
  { label: 'Financial Tools', icon: IconName.Analytics, href: 'https://alfredang.github.io/novafinance/' },
];

const STAT_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Descriptive',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/descriptive' },
  { label: 'Correlation',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/correlation' },
  { label: 'Regression',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/regression' },
  { label: 'Hypothesis',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/hypothesis' },
  { label: 'Chi-Square',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/chi-square' },
  { label: 'ANOVA',        icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/anova' },
];

const DOE_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Full Factorial',        icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#full-factorial' },
  { label: 'Fractional Factorial',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#fractional-factorial' },
  { label: 'Taguchi',               icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#taguchi' },
  { label: 'Central Composite',     icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#central-composite' },
  { label: 'Box-Behnken',           icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#box-behnken' },
  { label: 'Plackett-Burman',       icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#plackett-burman' },
  { label: 'Latin Square',          icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#latin-square' },
  { label: 'Response Surface',      icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#response-surface' },
];

const SPC_TOOL_ITEMS: { label: string; icon: IconName; href: string }[] = [
  { label: 'c Chart',              icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#c-chart' },
  { label: 'u Chart',              icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#u-chart' },
  { label: 'np Chart',             icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#np-chart' },
  { label: 'p Chart',              icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#p-chart' },
  { label: 'X-mR Chart',           icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#x-mr-chart' },
  { label: 'X\u0304-R Chart',      icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#xbar-r-chart' },
  { label: 'X\u0304-s Chart',      icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#xbar-s-chart' },
  { label: 'Distribution',         icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#distribution' },
  { label: 'Process Capability',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#process-capability' },
];

const GENAI_TOOL_ITEMS: { label: string; icon: IconName }[] = [
  { label: 'Create Quiz',            icon: IconName.FileText },
  { label: 'Create Interactive Poll', icon: IconName.ClipboardCheck },
  { label: 'Create Case Study',      icon: IconName.FileText },
  { label: 'Create Role Play',       icon: IconName.Award },
  { label: 'Create Practical Lab',   icon: IconName.ClipboardCheck },
  { label: 'Create Mind Maps',       icon: IconName.Create },
];

const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
const inactiveIconClass = 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white';
const subItemClass = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

const TrainerSidebar: React.FC<TrainerSidebarProps> = ({ onNavigate }) => {
  const { trainerPage, setTrainerPage, setCurrentView, setSelectedCourse } = useLms();
  const [edToolsOpen, setEdToolsOpen] = useState(true);
  const [dataAnalyticsOpen, setDataAnalyticsOpen] = useState(trainerPage === TrainerPage.DataAnalyticsTools);
  const [financeToolsOpen, setFinanceToolsOpen] = useState(trainerPage === TrainerPage.FinanceTools);
  const [statToolsOpen, setStatToolsOpen] = useState(trainerPage === TrainerPage.StatTools);
  const [doeToolsOpen, setDoeToolsOpen] = useState(trainerPage === TrainerPage.DoeTools);
  const [spcToolsOpen, setSpcToolsOpen] = useState(trainerPage === TrainerPage.SpcTools);
  const [genAiOpen, setGenAiOpen] = useState(trainerPage === TrainerPage.GenAIAuthoring);
  const [virtualToolsOpen, setVirtualToolsOpen] = useState(trainerPage === TrainerPage.VirtualTools);

  const navigateTo = (page: TrainerPage) => {
    setSelectedCourse(null);
    setCurrentView(View.Dashboard);
    setTrainerPage(page);
    onNavigate?.();
  };

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
              onClick={(e) => { e.preventDefault(); navigateTo(page); }}
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

        {/* Divider — Tools */}
        <div className="mt-4 mb-2 px-2">
          <div className="border-t border-default" />
          <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
            Tools
          </p>
        </div>

        <div className="space-y-0.5">

          {/* Ed Tools — expandable */}
          <button
            onClick={() => {
              setEdToolsOpen(prev => !prev);
              navigateTo(TrainerPage.EdTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.EdTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.BookOpen}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.EdTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">Ed Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                edToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.EdTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {edToolsOpen && (
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

          {/* Data Analytics Tools — expandable */}
          <button
            onClick={() => {
              setDataAnalyticsOpen(prev => !prev);
              navigateTo(TrainerPage.DataAnalyticsTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.DataAnalyticsTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.DataAnalyticsTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">Data Analytics Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                dataAnalyticsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.DataAnalyticsTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {dataAnalyticsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {DATA_ANALYTICS_ITEMS.map(({ label, icon, href }) => (
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

          {/* Finance Tools — expandable */}
          <button
            onClick={() => {
              setFinanceToolsOpen(prev => !prev);
              navigateTo(TrainerPage.FinanceTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.FinanceTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.FinanceTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">Finance Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                financeToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.FinanceTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {financeToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {FINANCE_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Statistical Tools — expandable */}
          <button
            onClick={() => {
              setStatToolsOpen(prev => !prev);
              navigateTo(TrainerPage.StatTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.StatTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.StatTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">Statistical Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                statToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.StatTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {statToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {STAT_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* DOE Tools — expandable */}
          <button
            onClick={() => {
              setDoeToolsOpen(prev => !prev);
              navigateTo(TrainerPage.DoeTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.DoeTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.DoeTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">DOE Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                doeToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.DoeTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {doeToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {DOE_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* SPC Tools — expandable */}
          <button
            onClick={() => {
              setSpcToolsOpen(prev => !prev);
              navigateTo(TrainerPage.SpcTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.SpcTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.SpcTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">SPC Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                spcToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.SpcTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {spcToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {SPC_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* GenAI Tools — expandable */}
          <button
            onClick={() => {
              setGenAiOpen(prev => !prev);
              navigateTo(TrainerPage.GenAIAuthoring);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.GenAIAuthoring
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Create}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.GenAIAuthoring ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">GenAI Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                genAiOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.GenAIAuthoring ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {genAiOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {GENAI_TOOL_ITEMS.map(({ label, icon }) => (
                <a
                  key={label}
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigateTo(TrainerPage.GenAIAuthoring); }}
                  className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${subItemClass}`}
                >
                  <Icon name={icon} className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
                  <span className="truncate">{label}</span>
                </a>
              ))}
            </div>
          )}

          {/* Virtual Tools — expandable */}
          <button
            onClick={() => {
              setVirtualToolsOpen(prev => !prev);
              navigateTo(TrainerPage.VirtualTools);
            }}
            className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.VirtualTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Video}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.VirtualTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            <span className="truncate">Virtual Tools</span>
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                virtualToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.VirtualTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />
          </button>

          {virtualToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {VIRTUAL_TOOL_ITEMS.map(({ label, icon, href }) => (
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
      </div>

    </div>
  );
};

export default TrainerSidebar;
