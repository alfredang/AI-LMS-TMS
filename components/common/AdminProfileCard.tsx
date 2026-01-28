import React, { useState, useEffect } from 'react';
import { Button, Card, Icon, Spinner, IconName } from '../ui';
import { AdminProfile } from '../../types/profile';
import { useLms } from '@contexts/LmsContext';
import { getApiUrl, getUploadUrl, getDeleteFileUrl, stripBaseUrl, getFileUrl } from '@/lib/urlHelpers';

// CSS classes for inputs
const inputClasses = "block w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

const ProfileBioItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
        <p className="font-semibold text-gray-900 break-words dark:text-gray-200">{value}</p>
    </div>
);

const LoginDetailsCard: React.FC<{
    loginId: string;
    password: string;
    userId: string;
    onPasswordUpdate?: (newPassword: string) => void;
}> = ({ loginId, password, userId, onPasswordUpdate }) => {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    const handleResetPassword = async () => {
        if (!newPassword.trim()) {
            alert('Please enter a new password');
            return;
        }

        if (newPassword.length < 6) {
            alert('Password must be at least 6 characters long');
            return;
        }

        try {
            setIsUpdating(true);

            // Use the new bcrypt-enabled password update API
            const response = await fetch(getApiUrl('/api/auth/update-password'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: userId,
                    newPassword: newPassword
                })
            });

            if (!response.ok) {
                throw new Error(`Password update failed: ${response.status}`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || 'Password update failed');
            }

            console.log('✅ Admin password updated successfully with bcrypt hashing');
            alert('Password reset successfully!');
            setIsResetting(false);
            setNewPassword('');

            // Call the callback to update the parent component
            if (onPasswordUpdate) {
                onPasswordUpdate(newPassword);
            }

        } catch (error) {
            console.error('❌ Failed to reset admin password:', error);
            alert(`Failed to reset password: ${error instanceof Error ? error.message : 'Please try again.'}`);
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <Card className="p-8 mt-8 dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-xl font-bold mb-4">Login Details</h2>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 flex-grow">
                    <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Login ID</p>
                        <p className="font-semibold text-gray-900 break-words dark:text-gray-200">{loginId}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Password</p>
                        <div className="flex items-end gap-2">
                            <div className="flex items-center gap-2 flex-grow">
                                {isResetting ? (
                                    <input
                                        type={isPasswordVisible ? "text" : "password"}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className={inputClasses + " tracking-wider"}
                                        placeholder="Enter new password"
                                    />
                                ) : (
                                    <p className="font-semibold text-gray-900 font-mono tracking-wider dark:text-gray-200">
                                        {isPasswordVisible ? password : '••••••••••••••••'}
                                    </p>
                                )}
                                <button onClick={() => setIsPasswordVisible(!isPasswordVisible)} className="text-gray-600 hover:text-blue-600 p-1 rounded-full">
                                    <Icon name={isPasswordVisible ? IconName.EyeOff : IconName.Eye} className="w-5 h-5" />
                                </button>
                            </div>

                            {isResetting ? (
                                <div className="flex items-end gap-2 flex-shrink-0">
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            setIsResetting(false);
                                            setNewPassword("");
                                        }}
                                        disabled={isUpdating}
                                    >
                                        Cancel
                                    </Button>
                                    <Button onClick={handleResetPassword} disabled={isUpdating}>
                                        {isUpdating ? <Spinner size="sm" /> : 'Save'}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="ghost"
                                    className="border border-gray-300 flex-shrink-0"
                                    onClick={() => setIsResetting(true)}
                                >
                                    Reset Password
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export const AdminProfileCard: React.FC<{ profile: AdminProfile }> = ({ profile }) => {
    const { updateCurrentUserProfile } = useLms();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState(profile);
    const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
    const [selectedProfilePictureFile, setSelectedProfilePictureFile] = useState<File | null>(null);
    const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(null);

    // Helper function to resolve image URL
    const resolveImageUrl = (url: string | null | undefined): string => {
        if (!url) return '/api/placeholder/150/150';

        // If it's already a full URL (AI generated or external), return as is
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }

        // If it's a relative path to uploads, prepend server URL
        if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
            return getFileUrl(url) || url;
        }

        // Fallback for any other case
        return url;
    };

    useEffect(() => {
        setFormData(profile);
    }, [profile]);

    // Handle password update from LoginDetailsCard
    const handlePasswordUpdate = (newPassword: string) => {
        setFormData(prev => ({ ...prev, password: newPassword }));
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            // Validate file type and size
            if (!file.type.startsWith('image/')) {
                alert('Please select a valid image file.');
                return;
            }

            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                alert('File size must be less than 5MB.');
                return;
            }

            // Store the file for later upload and create a preview
            setSelectedProfilePictureFile(file);

            // Create preview URL for immediate display
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = e.target?.result as string;
                setProfilePicturePreview(preview);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateAvatar = async () => {
        setIsGeneratingAvatar(true);
        try {
            // Clear any selected file since we're generating an AI avatar
            setSelectedProfilePictureFile(null);
            setProfilePicturePreview(null);

            await new Promise(resolve => setTimeout(resolve, 2000));
            const newAvatarUrl = `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 50)}`;
            setFormData(prev => ({ ...prev, profilePictureUrl: newAvatarUrl }));
        } catch (error) {
            console.error("Avatar generation failed:", error);
            alert("An error occurred while generating the avatar.");
        } finally {
            setIsGeneratingAvatar(false);
        }
    };

    const handleSave = async () => {
        try {
            console.log('💾 Saving admin profile:', formData);

            // Variable to store the uploaded path from this save session
            let currentUploadedPath: string | null = null;

            // Upload profile picture if a new one was selected
            if (selectedProfilePictureFile) {
                try {
                    console.log('📁 Uploading admin profile picture:', selectedProfilePictureFile.name);

                    // Delete old profile picture if it exists and is a local file
                    const oldFileUrl = profile.profilePictureUrl;
                    if (oldFileUrl && (oldFileUrl.startsWith('/uploads/') || oldFileUrl.includes('uploads/'))) {
                        try {
                            // Extract just the path part if it's a full URL
                            const filePath = oldFileUrl.startsWith('http')
                                ? stripBaseUrl(oldFileUrl) || oldFileUrl
                                : oldFileUrl;
                            await fetch(getDeleteFileUrl(filePath), {
                                method: 'DELETE'
                            });
                            console.log('✅ Old admin profile picture deleted before upload');
                        } catch (error) {
                            console.warn('⚠️ Failed to delete old admin profile picture:', error);
                        }
                    }

                    const uploadFormData = new FormData();
                    uploadFormData.append('file', selectedProfilePictureFile);

                    const uploadUrl = getUploadUrl('admin', 'profilePicture');

                    const response = await fetch(uploadUrl, {
                        method: 'POST',
                        body: uploadFormData
                    });

                    if (!response.ok) {
                        throw new Error(`Upload failed: ${response.statusText}`);
                    }

                    const result = await response.json();
                    if (!result.success) {
                        throw new Error(result.error || 'Upload failed');
                    }

                    console.log('✅ Admin profile picture uploaded successfully:', result.data);

                    // Store the uploaded path for database update
                    const relativePath = result.data.fileUrl.startsWith('http')
                        ? stripBaseUrl(result.data.fileUrl) || result.data.fileUrl
                        : result.data.fileUrl;

                    currentUploadedPath = relativePath;
                    console.log('📝 Admin uploaded profile picture path stored:', relativePath);

                    // Update formData with the relative path
                    setFormData(prev => ({
                        ...prev,
                        profilePictureUrl: relativePath
                    }));

                    // Clear the preview URL since we now have the real URL
                    setProfilePicturePreview(null);

                } catch (error) {
                    console.error('❌ Failed to upload admin profile picture:', error);
                    alert(`Failed to upload profile picture: ${error instanceof Error ? error.message : 'Please try again.'}`);
                    return;
                }
            }

            // Compare current formData with original profile to detect changes
            const changedFields: any = {};

            // Check each field for changes
            if (formData.name !== profile.name) changedFields.name = formData.name;
            if (formData.email !== profile.email) changedFields.email = formData.email;
            if (formData.tel !== profile.tel) changedFields.tel = formData.tel;

            // Handle profile picture changes
            if (currentUploadedPath) {
                // A new file was uploaded in this save session
                console.log('📝 Using current session uploaded path for database:', currentUploadedPath);
                changedFields.profilePictureUrl = currentUploadedPath;
            } else if (formData.profilePictureUrl &&
                formData.profilePictureUrl !== profile.profilePictureUrl &&
                !formData.profilePictureUrl.startsWith('data:')) {
                // Profile picture changed but it's not a data URL (probably AI generated)
                console.log('📝 Using formData profile picture URL:', formData.profilePictureUrl);
                changedFields.profilePictureUrl = formData.profilePictureUrl;

                // If switching from local file to AI generated, delete the old file
                const oldFileUrl = profile.profilePictureUrl;
                if (oldFileUrl && (oldFileUrl.startsWith('/uploads/') || oldFileUrl.includes('uploads/'))) {
                    try {
                        const filePath = oldFileUrl.startsWith('http')
                            ? stripBaseUrl(oldFileUrl) || oldFileUrl
                            : oldFileUrl;
                        await fetch(getDeleteFileUrl(filePath), {
                            method: 'DELETE'
                        });
                        console.log('✅ Old admin profile picture deleted (switched to AI generated)');
                    } catch (error) {
                        console.warn('⚠️ Failed to delete old admin profile picture:', error);
                    }
                }
            }

            // If no fields changed, don't make API call
            if (Object.keys(changedFields).length === 0) {
                console.log('📝 No changes detected, skipping save');
                setIsEditing(false);
                return;
            }

            console.log('📝 Admin changed fields:', changedFields);

            // Call the admin profile update API
            const updateResponse = await fetch(getApiUrl('/api/admin/update-profile'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: profile.id,
                    profileData: changedFields
                })
            });

            if (!updateResponse.ok) {
                throw new Error(`HTTP error! status: ${updateResponse.status}`);
            }

            const updateResult = await updateResponse.json();

            if (!updateResult.success) {
                throw new Error(updateResult.error || 'Failed to update admin profile');
            }

            console.log('✅ Admin profile updated successfully:', updateResult.data);

            setIsEditing(false);
            alert('Admin profile saved successfully!');

            // Update the original profile state with the changes
            Object.assign(profile, changedFields);

            // Update the formData to reflect changes including loginId
            const finalProfilePictureUrl = currentUploadedPath || changedFields.profilePictureUrl;
            setFormData(prev => ({
                ...prev,
                ...changedFields,
                profilePictureUrl: finalProfilePictureUrl,
                loginId: changedFields.email || prev.loginId // Update loginId if email changed
            }));

            // Update the header profile image when any profile change happens
            console.log('🔄 Updating header profile image:', {
                finalProfilePictureUrl,
                originalUrl: profile.profilePictureUrl,
                changedFields
            });

            // Add cache-busting parameter to ensure image refreshes
            const profileImageUrl = finalProfilePictureUrl || formData.profilePictureUrl;
            const cacheBustedUrl = profileImageUrl && profileImageUrl.startsWith('/uploads/')
                ? `${profileImageUrl}?t=${Date.now()}`
                : profileImageUrl;

            // Always update the header profile when profile is saved
            updateCurrentUserProfile({
                profilePictureUrl: cacheBustedUrl,
                name: changedFields.name || profile.name
            });
            console.log('✅ Header profile updated with cache-busted URL:', cacheBustedUrl);

            // Clear tracking state after updating formData
            setSelectedProfilePictureFile(null);
            setProfilePicturePreview(null);

        } catch (error) {
            console.error('❌ Failed to save admin profile:', error);
            alert(`Failed to save admin profile: ${error instanceof Error ? error.message : 'Please try again.'}`);
        }
    };

    return (
        <>
            <Card className="p-8 dark:bg-gray-800 dark:border-gray-700">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="flex-shrink-0 text-center">
                        <div className="relative group w-24 h-24">
                            <img src={profilePicturePreview || resolveImageUrl(formData.profilePictureUrl)} alt={formData.name} className="w-24 h-24 rounded-full object-cover ring-4 ring-indigo-500/20" />
                            {isGeneratingAvatar && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                                    <Spinner size="sm" className="text-white" />
                                </div>
                            )}
                            {isEditing && !isGeneratingAvatar && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                    onClick={() => document.getElementById('admin-photo-upload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-6 h-6 text-white" />
                                </div>
                            )}
                        </div>
                        {isEditing && (
                            <>
                                <input type="file" id="admin-photo-upload" className="hidden" onChange={handlePhotoChange} accept="image/*" />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-2"
                                    onClick={handleGenerateAvatar}
                                    disabled={isGeneratingAvatar}
                                >
                                    {isGeneratingAvatar ? <Spinner size="sm" /> : 'Generate Avatar'}
                                </Button>
                            </>
                        )}
                    </div>
                    <div className="text-center sm:text-left flex-grow">
                        <h1 className="text-2xl font-bold dark:text-white">{isEditing ? 'Editing Profile' : formData.name}</h1>
                        <p className="text-gray-600 dark:text-gray-400">Admin Profile</p>
                    </div>
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={() => {
                                setIsEditing(false);
                                setFormData(profile);
                                // Clear any preview state when canceling
                                setSelectedProfilePictureFile(null);
                                setProfilePicturePreview(null);
                            }}>Cancel</Button>
                            <Button onClick={handleSave}>Save Changes</Button>
                        </div>
                    ) : (
                        <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>
                    )}
                </div>
                <div className="border-t dark:border-gray-700 my-6"></div>
                <h2 className="text-xl font-bold mb-4 dark:text-white">Bio Data</h2>
                {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div><label className="text-sm font-medium dark:text-gray-200">Name</label><input type="text" name="name" value={formData.name} onChange={handleChange} className={inputClasses} /></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Telephone</label><input type="tel" name="tel" value={formData.tel} onChange={handleChange} className={inputClasses} /></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Email</label><input type="email" name="email" value={formData.email} onChange={handleChange} className={inputClasses} /></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <ProfileBioItem label="Name" value={formData.name} />
                        <ProfileBioItem label="Telephone" value={formData.tel} />
                        <ProfileBioItem label="Email" value={formData.email} />
                    </div>
                )}
            </Card>
            <LoginDetailsCard
                loginId={formData.loginId}
                password={formData.password || '••••••••'}
                userId={formData.id}
                onPasswordUpdate={handlePasswordUpdate}
            />
        </>
    );
};
