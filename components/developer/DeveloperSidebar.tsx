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
            <h3 className="text-sm font-bold uppercase text-gray-300 dark:text-gray-200 tracking-wider">{title}</h3>
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
            <span className="text-sm font-semibold uppercase text-gray-300 dark:text-gray-300 tracking-wider">{title}</span>
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

    const navButton = (label: string, page: DeveloperPage, indent = false) => (
        <button
            type="button"
            onClick={() => {
                setDeveloperPage(page);
                onNavigate?.();
            }}
            className={`w-full text-left text-base py-2.5 rounded-md transition-colors ${indent ? 'pl-12 pr-3' : 'pl-4 pr-3'} ${
                developerPage === page
                    ? 'bg-primary/10 text-primary font-semibold dark:bg-primary/20'
                    : 'text-gray-200 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-700'
            }`}
        >
            {label}
        </button>
    );

    return (
        <nav className="flex flex-col gap-2 py-4 px-2 overflow-y-auto h-full">
            {/* Dashboard */}
            {navButton('Dashboard', DeveloperPage.Dashboard)}
            {navButton('Course List', DeveloperPage.CourseList)}

            {/* CP Generator Section */}
            <div className="mt-4">
                <NavSection title="CP Generator" isOpen={openSections.cpGenerator} onToggle={() => toggleSection('cpGenerator')}>
                    {/* Prepare CP Sub-section */}
                    <SubSection title="Prepare CP" isOpen={openSections.cpPrepare} onToggle={() => toggleSection('cpPrepare')}>
                        {navButton('Course Details', DeveloperPage.CpCourseDetails, true)}
                        {navButton('About This Course', DeveloperPage.CpAboutCourse, true)}
                        {navButton("What You'll Learn", DeveloperPage.CpWhatYoullLearn, true)}
                        {navButton('Background Part A', DeveloperPage.CpBackgroundA, true)}
                        {navButton('Background Part B', DeveloperPage.CpBackgroundB, true)}
                        {navButton('Learning Outcomes', DeveloperPage.CpLearningOutcomes, true)}
                        {navButton('Instructional Methods', DeveloperPage.CpInstructionalMethods, true)}
                        {navButton('Assessment Methods', DeveloperPage.CpAssessmentMethods, true)}
                        {navButton('LU Sequencing', DeveloperPage.CpLuSequencing, true)}
                    </SubSection>

                    {/* Submit CP Sub-section */}
                    <SubSection title="Submit CP" isOpen={openSections.cpSubmit} onToggle={() => toggleSection('cpSubmit')}>
                        {navButton('Course Outline', DeveloperPage.CpCourseOutline, true)}
                        {navButton('Entry Requirements', DeveloperPage.CpEntryRequirements, true)}
                        {navButton('Job Roles', DeveloperPage.CpJobRoles, true)}
                        {navButton('Lesson Plan', DeveloperPage.CpLessonPlan, true)}
                        {navButton('CP Validation', DeveloperPage.CpValidation, true)}
                    </SubSection>
                </NavSection>
            </div>
        </nav>
    );
};

export default DeveloperSidebar;
