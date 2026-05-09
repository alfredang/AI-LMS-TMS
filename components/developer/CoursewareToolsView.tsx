import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { DeveloperPage } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface ToolCard {
    title: string;
    description: string;
    icon: IconName;
    page: DeveloperPage;
}

const TOOLS: ToolCard[] = [
    {
        title: 'SEO Meta Generator',
        description: 'Generate SEO metadata (titles, descriptions, keywords) for course pages.',
        icon: IconName.Search,
        page: DeveloperPage.SeoMetadata,
    },
    {
        title: 'CP Generator',
        description: 'Prepare and submit Course Proposals for SSG accreditation.',
        icon: IconName.FileText,
        page: DeveloperPage.CpCourseDetails,
    },
    {
        title: 'Courseware Generator',
        description: 'Generate lesson plans, assessments, slides and brochures for a course.',
        icon: IconName.BookOpen,
        page: DeveloperPage.CwExtractCourseInfo,
    },
];

const CoursewareToolsView: React.FC = () => {
    const { setDeveloperPage } = useLms();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-on-surface">Courseware Tools</h1>
                <p className="text-sm text-muted mt-1">Tools for authoring and submitting course materials.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {TOOLS.map(({ title, description, icon, page }) => (
                    <button
                        key={title}
                        onClick={() => setDeveloperPage(page)}
                        className="group text-left bg-surface border border-default rounded-xl p-5 hover:border-primary hover:shadow-md transition-all duration-150"
                    >
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                <Icon name={icon} className="w-5 h-5 text-primary" />
                            </div>
                            <h3 className="text-base font-semibold text-on-surface group-hover:text-primary transition-colors">
                                {title}
                            </h3>
                        </div>
                        <p className="text-sm text-muted leading-relaxed">{description}</p>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default CoursewareToolsView;
