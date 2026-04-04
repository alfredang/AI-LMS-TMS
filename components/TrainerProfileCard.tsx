import React, { useState, useEffect, useCallback } from 'react';
import { TrainerProfile, WorkExperienceItem, Certification, TrainerType, Gender, SKILLS_FUTURE_INDUSTRIES, TrainerQualification, TrainerEducation, Nationality, Ethnicity } from '@app-types/profile';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import Spinner from './ui/Spinner';
import { useLms } from '@contexts/LmsContext';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';
import { getApiUrl, getUploadUrl, getDeleteFileUrl, stripBaseUrl } from '@/lib/urlHelpers';
import { ThemeMode, getCurrentTheme, applyTheme } from '@utils/colorUtils';
import { maskNric, formatDate, formatDateForInput } from '../utils';

// Constants for styling consistency
const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

// Reusable Profile Bio Item Component
const ProfileBioItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <p className="text-sm text-subtle dark:text-gray-400">{label}</p>
        <p className="font-semibold text-on-surface break-words dark:text-gray-200">{value}</p>
    </div>
);

// Login Details Card Component
const LoginDetailsCard: React.FC<{
    loginId: string;
    password: string;
    userId?: string;
    onPasswordUpdate?: (newPassword: string) => void;
}> = ({ loginId, password, userId, onPasswordUpdate }) => {
    const { currentUser } = useLms();
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

            console.log('✅ Trainer password updated successfully with bcrypt hashing');
            alert('Password reset successfully!');
            setIsResetting(false);
            setNewPassword('');

            // Call the callback to update the parent component
            if (onPasswordUpdate) {
                onPasswordUpdate(newPassword);
            }

        } catch (error) {
            console.error('❌ Failed to reset trainer password:', error);
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
                        <p className="text-sm text-subtle">Login ID</p>
                        <p className="font-semibold text-on-surface break-words">{loginId}</p>
                    </div>
                    <div>
                        <p className="text-sm text-subtle">Password</p>
                        <div className="flex items-end gap-2">
                            <div className="flex items-center gap-2 flex-grow">
                                {isResetting ? (
                                    <>
                                        <input
                                            type={isPasswordVisible ? "text" : "password"}
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            className={`${inputClasses} tracking-wider`}
                                            placeholder="Enter new password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                                            className="text-subtle hover:text-primary p-1 rounded-full"
                                        >
                                            <Icon
                                                name={isPasswordVisible ? IconName.EyeOff : IconName.Eye}
                                                className="w-5 h-5"
                                            />
                                        </button>
                                    </>
                                ) : (
                                    <p className="font-semibold text-on-surface tracking-wider">••••••••••••••••</p>
                                )}
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

// Work Experience Section Component
const WorkExperienceSection: React.FC<{
    experience: WorkExperienceItem[];
    isEditing: boolean;
    onUpdate: (newExp: WorkExperienceItem[]) => void
}> = ({ experience, isEditing, onUpdate }) => {

    // Date validation function
    const validateDateFormat = (date: string): boolean => {
        if (!date || date === 'Present') return true;
        const dateRegex = /^\d{4}-\d{2}$/;
        if (!dateRegex.test(date)) return false;

        const [year, month] = date.split('-').map(Number);
        return year >= 1900 && year <= new Date().getFullYear() + 10 && month >= 1 && month <= 12;
    };

    const handleDateBlur = (index: number, field: 'startDate' | 'endDate', value: string) => {
        // Validate on blur (when user finishes typing)
        if (value !== '' && value !== 'Present') {
            if (!validateDateFormat(value)) {
                alert('Please enter date in YYYY-MM format (e.g., 2024-01)');
                // Focus back to the input if validation fails
                setTimeout(() => {
                    const input = document.querySelector(`input[data-field="${field}-${index}"]`) as HTMLInputElement;
                    if (input) input.focus();
                }, 100);
            }
        }
    };

    const handleDateChange = (index: number, field: 'startDate' | 'endDate', value: string) => {
        // Allow user to type freely, no immediate validation
        const updated = [...experience];
        updated[index] = { ...updated[index], [field]: value };
        onUpdate(updated);
    };

    const togglePresent = (index: number) => {
        const updated = [...experience];
        const currentEndDate = updated[index].endDate;
        // Toggle between Present and empty string (not null)
        if (currentEndDate === 'Present') {
            updated[index] = { ...updated[index], endDate: '' };
        } else {
            updated[index] = { ...updated[index], endDate: 'Present' };
        }
        onUpdate(updated);
    };

    if (isEditing) {
        return (
            <div className="space-y-4">
                {experience.map((item, index) => {
                    // Only consider it "Present" if explicitly set to 'Present'
                    const isPresent = item.endDate === 'Present';

                    return (
                        <div key={item.id || index} className="p-4 border rounded-md relative group dark:border-gray-700">
                            <div className="grid grid-cols-2 gap-4">
                                <input
                                    type="text"
                                    placeholder="Job Title"
                                    value={item.jobTitle}
                                    onChange={e => {
                                        const updated = [...experience];
                                        updated[index] = { ...item, jobTitle: e.target.value };
                                        onUpdate(updated);
                                    }}
                                    className={`${inputClasses} col-span-2`}
                                />
                                <input
                                    type="text"
                                    placeholder="Company"
                                    value={item.company}
                                    onChange={e => {
                                        const updated = [...experience];
                                        updated[index] = { ...item, company: e.target.value };
                                        onUpdate(updated);
                                    }}
                                    className={inputClasses}
                                />
                                <input
                                    type="text"
                                    placeholder="Start Date (YYYY-MM)"
                                    value={item.startDate}
                                    onChange={e => handleDateChange(index, 'startDate', e.target.value)}
                                    onBlur={e => handleDateBlur(index, 'startDate', e.target.value)}
                                    data-field={`startDate-${index}`}
                                    className={inputClasses}
                                />
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        placeholder="End Date (YYYY-MM)"
                                        value={isPresent ? '' : (item.endDate || '')}
                                        onChange={e => handleDateChange(index, 'endDate', e.target.value)}
                                        onBlur={e => handleDateBlur(index, 'endDate', e.target.value)}
                                        data-field={`endDate-${index}`}
                                        className={`${inputClasses} flex-1`}
                                        disabled={isPresent}
                                    />
                                    <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                                        <input
                                            type="checkbox"
                                            checked={isPresent}
                                            onChange={() => togglePresent(index)}
                                            className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                                        />
                                        Present
                                    </label>
                                </div>
                                <textarea
                                    placeholder="Description"
                                    value={item.description}
                                    onChange={e => {
                                        const updated = [...experience];
                                        updated[index] = { ...item, description: e.target.value };
                                        onUpdate(updated);
                                    }}
                                    className={`${inputClasses} col-span-2 h-20`}
                                ></textarea>
                            </div>
                            <button
                                onClick={() => {
                                    const updated = experience.filter((_, i) => i !== index);
                                    onUpdate(updated);
                                }}
                                className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Icon name={IconName.Delete} className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
                <Button variant="ghost" size="sm" onClick={() => onUpdate([...experience, {
                    id: `we_${Date.now()}`,
                    jobTitle: '',
                    company: '',
                    startDate: '',
                    endDate: '', // Default to empty (unticked)
                    description: ''
                }])}>
                    + Add Experience
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {experience.map((item, index) => {
                // Handle null/empty end dates from database as "Present"
                const displayEndDate = item.endDate === null || item.endDate === '' ? 'Present' : item.endDate;

                return (
                    <div key={item.id || index} className="p-4 border border-gray-200 rounded-md dark:border-gray-700">
                        <h4 className="font-bold">{item.jobTitle}</h4>
                        <p className="text-subtle">{item.company} | {item.startDate} - {displayEndDate}</p>
                        <p className="text-sm mt-1">{item.description}</p>
                    </div>
                );
            })}
            {experience.length === 0 && <p className="text-subtle">No work experience listed.</p>}
        </div>
    );
};

// Multi-Select Checkboxes Component
const MultiSelectCheckboxes: React.FC<{
    options: string[];
    selected: string[];
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isEditing: boolean;
    color: 'primary' | 'secondary'
}> = ({ options, selected, onChange, isEditing, color }) => {

    const colorClasses = {
        primary: { ring: 'focus:ring-primary', text: 'text-primary' },
        secondary: { ring: 'focus:ring-secondary', text: 'text-secondary' },
    }

    if (isEditing) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-h-60 overflow-y-auto p-4 border rounded-md dark:border-gray-700">
                {options.map(option => (
                    <div key={option} className="flex items-center">
                        <input
                            type="checkbox"
                            id={`option-${option}`}
                            value={option}
                            checked={selected.includes(option)}
                            onChange={onChange}
                            className={`h-4 w-4 ${colorClasses[color].text} ${colorClasses[color].ring} border-gray-300 rounded`}
                        />
                        <label htmlFor={`option-${option}`} className="ml-2 text-sm text-gray-900 dark:text-gray-200">{option}</label>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-2">
            {selected.map(item => (
                <span key={item} className={`text-sm font-medium px-3 py-1.5 rounded-full ${color === 'primary' ? 'bg-indigo-100 text-indigo-800' : 'bg-green-100 text-green-800'}`}>
                    {item}
                </span>
            ))}
            {selected.length === 0 && <p className="text-subtle text-sm">Not specified.</p>}
        </div>
    )
}

// Single-Select Component for Education
const SingleSelectEducation: React.FC<{
    options: string[];
    selected: string;
    onChange: (value: string) => void;
    isEditing: boolean;
}> = ({ options, selected, onChange, isEditing }) => {

    if (isEditing) {
        return (
            <select
                value={selected || ''}
                onChange={(e) => onChange(e.target.value)}
                className={inputClasses}
            >
                <option value="">Select highest education</option>
                {options.map(option => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        );
    }

    return (
        <div>
            {selected ? (
                <span className="text-sm font-medium px-3 py-1.5 rounded-full bg-green-100 text-green-800">
                    {selected}
                </span>
            ) : (
                <p className="text-subtle text-sm">Not specified.</p>
            )}
        </div>
    )
}

// Document Section Component
const DocumentSection: React.FC<{
    title: string;
    cvUrl?: string;
    cvOriginalFilename?: string;
    cvFolderUrl?: string;
    certifications?: Certification[];
    isEditing: boolean;
    onUpdateCvFolderUrl?: (url: string) => void;
}> = ({ title, cvUrl, cvOriginalFilename, cvFolderUrl, certifications, isEditing, onUpdateCvFolderUrl }) => {

    if (isEditing) {
        return (
            <section>
                <h2 className="text-xl font-bold mb-4">{title}</h2>
                <div className="space-y-4">
                    {/* CV Folder URL */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">CV & Documents Folder</label>
                        <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md border dark:bg-gray-700 dark:border-gray-600">
                            <Icon name={IconName.Folder} className="w-5 h-5 text-blue-500" />
                            <input
                                type="url"
                                placeholder="Paste Google Drive folder URL"
                                value={cvFolderUrl || ''}
                                onChange={(e) => onUpdateCvFolderUrl?.(e.target.value)}
                                className={`${inputClasses} !py-1.5 !text-sm flex-1`}
                            />
                            {cvFolderUrl && (
                                <a href={cvFolderUrl} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors whitespace-nowrap">
                                    <Icon name={IconName.ExternalLink} className="w-3 h-3" /> Open
                                </a>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">Upload your CV and certifications to this Google Drive folder.</p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section>
            <h2 className="text-xl font-bold mb-4">{title}</h2>
            <div className="space-y-4">
                {cvFolderUrl && (
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md border dark:bg-gray-700/50 dark:border-gray-600">
                        <div className="flex items-center gap-3">
                            <Icon name={IconName.Folder} className="w-6 h-6 text-blue-500 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-200">CV & Documents Folder</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Google Drive</p>
                            </div>
                        </div>
                        <a
                            href={cvFolderUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                        >
                            <Icon name={IconName.ExternalLink} className="w-3 h-3" />
                            Open Folder
                        </a>
                    </div>
                )}
                {cvUrl && (
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md border dark:bg-gray-700/50 dark:border-gray-600">
                        <div className="flex items-center gap-3">
                            <Icon name={IconName.FilePdf} className="w-6 h-6 text-red-600 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-200">Curriculum Vitae</p>
                            </div>
                        </div>
                        <a
                            href={getApiUrl(`/api/download${stripBaseUrl(cvUrl) || cvUrl || ''}`)}
                            download={cvOriginalFilename || 'CV.pdf'}
                            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                        >
                            <Icon name={IconName.Download} className="w-3 h-3" />
                            Download
                        </a>
                    </div>
                )}
                {(certifications && certifications.length > 0) && (
                    <div className="space-y-2">
                        {certifications.map(cert => (
                            <div key={cert.id || cert.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-md border dark:bg-gray-700/50 dark:border-gray-600">
                                <div className="flex items-center gap-3">
                                    <Icon name={IconName.FilePdf} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-200">{cert.name}</p>
                                    </div>
                                </div>
                                <a
                                    href={getApiUrl(`/api/download${stripBaseUrl(cert.fileUrl) || cert.fileUrl || ''}`)}
                                    download={cert.originalFilename || cert.name}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                                >
                                    <Icon name={IconName.Download} className="w-3 h-3" />
                                    Download
                                </a>
                            </div>
                        ))}
                    </div>
                )}
                {!cvFolderUrl && !cvUrl && (!certifications || certifications.length === 0) && <p className="text-subtle text-sm">No documents uploaded.</p>}
            </div>
        </section>
    );
};

// Main Trainer Profile Card Component
export const TrainerProfileCard: React.FC<{
    profile: TrainerProfile;
    onUpdate: (updatedData?: Partial<TrainerProfile>) => void;
    userId?: string;
    onProfileUpdate?: () => void;
}> = ({ profile, onUpdate, userId, onProfileUpdate }) => {
    const { currentUser } = useLms();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState(profile);
    const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
    // Pending changes state - only applied when Save is clicked
    const [pendingCvFile, setPendingCvFile] = useState<File | null>(null);
    const [pendingCertificationsToAdd, setPendingCertificationsToAdd] = useState<Array<{ name: string, file: File, tempId: string }>>([]);
    const [pendingCertificationsToDelete, setPendingCertificationsToDelete] = useState<string[]>([]);
    const [certificationFilesToDelete, setCertificationFilesToDelete] = useState<Array<{ id: string, fileUrl: string, name: string }>>([]);
    const [selectedProfilePictureFile, setSelectedProfilePictureFile] = useState<File | null>(null);
    const [profilePicturePreviewUrl, setProfilePicturePreviewUrl] = useState<string | null>(null);
    const [uploadedProfilePicturePath, setUploadedProfilePicturePath] = useState<string | null>(null);
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => getCurrentTheme());

    useEffect(() => {
        setFormData(profile);
    }, [profile]);

    // Handle password update from LoginDetailsCard
    const handlePasswordUpdate = (newPassword: string) => {
        setFormData(prev => ({ ...prev, password: newPassword }));
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleMultiSelectChange = (field: 'areasOfExpertise' | 'qualifications') => (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = e.target;
        setFormData(prev => {
            const currentValues = prev[field] || [];
            if (checked) {
                return { ...prev, [field]: [...currentValues, value].filter((v, i, arr) => arr.indexOf(v) === i) };
            } else {
                return { ...prev, [field]: currentValues.filter(item => item !== value) };
            }
        });
    };

    const handleEducationChange = (value: string) => {
        setFormData(prev => ({ ...prev, education: value }));
    };

    const handleThemeToggle = () => {
        const newTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
        setThemeMode(newTheme);
        applyTheme(newTheme);
        console.log(`🌓 Theme toggled to: ${newTheme}`);
    };

    const handleWorkExperienceUpdate = (newExp: WorkExperienceItem[]) => {
        setFormData(prev => ({ ...prev, workExperience: newExp }));
    }

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

            // Create preview URL for immediate display only - don't update formData
            const reader = new FileReader();
            reader.onloadend = () => {
                const previewUrl = reader.result as string;
                setProfilePicturePreviewUrl(previewUrl);
                // DON'T update formData.profilePictureUrl with the preview - only with actual uploaded path
            };
            reader.readAsDataURL(file);
        }
    };

    // const handleGenerateAvatar = async () => {
    //     if (!formData) return;
    //     setIsGeneratingAvatar(true);
    //     try {
    //         const newAvatarUrl = await generateAvatarImage(formData.name);
    //         if (newAvatarUrl) {
    //             setFormData(prev => ({ ...prev, profilePictureUrl: newAvatarUrl }));
    //         } else {
    //             alert("Failed to generate avatar. Please try again.");
    //         }
    //     } catch (error) {
    //         console.error("Avatar generation failed:", error);
    //         alert("An error occurred while generating the avatar.");
    //     } finally {
    //         setIsGeneratingAvatar(false);
    //     }
    // };

    const handleGenerateAvatar = async () => {
        setIsGeneratingAvatar(true);
        try {
            // Delete old profile picture if it exists and is a file
            const oldFileUrl = formData.profilePictureUrl;
            if (oldFileUrl && oldFileUrl.includes('uploads/')) {
                try {
                    // Extract just the path part (remove base URL)
                    const filePath = stripBaseUrl(oldFileUrl) || oldFileUrl;
                    await fetch(getDeleteFileUrl(filePath), {
                        method: 'DELETE'
                    });
                    console.log('✅ Old profile picture deleted');
                } catch (error) {
                    console.warn('⚠️ Failed to delete old profile picture:', error);
                }
            }

            // Use the same approach as learner profile - simple and reliable
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

    const handleCvUpdate = async (file: File) => {
        // Just store the file locally - upload will happen on save
        setPendingCvFile(file);

        // Update the display immediately to show the new filename
        setFormData(prev => ({
            ...prev,
            cvOriginalFilename: file.name
        }));

        console.log('📁 CV file selected for upload on save:', file.name);
    };

    const handleAddCertification = (name: string, file: File) => {
        // Create a temporary ID for the new certification
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Add to pending certifications to add
        setPendingCertificationsToAdd(prev => [...prev, { name, file, tempId }]);

        // Update the UI immediately to show the new certification
        const tempCert = {
            id: tempId,
            name: name,
            fileUrl: '', // Will be set after upload
            originalFilename: file.name
        };

        setFormData(prev => ({
            ...prev,
            certifications: [...(prev.certifications || []), tempCert]
        }));

        console.log('📁 Certification queued for upload on save:', name, file.name);
    };

    const handleRemoveCertification = (id: string) => {
        // If it's a temporary cert (pending addition), remove from pending and UI
        if (id.startsWith('temp_')) {
            setPendingCertificationsToAdd(prev => prev.filter(cert => cert.tempId !== id));
            setFormData(prev => ({
                ...prev,
                certifications: (prev.certifications || []).filter(c => c.id !== id)
            }));
            console.log('🗑️ Temporary certification removed from pending list:', id);
            return;
        }

        // For existing certifications, capture file info BEFORE removing from UI
        const certToDelete = formData.certifications?.find(cert => cert.id === id);
        if (certToDelete?.fileUrl) {
            setCertificationFilesToDelete(prev => [...prev, {
                id: id,
                fileUrl: certToDelete.fileUrl,
                name: certToDelete.name
            }]);
            console.log('📁 Captured certification file for deletion:', certToDelete.name, certToDelete.fileUrl);
        }

        // Add to pending deletion list
        setPendingCertificationsToDelete(prev => [...prev, id]);

        // Remove from UI immediately
        setFormData(prev => ({
            ...prev,
            certifications: (prev.certifications || []).filter(c => c.id !== id)
        }));

        console.log('🗑️ Certification marked for deletion on save:', id);
    };

    // Handle canceling edit mode - revert all pending changes
    const handleCancel = () => {
        // Reset form data to original profile
        setFormData(profile);

        // Clear all pending changes
        setPendingCvFile(null);
        setPendingCertificationsToAdd([]);
        setPendingCertificationsToDelete([]);
        setCertificationFilesToDelete([]);
        setSelectedProfilePictureFile(null);
        setProfilePicturePreviewUrl(null);
        setUploadedProfilePicturePath(null);

        // Exit edit mode
        setIsEditing(false);

        console.log('✅ All pending changes reverted');
    };

    const handleSave = async () => {
        try {
            console.log('💾 Saving trainer profile with all pending changes:', formData);

            const CURRENT_USER_ID = currentUser?.id;

            if (!CURRENT_USER_ID) {
                console.error('❌ No authenticated user found');
                alert('Error: No authenticated user found. Please log in again.');
                return;
            }

            // Step 1: Handle CV upload if pending
            let newCvUrl = formData.cvUrl;
            let newCvOriginalFilename = formData.cvOriginalFilename;

            if (pendingCvFile) {
                try {
                    console.log('📁 Uploading pending CV file:', pendingCvFile.name);

                    // Delete old CV file first if it exists
                    const oldFileUrl = profile.cvUrl;
                    if (oldFileUrl && (oldFileUrl.includes('uploads/') || oldFileUrl.startsWith('/uploads/'))) {
                        try {
                            console.log('🗑️ Deleting old CV file:', oldFileUrl);
                            const filePath = oldFileUrl.startsWith('http')
                                ? stripBaseUrl(oldFileUrl) || oldFileUrl
                                : oldFileUrl;

                            await fetch(getDeleteFileUrl(filePath), {
                                method: 'DELETE'
                            });
                            console.log('✅ Old CV file deleted successfully');
                        } catch (error) {
                            console.warn('⚠️ Failed to delete old CV file:', error);
                        }
                    }

                    const uploadFormData = new FormData();
                    uploadFormData.append('file', pendingCvFile);

                    const response = await fetch(getUploadUrl('trainer', 'cv'), {
                        method: 'POST',
                        body: uploadFormData
                    });

                    if (!response.ok) {
                        throw new Error(`CV upload failed: ${response.status}`);
                    }

                    const result = await response.json();
                    if (!result.success) {
                        throw new Error(result.error || 'CV upload failed');
                    }

                    console.log('✅ CV uploaded successfully:', result.data);
                    console.log('📁 Uploaded CV file URL:', result.data.fileUrl);
                    console.log('📁 Uploaded CV original filename:', result.data.originalFilename);

                    // Store the new CV info in local variables to ensure consistency
                    newCvUrl = result.data.fileUrl;
                    newCvOriginalFilename = result.data.originalFilename;

                    console.log('📝 Storing CV info in local variables:', {
                        newCvUrl,
                        newCvOriginalFilename
                    });

                    // Update formData with new CV info
                    setFormData(prev => ({
                        ...prev,
                        cvUrl: newCvUrl,
                        cvOriginalFilename: newCvOriginalFilename
                    }));

                } catch (error) {
                    console.error('❌ Failed to upload CV:', error);
                    alert(`Failed to upload CV: ${error instanceof Error ? error.message : 'Please try again.'}`);
                    return;
                }
            }

            // Step 2: Handle certification uploads if pending
            const uploadedCertifications = [];
            for (const pendingCert of pendingCertificationsToAdd) {
                try {
                    console.log('� Uploading pending certification:', pendingCert.name);

                    const uploadFormData = new FormData();
                    uploadFormData.append('file', pendingCert.file);

                    const response = await fetch(getUploadUrl('trainer', 'certification'), {
                        method: 'POST',
                        body: uploadFormData
                    });

                    if (!response.ok) {
                        throw new Error(`Certification upload failed: ${response.status}`);
                    }

                    const result = await response.json();
                    if (!result.success) {
                        throw new Error(result.error || 'Certification upload failed');
                    }

                    console.log('✅ Certification uploaded successfully:', result.data);

                    uploadedCertifications.push({
                        name: pendingCert.name,
                        fileUrl: result.data.fileUrl,
                        originalFilename: result.data.originalFilename
                    });

                } catch (error) {
                    console.error('❌ Failed to upload certification:', error);
                    alert(`Failed to upload certification "${pendingCert.name}": ${error instanceof Error ? error.message : 'Please try again.'}`);
                    return;
                }
            }

            // Step 3: Handle profile picture upload if pending
            let currentUploadedPath: string | null = null;
            if (selectedProfilePictureFile) {
                try {
                    console.log('� Uploading profile picture:', selectedProfilePictureFile.name);

                    // Delete old profile picture if it exists and is a local file
                    const oldFileUrl = profile.profilePictureUrl;
                    if (oldFileUrl && (oldFileUrl.startsWith('/uploads/') || oldFileUrl.includes('uploads/'))) {
                        try {
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

                    const response = await fetch(getUploadUrl('trainer', 'profilePicture'), {
                        method: 'POST',
                        body: uploadFormData
                    });

                    if (!response.ok) {
                        throw new Error(`Profile picture upload failed: ${response.statusText}`);
                    }

                    const result = await response.json();
                    if (!result.success) {
                        throw new Error(result.error || 'Profile picture upload failed');
                    }

                    console.log('✅ Profile picture uploaded successfully:', result.data);

                    currentUploadedPath = result.data.fileUrl.startsWith('http')
                        ? stripBaseUrl(result.data.fileUrl) || result.data.fileUrl
                        : result.data.fileUrl;

                    console.log('📝 Profile picture path for database:', currentUploadedPath);

                } catch (error) {
                    console.error('❌ Failed to upload profile picture:', error);
                    alert(`Failed to upload profile picture: ${error instanceof Error ? error.message : 'Please try again.'}`);
                    return;
                }
            }

            // Step 4: Prepare all changes for database update
            const changedFields: any = {};

            // Basic profile fields
            if (formData.name !== profile.name) changedFields.name = formData.name;
            if (formData.email !== profile.email) changedFields.email = formData.email;
            if (formData.secondaryEmail !== profile.secondaryEmail) changedFields.secondaryEmail = formData.secondaryEmail;
            if (formData.tel !== profile.tel) changedFields.tel = formData.tel;
            if (formData.gender !== profile.gender) changedFields.gender = formData.gender;
            if (formData.trainerType !== profile.trainerType) changedFields.trainerType = formData.trainerType;
            if (formData.linkedinUrl !== profile.linkedinUrl) changedFields.linkedinUrl = formData.linkedinUrl;
            if ((formData as any).ethnicity !== (profile as any).ethnicity) changedFields.ethnicity = (formData as any).ethnicity;
            if ((formData as any).nationality !== (profile as any).nationality) changedFields.nationality = (formData as any).nationality;
            if (formData.nric !== profile.nric) changedFields.nric = formData.nric;
            if ((formData as any).dob !== (profile as any).dob) changedFields.dob = (formData as any).dob;
            if (JSON.stringify(formData.areasOfExpertise) !== JSON.stringify(profile.areasOfExpertise)) changedFields.areasOfExpertise = formData.areasOfExpertise;
            if (JSON.stringify(formData.workExperience) !== JSON.stringify(profile.workExperience)) changedFields.workExperience = formData.workExperience;
            if (JSON.stringify(formData.qualifications) !== JSON.stringify(profile.qualifications)) changedFields.qualifications = formData.qualifications;
            if (formData.education !== profile.education) changedFields.education = formData.education;

            // CV changes - use the local variables to ensure we have the most up-to-date values
            if (pendingCvFile) {
                changedFields.cvUrl = newCvUrl;
                changedFields.cvOriginalFilename = newCvOriginalFilename;
                console.log('📝 CV changes detected - using uploaded file info:', {
                    cvUrl: newCvUrl,
                    cvOriginalFilename: newCvOriginalFilename
                });
            }

            // CV folder URL changes
            if ((formData as any).cvFolderUrl !== (profile as any).cvFolderUrl) {
                changedFields.cvFolderUrl = (formData as any).cvFolderUrl;
            }

            // Profile picture changes
            if (currentUploadedPath) {
                changedFields.profilePictureUrl = currentUploadedPath;
            } else if (uploadedProfilePicturePath) {
                changedFields.profilePictureUrl = uploadedProfilePicturePath;
            } else if (formData.profilePictureUrl &&
                formData.profilePictureUrl !== profile.profilePictureUrl &&
                !formData.profilePictureUrl.startsWith('data:')) {
                changedFields.profilePictureUrl = formData.profilePictureUrl;
            }

            // Certification changes
            if (uploadedCertifications.length > 0) {
                changedFields.newCertifications = uploadedCertifications;
            }
            if (pendingCertificationsToDelete.length > 0) {
                changedFields.certificationsToDelete = pendingCertificationsToDelete;
            }

            // Step 5: Collect file URLs for certifications that will be deleted (before database update)
            // Use the pre-captured file URLs from when certifications were marked for deletion
            console.log('📁 Certification files to delete:', certificationFilesToDelete);

            // Step 6: Update database with all changes
            // Step 6: Update database with all changes
            if (Object.keys(changedFields).length > 0) {
                console.log('📝 Updating database with all changes:', changedFields);

                const updateData = {
                    userId: CURRENT_USER_ID,
                    profileData: changedFields
                };

                const response = await fetch(getApiUrl('/api/profile/update-trainer'), {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updateData)
                });

                if (!response.ok) {
                    throw new Error(`Database update failed: ${response.status}`);
                }

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.message || 'Database update failed');
                }

                console.log('✅ All changes saved to database successfully');
                console.log('🔍 Server response secondaryEmail:', result.data?.profile?.secondaryEmail);

                // Update display from server response (reflects actual DB state)
                if (result.data?.profile) {
                    Object.assign(profile, result.data.profile);
                    setFormData(result.data.profile);
                }
            } else {
                console.log('📝 No changes detected, skipping database update');
            }

            // Step 7: Delete old certification files that were marked for deletion
            for (const certFile of certificationFilesToDelete) {
                try {
                    console.log('🗑️ Deleting certification file:', certFile.name, certFile.fileUrl);
                    const filePath = certFile.fileUrl.startsWith('http')
                        ? stripBaseUrl(certFile.fileUrl) || certFile.fileUrl
                        : certFile.fileUrl;

                    const deleteResponse = await fetch(getDeleteFileUrl(filePath), {
                        method: 'DELETE'
                    });

                    if (deleteResponse.ok) {
                        console.log('✅ Certification file deleted successfully:', certFile.name);
                    } else {
                        console.warn('⚠️ Failed to delete certification file:', certFile.name, deleteResponse.status);
                    }
                } catch (error) {
                    console.warn('⚠️ Failed to delete certification file:', certFile.name, error);
                }
            }

            // Step 8: Clean up pending changes and update final state
            setPendingCvFile(null);
            setPendingCertificationsToAdd([]);
            setPendingCertificationsToDelete([]);
            setCertificationFilesToDelete([]);
            setSelectedProfilePictureFile(null);
            setProfilePicturePreviewUrl(null);
            setUploadedProfilePicturePath(null);

            // Update formData with the actual saved profile picture path so view mode shows correct picture
            const savedProfilePicturePath = currentUploadedPath || uploadedProfilePicturePath;
            if (savedProfilePicturePath) {
                setFormData(prev => ({ ...prev, profilePictureUrl: savedProfilePicturePath }));
            }

            setIsEditing(false);
            alert('Profile saved successfully!');

            // Call callbacks to refresh parent components
            const updatedFormData = savedProfilePicturePath
                ? { ...formData, profilePictureUrl: savedProfilePicturePath }
                : formData;
            onUpdate(updatedFormData);
            if (onProfileUpdate) {
                onProfileUpdate();
            }

        } catch (error) {
            console.error('❌ Failed to save trainer profile:', error);
            alert(`Failed to save profile: ${error instanceof Error ? error.message : 'Please try again.'}`);
        }
    };

    return (
        <>
            <Card className="p-8">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="flex-shrink-0 text-center">
                        <div className="relative group w-24 h-24">
                            <img src={profilePicturePreviewUrl || ensureAbsoluteImageUrl(formData.profilePictureUrl) || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K'} alt={formData.name} className="w-24 h-24 rounded-full object-cover ring-4 ring-secondary/20" onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K'; }} />
                            {isGeneratingAvatar && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                                    <Spinner size="sm" />
                                </div>
                            )}
                            {isEditing && !isGeneratingAvatar && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <label htmlFor="photo-upload" className="cursor-pointer">
                                        <Icon name={IconName.Upload} className="w-6 h-6 text-white" />
                                    </label>
                                </div>
                            )}
                        </div>
                        {isEditing && (
                            <div className="mt-2">
                                <input type="file" id="photo-upload" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                            </div>
                        )}
                    </div>
                    <div className="text-center sm:text-left flex-grow">
                        <h1 className="text-2xl font-bold text-on-surface">{formData.name}</h1>
                        <p className="text-subtle">Trainer Profile</p>
                    </div>
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
                            <Button variant="primary" onClick={handleSave}>Save Changes</Button>
                        </div>
                    ) : (
                        <Button variant="primary" onClick={() => setIsEditing(true)}>Edit Profile</Button>
                    )}
                </div>
                <div className="border-t my-6"></div>

                <div className="space-y-6">
                    <section>
                        <h2 className="text-xl font-bold mb-4">Bio Data</h2>
                        {isEditing ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                                <div><label className="text-sm font-medium">Name</label><input type="text" name="name" value={formData.name} onChange={handleChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Phone</label><input type="tel" name="tel" value={formData.tel || ''} onChange={handleChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Email</label><input type="email" name="email" value={formData.email} onChange={handleChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Secondary Email</label><input type="email" name="secondaryEmail" value={formData.secondaryEmail ?? ''} onChange={handleChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Gender</label><select name="gender" value={formData.gender || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Gender).map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                                <div><label className="text-sm font-medium">Race</label><select name="ethnicity" value={(formData as any).ethnicity || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Ethnicity).map(e => <option key={e} value={e}>{e}</option>)}</select></div>
                                <div><label className="text-sm font-medium">Nationality</label><select name="nationality" value={(formData as any).nationality || ''} onChange={handleChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Nationality).map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                                <div><label className="text-sm font-medium">NRIC</label><input type="text" name="nric" value={formData.nric || ''} onChange={handleChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Date of Birth</label><input type="date" name="dob" value={formatDateForInput((formData as any).dob || '')} onChange={handleChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Trainer Type</label><select name="trainerType" value={formData.trainerType} onChange={handleChange} className={inputClasses}>{Object.values(TrainerType).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                <div><label className="text-sm font-medium">LinkedIn Profile</label><input type="url" name="linkedinUrl" value={formData.linkedinUrl || ''} onChange={handleChange} className={inputClasses} /></div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                                <ProfileBioItem label="Name" value={formData.name} />
                                <ProfileBioItem label="Phone" value={formData.tel} />
                                <ProfileBioItem label="Email" value={formData.email} />
                                <ProfileBioItem label="Secondary Email" value={formData.secondaryEmail || '—'} />
                                <ProfileBioItem label="Gender" value={formData.gender || '—'} />
                                <ProfileBioItem label="Race" value={(formData as any).ethnicity || '—'} />
                                <ProfileBioItem label="Nationality" value={(formData as any).nationality || '—'} />
                                <ProfileBioItem label="NRIC" value={formData.nric ? maskNric(formData.nric) : '—'} />
                                <ProfileBioItem label="Date of Birth" value={(formData as any).dob ? formatDate((formData as any).dob) : '—'} />
                                <ProfileBioItem label="Trainer Type" value={formData.trainerType || '—'} />
                                {formData.linkedinUrl && (
                                    <ProfileBioItem
                                        label="LinkedIn Profile"
                                        value={
                                            <a href={formData.linkedinUrl.startsWith('http') ? formData.linkedinUrl : `https://${formData.linkedinUrl}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1.5">
                                                <Icon name={IconName.Linkedin} className="w-4 h-4" />
                                                View Profile
                                            </a>
                                        }
                                    />
                                )}
                            </div>
                        )}
                    </section>

                    <DocumentSection
                        title="CV & Certifications"
                        cvUrl={formData.cvUrl}
                        cvOriginalFilename={formData.cvOriginalFilename}
                        cvFolderUrl={(formData as any).cvFolderUrl}
                        certifications={formData.certifications}
                        isEditing={isEditing}
                        onUpdateCvFolderUrl={(url) => setFormData(prev => ({ ...prev, cvFolderUrl: url } as any))}
                    />

                    <section>
                        <h2 className="text-xl font-bold mb-4">Qualifications</h2>
                        <MultiSelectCheckboxes
                            options={Object.values(TrainerQualification)}
                            selected={formData.qualifications || []}
                            onChange={handleMultiSelectChange('qualifications')}
                            isEditing={isEditing}
                            color="secondary"
                        />
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4">Highest Education</h2>
                        <SingleSelectEducation
                            options={Object.values(TrainerEducation)}
                            selected={formData.education || ''}
                            onChange={handleEducationChange}
                            isEditing={isEditing}
                        />
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4">Area of Expertise</h2>
                        <MultiSelectCheckboxes
                            options={SKILLS_FUTURE_INDUSTRIES}
                            selected={formData.areasOfExpertise || []}
                            onChange={handleMultiSelectChange('areasOfExpertise')}
                            isEditing={isEditing}
                            color="secondary"
                        />
                    </section>
                </div>

            </Card>
            <LoginDetailsCard
                loginId={formData.loginId || formData.email}
                password={formData.password || '••••••••'}
                userId={userId}
                onPasswordUpdate={handlePasswordUpdate}
            />
            {!isEditing && (
                <Card className="p-8 mt-8">
                    <h2 className="text-xl font-bold mb-4 dark:text-white">Appearance</h2>
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
                                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${themeMode === 'dark' ? 'bg-blue-600' : 'bg-gray-300'}`}
                            >
                                <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${themeMode === 'dark' ? 'translate-x-8' : 'translate-x-1'}`}
                                />
                            </button>
                        </div>
                    </div>
                </Card>
            )}
        </>
    );
};