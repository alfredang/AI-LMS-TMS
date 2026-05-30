import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { useAppVersion } from '@hooks/useAppVersion';
import { View, AdminPage } from '@app-types';
import { Icon, IconName } from '../ui/Icon';

interface TrainingProviderSidebarProps {
    onNavigate?: () => void;
    onSelectWorkflow?: (workflowId: string) => void;
    collapsed?: boolean;
}

const TrainingProviderSidebar: React.FC<TrainingProviderSidebarProps> = ({ onNavigate, onSelectWorkflow, collapsed = false }) => {
    const { currentView, handleNavigation, selectedCourse, adminPage, setAdminPage } = useLms();
    const appVersion = useAppVersion();

    const templateViews = [View.OtpEmailTemplate, View.CertificateEmailTemplate, View.FeedbackEmailTemplate, View.PasswordResetEmailTemplate, View.TrainerInvitationEmailTemplate, View.TrainerResponseEmailTemplates, View.FinalCourseConfirmationEmailTemplate, View.CourseConfirmationEmailTemplate, View.CoursewareAttendanceEmailTemplate, View.CourseCompletionEmailTemplate, View.ProformaInvoiceEmailTemplate, View.PrivacyPolicy, View.AcceptableUsePolicy];
    const cronJobsViews = [View.Scheduler, View.SchedulerSummary];
    const [templatesOpen, setTemplatesOpen] = useState(templateViews.includes(currentView));
    const [workflowsOpen, setWorkflowsOpen] = useState(currentView === View.WorkflowGuides);
    const [wfTrainingOpen, setWfTrainingOpen] = useState(false);
    const [wfAdminOpen, setWfAdminOpen] = useState(false);
    const [wfFinanceOpen, setWfFinanceOpen] = useState(false);
    const [usefulLinksOpen, setUsefulLinksOpen] = useState(false);
    const [cronJobsOpen, setCronJobsOpen] = useState(cronJobsViews.includes(currentView));
    const [loggingOpen, setLoggingOpen] = useState(false);
    const feedbackFormViews = [View.FeedbackForm, View.FeedbackFormResponses];
    const [feedbackFormOpen, setFeedbackFormOpen] = useState(feedbackFormViews.includes(currentView));
    const feedbackFormItems = [
        { view: View.FeedbackForm, label: 'Form Builder', icon: IconName.Edit },
        { view: View.FeedbackFormResponses, label: 'Responses', icon: IconName.ClipboardCheck },
    ];

    const navItemsTop = [
        { view: View.Dashboard, label: 'Training Dashboard', icon: IconName.Dashboard },
        { view: View.Courses, label: 'Course Management', icon: IconName.Courses },
        { view: View.UserManagement, label: 'User Management', icon: IconName.Users },
        { view: View.AdminManagement, label: 'Role Management', icon: IconName.Admin },
        { view: View.FinanceManagement, label: 'Finance Management', icon: IconName.DollarSign },
        { view: View.Profile, label: 'Company Setting', icon: IconName.MyAccount },
    ];

    const navItemsBottom = [
        { view: View.SsgApiSummary, label: 'SSG API Summary', icon: IconName.ClipboardCheck },
        { view: View.ApiEndpoints, label: 'API Endpoints', icon: IconName.Link },
        { view: View.Webhooks, label: 'Webhooks', icon: IconName.Link },
    ];

    const cronJobsItems = [
        { view: View.SchedulerSummary, label: 'Schedule Summary', icon: IconName.ClipboardCheck },
        { view: View.Scheduler, label: 'Task Scheduler', icon: IconName.Calendar },
    ];

    const loggingItems = [
        { page: AdminPage.AutomationLogs, label: 'Auto Create Learner Log' },
        { page: AdminPage.TrainerFolderLogs, label: 'Auto Create Assessment Records Log' },
        { page: AdminPage.AutoCreateCertificatesLog, label: 'Auto Create Certificates Log' },
        { page: AdminPage.CourseRunDateSyncLogs, label: 'Course Run Date Sync Log' },
        { page: AdminPage.UpcomingCourseRunsLog, label: 'TGS Enrolments & Assign Trainers Log' },
        { page: AdminPage.SyncTrainerTpgLogs, label: 'Sync Trainer to TPG Log' },
        { page: AdminPage.AutoSendTrainerInvitationLog, label: 'Auto Send Trainer Invitation Log' },
        { page: AdminPage.AutoSendCoursewareAttendanceLog, label: 'Auto Send Courseware & Attendance Log' },
        { page: AdminPage.AutoSendCourseCompletionLog, label: 'Auto Send Course Completion Log' },
        { page: AdminPage.AutoSanitiseDataLog, label: 'Auto Sanitise Data Log' },
        { page: AdminPage.CourseConfirmationEmailLogs, label: 'Course Confirmation Email' },
    ];

    const templateItems = [
        { view: View.OtpEmailTemplate, label: 'OTP Email', icon: IconName.Mail },
        { view: View.CertificateEmailTemplate, label: 'Certificate Email', icon: IconName.Award },
        { view: View.FeedbackEmailTemplate, label: 'Feedback Email', icon: IconName.Chat },
        { view: View.PasswordResetEmailTemplate, label: 'Password Reset Email', icon: IconName.Shield },
        { view: View.TrainerInvitationEmailTemplate, label: 'Trainer Invitation Email', icon: IconName.Send },
        { view: View.TrainerResponseEmailTemplates, label: 'Trainer Accept/Decline Email', icon: IconName.Mail },
        { view: View.FinalCourseConfirmationEmailTemplate, label: 'Final Class Confirm Email', icon: IconName.Send },
        { view: View.CourseConfirmationEmailTemplate, label: 'Class Confirm Email', icon: IconName.Send },
        { view: View.CoursewareAttendanceEmailTemplate, label: 'Courseware and Attendance Taking', icon: IconName.Send },
        { view: View.CourseCompletionEmailTemplate, label: 'Course Completion and Thank You', icon: IconName.Award },
        { view: View.ProformaInvoiceEmailTemplate, label: 'Proforma Invoice Email', icon: IconName.FileText },
        { view: View.PrivacyPolicy, label: 'Privacy Policy', icon: IconName.Shield },
        { view: View.AcceptableUsePolicy, label: 'Acceptable Use Policy', icon: IconName.ClipboardCheck },
    ];

    const handleClick = (view: View) => {
        handleNavigation(view);
        if (onNavigate) {
            onNavigate();
        }
    };

    // Determine active view - if a course is selected, highlight Courses
    const activeView = selectedCourse ? View.Courses : currentView;

    const activeClass = 'bg-primary/10 text-primary font-semibold';
    const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

    const linkClass = (view: View) =>
        `group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${activeView === view ? activeClass : inactiveClass}`;

    return (
        <nav className="space-y-1 px-2 py-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
            {/* Dashboard */}
            <a href="#" title={collapsed ? 'Training Dashboard' : undefined} onClick={(e) => { e.preventDefault(); handleClick(View.Dashboard); }} className={linkClass(View.Dashboard)}>
                <Icon name={IconName.Dashboard} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${activeView === View.Dashboard ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                {!collapsed && <span className="truncate">Training Dashboard</span>}
            </a>

            {/* Workflow Guides - Collapsible (after Dashboard) */}
            <div>
                <button
                    onClick={() => { setWorkflowsOpen(!workflowsOpen); handleClick(View.WorkflowGuides); onSelectWorkflow?.(''); }}
                    title={collapsed ? 'Workflow Guides' : undefined}
                    className={linkClass(View.WorkflowGuides)}
                >
                    <Icon name={IconName.BookOpen} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${activeView === View.WorkflowGuides ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                    {!collapsed && <span className="truncate flex-1 text-left">Workflow Guides</span>}
                    {!collapsed && <Icon name={IconName.ChevronDown} className={`w-4 h-4 flex-shrink-0 transition-transform ${workflowsOpen ? 'rotate-180' : ''}`} />}
                </button>
                {!collapsed && workflowsOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                        {/* Training */}
                        <button onClick={() => setWfTrainingOpen(!wfTrainingOpen)} className="w-full flex items-center justify-between px-3 py-1.5 group cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md">
                            <span className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wider">Training</span>
                            <Icon name={IconName.ChevronDown} className={`w-3 h-3 text-gray-400 transition-transform ${wfTrainingOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {wfTrainingOpen && [
                            { id: 'lesson-delivery', label: 'Lesson Delivery', icon: '📚' },
                            { id: 'assessment', label: 'Assessment', icon: '📝' },
                        ].map(item => (
                            <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); handleClick(View.WorkflowGuides); onSelectWorkflow?.(item.id); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
                                <span className="text-sm">{item.icon}</span>
                                <span>{item.label}</span>
                            </a>
                        ))}
                        {/* Admin */}
                        <button onClick={() => setWfAdminOpen(!wfAdminOpen)} className="w-full flex items-center justify-between px-3 py-1.5 group cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md">
                            <span className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wider">Admin</span>
                            <Icon name={IconName.ChevronDown} className={`w-3 h-3 text-gray-400 transition-transform ${wfAdminOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {wfAdminOpen && [
                            { id: 'ssg-process-steps', label: 'SSG Process Steps', icon: '🏛️' },
                            { id: 'direct-application', label: 'Direct Application', icon: '📋' },
                            { id: 'certificate', label: 'Certificate', icon: '🎓' },
                            { id: 'trainer-invitation', label: 'Trainer Invitation', icon: '📨' },
                        ].map(item => (
                            <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); handleClick(View.WorkflowGuides); onSelectWorkflow?.(item.id); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
                                <span className="text-sm">{item.icon}</span>
                                <span>{item.label}</span>
                            </a>
                        ))}
                        {/* Finance */}
                        <button onClick={() => setWfFinanceOpen(!wfFinanceOpen)} className="w-full flex items-center justify-between px-3 py-1.5 group cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md">
                            <span className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wider">Finance</span>
                            <Icon name={IconName.ChevronDown} className={`w-3 h-3 text-gray-400 transition-transform ${wfFinanceOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {wfFinanceOpen && [
                            { id: 'billing-history', label: 'Billing History', icon: '💰' },
                            { id: 'proforma-invoice', label: 'Proforma Invoice', icon: '🧾' },
                            { id: 'personal-invoice', label: 'Personal Invoice', icon: '📄' },
                            { id: 'company-invoice', label: 'Company Invoice', icon: '🏢' },
                            { id: 'receipt', label: 'Receipt', icon: '🧾' },
                        ].map(item => (
                            <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); handleClick(View.WorkflowGuides); onSelectWorkflow?.(item.id); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
                                <span className="text-sm">{item.icon}</span>
                                <span>{item.label}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {/* Remaining nav items */}
            {navItemsTop.filter(item => item.view !== View.Dashboard).map((item) => (
                <a key={item.view} href="#" title={collapsed ? item.label : undefined} onClick={(e) => { e.preventDefault(); handleClick(item.view); }} className={linkClass(item.view)}>
                    <Icon name={item.icon} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${activeView === item.view ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                </a>
            ))}

            {navItemsBottom.map((item) => (
                <a key={item.view} href="#" title={collapsed ? item.label : undefined} onClick={(e) => { e.preventDefault(); handleClick(item.view); }} className={linkClass(item.view)}>
                    <Icon name={item.icon} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${activeView === item.view ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                </a>
            ))}

            {/* Feedback Form - Collapsible */}
            <div>
                <button
                    onClick={() => setFeedbackFormOpen(!feedbackFormOpen)}
                    title={collapsed ? 'Feedback Form' : undefined}
                    className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${feedbackFormViews.includes(activeView) ? activeClass : inactiveClass}`}
                >
                    <Icon name={IconName.Chat} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${feedbackFormViews.includes(activeView) ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                    {!collapsed && <span className="truncate flex-1 text-left">Feedback Form</span>}
                    {!collapsed && <Icon name={IconName.ChevronDown} className={`w-4 h-4 flex-shrink-0 transition-transform ${feedbackFormOpen ? 'rotate-180' : ''}`} />}
                </button>
                {!collapsed && feedbackFormOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                        {feedbackFormItems.map((item) => (
                            <a
                                key={item.view}
                                href="#"
                                onClick={(e) => { e.preventDefault(); handleClick(item.view); }}
                                className={linkClass(item.view)}
                            >
                                <Icon name={item.icon} className="w-4 h-4" />
                                <span>{item.label}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {/* Cron Jobs - Collapsible */}
            <div>
                <button
                    onClick={() => setCronJobsOpen(!cronJobsOpen)}
                    title={collapsed ? 'Cron Jobs' : undefined}
                    className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${cronJobsViews.includes(activeView) ? activeClass : inactiveClass}`}
                >
                    <Icon name={IconName.Clock} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${cronJobsViews.includes(activeView) ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                    {!collapsed && <span className="truncate flex-1 text-left">Cron Jobs</span>}
                    {!collapsed && <Icon name={IconName.ChevronDown} className={`w-4 h-4 flex-shrink-0 transition-transform ${cronJobsOpen ? 'rotate-180' : ''}`} />}
                </button>
                {!collapsed && cronJobsOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                        {cronJobsItems.map((item) => (
                            <a
                                key={item.view}
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleClick(item.view);
                                }}
                                className={linkClass(item.view)}
                            >
                                <Icon name={item.icon} className="w-4 h-4" />
                                <span>{item.label}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {/* Logging - Collapsible */}
            <div>
                <button
                    onClick={() => setLoggingOpen(!loggingOpen)}
                    title={collapsed ? 'Logging' : undefined}
                    className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${currentView === View.Scheduler && loggingItems.some(i => i.page === adminPage) ? activeClass : inactiveClass}`}
                >
                    <Icon name={IconName.FileText} className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${currentView === View.Scheduler && loggingItems.some(i => i.page === adminPage) ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`} />
                    {!collapsed && <span className="truncate flex-1 text-left">Logging</span>}
                    {!collapsed && <Icon name={IconName.ChevronDown} className={`w-4 h-4 flex-shrink-0 transition-transform ${loggingOpen ? 'rotate-180' : ''}`} />}
                </button>
                {!collapsed && loggingOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                        {loggingItems.map((item) => {
                            const isActive = currentView === View.Scheduler && adminPage === item.page;
                            return (
                                <a
                                    key={item.page}
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        setAdminPage(item.page);
                                        handleClick(View.Scheduler);
                                    }}
                                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'}`}
                                >
                                    <span>{item.label}</span>
                                </a>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Templates Section - Collapsible */}
            <div>
                <button
                    onClick={() => setTemplatesOpen(!templatesOpen)}
                    title={collapsed ? 'Templates' : undefined}
                    className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
                >
                    <Icon name={IconName.Mail} className="w-[18px] h-[18px] flex-shrink-0 text-gray-400 dark:text-gray-500" />
                    {!collapsed && <span className="truncate flex-1 text-left">Templates</span>}
                    {!collapsed && <Icon name={IconName.ChevronDown} className={`w-4 h-4 flex-shrink-0 transition-transform ${templatesOpen ? 'rotate-180' : ''}`} />}
                </button>
                {!collapsed && templatesOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                        {templateItems.map((item) => (
                            <a
                                key={item.view}
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    handleClick(item.view);
                                }}
                                className={linkClass(item.view)}
                            >
                                <Icon name={item.icon} className="w-4 h-4" />
                                <span>{item.label}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {/* Useful Links - Collapsible */}
            <div>
                <button
                    onClick={() => setUsefulLinksOpen(!usefulLinksOpen)}
                    title={collapsed ? 'Useful Links' : undefined}
                    className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
                >
                    <Icon name={IconName.ExternalLink} className="w-[18px] h-[18px] flex-shrink-0 text-gray-400 dark:text-gray-500" />
                    {!collapsed && <span className="truncate flex-1 text-left">Useful Links</span>}
                    {!collapsed && <Icon name={IconName.ChevronDown} className={`w-4 h-4 flex-shrink-0 transition-transform ${usefulLinksOpen ? 'rotate-180' : ''}`} />}
                </button>
                {!collapsed && usefulLinksOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                        <a
                            href="https://ssg-api-portal.vercel.app/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                        >
                            <Icon name={IconName.Link} className="w-4 h-4" />
                            <span>SSG API Portal</span>
                            <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto opacity-50" />
                        </a>
                        <a
                            href="https://developer.ssg-wsg.gov.sg/webapp/home"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                        >
                            <Icon name={IconName.Link} className="w-4 h-4" />
                            <span>SSG Developer</span>
                            <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto opacity-50" />
                        </a>
                    </div>
                )}
            </div>

            {/* Provider Access Info */}
            {!collapsed && (
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="px-3 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 mb-1">
                            <Icon name={IconName.Admin} className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Provider Access</span>
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                            You have full training provider privileges. Handle user data with care.
                        </p>
                    </div>
                </div>
            )}
        </nav>
    );
};

export default TrainingProviderSidebar;