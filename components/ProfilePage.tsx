import React from 'react';
import { useProfile } from '@hooks/useProfile';
import { useTrainerProfile } from '@hooks/useTrainerProfile';
import { useLms } from '@contexts/LmsContext';
import { LearnerProfileCard } from '@components/common/LearnerProfileCard';
import { AdminProfileCard } from '@components/common/AdminProfileCard';
import { TrainerProfileCard } from '@components/TrainerProfileCard';
import ProfileView from '@components/ProfileView';
import { LearnerProfile, AdminProfile, TrainerProfile } from '@app-types/profile';
import { UserRole } from '@app-types';
import Spinner from '@components/ui/Spinner';

interface ProfilePageProps {
  userId?: string;
  role?: string;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ 
  userId, 
  role 
}) => {
  const { currentUser, role: contextRole, refreshUserProfile } = useLms();
  
  // Use authenticated user's ID and role from context, fallback to props
  const actualUserId = userId || currentUser?.id;
  const actualRole = role || contextRole?.toLowerCase() || 'learner';
  
  // Handle trainer profile separately
  if (contextRole === UserRole.Trainer) {
    console.log('🔍 ProfilePage: Rendering trainer profile for user:', actualUserId);
    const { profile: trainerProfile, loading: trainerLoading, error: trainerError, updateProfile: updateTrainerProfile } = useTrainerProfile(actualUserId);
    
    console.log('🔍 ProfilePage: Trainer profile state:', { 
      profile: trainerProfile, 
      loading: trainerLoading, 
      error: trainerError 
    });
    
    const handleTrainerUpdate = async (updatedData: Partial<TrainerProfile>) => {
      // TrainerProfileCard already handles the database update via its own API
      // We just need to update the local state and refresh user profile
      console.log('🔄 ProfilePage: Trainer profile updated locally:', updatedData);
      
      // Refresh user profile to get latest data
      await refreshUserProfile();
    };

    if (trainerLoading) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading trainer profile...</p>
          </div>
        </div>
      );
    }

    if (trainerError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Error Loading Trainer Profile</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{trainerError}</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">User ID: {actualUserId}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (!trainerProfile) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center text-subtle">
            <p>No trainer profile found</p>
            <p className="text-sm mt-2">User ID: {actualUserId}</p>
            <p className="text-sm mt-2">Please contact support if this is an error.</p>
          </div>
        </div>
      );
    }

    return (
      <div>
        <div className="max-w-5xl mx-auto px-4 py-8">
          <TrainerProfileCard 
            profile={trainerProfile} 
            onUpdate={handleTrainerUpdate}
            userId={actualUserId}
            onProfileUpdate={refreshUserProfile}
          />
        </div>
      </div>
    );
  }
  
  // Handle training provider profile separately
  if (contextRole === UserRole.TrainingProvider) {
    console.log('🔍 ProfilePage: Rendering training provider profile for user:', actualUserId);
    return <ProfileView />;
  }
  
  // Handle learner/admin profiles with existing logic
  // Don't fetch profile if no user ID is available
  const { profile, loading, error, refreshProfile } = useProfile({
    userId: actualUserId || '',
    role: actualRole,
    autoFetch: !!actualUserId
  });
  
  // Combined refresh function that refreshes both profile and header
  const handleProfileUpdate = async () => {
    await refreshProfile();
    await refreshUserProfile();
  };

  // Show error if no authenticated user
  if (!actualUserId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Authentication Required</h1>
          <p className="text-gray-600 dark:text-gray-400">Please log in to view your profile.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading beautiful profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error Loading Profile</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={refreshProfile}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-4">No Profile Found</h1>
          <p className="text-gray-600 dark:text-gray-400">No profile data available.</p>
        </div>
      </div>
    );
  }

  // Render appropriate profile card based on role
  const renderProfileCard = () => {
    switch (actualRole) {
      case 'learner':
        return (
          <LearnerProfileCard 
            profile={profile as LearnerProfile} 
            userId={actualUserId}
            onProfileUpdate={handleProfileUpdate}
          />
        );
      case 'admin':
        return <AdminProfileCard profile={profile as AdminProfile} />;
      default:
        return (
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400">Profile type not supported: {actualRole}</p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="py-8">
        <div className="max-w-4xl mx-auto px-4 space-y-6">
          {renderProfileCard()}
        </div>
      </div>
    </div>
  );
};
