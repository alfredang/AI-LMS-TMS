import { useState, useEffect, useCallback } from 'react';
import { Course } from '@app-types';
import { courseService } from '@lib/services/courseService';
import { courseApiService, CourseListItem, CourseDetails } from '@lib/services/courseApiService';

export const useCourses = (userId?: string) => {
  console.log('🚀 useCourses hook called with userId:', userId);
  
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  console.log('📊 useCourses hook state initialized - courses length:', courses.length, 'loading:', loading);

  const fetchEnrolledCourses = useCallback(async (userIdParam?: string) => {
    console.log('🔍 useCourses - fetchEnrolledCourses called with userId:', userIdParam);
    if (!userIdParam) {
      console.log('⚠️ useCourses - No userId provided, returning early');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('📞 useCourses - Calling courseService.getEnrolledCourses with userId:', userIdParam);
      const enrolledCourses = await courseService.getEnrolledCourses(userIdParam);
      console.log('✅ useCourses - Received courses count:', enrolledCourses?.length || 0);
      console.log('📋 useCourses - Full courses data:', enrolledCourses);
      setCourses(enrolledCourses || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch courses';
      console.error('❌ useCourses - Error fetching courses:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []); // Empty dependency array since the function doesn't depend on any props or state

  // Simplified useEffect - debug version
  useEffect(() => {
    console.log('🔄 useCourses useEffect FIRING! userId:', userId);
    console.log('🔍 userId type:', typeof userId);
    console.log('✅ userId truthy check:', !!userId);
    
    if (userId) {
      console.log('✨ useCourses - About to call fetchEnrolledCourses');
      fetchEnrolledCourses(userId);
    } else {
      console.log('⚠️ useCourses - userId is falsy, not calling fetchEnrolledCourses');
    }
  }, [userId]); // Simplified dependency array

  console.log('📤 useCourses hook returning:', { coursesLength: courses.length, loading, error });
  
  return {
    courses,
    loading,
    error,
    refetchCourses: () => fetchEnrolledCourses(userId)
  };
};

export const useLearnerCourseSearch = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchCourses = useCallback(async (
    userId: string,
    search?: string,
    courseType?: 'WSQ' | 'IBF' | 'Non-WSQ' | 'All',
    modeOfLearning?: string
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔍 useLearnerCourseSearch - Searching with params:', {
        userId, search, courseType, modeOfLearning
      });
      
      const searchResults = await courseService.searchLearnerCourses(
        userId, 
        search, 
        courseType === 'All' ? undefined : courseType,
        modeOfLearning === 'All' ? undefined : modeOfLearning
      );
      
      console.log('✅ useLearnerCourseSearch - Search results:', searchResults);
      setCourses(searchResults || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search courses';
      console.error('❌ useLearnerCourseSearch - Error:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    courses,
    loading,
    error,
    searchCourses
  };
};

// New hooks for database course data
export const useAllCourses = () => {
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = async () => {
    setLoading(true);
    setError(null);
    try {
      const courseData = await courseApiService.fetchCourses();
      setCourses(courseData);
    } catch (err) {
      setError('Failed to load courses');
      console.error('Error fetching courses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  return {
    courses,
    loading,
    error,
    refetch: fetchCourses
  };
};

export const useCourseDetails = (courseId: string | null) => {
  const [courseDetails, setCourseDetails] = useState<CourseDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) {
      setCourseDetails(null);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const details = await courseApiService.fetchCourseDetails(courseId);
        setCourseDetails(details);
      } catch (err) {
        setError('Failed to load course details');
        console.error('Error fetching course details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [courseId]);

  return {
    courseDetails,
    loading,
    error
  };
};
