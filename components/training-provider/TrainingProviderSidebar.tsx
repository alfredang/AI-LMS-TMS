import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types';
import { Icon, IconName } from '../ui/Icon';

interface TrainingProviderSidebarProps {
    onNavigate?: () => void;
}

const TrainingProviderSidebar: React.FC<TrainingProviderSidebarProps> = ({ onNavigate }) => {
    const { currentView, handleNavigation, selectedCourse } = useLms();

    const navItems = [
        { view: View.Dashboard, label: 'Dashboard', icon: IconName.Dashboard },
        { view: View.Courses, label: 'Courses', icon: IconName.Courses },
        { view: View.UserManagement, label: 'User Management', icon: IconName.Users },
        { view: View.AdminManagement, label: 'Admin Management', icon: IconName.Admin },
        { view: View.Profile, label: 'Company Setting', icon: IconName.MyAccount },
        { view: View.ApiEndpoints, label: 'API Endpoints', icon: IconName.Link },
        { view: View.Documents, label: 'Documents', icon: IconName.FileText },
    ];

    const handleClick = (view: View) => {
        handleNavigation(view);
        if (onNavigate) {
            onNavigate();
        }
    };

    // Determine active view - if a course is selected, highlight Courses
    const activeView = selectedCourse ? View.Courses : currentView;

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
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeView === item.view
                        ? 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'
                        }`}
                >
                    <Icon name={item.icon} className="w-5 h-5" />
                    <span>{item.label}</span>
                </a>
            ))}

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
