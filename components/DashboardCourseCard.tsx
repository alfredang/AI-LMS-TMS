import React from 'react';
import { Course, UserRole } from '@app-types';
import { Card } from './ui/Card';
import { useLms } from '@contexts/LmsContext';
import CircularProgressBar from './CircularProgressBar';
import { getCourseImageUrl } from '@utils/imageUtils';

interface DashboardCourseCardProps {
  course: Course;
}

const DashboardCourseCard: React.FC<DashboardCourseCardProps> = ({ course }) => {
  const { role, loadCourseData } = useLms();
  const progress = course.progressPercent ?? 0;
  const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);

  const getTypeColor = () => {
      switch(course.courseType) {
          case 'WSQ': return 'bg-blue-100 text-blue-800';
          case 'IBF': return 'bg-purple-100 text-purple-800';
          default: return 'bg-gray-100 text-gray-800';
      }
  }

  const handleCourseClick = async () => {
    try {
      await loadCourseData(course);
    } catch (error) {
      console.error('Error loading course data:', error);
    }
  };

  return (
    <Card className="flex flex-col group cursor-pointer" onClick={handleCourseClick}>
      <div className="relative">
        <img src={getCourseImageUrl(course.imageUrl, course.id)} alt={course.title} className="w-full h-auto object-cover rounded-t-xl" />
      </div>
      <div className="p-4 flex flex-col flex-grow">
        <h3 className="font-bold text-on-surface mb-3 group-hover:text-primary transition-colors mt-3">{course.title}</h3>
        
        {/* --- NEW INTEGRATED DETAILS AND PROGRESS SECTION --- */}
        <div className="flex items-center my-auto py-3">
            <div className="text-xs space-y-2 flex-grow">
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-500">TGS Ref</span>
                    <span className="font-mono text-gray-800">{course.courseCode}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-500">Course Duration</span>
                    <span className="font-medium text-gray-800 text-right">{totalHours} Hours ({course.trainingHours}T + {course.assessmentHours}A)</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-500">Course Type</span>
                    <span className={`font-semibold px-2 py-0.5 rounded ${getTypeColor()}`}>{course.courseType}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-500">Mode of Training</span>
                    <span className="font-medium text-gray-800">{course.modeOfLearning.join(', ')}</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-500">Course Run</span>
                    {role === UserRole.Learner && (<span className="font-mono text-gray-800">{course.courseRunCode}</span>)}
                    {role === UserRole.Trainer && (<span className="font-mono text-gray-800">{course.courseRunCode}</span>)}
                </div>
            </div>
            <div className="flex-shrink-0 ml-4">
                {role === UserRole.Learner && <CircularProgressBar percentage={progress} />}
            </div>
        </div>
        
        {/* --- ACTION LINK --- */}
        <div className="border-t border-gray-200 mt-auto pt-3 flex justify-between items-center">
            <span className="font-semibold text-on-surface text-sm">
                {role === UserRole.Learner ? (progress >= 100 ? 'Class Completed' : 'Resume Learning') : 'View Class'}
            </span>
            <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
            </div>
        </div>
      </div>
    </Card>
  );
};

export default DashboardCourseCard;
