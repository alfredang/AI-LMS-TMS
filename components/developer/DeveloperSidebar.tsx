import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { DeveloperPage } from '@app-types';

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
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h3>
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

interface DeveloperSidebarProps {
    onNavigate?: () => void;
}

const DeveloperSidebar: React.FC<DeveloperSidebarProps> = ({ onNavigate }) => {
    const { developerPage, setDeveloperPage } = useLms();

    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        cpGenerator: true,
        cpPrepare: true,
        cpSubmit: false,
    });

    const toggleSection = (key: string) => {
        setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const NavItem: React.FC<{ page: DeveloperPage; label: string; isSubItem?: boolean }> = ({ page, label, isSubItem = false }) => (
        <a
            href="#"
            onClick={(e) => {
                e.preventDefault();
                setDeveloperPage(page);
                if (onNavigate) onNavigate();
            }}
            className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isSubItem ? 'pl-8' : ''
                } ${developerPage === page
                    ? 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white'
                }`}
        >
            {label}
        </a>
    );

    return (
        <nav className="space-y-6 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
            <NavItem page={DeveloperPage.Dashboard} label="Dashboard" />
            <NavItem page={DeveloperPage.CourseList} label="Course List" />
            <NavItem page={DeveloperPage.SeoMetadata} label="SEO Metadata" />

            <NavSection title="CP Generator" isOpen={openSections.cpGenerator} onToggle={() => toggleSection('cpGenerator')}>
                <SubSection title="Prepare CP" isOpen={openSections.cpPrepare} onToggle={() => toggleSection('cpPrepare')}>
                    <NavItem page={DeveloperPage.CpCourseDetails} label="Course Details" isSubItem />
                    <NavItem page={DeveloperPage.CpAboutCourse} label="About This Course" isSubItem />
                    <NavItem page={DeveloperPage.CpWhatYoullLearn} label="What You'll Learn" isSubItem />
                    <NavItem page={DeveloperPage.CpBackgroundA} label="Background Part A" isSubItem />
                    <NavItem page={DeveloperPage.CpBackgroundB} label="Background Part B" isSubItem />
                    <NavItem page={DeveloperPage.CpLearningOutcomes} label="Learning Outcomes" isSubItem />
                    <NavItem page={DeveloperPage.CpInstructionalMethods} label="Instructional Methods" isSubItem />
                    <NavItem page={DeveloperPage.CpAssessmentMethods} label="Assessment Methods" isSubItem />
                    <NavItem page={DeveloperPage.CpLuSequencing} label="LU Sequencing" isSubItem />
                </SubSection>

                <SubSection title="Submit CP" isOpen={openSections.cpSubmit} onToggle={() => toggleSection('cpSubmit')}>
                    <NavItem page={DeveloperPage.CpCourseOutline} label="Course Outline" isSubItem />
                    <NavItem page={DeveloperPage.CpEntryRequirements} label="Entry Requirements" isSubItem />
                    <NavItem page={DeveloperPage.CpJobRoles} label="Job Roles" isSubItem />
                    <NavItem page={DeveloperPage.CpLessonPlan} label="Lesson Plan" isSubItem />
                    <NavItem page={DeveloperPage.CpValidation} label="CP Validation" isSubItem />
                </SubSection>
            </NavSection>
        </nav>
    );
};

export default DeveloperSidebar;
