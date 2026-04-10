import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

interface NavSectionProps {
    title: string;
    children: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
}

const NavSection: React.FC<NavSectionProps> = ({ title, children, isOpen, onToggle }) => (
    <div>
        <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center justify-between px-3 py-1 group cursor-pointer"
        >
            <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">{title}</h3>
            <svg
                className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
        </button>
        {isOpen && (
            <div className="mt-2 space-y-1" role="group" aria-labelledby={`${title}-heading`}>
                {children}
            </div>
        )}
    </div>
);

const SubSection: React.FC<{ title: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }> = ({ title, isOpen, onToggle, children }) => (
    <div>
        <button
            type="button"
            onClick={onToggle}
            className="w-full flex items-center justify-between pl-8 pr-3 py-1.5 group cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md"
        >
            <span className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wider">{title}</span>
            <svg
                className={`w-3 h-3 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
        </button>
        {isOpen && <div className="space-y-1">{children}</div>}
    </div>
);

interface AdminSidebarProps {
    onNavigate?: () => void;
    onSelectWorkflow?: (workflowId: string) => void;
}

const REFERENCE_LINKS = [
    { key: 'masterListUrl', label: 'Master List' },
    { key: 'tertiaryTmsUrl', label: 'Tertiary TMS' },
    { key: 'tertiaryFmsUrl', label: 'Tertiary FMS' },
    { key: 'tertiaryMmsUrl', label: 'Tertiary MMS' },
    { key: 'tertiaryTpmsUrl', label: 'Tertiary TPMS' },
];

const N8N_LINKS = [
    { key: 'n8nHost1Url', label: 'n8n Host 1' },
    { key: 'n8nHost2Url', label: 'n8n Host 2' },
];

const USEFUL_LINKS = [
    { key: 'magentoBackendUrl', label: 'Magento Backend' },
];

const AdminSidebar: React.FC<AdminSidebarProps> = ({ onNavigate, onSelectWorkflow }) => {
    const { adminPage, setAdminPage, setEditingCourseRun, setEditingCourse, setSelectedCourse, setCourseEditMode, trainingProviderProfile } = useLms();

    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        calendar: false,
        courseManagement: false,
        classManagement: false,
        directApplication: false,
        tpgManagement: false,
        tpgCourseRun: false,
        tpgSession: false,
        tpgAttendance: false,
        tpgEnrolment: false,
        tpgAssessment: false,
        tpgGrant: false,
        logging: false,
        certificate: false,
        supportTickets: false,
        workflowGuides: false,
        wfTraining: false,
        wfAdmin: false,
        wfFinance: false,
        referenceLinks: false,
        n8nLinks: false,
        usefulLinks: false,
    });

    const toggleSection = (key: string) => {
        setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const NavItem: React.FC<{ page: AdminPage; isSubItem?: boolean; label?: string }> = ({ page, isSubItem = false, label }) => (
        <a
            href="#"
            onClick={(e) => {
                e.preventDefault();
                // Clear course detail/editor state so admin navigation always responds.
                setSelectedCourse(null);
                setEditingCourse(null);
                setCourseEditMode(null);

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

            <NavSection title="Workflow Guides" isOpen={openSections.workflowGuides} onToggle={() => toggleSection('workflowGuides')}>
                <SubSection title="Training" isOpen={openSections.wfTraining} onToggle={() => toggleSection('wfTraining')}>
                    {[
                        { id: 'lesson-delivery', label: 'Lesson Delivery', icon: '📚' },
                        { id: 'assessment', label: 'Assessment', icon: '📝' },
                    ].map(item => (
                        <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); setAdminPage(AdminPage.WorkflowGuides); onSelectWorkflow?.(item.id); if (onNavigate) onNavigate(); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
                            <span className="text-sm">{item.icon}</span>
                            <span>{item.label}</span>
                        </a>
                    ))}
                </SubSection>
                <SubSection title="Admin" isOpen={openSections.wfAdmin} onToggle={() => toggleSection('wfAdmin')}>
                    {[
                        { id: 'ssg-process-steps', label: 'SSG Process Steps', icon: '🏛️' },
                        { id: 'support-ticketing', label: 'Support Ticketing', icon: '🎫' },
                        { id: 'certificate', label: 'Certificate', icon: '🎓' },
                        { id: 'trainer-invitation', label: 'Trainer Invitation', icon: '📨' },
                    ].map(item => (
                        <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); setAdminPage(AdminPage.WorkflowGuides); onSelectWorkflow?.(item.id); if (onNavigate) onNavigate(); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
                            <span className="text-sm">{item.icon}</span>
                            <span>{item.label}</span>
                        </a>
                    ))}
                </SubSection>
                <SubSection title="Finance" isOpen={openSections.wfFinance} onToggle={() => toggleSection('wfFinance')}>
                    {[
                        { id: 'billing-history', label: 'Billing History', icon: '💰' },
                        { id: 'proforma-invoice', label: 'Proforma Invoice', icon: '🧾' },
                        { id: 'personal-invoice', label: 'Personal Invoice', icon: '📄' },
                        { id: 'company-invoice', label: 'Company Invoice', icon: '🏢' },
                        { id: 'receipt', label: 'Receipt', icon: '🧾' },
                    ].map(item => (
                        <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); setAdminPage(AdminPage.WorkflowGuides); onSelectWorkflow?.(item.id); if (onNavigate) onNavigate(); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
                            <span className="text-sm">{item.icon}</span>
                            <span>{item.label}</span>
                        </a>
                    ))}
                </SubSection>
            </NavSection>

            <NavSection title="Support Tickets" isOpen={openSections.supportTickets} onToggle={() => toggleSection('supportTickets')}>
                <NavItem page={AdminPage.SupportTickets} label="View All Tickets" isSubItem />
            </NavSection>

            <NavSection title="Calendar & Scheduler" isOpen={openSections.calendar} onToggle={() => toggleSection('calendar')}>
                <NavItem page={AdminPage.Calendar} label="View Calendar" isSubItem />
            </NavSection>

            <NavSection title="Course Management" isOpen={openSections.courseManagement} onToggle={() => toggleSection('courseManagement')}>
                <NavItem page={AdminPage.ViewCourses} label="View Courses" isSubItem />
                <NavItem page={AdminPage.ViewTrainers} label="View Trainers" isSubItem />
                <NavItem page={AdminPage.FundingValidity} label="Funding Validity" isSubItem />
            </NavSection>

            <NavSection title="Class Management" isOpen={openSections.classManagement} onToggle={() => toggleSection('classManagement')}>
                <NavItem page={AdminPage.ViewLearners} label="View Learners" isSubItem />
                <NavItem page={AdminPage.OngoingClasses} label="Ongoing Classes" isSubItem />
                <NavItem page={AdminPage.UpcomingClasses} label="Upcoming Classes" isSubItem />
                <NavItem page={AdminPage.CompletedClasses} label="Completed Classes" isSubItem />
                <NavItem page={AdminPage.AssignTrainer} label="Assign Trainer" isSubItem />
                <NavItem page={AdminPage.AssignStudent} label="Assign Learners" isSubItem />
                <NavItem page={AdminPage.SearchPastLearners} label="Search Past Learners" isSubItem />
            </NavSection>

            <NavSection title="Direct Application" isOpen={openSections.directApplication} onToggle={() => toggleSection('directApplication')}>
                <NavItem page={AdminPage.UploadDirectApplication} label="Upload Direct Application" isSubItem />
                <NavItem page={AdminPage.ViewDirectApplication} label="View Direct Application" isSubItem />
            </NavSection>

            <NavSection title="TPG Management" isOpen={openSections.tpgManagement} onToggle={() => toggleSection('tpgManagement')}>
                <SubSection title="Course Run" isOpen={openSections.tpgCourseRun} onToggle={() => toggleSection('tpgCourseRun')}>
                    <NavItem page={AdminPage.CreateNewClass} label="Create New Class" isSubItem />
                    <NavItem page={AdminPage.SearchCourseRuns} label="Search Course Runs" isSubItem />
                    <NavItem page={AdminPage.ViewCourseRun} label="View Course Run" isSubItem />
                    <NavItem page={AdminPage.EditCourseRun} label="Edit Course Run" isSubItem />
                    <NavItem page={AdminPage.UploadCourseRuns} label="Upload Course Runs" isSubItem />
                    <NavItem page={AdminPage.DeleteCourseRun} label="Delete Course Run" isSubItem />
                </SubSection>

                <SubSection title="Session" isOpen={openSections.tpgSession} onToggle={() => toggleSection('tpgSession')}>
                    <NavItem page={AdminPage.AddSessions} label="Add Sessions" isSubItem />
                    <NavItem page={AdminPage.CourseSessions} label="Course Sessions" isSubItem />
                </SubSection>

                <SubSection title="Enrolment" isOpen={openSections.tpgEnrolment} onToggle={() => toggleSection('tpgEnrolment')}>
                    <NavItem page={AdminPage.EnrollLearners} label="Enroll Learners" isSubItem />
                    <NavItem page={AdminPage.UploadEnrolments} label="Upload Enrolments" isSubItem />
                    <NavItem page={AdminPage.SearchEnrolment} label="Search Enrolment" isSubItem />
                    <NavItem page={AdminPage.ViewEnrolment} label="View Enrolment" isSubItem />
                    <NavItem page={AdminPage.UpdateEnrolment} label="Update Enrolment" isSubItem />
                    <NavItem page={AdminPage.CancelEnrolment} label="Cancel Enrolment" isSubItem />
                    <NavItem page={AdminPage.UpdateEnrolmentFees} label="Update Enrolment Fees" isSubItem />
                </SubSection>

                <SubSection title="Attendance" isOpen={openSections.tpgAttendance} onToggle={() => toggleSection('tpgAttendance')}>
                    <NavItem page={AdminPage.CourseSessionAttendance} label="Session Attendance" isSubItem />
                    <NavItem page={AdminPage.CheckAttendance} label="Check Attendance" isSubItem />
                </SubSection>

                <SubSection title="Assessment" isOpen={openSections.tpgAssessment} onToggle={() => toggleSection('tpgAssessment')}>
                    <NavItem page={AdminPage.SubmitAssessment} label="Submit Assessment" isSubItem />
                    <NavItem page={AdminPage.UpdateAssessment} label="Update Assessment" isSubItem />
                    <NavItem page={AdminPage.SearchAssessments} label="Search Assessments" isSubItem />
                    <NavItem page={AdminPage.ViewAssessment} label="View Assessment" isSubItem />
                </SubSection>

                <SubSection title="Grant" isOpen={openSections.tpgGrant} onToggle={() => toggleSection('tpgGrant')}>
                    <NavItem page={AdminPage.GrantCalculator} label="Grant Calculator" isSubItem />
                    <NavItem page={AdminPage.SearchGrant} label="Search Grant" isSubItem />
                    <NavItem page={AdminPage.ViewGrantStatus} label="View Grant Status" isSubItem />
                </SubSection>
            </NavSection>

            <NavSection title="Certificate" isOpen={openSections.certificate} onToggle={() => toggleSection('certificate')}>
                <NavItem page={AdminPage.CreateCertificate} label="Create Certificate" isSubItem />
                <NavItem page={AdminPage.DeleteCertificate} label="Delete Certificate" isSubItem />
                <NavItem page={AdminPage.SendCertificateSG} label="Send Certificate (SG)" isSubItem />
                <NavItem page={AdminPage.SendCertificateGH} label="Send Certificate (GH)" isSubItem />
            </NavSection>

            <NavSection title="Reference Links" isOpen={openSections.referenceLinks} onToggle={() => toggleSection('referenceLinks')}>
                {REFERENCE_LINKS.map(({ key, label }) => {
                    const url = (trainingProviderProfile?.integrations as any)?.[key];
                    if (!url) return null;
                    return (
                        <a
                            key={key}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors pl-8 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                        >
                            {label}
                            <svg className="w-3 h-3 ml-1.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    );
                })}
            </NavSection>

            <NavSection title="n8n Links" isOpen={openSections.n8nLinks} onToggle={() => toggleSection('n8nLinks')}>
                {N8N_LINKS.map(({ key, label }) => {
                    const url = (trainingProviderProfile?.integrations as any)?.[key];
                    if (!url) return null;
                    return (
                        <a
                            key={key}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors pl-8 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                        >
                            {label}
                            <svg className="w-3 h-3 ml-1.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    );
                })}
            </NavSection>

            <NavSection title="Useful Links" isOpen={openSections.usefulLinks} onToggle={() => toggleSection('usefulLinks')}>
                {[
                    { label: 'TMS Documentation', href: 'https://alfredang.github.io/AI-LMS-TMS/' },
                    { label: 'SSG Process Steps', href: 'https://alfredang.github.io/ssgwsqprocess/index.html' },
                    { label: 'TPGateway', href: 'https://www.tpgateway.gov.sg/' },
                    { label: 'MySkillsFuture Portal', href: 'https://www.myskillsfuture.gov.sg/content/portal/en/index.html' },
                    { label: 'SF for Business', href: 'https://skillsfuture.gobusiness.gov.sg/' },
                    { label: 'Skills Framework', href: 'https://www.tpgateway.gov.sg/plan-courses/skills-framework' },
                    { label: 'SSG Circular', href: 'https://www.tpgateway.gov.sg/resources/announcements-and-circulars' },
                    { label: 'Corppass', href: 'https://www.corppass.gov.sg/portal' },
                    { label: 'SSG API Portal', href: 'https://ssg-api-portal.vercel.app/' },
                    { label: 'SSG Developer', href: 'https://developer.ssg-wsg.gov.sg/webapp/home' },
                ].map(({ label, href }) => (
                    <a
                        key={label}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors pl-8 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                    >
                        {label}
                        <svg className="w-3 h-3 ml-1.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </a>
                ))}
                {USEFUL_LINKS.map(({ key, label }) => {
                    const url = (trainingProviderProfile?.integrations as any)?.[key];
                    if (!url) return null;
                    return (
                        <a
                            key={key}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors pl-8 text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white"
                        >
                            {label}
                            <svg className="w-3 h-3 ml-1.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    );
                })}
            </NavSection>

            <NavSection title="Logging" isOpen={openSections.logging} onToggle={() => toggleSection('logging')}>
                <NavItem page={AdminPage.AutomationLogs} label="Auto Create Learner Log" isSubItem />
                <NavItem page={AdminPage.AssignTrainerLogs} label="Assign Trainer Log" isSubItem />
                <NavItem page={AdminPage.TrainerFolderLogs} label="Auto Create Assessment Records Log" isSubItem />
                <NavItem page={AdminPage.AutoCreateCertificatesLog} label="Auto Create Certificates Log" isSubItem />
                <NavItem page={AdminPage.CourseRunDateSyncLogs} label="Course Run Date Sync Log" isSubItem />
                <NavItem page={AdminPage.UpcomingCourseRunsLog} label="TGS Enrolments & Assign Trainers Log" isSubItem />
                <NavItem page={AdminPage.SyncTrainerTpgLogs} label="Sync Trainer to TPG Log" isSubItem />
            </NavSection>

        </nav>
    );
};

export default AdminSidebar;
