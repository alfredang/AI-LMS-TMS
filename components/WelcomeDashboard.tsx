import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { useCourses } from '../hooks/useCourses';
import { useTrainerCourses } from '../hooks/useTrainerCourses';
import DashboardCourseCard from '../components/DashboardCourseCard';
import { EmptyState } from './ui/EmptyState';
import { IconName } from './ui/Icon';
import { UserRole } from '@app-types';

const WelcomeDashboard: React.FC = () => {
  const { role, currentUser } = useLms();
  const { courses, loading, error } = useCourses(role === UserRole.Learner && currentUser?.id ? currentUser.id : undefined);
  const { courses: trainerCourses, loading: trainerLoading, error: trainerError } = useTrainerCourses(
    role === UserRole.Trainer && currentUser?.id ? currentUser.id : undefined
  );

  console.log('WelcomeDashboard - Role:', role);
  console.log('WelcomeDashboard - UserId passed to useCourses:', role === UserRole.Learner && currentUser?.id ? currentUser.id : undefined);
  console.log('WelcomeDashboard - Courses:', courses);
  console.log('WelcomeDashboard - Trainer Courses:', trainerCourses);
  console.log('WelcomeDashboard - Loading:', loading, 'Trainer Loading:', trainerLoading);
  console.log('WelcomeDashboard - Error:', error, 'Trainer Error:', trainerError);

  const getDashboardConfig = () => {
    switch (role) {
      case UserRole.Trainer:
        return {
          title: 'My Assigned Classes',
          courses: trainerCourses
        };
      case UserRole.Learner:
        return {
          title: 'My Classes',
          courses: courses
        };
      default: // Fallback for Developer/Admin
        return {
          title: 'Course Management',
          courses: courses
        };
    }
  };

  const { title: myCoursesTitle, courses: relevantCourses } = getDashboardConfig();

  // Use appropriate loading and error states based on role
  const isLoading = role === UserRole.Trainer ? trainerLoading : loading;
  const currentError = role === UserRole.Trainer ? trainerError : error;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading your courses...</p>
        </div>
      </div>
    );
  }

  if (currentError) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">Error loading courses: {currentError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-12">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-on-surface">
            {myCoursesTitle}
          </h2>
        </div>

        {relevantCourses.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No courses found"
              description={role === UserRole.Learner
                ? "You haven't enrolled in any courses yet. Browse the catalog to get started."
                : "No courses available at the moment."}
              icon={IconName.Courses}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {relevantCourses.map(course => (
              <DashboardCourseCard key={course.id} course={course} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default WelcomeDashboard;
