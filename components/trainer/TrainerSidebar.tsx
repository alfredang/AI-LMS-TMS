import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { TrainerPage, View } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';
// Tool link catalogue shared with the Learner sidebar — edit components/toolsData.ts.
import {
  ED_TOOL_ITEMS,
  PROJECT_MGT_TOOL_ITEMS,
  PROBLEM_SOLVING_TOOL_ITEMS,
  CYBER_SECURITY_TOOL_ITEMS,
  VIRTUAL_TOOL_ITEMS,
  DATA_ANALYTICS_ITEMS,
  ML_TOOL_ITEMS,
  FINANCE_TOOL_ITEMS,
  HR_TOOL_ITEMS,
  STAT_TOOL_ITEMS,
  DOE_TOOL_ITEMS,
  SPC_TOOL_ITEMS,
  SUSTAINABILITY_TOOL_ITEMS,
  NETWORKING_TOOL_ITEMS,
  K8S_TOOL_ITEMS,
  BLOCKCHAIN_TOOL_ITEMS,
  QUANTUM_TOOL_ITEMS,
  DESIGN_TOOL_ITEMS,
  GENAI_LINK_GROUPS,
  AGENTIC_AI_GROUPS,
} from '@components/toolsData';

interface TrainerSidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
}

const NAV_ITEMS: { page: TrainerPage; label: string; icon: IconName }[] = [
  { page: TrainerPage.MyClasses,          label: 'My Classes',          icon: IconName.BookOpen       },
  { page: TrainerPage.MyCalendar,         label: 'My Calendar',         icon: IconName.Calendar       },
  { page: TrainerPage.EAttendance,        label: 'E-Attendance',        icon: IconName.ClipboardCheck },
  { page: TrainerPage.AssessmentGrading,  label: 'Assessment Grading',  icon: IconName.Award          },
  { page: TrainerPage.TrainingHours,      label: 'Training Hours',      icon: IconName.Clock          },
  { page: TrainerPage.PastAttendance,     label: 'Past Attendance',     icon: IconName.ClipboardCheck },
  { page: TrainerPage.PastAssessment,     label: 'Past Assessment',     icon: IconName.Award          },
];

const TRAINER_GUIDE_ITEMS: { page: TrainerPage; label: string; icon: IconName }[] = [
  { page: TrainerPage.LessonDeliveryGuide, label: 'Physical Class Guide', icon: IconName.BookOpen },
  { page: TrainerPage.VirtualClassGuide,   label: 'Virtual Class Guide',  icon: IconName.BookOpen },
  { page: TrainerPage.AssessmentGuide,     label: 'Assessment Guide',     icon: IconName.BookOpen },
];

const POST_GUIDE_NAV_ITEMS: { page: TrainerPage; label: string; icon: IconName }[] = [
  { page: TrainerPage.PaymentHistory, label: 'Trainer Payout History', icon: IconName.Analytics },
];


const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
const inactiveIconClass = 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white';
const subItemClass = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

