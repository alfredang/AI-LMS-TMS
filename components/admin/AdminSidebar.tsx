import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

interface NavSectionProps {
    title: string;
    children: React.ReactNode;
}

const NavSection: React.FC<NavSectionProps> = ({ title, children }) => (
    <div>
        <h3 className="px-3 text-xs font-semibold uppercase text-gray-500 tracking-wider dark:text-gray-400">{title}</h3>
        <div className="mt-2 space-y-1" role="group" aria-labelledby={`${title}-heading`}>
            {children}
        </div>
    </div>
);

interface AdminSidebarProps {
    onNavigate?: () => void;
}

const AdminSidebar: React.FC<AdminSidebarProps> = ({ onNavigate }) => {
    const { adminPage, setAdminPage, setEditingCourseRun } = useLms();

    const NavItem: React.FC<{ page: AdminPage; isSubItem?: boolean; label?: string }> = ({ page, isSubItem = false, label }) => (
        <a
            href="#"
            onClick={(e) => {
                e.preventDefault();
                // Clear editingCourseRun when navigating to Create New Class
                if (page === AdminPage.CreateNewClass) {
                    setEditingCourseRun(null);
                }
                setAdminPage(page);
                if (onNavigate) {
                    onNavigate();
                }
            }}
            className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isSubItem ? 'pl-8' : ''
                } ${adminPage === page
                    ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-400'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                }`}
        >
            {label || page}
        </a>
    );

    return (
        <nav className="space-y-6 p-4">
            <NavItem page={AdminPage.Dashboard} label="Admin Dashboard" />

            <NavSection title="Class Management">
                <NavItem page={AdminPage.ViewCourses} label="View Courses" isSubItem />
                <NavItem page={AdminPage.ViewTrainers} label="View Trainers" isSubItem />
                <NavItem page={AdminPage.UpcomingClasses} label="Upcoming Classes" isSubItem />
                <NavItem page={AdminPage.OngoingClasses} label="Ongoing Classes" isSubItem />
                <NavItem page={AdminPage.CompletedClasses} label="Completed Classes" isSubItem />
                <NavItem page={AdminPage.CreateNewClass} label="Create New Class" isSubItem />
                <NavItem page={AdminPage.EnrollLearners} label="Enroll Learners" isSubItem />
                <NavItem page={AdminPage.AssignTrainer} label="Assign Trainer" isSubItem />
            </NavSection>

            <NavSection title="Direct Application">
                <NavItem page={AdminPage.UploadDirectApplication} label="Upload Direct Application" isSubItem />
                <NavItem page={AdminPage.ViewDirectApplication} label="View Direct Application" isSubItem />
            </NavSection>

            <NavSection title="TPG Management">
                <NavItem page={AdminPage.SearchEnrolment} label="Search Enrolment" isSubItem />
                <NavItem page={AdminPage.ViewEnrolment} label="View Enrolment" isSubItem />
                <NavItem page={AdminPage.SearchGrant} label="Search Grant" isSubItem />
                <NavItem page={AdminPage.ViewGrantStatus} label="View Grant Status" isSubItem />
                <NavItem page={AdminPage.SubmitAssessment} label="Submit Assessment" isSubItem />
                <NavItem page={AdminPage.ViewAssessments} label="View Assessments" isSubItem />
                <NavItem page={AdminPage.UploadCourseRuns} label="Upload Course Runs" isSubItem />
                <NavItem page={AdminPage.UploadEnrolments} label="Upload Enrolments" isSubItem />
            </NavSection>


        </nav>
    );
};

export default AdminSidebar;