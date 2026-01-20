import { getApiBaseUrl } from '../config';

const API_BASE_URL = getApiBaseUrl();

export interface CourseListItem {
  id: string;
  title: string;
  courseCode: string;
  tscTitle?: string;
  tscCode?: string;
}

export interface CourseDetails {
  id: string;
  title: string;
  tscTitle?: string;
  tscKnowledge?: string;
  tscAbilities?: string;
  learningOutcomes?: string;
}

export const courseApiService = {
  async fetchCourses(): Promise<CourseListItem[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/list`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch courses');
      }
      
      return data.data || [];
    } catch (error) {
      console.error('Error fetching courses:', error);
      return [];
    }
  },

  async fetchCourseDetails(courseId: string): Promise<CourseDetails | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/details?courseId=${courseId}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch course details');
      }
      
      return data.data;
    } catch (error) {
      console.error('Error fetching course details:', error);
      return null;
    }
  }
};