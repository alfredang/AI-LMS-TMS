import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

interface NavSectionProps {
    title: string;
    children: React.ReactNode;
}

const NavSection: React.FC<NavSectionProps> = ({ title, children }) => (
    <div>
        <h3 className="px-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">{title}</h3>
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
                    ? 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'
                }`}
        >
            {label || page}
        </a>
    );

    return (
        <nav className="space-y-6 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
            <NavItem page={AdminPage.Dashboard} label="Admin Dashboard" />

            <NavSection title="Class Management">
                <NavItem page={AdminPage.ViewCourses} label="View Courses" isSubItem />
                <NavItem page={AdminPage.ViewTrainers} label="View Trainers" isSubItem />
                <NavItem page={AdminPage.ViewLearners} label="View Learners" isSubItem />
                <NavItem page={AdminPage.UpcomingClasses} label="Upcoming Classes" isSubItem />
                <NavItem page={AdminPage.OngoingClasses} label="Ongoing Classes" isSubItem />
                <NavItem page={AdminPage.CompletedClasses} label="Completed Classes" isSubItem />
                <NavItem page={AdminPage.AssignTrainer} label="Assign Trainer" isSubItem />
                <NavItem page={AdminPage.AssignStudent} label="Assign Learners" isSubItem />
            </NavSection>

            <NavSection title="Direct Application">
                <NavItem page={AdminPage.UploadDirectApplication} label="Upload Direct Application" isSubItem />
                <NavItem page={AdminPage.ViewDirectApplication} label="View Direct Application" isSubItem />
                {/* <NavItem page={AdminPage.UpdateDirectApplication} label="Update Direct Application" isSubItem /> */}
            </NavSection>

            <NavSection title="TPG Management">
                {/* Course Run */}
                <p className="pl-8 pt-2 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Course Run</p>
                <NavItem page={AdminPage.CreateNewClass} label="Create New Class" isSubItem />
                <NavItem page={AdminPage.SearchCourseRuns} label="Search Course Runs" isSubItem />
                <NavItem page={AdminPage.ViewCourseRun} label="View Course Run" isSubItem />
                <NavItem page={AdminPage.UploadCourseRuns} label="Upload Course Runs" isSubItem />
                <NavItem page={AdminPage.DeleteCourseRun} label="Delete Course Run" isSubItem />
                <NavItem page={AdminPage.CourseSessions} label="Course Sessions" isSubItem />
                <NavItem page={AdminPage.CourseSessionAttendance} label="Course Session Attendance" isSubItem />
                <NavItem page={AdminPage.CheckAttendance} label="Check Attendance" isSubItem />

                <div className="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

                {/* Enrolment */}
                <p className="pl-8 pt-1 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Enrolment</p>
                <NavItem page={AdminPage.EnrollLearners} label="Enroll Learners" isSubItem />
                <NavItem page={AdminPage.UploadEnrolments} label="Upload Enrolments" isSubItem />
                <NavItem page={AdminPage.SearchEnrolment} label="Search Enrolment" isSubItem />
                <NavItem page={AdminPage.ViewEnrolment} label="View Enrolment" isSubItem />
                <NavItem page={AdminPage.UpdateEnrolment} label="Update Enrolment" isSubItem />
                <NavItem page={AdminPage.CancelEnrolment} label="Cancel Enrolment" isSubItem />
                <NavItem page={AdminPage.UpdateEnrolmentFees} label="Update Enrolment Fees" isSubItem />

                <div className="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

                {/* Assessment */}
                <p className="pl-8 pt-1 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Assessment</p>
                <NavItem page={AdminPage.SubmitAssessment} label="Submit Assessment" isSubItem />
                <NavItem page={AdminPage.UpdateAssessment} label="Update Assessment" isSubItem />
                <NavItem page={AdminPage.SearchAssessments} label="Search Assessments" isSubItem />
                <NavItem page={AdminPage.ViewAssessment} label="View Assessment" isSubItem />

                <div className="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />

                {/* Grant */}
                <p className="pl-8 pt-1 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Grant</p>
                <NavItem page={AdminPage.SearchGrant} label="Search Grant" isSubItem />
                <NavItem page={AdminPage.ViewGrantStatus} label="View Grant Status" isSubItem />
            </NavSection>

            <NavSection title="Logging">
                <NavItem page={AdminPage.AutomationLogs} label="Auto Create Learner Log" isSubItem />
                <NavItem page={AdminPage.AssignTrainerLogs} label="Assign Trainer Log" isSubItem />
            </NavSection>

            <NavSection title="Certificate">
                <NavItem page={AdminPage.CreateCertificate} label="Create Certificate" isSubItem />
                <NavItem page={AdminPage.DeleteCertificate} label="Delete Certificate" isSubItem />
            </NavSection>

            {/* Tools section hidden
            <NavSection title="Tools">
                <NavItem page={AdminPage.BackfillEnrollments} label="Backfill Enrollments" isSubItem />
                <NavItem page={AdminPage.FetchUpcomingEnrolments} label="Fetch Upcoming Classes Enrolment" isSubItem />
            </NavSection>
            */}

        </nav>
    );
};

export default AdminSidebar;