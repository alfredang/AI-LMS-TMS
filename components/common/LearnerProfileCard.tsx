import React, { useState, useEffect } from 'react';
import { Button, Card, Icon, IconName } from '../ui';
import { LearnerProfile, Gender, EmploymentStatus, Nationality, Ethnicity } from '../../types/profile';
import { calculateAgeGroup, maskNric, formatDate, formatDateForInput } from '../../utils';
import { ProfileService } from '@lib/services/profileService';
import { useLms } from '@contexts/LmsContext';
import { UserRole } from '@app-types';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';
import { getApiUrl, getUploadUrl, getDeleteFileUrl, getProfileImageImportUrl, stripBaseUrl } from '@/lib/urlHelpers';
import { ThemeMode, getCurrentTheme, applyTheme } from '@utils/colorUtils';

// CSS classes for inputs
const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

// --- Reusable Profile Components ---
const ProfileBioItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
        <p className="font-semibold text-gray-900 dark:text-gray-200 break-words">{value}</p>
    </div>
);

const MaskedProfileBioItem: React.FC<{
    label: string;
    value: string;
    isVisible: boolean;
    onToggle: () => void;
    isAdmin: boolean;
    maskFn: (val: string) => string;
}> = ({ label, value, isVisible, onToggle, isAdmin, maskFn }) => (
    <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
        <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900 dark:text-gray-200 break-words">
                {isAdmin && isVisible ? value : maskFn(value)}
            </p>
            {isAdmin && (
                <button onClick={onToggle} className="text-gray-600 dark:text-gray-400 hover:text-primary">
                    <Icon name={isVisible ? IconName.EyeOff : IconName.Eye} className="w-5 h-5" />
                </button>
            )}
        </div>
    </div>
);

