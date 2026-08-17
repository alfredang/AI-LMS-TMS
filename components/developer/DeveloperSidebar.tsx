import React, { useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { DeveloperPage } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface DeveloperSidebarProps {
    onNavigate?: () => void;
    collapsed?: boolean;
}

const TOP_NAV_ITEMS: { page: DeveloperPage; label: string; icon: IconName }[] = [
    { page: DeveloperPage.CourseList, label: 'Course Management', icon: IconName.Courses },
    { page: DeveloperPage.CourseImageGenerator, label: 'Course Image Generator', icon: IconName.Create },
    { page: DeveloperPage.FundingValidity, label: 'Funding Validity', icon: IconName.Calendar },
    { page: DeveloperPage.CourseChangeControl, label: 'Course Change Control', icon: IconName.Clock },
];

const CP_PREPARE_ITEMS: { page: DeveloperPage; label: string }[] = [
    { page: DeveloperPage.CpCourseDetails,        label: 'Course Details' },
    { page: DeveloperPage.CpAboutCourse,          label: 'About This Course' },
    { page: DeveloperPage.CpWhatYoullLearn,       label: "What You'll Learn" },
    { page: DeveloperPage.CpBackgroundA,          label: 'Background Part A' },
    { page: DeveloperPage.CpBackgroundB,          label: 'Background Part B' },
    { page: DeveloperPage.CpLearningOutcomes,     label: 'Learning Outcomes' },
    { page: DeveloperPage.CpInstructionalMethods, label: 'Instructional Methods' },
    { page: DeveloperPage.CpAssessmentMethods,    label: 'Assessment Methods' },
    { page: DeveloperPage.CpLuSequencing,         label: 'LU Sequencing' },
];

const CP_SUBMIT_ITEMS: { page: DeveloperPage; label: string }[] = [
    { page: DeveloperPage.CpCourseOutline,      label: 'Course Outline' },
    { page: DeveloperPage.CpEntryRequirements,  label: 'Entry Requirements' },
    { page: DeveloperPage.CpJobRoles,           label: 'Job Roles' },
    { page: DeveloperPage.CpLessonPlan,         label: 'Lesson Plan' },
    { page: DeveloperPage.CpValidation,         label: 'CP Validation' },
];

const CW_ITEMS: { page: DeveloperPage; label: string }[] = [
    { page: DeveloperPage.CwExtractCourseInfo,  label: 'Extract Course Info' },
    { page: DeveloperPage.CwGenerateApFgLg,     label: 'Generate AP/FG/LG' },
    { page: DeveloperPage.CwGenerateLessonPlan, label: 'Generate Lesson Plan' },
    { page: DeveloperPage.CwGenerateAssessment, label: 'Generate Assessment' },
    { page: DeveloperPage.CwGenerateSlides,     label: 'Generate Slides' },
    { page: DeveloperPage.CwGenerateBrochure,   label: 'Generate Brochure' },
    { page: DeveloperPage.CwCoursewareAudit,    label: 'Courseware Audit' },
];

const SKILLS_FRAMEWORK_LINKS: { label: string; href: string }[] = [
    { label: 'SFw Dataset', href: 'https://jobsandskills.skillsfuture.gov.sg/frameworks/skills-frameworks#download-the-latest-skills-framework-dataset' },
    { label: 'Latest CP',   href: 'https://www.tpgateway.gov.sg/plan-courses/course-accreditation' },
];

const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
const inactiveIconClass = 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white';
const subItemClass = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

const DeveloperSidebar: React.FC<DeveloperSidebarProps> = ({ onNavigate, collapsed = false }) => {
    const { developerPage, setDeveloperPage, setEditingCourse, setSelectedCourse, setCourseEditMode } = useLms();

    const cpPages = new Set<DeveloperPage>([...CP_PREPARE_ITEMS, ...CP_SUBMIT_ITEMS].map(i => i.page));
    const cwPages = new Set<DeveloperPage>(CW_ITEMS.map(i => i.page));
    const coursewareToolsActive = developerPage === DeveloperPage.CoursewareTools || developerPage === DeveloperPage.SeoMetadata || cpPages.has(developerPage) || cwPages.has(developerPage);

    const [coursewareToolsOpen, setCoursewareToolsOpen] = useState(coursewareToolsActive);
    const [cpOpen, setCpOpen] = useState(cpPages.has(developerPage));
    const [cpPrepareOpen, setCpPrepareOpen] = useState(true);
    const [cpSubmitOpen, setCpSubmitOpen] = useState(false);
    const [cwOpen, setCwOpen] = useState(cwPages.has(developerPage));
    const [skillsOpen, setSkillsOpen] = useState(false);

    const navigateTo = (page: DeveloperPage) => {
        // Leaving via the sidebar exits any course being edited or viewed.
        // The layout gives the editor priority over the page selection, so
        // stale edit state made sidebar clicks appear dead while editing.
        setEditingCourse(null);
        setSelectedCourse(null);
        setCourseEditMode(null);
        setDeveloperPage(page);
        onNavigate?.();
    };

    const renderTopNav = (page: DeveloperPage, label: string, icon: IconName) => (
        <a
            key={page}
            href="#"
            title={collapsed ? label : undefined}
            onClick={(e) => { e.preventDefault(); navigateTo(page); }}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
                developerPage === page ? 'bg-primary/10 text-primary' : inactiveClass
            }`}
        >
            <Icon
                name={icon}
                className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                    developerPage === page ? 'text-primary' : inactiveIconClass
                }`}
            />
            {!collapsed && <span className="truncate">{label}</span>}
        </a>
    );

    const renderSubItem = (page: DeveloperPage, label: string, extraIndent = false) => (
        <a
            key={page}
            href="#"
            onClick={(e) => { e.preventDefault(); navigateTo(page); }}
            className={`group flex items-center gap-2.5 w-full rounded-lg ${extraIndent ? 'pl-5 pr-2.5' : 'px-2.5'} py-2 text-[13px] font-medium transition-all duration-150 ${
                developerPage === page ? 'bg-primary/10 text-primary' : subItemClass
            }`}
        >
            <span className="truncate">{label}</span>
        </a>
    );

    return (
        <div className="flex flex-col h-full bg-surface border-r border-default">
            <div className="flex-1 px-2 py-4">
                {!collapsed && (
                    <p className="px-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-muted select-none">
                        Menu
                    </p>
                )}

                <div className="space-y-0.5">
                    {TOP_NAV_ITEMS.map(({ page, label, icon }) => renderTopNav(page, label, icon))}

                    {/* Courseware Tools — expandable */}
                    <button
                        onClick={() => {
                            setCoursewareToolsOpen(prev => !prev);
                            navigateTo(DeveloperPage.CoursewareTools);
                        }}
                        title={collapsed ? 'Courseware Tools' : undefined}
                        className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
                            coursewareToolsActive ? 'bg-primary/10 text-primary' : inactiveClass
                        }`}
                    >
                        <Icon
                            name={IconName.BookOpen}
                            className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                                coursewareToolsActive ? 'text-primary' : inactiveIconClass
                            }`}
                        />
                        {!collapsed && <span className="truncate">Courseware Tools</span>}
                        {!collapsed && (
                            <Icon
                                name={IconName.ChevronDown}
                                className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                                    coursewareToolsOpen ? 'rotate-0' : '-rotate-90'
                                } ${coursewareToolsActive ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
                            />
                        )}
                    </button>

                    {!collapsed && coursewareToolsOpen && (
                        <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
                            {/* SEO Meta Generator */}
                            <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); navigateTo(DeveloperPage.SeoMetadata); }}
                                className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${
                                    developerPage === DeveloperPage.SeoMetadata ? 'bg-primary/10 text-primary' : subItemClass
                                }`}
                            >
                                <Icon
                                    name={IconName.Search}
                                    className={`w-4 h-4 flex-shrink-0 transition-colors ${
                                        developerPage === DeveloperPage.SeoMetadata ? 'text-primary' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white'
                                    }`}
                                />
                                <span className="truncate">SEO Meta Generator</span>
                            </a>

                            {/* CP Generator nested */}
                            <button
                                onClick={() => setCpOpen(prev => !prev)}
                                className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${
                                    cpPages.has(developerPage) ? 'bg-primary/10 text-primary' : subItemClass
                                }`}
                            >
                                <Icon
                                    name={IconName.FileText}
                                    className={`w-4 h-4 flex-shrink-0 transition-colors ${
                                        cpPages.has(developerPage) ? 'text-primary' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white'
                                    }`}
                                />
                                <span className="truncate">CP Generator</span>
                                <Icon
                                    name={IconName.ChevronDown}
                                    className={`w-3.5 h-3.5 ml-auto flex-shrink-0 transition-transform duration-200 ${
                                        cpOpen ? 'rotate-0' : '-rotate-90'
                                    } text-gray-400 dark:text-gray-500`}
                                />
                            </button>

                            {cpOpen && (
                                <div className="ml-4 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
                                    <button
                                        onClick={() => setCpPrepareOpen(prev => !prev)}
                                        className="group flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted select-none"
                                    >
                                        <Icon
                                            name={IconName.ChevronDown}
                                            className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 text-gray-400 dark:text-gray-500 ${
                                                cpPrepareOpen ? 'rotate-0' : '-rotate-90'
                                            }`}
                                        />
                                        <span>Prepare CP</span>
                                    </button>
                                    {cpPrepareOpen && CP_PREPARE_ITEMS.map(({ page, label }) => renderSubItem(page, label, true))}

                                    <button
                                        onClick={() => setCpSubmitOpen(prev => !prev)}
                                        className="group flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted select-none mt-1"
                                    >
                                        <Icon
                                            name={IconName.ChevronDown}
                                            className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 text-gray-400 dark:text-gray-500 ${
                                                cpSubmitOpen ? 'rotate-0' : '-rotate-90'
                                            }`}
                                        />
                                        <span>Submit CP</span>
                                    </button>
                                    {cpSubmitOpen && CP_SUBMIT_ITEMS.map(({ page, label }) => renderSubItem(page, label, true))}
                                </div>
                            )}

                            {/* Courseware Generator nested */}
                            <button
                                onClick={() => setCwOpen(prev => !prev)}
                                className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${
                                    cwPages.has(developerPage) ? 'bg-primary/10 text-primary' : subItemClass
                                }`}
                            >
                                <Icon
                                    name={IconName.BookOpen}
                                    className={`w-4 h-4 flex-shrink-0 transition-colors ${
                                        cwPages.has(developerPage) ? 'text-primary' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white'
                                    }`}
                                />
                                <span className="truncate">Courseware Generator</span>
                                <Icon
                                    name={IconName.ChevronDown}
                                    className={`w-3.5 h-3.5 ml-auto flex-shrink-0 transition-transform duration-200 ${
                                        cwOpen ? 'rotate-0' : '-rotate-90'
                                    } text-gray-400 dark:text-gray-500`}
                                />
                            </button>

                            {cwOpen && (
                                <div className="ml-4 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
                                    {CW_ITEMS.map(({ page, label }) => renderSubItem(page, label))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Skills Frameworks — external links */}
                    <button
                        onClick={() => setSkillsOpen(prev => !prev)}
                        title={collapsed ? 'Skills Frameworks' : undefined}
                        className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${inactiveClass}`}
                    >
                        <Icon
                            name={IconName.Library}
                            className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${inactiveIconClass}`}
                        />
                        {!collapsed && <span className="truncate">Skills Frameworks</span>}
                        {!collapsed && (
                            <Icon
                                name={IconName.ChevronDown}
                                className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                                    skillsOpen ? 'rotate-0' : '-rotate-90'
                                } text-gray-400 dark:text-gray-500`}
                            />
                        )}
                    </button>

                    {!collapsed && skillsOpen && (
                        <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
                            {SKILLS_FRAMEWORK_LINKS.map(({ label, href }) => (
                                <a
                                    key={label}
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${subItemClass}`}
                                >
                                    <span className="truncate">{label}</span>
                                    <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DeveloperSidebar;
