import React from 'react';
import { useProfile } from '@hooks/useProfile';
import { useLms } from '@contexts/LmsContext';
import { LearnerProfileCard } from '@components/common/LearnerProfileCard';
import { AdminProfileCard } from '@components/common/AdminProfileCard';
import ProfileView from '@components/ProfileView';
import { LearnerProfile, AdminProfile } from '@app-types/profile';
import { UserRole } from '@app-types';

interface ProfilePageProps {
  userId?: string;
  role?: string;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  userId,
  role
}) => {
  const { currentUser, role: contextRole } = useLms();

  const actualUserId = userId || currentUser?.id;
  const actualRole = role || contextRole?.toLowerCase() || 'learner';

  // Trainer, Developer, and TrainingProvider are all handled by ProfileView
  // which correctly manages their hooks and data fetching internally
  const delegateToProfileView = contextRole === UserRole.Trainer ||
    contextRole === UserRole.Developer ||
    contextRole === UserRole.TrainingProvider;

  // useProfile must be called unconditionally (React hooks rule)
  // autoFetch is false for roles handled by ProfileView
  const { profile, loading, error, refreshProfile } = useProfile({
    userId: actualUserId || '',
    role: actualRole,
    autoFetch: !!actualUserId && !delegateToProfileView
  });

  // Delegate trainer / developer / training provider to ProfileView
  if (delegateToProfileView) {
    return <ProfileView />;
  }

  // Show error if no authenticated user
  if (!actualUserId) {
    return (
      <div className="flex items-center justify-center py-24 bg-background">
        <div className="text-center">
          <h1 className="text-xl font-bold text-red-500 mb-3">Authentication Required</h1>
          <p className="text-sm text-on-surface-secondary">Please log in to view your profile.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-sm text-on-surface-secondary">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24 bg-background">
        <div className="text-center">
          <h1 className="text-xl font-bold text-red-500 mb-3">Error Loading Profile</h1>
          <p className="text-sm text-on-surface-secondary mb-4">{error}</p>
          <button
            onClick={refreshProfile}
            className="bg-primary hover:bg-primary-hover text-white font-semibold py-2 px-4 rounded-lg transition-colors"
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
            onProfileUpdate={refreshProfile}
          />
        );
      case 'admin':
      case 'finance':
      case 'payroll':
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