const LoginDetailsCard: React.FC<{
    loginId: string;
    password: string;
    userId?: string;
    onPasswordUpdate?: (newPassword: string) => void;
}> = ({ loginId, password, userId, onPasswordUpdate }) => {
    const { currentUser, role } = useLms();
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

            // Use currentUser from component level hook
            if (!currentUser?.id) {
                throw new Error('No authenticated user found');
            }

            // Use the new bcrypt-enabled password update API
            const response = await fetch(getApiUrl('/api/auth/update-password'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId: currentUser.id,
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

            console.log('✅ Learner password updated successfully with bcrypt hashing');
            alert('Password reset successfully!');
            setIsResetting(false);
            setNewPassword('');

            // Call the callback to update the parent component
            if (onPasswordUpdate) {
                onPasswordUpdate(newPassword);
            }

        } catch (error) {
            console.error('❌ Failed to reset learner password:', error);
            alert(`Failed to reset password: ${error instanceof Error ? error.message : 'Please try again.'}`);
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <Card className="p-8 mt-8 dark:bg-gray-800 dark:border-gray-700">
            <h2 className="text-xl font-bold mb-4 dark:text-white">Login Details</h2>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 flex-grow">
                    <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Login ID</p>
                        <p className="font-semibold text-gray-900 dark:text-gray-200 break-words">{loginId}</p>
                    </div>

                    {/* Password row */}
                    <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Password</p>

                        {/* one row: input/display + eye (left) | actions (right) */}
                        <div className="flex items-end gap-2">
                            {/* left group */}
                            <div className="flex items-center gap-2 flex-grow">
                                {isResetting ? (
                                    <input
                                        type={isPasswordVisible ? "text" : "password"}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className={`${inputClasses} tracking-wider`}
                                        placeholder="Enter new password"
                                    />
                                ) : (
                                    <p className="font-semibold text-gray-900 dark:text-gray-200 tracking-wider">
                                        {isPasswordVisible ? password : "••••••••••••••••"}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                                    className="text-gray-600 dark:text-gray-400 hover:text-primary p-1 rounded-full"
                                >
                                    <Icon
                                        name={isPasswordVisible ? IconName.EyeOff : IconName.Eye}
                                        className="w-5 h-5"
                                    />
                                </button>
                            </div>

                            {/* right group: actions (now inline with input/display) */}
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
                                        Save
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="ghost"
                                    className="border border-gray-300 dark:border-gray-600 dark:text-gray-200 flex-shrink-0"
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

export const LearnerProfileCard: React.FC<{
    profile: LearnerProfile;
    userId?: string;
    onProfileUpdate?: () => void;
}> = ({ profile, userId, onProfileUpdate }) => {
    const { currentUser, role } = useLms();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState(profile);
    const [showNric, setShowNric] = useState(false);
    const [showDob, setShowDob] = useState(false);
    const [selectedProfilePictureFile, setSelectedProfilePictureFile] = useState<File | null>(null);
    const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(null);
    const [uploadedProfilePicturePath, setUploadedProfilePicturePath] = useState<string | null>(null);
    const [profileImageLink, setProfileImageLink] = useState('');
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => getCurrentTheme());

    console.log('form data content:', formData);

    const isAdmin = role === UserRole.Admin;

    useEffect(() => {
        setFormData(profile);
        setProfileImageLink(profile.profilePictureUrl || '');
    }, [profile]);

    // Handle password update from LoginDetailsCard
    const handlePasswordUpdate = (newPassword: string) => {
        setFormData(prev => ({ ...prev, password: newPassword }));
    };

    const handleThemeToggle = () => {
        const newTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
        setThemeMode(newTheme);
        applyTheme(newTheme);
        console.log(`🌓 Theme toggled to: ${newTheme}`);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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

            // Clear any previous uploaded path since we have a new file
            setUploadedProfilePicturePath(null);
            setProfileImageLink('');

            // Create preview URL for immediate display only - don't update formData
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = e.target?.result as string;
                setProfilePicturePreview(preview);
                // DON'T update formData.profilePictureUrl with the preview - only with actual uploaded path
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = async () => {
        try {
            console.log('💾 Saving learner profile:', formData);

            // Use the currentUser from component level hook
            const CURRENT_USER_ID = currentUser?.id;

            if (!CURRENT_USER_ID) {
                console.error('❌ No authenticated user found');
                alert('Error: No authenticated user found. Please log in again.');
                return;
            }

            // Variable to store the uploaded path from this save session
            let currentUploadedPath: string | null = null;

            // Upload profile picture from URL if provided
            if (profileImageLink.trim()) {
                try {
                    const response = await fetch(getProfileImageImportUrl('learner', CURRENT_USER_ID), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sourceUrl: profileImageLink.trim() }),
                    });

                    if (!response.ok) {
                        throw new Error(`Image URL import failed: ${response.statusText}`);
                    }

                    const result = await response.json();
                    if (!result.success) {
                        throw new Error(result.error || 'Image URL import failed');
                    }

                    currentUploadedPath = result.data.fileUrl;
                    setUploadedProfilePicturePath(result.data.fileUrl);
                    setProfileImageLink(result.data.fileUrl);
                    setFormData(prev => ({ ...prev, profilePictureUrl: result.data.fileUrl }));
                    setProfilePicturePreview(null);
                } catch (error) {
                    console.error('❌ Failed to import learner profile picture from URL:', error);
                    alert(`Failed to import profile image: ${error instanceof Error ? error.message : 'Please try again.'}`);
                    return;
                }
            }
            // Upload profile picture if a new one was selected
            else if (selectedProfilePictureFile) {
                try {
                    console.log('📁 Uploading profile picture:', selectedProfilePictureFile.name);
                    console.log('🔄 Current uploadedProfilePicturePath before upload:', uploadedProfilePicturePath);

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
                            console.log('✅ Old profile picture deleted before upload');
                        } catch (error) {
                            console.warn('⚠️ Failed to delete old profile picture:', error);
                        }
                    }

                    const uploadFormData = new FormData();
                    uploadFormData.append('file', selectedProfilePictureFile);

                    const uploadUrl = getUploadUrl('learner', 'profilePicture');

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

                    console.log('✅ Profile picture uploaded successfully:', result.data);

                    // Store the uploaded path for database update
                    const relativePath = result.data.fileUrl.startsWith('http')
                        ? stripBaseUrl(result.data.fileUrl) || result.data.fileUrl
                        : result.data.fileUrl;

                    // Store in both state and local variable
                    setUploadedProfilePicturePath(relativePath);
                    currentUploadedPath = relativePath;  // Store in local variable for immediate use
                    setProfileImageLink(relativePath);

                    console.log('📝 NEW uploaded profile picture path stored:', relativePath);
                    console.log('📝 Server returned fileUrl:', result.data.fileUrl);

                    // Update formData with the relative path for both display and database consistency
                    setFormData(prev => ({
                        ...prev,
                        profilePictureUrl: relativePath  // Use relative path consistently
                    }));

                    // Clear the preview URL since we now have the real URL
                    setProfilePicturePreview(null);

                } catch (error) {
                    console.error('❌ Failed to upload profile picture:', error);
                    alert(`Failed to upload profile picture: ${error instanceof Error ? error.message : 'Please try again.'}`);
                    return;
                }
            }

            // Compare current formData with original profile to detect changes
            const changedFields: any = {};

            console.log('🔍 DEBUG: About to save profile');
            console.log('🔍 uploadedProfilePicturePath (state):', uploadedProfilePicturePath);
            console.log('🔍 currentUploadedPath (local):', currentUploadedPath);
            console.log('🔍 formData.profilePictureUrl:', formData.profilePictureUrl);
            console.log('🔍 profile.profilePictureUrl:', profile.profilePictureUrl);

            // Check each field for changes
            if (formData.name !== profile.name) changedFields.name = formData.name;
            if (formData.email !== profile.email) changedFields.email = formData.email;
            if (formData.secondaryEmail !== profile.secondaryEmail) changedFields.secondaryEmail = formData.secondaryEmail;

            // For profile picture, prioritize the current upload, then state, then formData comparison
            if (currentUploadedPath) {
                // A new file was uploaded in this save session
                console.log('📝 Using current session uploaded path for database:', currentUploadedPath);
                changedFields.profilePictureUrl = currentUploadedPath;
            } else if (uploadedProfilePicturePath) {
                // Use the state uploaded path
                console.log('📝 Using state uploaded profile picture path for database:', uploadedProfilePicturePath);
                changedFields.profilePictureUrl = uploadedProfilePicturePath;
            } else if (formData.profilePictureUrl &&
                formData.profilePictureUrl !== profile.profilePictureUrl &&
                !formData.profilePictureUrl.startsWith('data:')) {
                // Profile picture changed but it's not a data URL (probably AI generated)
                console.log('📝 Using formData profile picture URL:', formData.profilePictureUrl);
                changedFields.profilePictureUrl = formData.profilePictureUrl;
            }

            if (formData.tel !== profile.tel) changedFields.tel = formData.tel;
            if (formData.company !== profile.company) changedFields.company = formData.company;
            if (formData.employmentStatus !== profile.employmentStatus) changedFields.employmentStatus = formData.employmentStatus;
            if (formData.nationality !== profile.nationality) changedFields.nationality = formData.nationality;
            if (formData.ethnicity !== profile.ethnicity) changedFields.ethnicity = formData.ethnicity;
            if (formData.dob !== profile.dob) changedFields.dob = formData.dob;
            if (formData.nric !== profile.nric) changedFields.nric = formData.nric;
            if (formData.gender !== profile.gender) changedFields.gender = formData.gender;

            // If no fields changed, don't make API call
            if (Object.keys(changedFields).length === 0) {
                console.log('📝 No changes detected, skipping save');
                setIsEditing(false);
                return;
            }

            console.log('📝 Changed fields:', changedFields);

            // Use ProfileService to update the profile
            const updatedProfile = await ProfileService.updateProfile(
                CURRENT_USER_ID,
                'learner',
                changedFields
            );

            console.log('✅ Profile updated successfully:', updatedProfile);

            // Log what we're storing for debugging
            if (changedFields.profilePictureUrl) {
                console.log('🖼️ Profile picture stored in database:', changedFields.profilePictureUrl);
            }

            setIsEditing(false);
            alert('Profile saved successfully!');

            // Update the original profile state with the changes
            // This ensures the next comparison works correctly
            Object.assign(profile, changedFields);

            // Update the formData to reflect changes including loginId
            // Make sure profile picture URL is the uploaded path if available
            const finalProfilePictureUrl = currentUploadedPath || uploadedProfilePicturePath || changedFields.profilePictureUrl;
            setFormData(prev => ({
                ...prev,
                ...changedFields,
                profilePictureUrl: finalProfilePictureUrl,
                loginId: changedFields.email || prev.loginId // Update loginId if email changed
            }));

            // Clear tracking state after updating formData
            setSelectedProfilePictureFile(null);
            setProfilePicturePreview(null);
            setUploadedProfilePicturePath(null);

            // Call the onProfileUpdate callback to refresh header
            if (onProfileUpdate) {
                onProfileUpdate();
            }

        } catch (error) {
            console.error('❌ Failed to save learner profile:', error);
            alert(`Failed to save profile: ${error instanceof Error ? error.message : 'Please try again.'}`);
        }
    };

    return (
        <>
            <Card className="p-8 dark:bg-gray-800 dark:border-gray-700">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="flex-shrink-0 text-center">
                        <div className="relative group w-24 h-24">
                            <img src={profilePicturePreview || (isEditing && profileImageLink.trim() ? ensureAbsoluteImageUrl(profileImageLink.trim()) : undefined) || ensureAbsoluteImageUrl(formData.profilePictureUrl) || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K'} alt={formData.name} className="w-24 h-24 rounded-full object-cover ring-4 ring-primary/20" onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K'; }} />
                            {isEditing && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                    onClick={() => document.getElementById('photo-upload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-6 h-6 text-white" />
                                </div>
                            )}
                        </div>
                        {isEditing && (
                            <input type="file" id="photo-upload" className="hidden" onChange={handlePhotoChange} accept="image/*" />
                        )}
                    </div>
                    <div className="text-center sm:text-left flex-grow">
                        <h1 className="text-2xl font-bold text-on-surface">{isEditing ? 'Editing Profile' : formData.name}</h1>
                        <p className="text-gray-600 dark:text-gray-400">Learner Profile</p>
                    </div>
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" className="border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200" onClick={() => {
                                setIsEditing(false);
                                setFormData(profile);
                                // Clear any preview state when canceling
                                setSelectedProfilePictureFile(null);
                                setProfilePicturePreview(null);
                                setUploadedProfilePicturePath(null);
                                setProfileImageLink(profile.profilePictureUrl || '');
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
                        <div><label className="text-sm font-medium dark:text-gray-200">Secondary Email</label><input type="email" name="secondaryEmail" value={formData.secondaryEmail || ''} onChange={handleChange} className={inputClasses} /></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Date of Birth</label><input type="date" name="dob" value={formatDateForInput(formData.dob || '')} onChange={handleChange} className={inputClasses} /></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">NRIC</label><input type="text" name="nric" value={formData.nric || ''} onChange={handleChange} className={inputClasses} /></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Race</label><select name="ethnicity" value={formData.ethnicity || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Ethnicity).map(e => <option key={e} value={e}>{e}</option>)}</select></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Gender</label><select name="gender" value={formData.gender || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Gender).map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Company</label><input type="text" name="company" value={formData.company} onChange={handleChange} className={inputClasses} /></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Employment Status</label><select name="employmentStatus" value={formData.employmentStatus || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(EmploymentStatus).map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Nationality</label><select name="nationality" value={formData.nationality || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Nationality).map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                        <div><label className="text-sm font-medium dark:text-gray-200">Profile Image Link</label><input type="url" value={profileImageLink} onChange={(e) => { setProfileImageLink(e.target.value); if (e.target.value.trim()) { setSelectedProfilePictureFile(null); setProfilePicturePreview(null); } }} placeholder="Paste image URL to save into Google Drive" className={inputClasses} /></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <ProfileBioItem label="Name" value={formData.name} />
                        <ProfileBioItem label="Telephone" value={formData.tel} />
                        <ProfileBioItem label="Email" value={formData.email} />
                        <ProfileBioItem label="Secondary Email" value={formData.secondaryEmail || '—'} />
                        <MaskedProfileBioItem
                            label="Date of Birth"
                            value={formData.dob ? formatDate(formData.dob) : ''}
                            isVisible={showDob}
                            onToggle={() => setShowDob(!showDob)}
                            isAdmin={isAdmin}
                            maskFn={() => 'XX/XX/XXXX'}
                        />
                        <MaskedProfileBioItem
                            label="NRIC"
                            value={formData.nric || 'N/A'}
                            isVisible={showNric}
                            onToggle={() => setShowNric(!showNric)}
                            isAdmin={isAdmin}
                            maskFn={(val) => val && val !== 'N/A' ? maskNric(val) : 'N/A'}
                        />
                        <ProfileBioItem label="Race" value={formData.ethnicity} />
                        <ProfileBioItem label="Age Group" value={formData.dob ? calculateAgeGroup(formData.dob) : 'Not specified'} />
                        <ProfileBioItem label="Gender" value={formData.gender} />
                        <ProfileBioItem label="Company" value={formData.company} />
                        <ProfileBioItem label="Employment Status" value={formData.employmentStatus} />
                        <ProfileBioItem label="Nationality" value={formData.nationality} />
                    </div>
                )}

                {!isEditing && (
                    <>
                        <div className="border-t dark:border-gray-700 my-6"></div>
                        <h2 className="text-xl font-bold mb-4 dark:text-white">Appearance</h2>

                        {/* Theme Mode Toggle */}
                        <div className="space-y-4">
                            <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${themeMode === 'dark' ? 'bg-gray-600' : 'bg-blue-100'}`}>
                                        {themeMode === 'dark' ? (
                                            <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                                            </svg>
                                        ) : (
                                            <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-900 dark:text-gray-200">Theme Mode</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            {themeMode === 'dark' ? 'Dark theme active' : 'Light theme active'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleThemeToggle}
                                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${themeMode === 'dark' ? 'bg-blue-600' : 'bg-gray-300'
                                        }`}
                                >
                                    <span
                                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${themeMode === 'dark' ? 'translate-x-8' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            </div>
                        </div>

                        {isAdmin && (
                            <>
                                <div className="border-t dark:border-gray-700 my-6"></div>
                                <h2 className="text-xl font-bold mb-4 dark:text-white">Billing Documents</h2>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                        <div>
                                            <p className="font-semibold dark:text-gray-200">Pro Forma Invoice</p>
                                            <p className="text-xs text-subtle dark:text-gray-400">Pro forma invoice for your enrollment.</p>
                                        </div>
                                        <Button size="sm" className="!text-white" onClick={() => window.open(formData.pro_formal_url, '_blank')}>
                                            Download
                                        </Button>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                        <div>
                                            <p className="font-semibold dark:text-gray-200">Course Invoice</p>
                                            <p className="text-xs text-subtle dark:text-gray-400">Invoice for your course enrollment.</p>
                                        </div>
                                        <Button size="sm" className="!text-white" disabled={!formData.invoice_url} onClick={() => formData.invoice_url && window.open(formData.invoice_url, '_blank')}>
                                            Download
                                        </Button>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                        <div>
                                            <p className="font-semibold dark:text-gray-200">Payment Receipt</p>
                                            <p className="text-xs text-subtle dark:text-gray-400">Receipt for your payment.</p>
                                        </div>
                                        <Button size="sm" className="!text-white" disabled={!formData.receipt_url} onClick={() => formData.receipt_url && window.open(formData.receipt_url, '_blank')}>
                                            Download
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </>
                )}
            </Card>
            <LoginDetailsCard
                loginId={formData.loginId}
                password={formData.password || '••••••••'}
                userId={userId}
                onPasswordUpdate={handlePasswordUpdate}
            />
        </>
    );
};
