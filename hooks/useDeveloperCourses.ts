import { useState, useEffect } from 'react';
import { courseService } from '@lib/services/courseService';
import { Course } from '@app-types';

export const useDeveloperCourses = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeveloperCourses = async () => {
    console.log('🔍 useDeveloperCourses - fetchDeveloperCourses called');
    try {
      setLoading(true);
      setError(null);
      
      console.log('📞 useDeveloperCourses - Calling courseService.getDeveloperCourses');
      const developerCourses = await courseService.getDeveloperCourses();
      
      console.log('✅ useDeveloperCourses - Received courses count:', developerCourses?.length || 0);
      console.log('📋 useDeveloperCourses - Full courses data:', developerCourses);
      
      setCourses(developerCourses || []);
    } catch (err: any) {
      console.error('❌ useDeveloperCourses - Error fetching courses:', err);
      setError(err.message || 'Failed to fetch courses');
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('🔄 useDeveloperCourses useEffect FIRING!');
    fetchDeveloperCourses();
  }, []);

  return { courses, loading, error, refetch: fetchDeveloperCourses };
};

// Developer course search hook
export const useDeveloperCourseSearch = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const searchCourses = async (
    search?: string, 
    courseType?: string, 
    modeOfLearning?: string
  ): Promise<void> => {
    try {
      setLoading(true);
      
      console.log('🔍 useDeveloperCourseSearch - Searching with params:', {
        search,
        courseType,
        modeOfLearning
      });
      
      // Since we have all courses, we'll implement client-side filtering
      // For now, just return all courses - filtering will be handled in the component
      const allCourses = await courseService.getDeveloperCourses();
      
      console.log('✅ useDeveloperCourseSearch - Search results:', allCourses);
      setCourses(allCourses || []);
    } catch (err: any) {
      console.error('❌ useDeveloperCourseSearch - Error:', err);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  return { courses, loading, searchCourses };
};