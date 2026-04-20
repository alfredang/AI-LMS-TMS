import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { DeveloperPage } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface NavSectionProps {
    title: string;
    children: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
    collapsed?: boolean;
    icon?: IconName;
}

const NavSection: React.FC<NavSectionProps> = ({ title, children, isOpen, onToggle, collapsed = false, icon }) => {
    if (collapsed) {
        if (!icon) return null;
        return (
            <div className="flex justify-center" title={title}>
                <button type="button" onClick={onToggle} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" title={title}>
                    <Icon name={icon} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
            </div>
        );
    }

    return (
        <div>
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-1 group cursor-pointer"
            >
                {icon && <Icon name={icon} className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />}
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1 text-left">{title}</h3>
                <svg
                    className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
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
};

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
    collapsed?: boolean;
}

const DeveloperSidebar: React.FC<DeveloperSidebarProps> = ({ onNavigate, collapsed = false }) => {
    const { developerPage, setDeveloperPage } = useLms();

    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        cpGenerator: false,
        cpPrepare: true,
        cpSubmit: false,
        cwGenerator: false,
    });

    const toggleSection = (key: string) => {
        setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const inactiveClass = 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white';
    const inactiveIconClass = 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300';

    const NavItem: React.FC<{ page: DeveloperPage; label: string; icon?: IconName; isSubItem?: boolean }> = ({ page, label, icon, isSubItem = false }) => {
        if (collapsed && isSubItem) return null;

        return (
            <a
                href="#"
                title={collapsed ? label : undefined}
                onClick={(e) => {
                    e.preventDefault();
                    setDeveloperPage(page);
                    if (onNavigate) onNavigate();
                }}
                className={`group flex items-center ${collapsed ? 'justify-center px-0' : `gap-3 px-3 ${isSubItem ? 'pl-8' : ''}`} rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
                    developerPage === page
                        ? 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500'
                        : inactiveClass
                }`}
            >
                {icon && (
                    <Icon
                        name={icon}
                        className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                            developerPage === page ? 'text-blue-600 dark:text-blue-400' : inactiveIconClass
                        }`}
                    />
                )}
                {!collapsed && <span className="truncate">{label}</span>}
            </a>
        );
    };

    return (
        <nav className="space-y-6 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
            <NavItem page={DeveloperPage.Dashboard} label="Dashboard" icon={IconName.Dashboard} />
            <NavItem page={DeveloperPage.CourseList} label="Course List" icon={IconName.Courses} />
            <NavItem page={DeveloperPage.SeoMetadata} label="SEO Metadata" icon={IconName.Search} />

            {collapsed ? (
                <a
                    href="#"
                    title="CP Generator"
                    onClick={(e) => {
                        e.preventDefault();
                        setDeveloperPage(DeveloperPage.CpCourseDetails);
                        if (onNavigate) onNavigate();
                    }}
                    className={`group flex items-center justify-center px-0 rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
                >
                    <Icon
                        name={IconName.FileText}
                        className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${inactiveIconClass}`}
                    />
                </a>
            ) : (
                <NavSection title="CP Generator" icon={IconName.FileText} isOpen={openSections.cpGenerator} onToggle={() => toggleSection('cpGenerator')} collapsed={collapsed}>
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
            )}

            {collapsed ? (
                <a
                    href="#"
                    title="Courseware Generator"
                    onClick={(e) => {
                        e.preventDefault();
                        setDeveloperPage(DeveloperPage.CwExtractCourseInfo);
                        if (onNavigate) onNavigate();
                    }}
                    className={`group flex items-center justify-center px-0 rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
                >
                    <Icon
                        name={IconName.BookOpen}
                        className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${inactiveIconClass}`}
                    />
                </a>
            ) : (
                <NavSection title="Courseware Generator" icon={IconName.BookOpen} isOpen={openSections.cwGenerator} onToggle={() => toggleSection('cwGenerator')} collapsed={collapsed}>
                    <NavItem page={DeveloperPage.CwExtractCourseInfo} label="Extract Course Info" isSubItem />
                    <NavItem page={DeveloperPage.CwGenerateApFgLg} label="Generate AP/FG/LG" isSubItem />
                    <NavItem page={DeveloperPage.CwGenerateLessonPlan} label="Generate Lesson Plan" isSubItem />
                    <NavItem page={DeveloperPage.CwGenerateAssessment} label="Generate Assessment" isSubItem />
                    <NavItem page={DeveloperPage.CwGenerateSlides} label="Generate Slides" isSubItem />
                    <NavItem page={DeveloperPage.CwGenerateBrochure} label="Generate Brochure" isSubItem />
                    <NavItem page={DeveloperPage.CwConvertDocuments} label="Convert Documents" isSubItem />
                    <NavItem page={DeveloperPage.CwCoursewareAudit} label="Courseware Audit" isSubItem />
                </NavSection>
            )}
        </nav>
    );
};

export default DeveloperSidebar;
