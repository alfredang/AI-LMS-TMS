import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types';
import { Icon, IconName } from '../ui/Icon';

interface TrainingProviderSidebarProps {
    onNavigate?: () => void;
}

const TrainingProviderSidebar: React.FC<TrainingProviderSidebarProps> = ({ onNavigate }) => {
    const { currentView, handleNavigation, selectedCourse } = useLms();

    const templateViews = [View.OtpEmailTemplate, View.CertificateEmailTemplate, View.FeedbackEmailTemplate, View.PasswordResetEmailTemplate, View.TrainerInvitationEmailTemplate, View.FinalCourseConfirmationEmailTemplate, View.CourseConfirmationEmailTemplate, View.PrivacyPolicy, View.AcceptableUsePolicy];
    const [templatesOpen, setTemplatesOpen] = useState(templateViews.includes(currentView));
    const [usefulLinksOpen, setUsefulLinksOpen] = useState(false);

    const navItems = [
        { view: View.Dashboard, label: 'Dashboard', icon: IconName.Dashboard },
        { view: View.Courses, label: 'Courses', icon: IconName.Courses },
        { view: View.UserManagement, label: 'User Management', icon: IconName.Users },
        { view: View.AdminManagement, label: 'Role Management', icon: IconName.Admin },
        { view: View.FinanceManagement, label: 'Finance Management', icon: IconName.DollarSign },
        { view: View.Profile, label: 'Company Setting', icon: IconName.MyAccount },
        { view: View.SsgApiSummary, label: 'SSG API Summary', icon: IconName.ClipboardCheck },
        { view: View.ApiEndpoints, label: 'API Endpoints', icon: IconName.Link },
        { view: View.Documents, label: 'Documents', icon: IconName.FileText },
        { view: View.Scheduler, label: 'Task Scheduler', icon: IconName.Calendar },
    ];

    const templateItems = [
        { view: View.OtpEmailTemplate, label: 'OTP Email', icon: IconName.Mail },
        { view: View.CertificateEmailTemplate, label: 'Certificate Email', icon: IconName.Award },
        { view: View.FeedbackEmailTemplate, label: 'Feedback Email', icon: IconName.Chat },
        { view: View.PasswordResetEmailTemplate, label: 'Password Reset Email', icon: IconName.Shield },
        { view: View.TrainerInvitationEmailTemplate, label: 'Trainer Invitation Email', icon: IconName.Send },
        { view: View.FinalCourseConfirmationEmailTemplate, label: 'Final Course Confirmation Email', icon: IconName.Send },
        { view: View.CourseConfirmationEmailTemplate, label: 'Course Confirmation Email', icon: IconName.Send },
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
            {navItems.map((item) => (
                <a
                    key={item.view}
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        handleClick(item.view);
                    }}
                    className={linkClass(item.view)}
                >
                    <Icon name={item.icon} className="w-5 h-5" />
                    <span>{item.label}</span>
                </a>
            ))}

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
        </nav>
    );
};

export default TrainingProviderSidebar;