const TrainerSidebar: React.FC<TrainerSidebarProps> = ({ onNavigate, collapsed = false }) => {
  const { trainerPage, setTrainerPage, setCurrentView, setSelectedCourse } = useLms();
  const [trainerGuidesOpen, setTrainerGuidesOpen] = useState(
    trainerPage === TrainerPage.LessonDeliveryGuide ||
    trainerPage === TrainerPage.VirtualClassGuide ||
    trainerPage === TrainerPage.AssessmentGuide
  );
  const [edToolsOpen, setEdToolsOpen] = useState(trainerPage === TrainerPage.EdTools);
  const [projectMgtOpen, setProjectMgtOpen] = useState(trainerPage === TrainerPage.ProjectMgtTools);
  const [problemSolvingOpen, setProblemSolvingOpen] = useState(trainerPage === TrainerPage.ProblemSolvingTools);
  const [cyberSecurityOpen, setCyberSecurityOpen] = useState(trainerPage === TrainerPage.CyberSecurityTools);
  const [dataAnalyticsOpen, setDataAnalyticsOpen] = useState(trainerPage === TrainerPage.DataAnalyticsTools);
  const [mlToolsOpen, setMlToolsOpen] = useState(trainerPage === TrainerPage.MLTools);
  const [financeToolsOpen, setFinanceToolsOpen] = useState(trainerPage === TrainerPage.FinanceTools);
  const [hrToolsOpen, setHrToolsOpen] = useState(trainerPage === TrainerPage.HRTools);
  const [statToolsOpen, setStatToolsOpen] = useState(trainerPage === TrainerPage.StatTools);
  const [doeToolsOpen, setDoeToolsOpen] = useState(trainerPage === TrainerPage.DoeTools);
  const [spcToolsOpen, setSpcToolsOpen] = useState(trainerPage === TrainerPage.SpcTools);
  const [videoCreationToolsOpen, setVideoCreationToolsOpen] = useState(trainerPage === TrainerPage.VideoCreationTools);
  const [sustainabilityToolsOpen, setSustainabilityToolsOpen] = useState(trainerPage === TrainerPage.SustainabilityTools);
  const [networkingToolsOpen, setNetworkingToolsOpen] = useState(trainerPage === TrainerPage.NetworkingTools);
  const [k8sToolsOpen, setK8sToolsOpen] = useState(trainerPage === TrainerPage.K8sTools);
  const [blockchainToolsOpen, setBlockchainToolsOpen] = useState(trainerPage === TrainerPage.BlockchainTools);
  const [quantumToolsOpen, setQuantumToolsOpen] = useState(trainerPage === TrainerPage.QuantumTools);
  const [designToolsOpen, setDesignToolsOpen] = useState(trainerPage === TrainerPage.DesignTools);
  const [genAiOpen, setGenAiOpen] = useState(trainerPage === TrainerPage.GenAIAuthoring);
  const [genAiSubOpen, setGenAiSubOpen] = useState<Record<string, boolean>>({});
  const [virtualToolsOpen, setVirtualToolsOpen] = useState(trainerPage === TrainerPage.VirtualTools);
  const [agenticAiOpen, setAgenticAiOpen] = useState(trainerPage === TrainerPage.AgenticAITools);
  const [agenticAiSubOpen, setAgenticAiSubOpen] = useState<Record<string, boolean>>({});

  const navigateTo = (page: TrainerPage) => {
    setSelectedCourse(null);
    setCurrentView(View.Dashboard);
    setTrainerPage(page);
    onNavigate?.();
  };

  return (
    <div className="flex flex-col h-full bg-surface border-r border-default">

      {/* Nav Items */}
      <div className="flex-1 px-2 py-4">
        {!collapsed && (
          <p className="px-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
            Menu
          </p>
        )}

        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ page, label, icon }) => (
            <a
              key={page}
              href="#"
              title={collapsed ? label : undefined}
              onClick={(e) => { e.preventDefault(); navigateTo(page); }}
              className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
              {!collapsed && <span className="truncate">{label}</span>}
            </a>
          ))}

          {POST_GUIDE_NAV_ITEMS.map(({ page, label, icon }) => (
            <a
              key={page}
              href="#"
              title={collapsed ? label : undefined}
              onClick={(e) => { e.preventDefault(); navigateTo(page); }}
              className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
              {!collapsed && <span className="truncate">{label}</span>}
            </a>
          ))}

          {/* Trainer Guides — expandable */}
          {(() => {
            const guidesActive =
              trainerPage === TrainerPage.TrainerGuides ||
              TRAINER_GUIDE_ITEMS.some(g => g.page === trainerPage);
            return (
              <>
                <button
                  onClick={() => {
                    setTrainerGuidesOpen(prev => !prev);
                    navigateTo(TrainerPage.TrainerGuides);
                  }}
                  title={collapsed ? 'Trainer Guides' : undefined}
                  className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
                    guidesActive ? 'bg-primary/10 text-primary' : inactiveClass
                  }`}
                >
                  <Icon
                    name={IconName.BookOpen}
                    className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                      guidesActive ? 'text-primary' : inactiveIconClass
                    }`}
                  />
                  {!collapsed && <span className="truncate">Trainer Guides</span>}
                  {!collapsed && (
                    <Icon
                      name={IconName.ChevronDown}
                      className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                        trainerGuidesOpen ? 'rotate-0' : '-rotate-90'
                      } ${guidesActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
                    />
                  )}
                </button>

                {!collapsed && trainerGuidesOpen && (
                  <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
                    {TRAINER_GUIDE_ITEMS.map(({ page, label, icon }) => (
                      <a
                        key={page}
                        href="#"
                        onClick={(e) => { e.preventDefault(); navigateTo(page); }}
                        className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${
                          trainerPage === page ? 'bg-primary/10 text-primary' : subItemClass
                        }`}
                      >
                        <Icon
                          name={icon}
                          className={`w-4 h-4 flex-shrink-0 transition-colors ${
                            trainerPage === page
                              ? 'text-primary'
                              : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white'
                          }`}
                        />
                        <span className="truncate">{label}</span>
                      </a>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Divider — Tools */}
        <div className="mt-4 mb-2 px-2">
          <div className="border-t border-default" />
          {!collapsed && (
            <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
              Tools
            </p>
          )}
        </div>

        <div className="space-y-0.5">

          {/* Ed Tools — expandable */}
          <button
            onClick={() => {
              setEdToolsOpen(prev => !prev);
              navigateTo(TrainerPage.EdTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">Ed Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                edToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.EdTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && edToolsOpen && (
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

          {/* Project Mgt Tools — expandable */}
          <button
            onClick={() => {
              setProjectMgtOpen(prev => !prev);
              navigateTo(TrainerPage.ProjectMgtTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.ProjectMgtTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.ClipboardCheck}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.ProjectMgtTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Project Mgt Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                projectMgtOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.ProjectMgtTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && projectMgtOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {PROJECT_MGT_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Problem Solving Tools — expandable */}
          <button
            onClick={() => {
              setProblemSolvingOpen(prev => !prev);
              navigateTo(TrainerPage.ProblemSolvingTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.ProblemSolvingTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Help}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.ProblemSolvingTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Six Sigma Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                problemSolvingOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.ProblemSolvingTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && problemSolvingOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {PROBLEM_SOLVING_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Cyber Security Tools — expandable */}
          <button
            onClick={() => {
              setCyberSecurityOpen(prev => !prev);
              navigateTo(TrainerPage.CyberSecurityTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.CyberSecurityTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Shield}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.CyberSecurityTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Cyber Security Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                cyberSecurityOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.CyberSecurityTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && cyberSecurityOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {CYBER_SECURITY_TOOL_ITEMS.map(({ label, icon, href }) => (
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
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">Finance Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                financeToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.FinanceTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && financeToolsOpen && (
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

          {/* HR Tools — expandable */}
          <button
            onClick={() => {
              setHrToolsOpen(prev => !prev);
              navigateTo(TrainerPage.HRTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.HRTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.HRTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">HR Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                hrToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.HRTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && hrToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {HR_TOOL_ITEMS.map(({ label, icon, href }) => (
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
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">Data Analytics Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                dataAnalyticsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.DataAnalyticsTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && dataAnalyticsOpen && (
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

          {/* ML Tools — expandable */}
          <button
            onClick={() => {
              setMlToolsOpen(prev => !prev);
              navigateTo(TrainerPage.MLTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.MLTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.MLTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">ML Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                mlToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.MLTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && mlToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {ML_TOOL_ITEMS.map(({ label, icon, href }) => (
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
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">Statistical Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                statToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.StatTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && statToolsOpen && (
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
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">DOE Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                doeToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.DoeTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && doeToolsOpen && (
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
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">SPC Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                spcToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.SpcTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && spcToolsOpen && (
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

          {/* Sustainability Tools — expandable */}
          <button
            onClick={() => {
              setSustainabilityToolsOpen(prev => !prev);
              navigateTo(TrainerPage.SustainabilityTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.SustainabilityTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.SustainabilityTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Sustainability Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                sustainabilityToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.SustainabilityTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && sustainabilityToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {SUSTAINABILITY_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Networking Tools — expandable */}
          <button
            onClick={() => {
              setNetworkingToolsOpen(prev => !prev);
              navigateTo(TrainerPage.NetworkingTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.NetworkingTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.NetworkingTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Networking Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                networkingToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.NetworkingTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && networkingToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {NETWORKING_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* K8s Tools — expandable */}
          <button
            onClick={() => {
              setK8sToolsOpen(prev => !prev);
              navigateTo(TrainerPage.K8sTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.K8sTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Analytics}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.K8sTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">K8s Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                k8sToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.K8sTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && k8sToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {K8S_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Blockchain Tools — expandable */}
          <button
            onClick={() => {
              setBlockchainToolsOpen(prev => !prev);
              navigateTo(TrainerPage.BlockchainTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.BlockchainTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Award}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.BlockchainTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Blockchain Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                blockchainToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.BlockchainTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && blockchainToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {BLOCKCHAIN_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Quantum Tools — expandable */}
          <button
            onClick={() => {
              setQuantumToolsOpen(prev => !prev);
              navigateTo(TrainerPage.QuantumTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.QuantumTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Sync}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.QuantumTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Quantum Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                quantumToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.QuantumTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && quantumToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {QUANTUM_TOOL_ITEMS.map(({ label, icon, href }) => (
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

          {/* Design Tools — expandable */}
          <button
            onClick={() => {
              setDesignToolsOpen(prev => !prev);
              navigateTo(TrainerPage.DesignTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.DesignTools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Create}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.DesignTools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Design Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                designToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.DesignTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && designToolsOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {DESIGN_TOOL_ITEMS.map(({ label, icon, href }) => (
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
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">GenAI Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                genAiOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.GenAIAuthoring ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && genAiOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {GENAI_LINK_GROUPS.map(({ category, items }) => (
                <div key={category}>
                  <button
                    onClick={() => setGenAiSubOpen(prev => ({ ...prev, [category]: !prev[category] }))}
                    className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none mt-1`}
                  >
                    <Icon
                      name={IconName.ChevronDown}
                      className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 text-gray-400 dark:text-gray-500 ${
                        genAiSubOpen[category] ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                    <span>{category}</span>
                  </button>
                  {genAiSubOpen[category] && items.map(({ label, icon, href }) => (
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
              ))}
            </div>
          )}

          {/* Agentic AI Tools — expandable */}
          <button
            onClick={() => {
              setAgenticAiOpen(prev => !prev);
              navigateTo(TrainerPage.AgenticAITools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              trainerPage === TrainerPage.AgenticAITools
                ? 'bg-primary/10 text-primary'
                : inactiveClass
            }`}
          >
            <Icon
              name={IconName.Link}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                trainerPage === TrainerPage.AgenticAITools ? 'text-primary' : inactiveIconClass
              }`}
            />
            {!collapsed && <span className="truncate">Agentic AI Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                agenticAiOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.AgenticAITools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && agenticAiOpen && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {AGENTIC_AI_GROUPS.map(({ category, items }) => (
                <div key={category}>
                  <button
                    onClick={() => setAgenticAiSubOpen(prev => ({ ...prev, [category]: !prev[category] }))}
                    className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none mt-1`}
                  >
                    <Icon
                      name={IconName.ChevronDown}
                      className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 text-gray-400 dark:text-gray-500 ${
                        agenticAiSubOpen[category] ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                    <span>{category}</span>
                  </button>
                  {agenticAiSubOpen[category] && items.map(({ label, icon, href }) => (
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
              ))}
            </div>
          )}

          {/* Virtual Tools — expandable */}
          <button
            onClick={() => {
              setVirtualToolsOpen(prev => !prev);
              navigateTo(TrainerPage.VirtualTools);
            }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
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
            {!collapsed && <span className="truncate">Virtual Tools</span>}
            {!collapsed && <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                virtualToolsOpen ? 'rotate-0' : '-rotate-90'
              } ${trainerPage === TrainerPage.VirtualTools ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
            />}
          </button>

          {!collapsed && virtualToolsOpen && (
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
