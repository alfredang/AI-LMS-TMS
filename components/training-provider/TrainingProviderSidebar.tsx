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
        { view: View.Profile, label: 'My Profile', icon: IconName.MyAccount },
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
        <nav className="space-y-2 p-4 bg-slate-800 text-white h-full">
            {navItems.map((item) => (
                <a
                    key={item.view}
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        handleClick(item.view);
                    }}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeView === item.view
                        ? 'bg-blue-600/20 text-blue-400 border-l-3 border-blue-500'
                        : 'text-gray-300 hover:bg-slate-700 hover:text-white'
                        }`}
                >
                    <Icon name={item.icon} className="w-5 h-5" />
                    <span>{item.label}</span>
                </a>
            ))}

            {/* Provider Access Info */}
            <div className="mt-6 pt-4 border-t border-gray-700">
                <div className="px-3 py-3 rounded-lg bg-blue-900/30 border border-blue-800">
                    <div className="flex items-center gap-2 mb-1">
                        <Icon name={IconName.Admin} className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-semibold text-blue-300">Provider Access</span>
                    </div>
                    <p className="text-xs text-blue-400">
                        You have full training provider privileges. Handle user data with care.
                    </p>
                </div>
            </div>
        </nav>
    );
};

export default TrainingProviderSidebar;
