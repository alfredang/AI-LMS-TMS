import { useState, useEffect } from 'react';
import { ProfileService } from '@lib/services/profileService';
import { UserProfile } from '@/types/profile';

export interface UseProfileOptions {
  userId: string;
  role: string;
  autoFetch?: boolean;
}

export interface UseProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  fetchProfile: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  uploadProfilePicture: (file: File) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export function useProfile({ 
  userId, 
  role, 
  autoFetch = true 
}: UseProfileOptions): UseProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🎣 useProfile: Fetching profile...');
      const profileData = await ProfileService.getProfile(userId, role);
      
      setProfile(profileData);
      console.log('✅ useProfile: Profile loaded successfully');
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ useProfile: Error fetching profile:', errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    try {
      setError(null);
      
      console.log('💾 useProfile: Updating profile...');
      const updatedProfile = await ProfileService.updateProfile(userId, role, data);
      
      setProfile(updatedProfile);
      console.log('✅ useProfile: Profile updated successfully');
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ useProfile: Error updating profile:', errorMessage);
      setError(errorMessage);
      throw err; // Re-throw to allow component to handle
    }
  };

  const uploadProfilePicture = async (file: File) => {
    try {
      setError(null);
      
      console.log('📸 useProfile: Uploading profile picture...');
      const profilePictureUrl = await ProfileService.uploadProfilePicture(userId, file);
      
      // Update the profile with new picture URL
      if (profile) {
        setProfile({
          ...profile,
          profilePictureUrl
        });
      }
      
      console.log('✅ useProfile: Profile picture uploaded successfully');
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ useProfile: Error uploading profile picture:', errorMessage);
      setError(errorMessage);
      throw err;
    }
  };

  const refreshProfile = async () => {
    await fetchProfile();
  };

  useEffect(() => {
    if (autoFetch && userId && role) {
      fetchProfile();
    }
  }, [userId, role, autoFetch]);

  return {
    profile,
    loading,
    error,
    fetchProfile,
    updateProfile,
    uploadProfilePicture,
    refreshProfile
  };
}
