import { useState, useEffect, useCallback } from 'react';
import { Course } from '@app-types';
import { courseService } from '@lib/services/courseService';

export const useTrainerCourses = (trainerId?: string, upcomingOnly = false, activeOnly = false) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrainerCourses = useCallback(async (trainerIdParam?: string) => {
    if (!trainerIdParam) {
      console.log('⚠️ useTrainerCourses - No trainerId provided');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('📞 useTrainerCourses - Fetching courses for trainer:', trainerIdParam);
      const trainerCourses = await courseService.getTrainerCourses(trainerIdParam, upcomingOnly, activeOnly);
      console.log('✅ useTrainerCourses - Received courses:', trainerCourses);
      setCourses(trainerCourses || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch trainer courses';
      console.error('❌ useTrainerCourses - Error:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [upcomingOnly, activeOnly]);

  useEffect(() => {
    if (trainerId) {
      fetchTrainerCourses(trainerId);
    }
  }, [trainerId, fetchTrainerCourses]);

  return {
    courses,
    loading,
    error,
    refetchCourses: () => fetchTrainerCourses(trainerId)
  };
};

export const useTrainerCourseSearch = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchCourses = useCallback(async (
    trainerId: string,
    search?: string,
    courseType?: 'WSQ' | 'IBF' | 'Non-WSQ' | 'All',
    modeOfLearning?: string
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔍 useTrainerCourseSearch - Searching with params:', {
        trainerId, search, courseType, modeOfLearning
      });
      
      const searchResults = await courseService.searchTrainerCourses(
        trainerId, 
        search, 
        courseType === 'All' ? undefined : courseType,
        modeOfLearning === 'All' ? undefined : modeOfLearning
      );
      
      console.log('✅ useTrainerCourseSearch - Search results:', searchResults);
      setCourses(searchResults || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search courses';
      console.error('❌ useTrainerCourseSearch - Error:', err);
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
