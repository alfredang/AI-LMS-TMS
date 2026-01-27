import { apiClient } from './apiClient';
import { LearnerProfile, AdminProfile, UserProfile, TrainerProfile } from '@app-types/profile';
import { getApiBaseUrl } from '../config';

export interface ProfileApiResponse {
  success: boolean;
  message: string;
  data: {
    profile: UserProfile;
    role: string;
  } | null;
  error: any;
  timestamp: string;
}

export interface TrainerProfileApiResponse {
  success: boolean;
  data: {
    profile: TrainerProfile;
  };
  message?: string;
  error?: string;
}

export interface UpdateProfileRequest {
  userId: string;
  profileData: Partial<LearnerProfile>;
}

export interface UpdateProfileResponse {
  success: boolean;
  message: string;
  data: {
    profile: LearnerProfile;
  };
  error?: string;
}

export class ProfileService {
  
  /**
   * Fetch profile by user ID and role
   */
  static async getProfile(userId: string, role: string): Promise<UserProfile> {
    try {
      console.log('🔍 ProfileService: Fetching profile for', { userId, role });
      
      const response = await apiClient.get<ProfileApiResponse>(
        `/api/profile-new?userId=${userId}&role=${role}`
      );
      
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to fetch profile');
      }
      
      console.log('✅ ProfileService: Profile fetched successfully');
      return response.data.profile;
      
    } catch (error) {
      console.error('❌ ProfileService: Error fetching profile:', error);
      throw error;
    }
  }

  /**
   * Update profile
   */
  static async updateProfile(userId: string, role: string, profileData: Partial<UserProfile>): Promise<UserProfile> {
    try {
      console.log('💾 ProfileService: Updating profile for', { userId, role });
      
      // Route to different endpoints based on role
      const baseUrl = getApiBaseUrl();
      let apiUrl = '';
      let updateData: any = {};

      if (role === 'trainer') {
        // Trainer APIs
        apiUrl = `${baseUrl}/api/profile/update-trainer`;
        updateData = {
          userId: userId,
          profileData: profileData
        };
      } else {
        // Other profiles
        apiUrl = `${baseUrl}/api/profile-update`;
        updateData = {
          userId: userId,
          profileData: profileData
        };
      }
      
      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update profile');
      }

      if (!result.success || !result.data?.profile) {
        throw new Error(result.error || 'Failed to update profile');
      }
      
      console.log('✅ ProfileService: Profile updated successfully');
      return result.data.profile;
      
    } catch (error) {
      console.error('❌ ProfileService: Error updating profile:', error);
      throw error;
    }
  }

  /**
   * Upload profile picture
   */
  static async uploadProfilePicture(userId: string, file: File): Promise<string> {
    try {
      console.log('📸 ProfileService: Uploading profile picture for', userId);
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      
      const response = await fetch('/api/upload/profile-picture', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload profile picture');
      }
      
      const data = await response.json();
      console.log('✅ ProfileService: Profile picture uploaded successfully');
      
      return data.profilePictureUrl;
      
    } catch (error) {
      console.error('❌ ProfileService: Error uploading profile picture:', error);
      throw error;
    }
  }
  
  /**
   * Fetch trainer profile by user ID
   */
  static async getTrainerProfile(userId: string): Promise<TrainerProfile> {
    try {
      console.log('🔍 ProfileService: Fetching trainer profile for', userId);

      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/profile/trainer?userId=${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.data) {
        throw new Error(data.message || 'Failed to fetch trainer profile');
      }
      
      console.log('✅ ProfileService: Trainer profile fetched successfully');
      return data.data.profile;
      
    } catch (error) {
      console.error('❌ ProfileService: Error fetching trainer profile:', error);
      throw error;
    }
  }

  /**
   * Update trainer profile
   */
  static async updateTrainerProfile(userId: string, profileData: Partial<TrainerProfile>): Promise<TrainerProfile> {
    try {
      console.log('💾 ProfileService: Updating trainer profile for', userId);

      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/profile/update-trainer`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, profileData }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.data) {
        throw new Error(data.message || 'Failed to update trainer profile');
      }
      
      console.log('✅ ProfileService: Trainer profile updated successfully');
      return data.data.profile;
      
    } catch (error) {
      console.error('❌ ProfileService: Error updating trainer profile:', error);
      throw error;
    }
  }
}
