import React from 'react';
import { Course, UserRole } from '@app-types';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import { Button } from './ui/Button';

import { getCourseImageUrl } from '@utils/imageUtils';


interface EnrolledCourseListItemProps {
    course: Course;
}

const CourseStat: React.FC<{ icon: IconName; text: string | number }> = ({ icon, text }) => (
    <span className="flex items-center text-sm text-subtle">
        <Icon name={icon} className="w-4 h-4 mr-1.5 text-green-500" />
        {text}
    </span>
);

const EnrolledCourseListItem: React.FC<EnrolledCourseListItemProps> = ({ course }) => {
    const { role, loadCourseData } = useLms();

    const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);

    const handleCourseClick = async () => {
        try {
            await loadCourseData(course);
        } catch (error) {
            console.error('Error loading course data:', error);
        }
    };

    return (
        <Card
            className="!p-0 !shadow-lg hover:!shadow-xl !-translate-y-0 hover:!scale-[1.01] cursor-pointer dark:bg-gray-800"
            onClick={handleCourseClick}
        >
            <div className="flex flex-col md:flex-row">
                <img
                    src={getCourseImageUrl(course.imageUrl, course.id, course.title)}
                    alt={course.title}
                    className="w-full md:w-52 h-40 md:h-auto object-cover rounded-t-xl md:rounded-l-xl md:rounded-r-none"
                />
                <div className="p-4 flex-1 flex flex-col md:flex-row md:items-center">
                    <div className="flex-1 mb-4 md:mb-0">
                        <h3 className="text-lg font-bold hover:text-primary transition-colors">{course.title}</h3>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                            <CourseStat icon={IconName.CheckCircle} text={`${totalHours}+ hrs`} />
                            <CourseStat icon={IconName.CheckCircle} text={`${course.totalAssessments || 0} Assessments`} />
                            <CourseStat icon={IconName.CheckCircle} text={course.courseType} />
                        </div>
                    </div>
                    <div className="flex items-center space-x-4 md:pl-4">
                        <span className="text-xs font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded">
                            {course.modeOfLearning.join(' / ')}
                        </span>

                        <Button variant="ghost" className="!border !border-gray-800 !font-semibold hover:!bg-gray-800 hover:!text-white">
                            View Course
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default EnrolledCourseListItem;
