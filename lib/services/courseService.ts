import { apiClient } from './apiClient';
import { Course } from '@app-types';

export interface EnrolledCoursesResponse {
  success: boolean;
  data: Course[];
  total: number;
}

export const courseService = {
  id: 'courseService', // Add this to match the expected type
  
  async getEnrolledCourses(userId: string): Promise<Course[]> {
    try {
      const response = await apiClient.get<EnrolledCoursesResponse>(
        `/api/courses/enrolled?userId=${userId}`
      );
      
      if (response.success) {
        return response.data;
      } else {
        throw new Error('Failed to fetch enrolled courses');
      }
    } catch (error) {
      console.error('💥 courseService - Error fetching enrolled courses:', error);
      throw error;
    }
  },

  // Get developer courses
  async getDeveloperCourses() {
    try {
      const response = await apiClient.get<Course[]>(
        `/api/courses/developer`
      );
      
      return response;
    } catch (error) {
      console.error('💥 courseService - Error fetching developer courses:', error);
      throw error;
    }
  },

  // Search trainer courses
  async searchTrainerCourses(trainerId: string, search?: string, courseType?: string, modeOfLearning?: string) {
    try {
      const params = new URLSearchParams();
      params.append('trainerId', trainerId);
      if (search) params.append('search', search);
      if (courseType && courseType !== 'All') params.append('courseType', courseType);
      if (modeOfLearning && modeOfLearning !== 'All') params.append('modeOfLearning', modeOfLearning);

      const response = await apiClient.get<Course[]>(
        `/api/courses/trainer-search?${params.toString()}`
      );
      
      return response;
    } catch (error) {
      console.error('💥 courseService - Error searching trainer courses:', error);
      throw error;
    }
  },

  // Get trainer courses — pass upcoming=true to limit to today→today+7 (for e-attendance)
  async getTrainerCourses(trainerId: string, upcomingOnly = false) {
    try {
      const params = new URLSearchParams({ trainerId });
      if (upcomingOnly) params.set('upcoming', 'true');
      const response = await apiClient.get<Course[]>(
        `/api/courses/trainer-search?${params.toString()}`
      );
      return response;
    } catch (error) {
      console.error('💥 courseService - Error fetching trainer courses:', error);
      throw error;
    }
  },

  // Search learner courses (placeholder implementation)
  async searchLearnerCourses(userId: string, search?: string, courseType?: string, modeOfLearning?: string) {
    try {
      // For now, just return enrolled courses - this can be enhanced later
      return this.getEnrolledCourses(userId);
    } catch (error) {
      console.error('💥 courseService - Error searching learner courses:', error);
      throw error;
    }
  },

  // Get developer course detail by course ID (not course run)
  async getDeveloperCourseDetail(courseId: string) {
    try {
      const response = await apiClient.get<{
        success: boolean;
        data: any;
      }>(`/api/courses/developer-course-detail?courseId=${courseId}`);
      
      return response;
    } catch (error) {
      console.error('💥 courseService - Error fetching developer course detail:', error);
      throw error;
    }
  },

  // Delete course
  async deleteCourse(courseId: string) {
    try {
      const response = await apiClient.delete<{
        success: boolean;
        message: string;
        deletedFilesCount?: number;
      }>(`/api/courses/delete?courseId=${courseId}`);
      
      return response;
    } catch (error) {
      console.error('💥 courseService - Error deleting course:', error);
      throw error;
    }
  }
};