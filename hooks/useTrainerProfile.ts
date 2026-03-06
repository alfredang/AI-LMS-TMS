import { useState, useEffect, useCallback } from 'react';
import { TrainerProfile } from '@app-types/profile';
import { ProfileService } from '@lib/services/profileService';

export const useTrainerProfile = (userId?: string) => {
  const [profile, setProfile] = useState<TrainerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  console.log('🔧 useTrainerProfile - Hook called with userId:', userId);

  const fetchProfile = useCallback(async (userIdParam?: string, silent = false) => {
    if (!userIdParam) {
      console.log('⚠️ useTrainerProfile - No userId provided');
      return;
    }

    if (!silent) setLoading(true);
    setError(null);

    try {
      console.log('📞 useTrainerProfile - Fetching trainer profile for:', userIdParam);
      const trainerProfile = await ProfileService.getTrainerProfile(userIdParam);
      console.log('✅ useTrainerProfile - Received profile:', trainerProfile);
      setProfile(trainerProfile);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch trainer profile';
      console.error('❌ useTrainerProfile - Error:', err);
      setError(errorMessage);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const updateProfile = useCallback(async (userId: string, updatedData: Partial<TrainerProfile>) => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('💾 useTrainerProfile - Updating trainer profile');
      const updatedProfile = await ProfileService.updateTrainerProfile(userId, updatedData);
      console.log('✅ useTrainerProfile - Profile updated successfully');
      setProfile(updatedProfile);
      return updatedProfile;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update trainer profile';
      console.error('❌ useTrainerProfile - Update error:', err);
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) {
      fetchProfile(userId);
    }
  }, [userId, fetchProfile]);

  return {
    profile,
    loading,
    error,
    refetchProfile: () => fetchProfile(userId, true),
    updateProfile
  };
};