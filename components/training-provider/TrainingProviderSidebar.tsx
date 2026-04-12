import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { useAppVersion } from '@hooks/useAppVersion';
import { View } from '@app-types';
import { Icon, IconName } from '../ui/Icon';

interface TrainingProviderSidebarProps {
    onNavigate?: () => void;
    onSelectWorkflow?: (workflowId: string) => void;
}

const TrainingProviderSidebar: React.FC<TrainingProviderSidebarProps> = ({ onNavigate, onSelectWorkflow }) => {
    const { currentView, handleNavigation, selectedCourse } = useLms();
    const appVersion = useAppVersion();

    const templateViews = [View.OtpEmailTemplate, View.CertificateEmailTemplate, View.FeedbackEmailTemplate, View.PasswordResetEmailTemplate, View.TrainerInvitationEmailTemplate, View.TrainerResponseEmailTemplates, View.FinalCourseConfirmationEmailTemplate, View.CourseConfirmationEmailTemplate, View.CoursewareAttendanceEmailTemplate, View.PrivacyPolicy, View.AcceptableUsePolicy];
    const cronJobsViews = [View.Scheduler, View.SchedulerSummary];
    const [templatesOpen, setTemplatesOpen] = useState(templateViews.includes(currentView));
    const [workflowsOpen, setWorkflowsOpen] = useState(currentView === View.WorkflowGuides);
    const [wfTrainingOpen, setWfTrainingOpen] = useState(false);
    const [wfAdminOpen, setWfAdminOpen] = useState(false);
    const [wfFinanceOpen, setWfFinanceOpen] = useState(false);
    const [usefulLinksOpen, setUsefulLinksOpen] = useState(false);
    const [cronJobsOpen, setCronJobsOpen] = useState(cronJobsViews.includes(currentView));

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

    const linkClass = (view: View) =>
        `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeView === view
            ? 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'
        }`;

    return (
        <nav className="space-y-2 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
            {/* Dashboard */}
            <a href="#" onClick={(e) => { e.preventDefault(); handleClick(View.Dashboard); }} className={linkClass(View.Dashboard)}>
                <Icon name={IconName.Dashboard} className="w-5 h-5" />
                <span>Training Dashboard</span>
            </a>

            {/* Workflow Guides - Collapsible (after Dashboard) */}
            <div>
                <button
                    onClick={() => { setWorkflowsOpen(!workflowsOpen); handleClick(View.WorkflowGuides); onSelectWorkflow?.(''); }}
                    className={`flex items-center justify-between w-full rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeView === View.WorkflowGuides ? 'bg-blue-50 text-blue-600 dark:bg-blue-600/20 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'}`}
                >
                    <div className="flex items-center gap-3">
                        <Icon name={IconName.BookOpen} className="w-5 h-5" />
                        <span>Workflow Guides</span>
                    </div>
                    <Icon name={IconName.ChevronDown} className={`w-4 h-4 transition-transform ${workflowsOpen ? 'rotate-180' : ''}`} />
                </button>
                {workflowsOpen && (
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
                <a key={item.view} href="#" onClick={(e) => { e.preventDefault(); handleClick(item.view); }} className={linkClass(item.view)}>
                    <Icon name={item.icon} className="w-5 h-5" />
                    <span>{item.label}</span>
                </a>
            ))}

            {navItemsBottom.map((item) => (
                <a key={item.view} href="#" onClick={(e) => { e.preventDefault(); handleClick(item.view); }} className={linkClass(item.view)}>
                    <Icon name={item.icon} className="w-5 h-5" />
                    <span>{item.label}</span>
                </a>
            ))}

            {/* Cron Jobs - Collapsible */}
            <div>
                <button
                    onClick={() => setCronJobsOpen(!cronJobsOpen)}
                    className={`flex items-center justify-between w-full rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${cronJobsViews.includes(activeView)
                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-600/20 dark:text-blue-400'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'}`}
                >
                    <div className="flex items-center gap-3">
                        <Icon name={IconName.Clock} className="w-5 h-5" />
                        <span>Cron Jobs</span>
                    </div>
                    <Icon
                        name={IconName.ChevronDown}
                        className={`w-4 h-4 transition-transform ${cronJobsOpen ? 'rotate-180' : ''}`}
                    />
                </button>
                {cronJobsOpen && (
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

            {/* Templates Section - Collapsible */}
            <div>
                <button
                    onClick={() => setTemplatesOpen(!templatesOpen)}
                    className="flex items-center justify-between w-full rounded-md px-3 py-2.5 text-sm font-medium transition-colors text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                    <div className="flex items-center gap-3">
                        <Icon name={IconName.FileText} className="w-5 h-5" />
                        <span>Templates</span>
                    </div>
                    <Icon
                        name={IconName.ChevronDown}
                        className={`w-4 h-4 transition-transform ${templatesOpen ? 'rotate-180' : ''}`}
                    />
                </button>
                {templatesOpen && (
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
                    className="flex items-center justify-between w-full rounded-md px-3 py-2.5 text-sm font-medium transition-colors text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                    <div className="flex items-center gap-3">
                        <Icon name={IconName.ExternalLink} className="w-5 h-5" />
                        <span>Useful Links</span>
                    </div>
                    <Icon
                        name={IconName.ChevronDown}
                        className={`w-4 h-4 transition-transform ${usefulLinksOpen ? 'rotate-180' : ''}`}
                    />
                </button>
                {usefulLinksOpen && (
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

            <div className="pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
                <p className="px-3 text-[10px] text-gray-400 dark:text-gray-300 font-mono">version {appVersion}</p>
            </div>
        </nav>
    );
};

export default TrainingProviderSidebar;
