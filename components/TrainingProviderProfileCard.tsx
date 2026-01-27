import React, { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { Spinner } from './ui';
import { TrainingProviderProfile } from '@app-types/profile';
import { generateCompanyLogo } from '@lib/services/geminiService';
import { useLms } from '@contexts/LmsContext';
import { applyPrimaryColor, useColorScheme, ThemeMode, getCurrentTheme, applyTheme } from '@utils/colorUtils';
import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';

// Constants for styling consistency
const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

// Fixed API Key names - these are the only allowed API key names
const FIXED_API_KEY_NAMES = [
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'GROK_API_KEY',
    'DEEPSEEK_API_KEY',
] as const;

// Helper function to clean filename for display
const getCleanDisplayName = (filename: string): string => {
    if (!filename) return '';
    
    // Remove timestamp prefix (pattern: numbers_)
    const withoutTimestamp = filename.replace(/^\d+_/, '');
    
    // Fix double extensions (e.g., "test.txt.txt" -> "test.txt")
    const extension = withoutTimestamp.includes('.') ? '.' + withoutTimestamp.split('.').pop() : '';
    const nameWithoutExt = withoutTimestamp.replace(new RegExp(`\\${extension}$`), '');
    
    // Check if name ends with the same extension again
    if (extension && nameWithoutExt.toLowerCase().endsWith(extension.toLowerCase())) {
        const correctedName = nameWithoutExt.slice(0, -extension.length);
        return correctedName + extension;
    }
    
    return withoutTimestamp;
};

// Reusable Profile Bio Item Component
const ProfileBioItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <p className="text-sm text-subtle">{label}</p>
        <p className="font-semibold text-on-surface break-words">{value}</p>
    </div>
);

// Toggle Component for Settings
const ToggleSwitch: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    isEditing: boolean;
}> = ({ checked, onChange, label, isEditing }) => {
    if (!isEditing) {
        return (
            <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                <span className="text-sm text-on-surface">{label}</span>
                <span className={`text-sm font-medium ${checked ? 'text-green-500' : 'text-gray-400'}`}>
                    {checked ? 'Enabled' : 'Disabled'}
                </span>
            </div>
        );
    }

    return (
        <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
            <label className="text-sm text-on-surface flex-grow cursor-pointer" onClick={() => onChange(!checked)}>
                {label}
            </label>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        checked ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
};

// Login Details Card Component
const LoginDetailsCard: React.FC<{ 
    loginId: string; 
    password?: string; 
    userId?: string;
    onPasswordUpdate?: (newPassword: string) => void;
}> = ({ loginId, password, userId, onPasswordUpdate }) => {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const displayPassword = password || "No password available";

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
            
            if (!userId) {
                throw new Error('No user ID found');
            }

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
            
            console.log('✅ Training Provider password updated successfully with bcrypt hashing');
            alert('Password reset successfully!');
            setIsResetting(false);
            setNewPassword('');
            
            // Call the callback to update the parent component
            if (onPasswordUpdate) {
                onPasswordUpdate(newPassword);
            }
            
        } catch (error) {
            console.error('❌ Failed to reset training provider password:', error);
            alert(`Failed to reset password: ${error instanceof Error ? error.message : 'Please try again.'}`);
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <Card className="p-8 mt-8">
            <h2 className="text-xl font-bold mb-4">Login Details</h2>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 flex-grow">
                    <div>
                        <p className="text-sm text-subtle">User ID</p>
                        <p className="font-semibold text-on-surface">{loginId}</p>
                    </div>
                    <div>
                        <p className="text-sm text-subtle">Password</p>
                        <div className="flex items-end gap-2">
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
                                    <p className="font-semibold text-on-surface tracking-wider">
                                        {isPasswordVisible ? displayPassword : "••••••••••••••••"}
                                    </p>
                                )}
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
                                    className="border border-primary text-primary hover:bg-primary hover:text-white flex-shrink-0"
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

interface TrainingProviderProfileCardProps {
    profile: TrainingProviderProfile;
    onUpdate: (userId: string, updatedData: Partial<TrainingProviderProfile>) => Promise<void>;
}

export const TrainingProviderProfileCard: React.FC<TrainingProviderProfileCardProps> = ({ profile, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    
    // Transform initial profile data to ensure colorScheme is a string
    const getInitialFormData = (profile: TrainingProviderProfile) => {
        const transformedProfile = { ...profile };
        
        // Handle colorScheme transformation from object to string
        if (profile.colorScheme && typeof profile.colorScheme === 'object' && 'primary' in profile.colorScheme) {
            transformedProfile.colorScheme = (profile.colorScheme as any).primary;
        }
        
        return transformedProfile;
    };
    
    const [formData, setFormData] = useState(getInitialFormData(profile));
    const [isSaving, setIsSaving] = useState(false);
    const [newApiKey, setNewApiKey] = useState({ name: '', value: '' });
    const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);
    const [visibleApiKeys, setVisibleApiKeys] = useState<{ [key: string]: boolean }>({});
    const [isEncryptionKeyVisible, setIsEncryptionKeyVisible] = useState(false);
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => getCurrentTheme());

    // Get the updateTrainingProviderProfile function from the LMS context
    const { updateTrainingProviderProfile, updateCurrentUserProfile } = useLms();
    
    // Helper function to ensure absolute URL for images
    const getImageUrl = (url: string | undefined) => {
        if (!url) return '/images/default-company-logo.png'; // fallback image
        if (url.startsWith('http') || url.startsWith('blob:')) return url; // already absolute or blob URL
        return getFileUrl(url); // add server URL
    };
    
    // File upload states
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [invoiceTemplateFile, setInvoiceTemplateFile] = useState<File | null>(null);
    const [receiptTemplateFile, setReceiptTemplateFile] = useState<File | null>(null);
    const [certificateTemplateFile, setCertificateTemplateFile] = useState<File | null>(null);
    const [proFormaTemplateFile, setProFormaTemplateFile] = useState<File | null>(null);
    const [ssgCertFile, setSsgCertFile] = useState<File | null>(null);
    const [ssgPrivateKeyFile, setSsgPrivateKeyFile] = useState<File | null>(null);

    const adminSettingLabels: { [key: string]: string } = {
        autoSendProFormaInvoice: "Auto Send Pro Forma Invoice Upon Course Confirmation",
        autoSendConfirmationEmail: "Auto Send Confirmation Email Upon Course Confirmation",
        autoSendInvoiceOnGrantSuccess: "Auto Send Invoice Upon Successful Grant Application",
        autoSendReceiptOnPayment: "Auto Send Receipt Upon Payment Received",
        autoSendCertificateOnCompletion: "Auto Send Certificate On Achievement Upon Class Completed",
        autoSendThankYouEmail: "Auto Send Thank You Email Upon Class Completed",
    };

    useEffect(() => {
        // Transform profile data to ensure colorScheme is a string
        setFormData(getInitialFormData(profile));
    }, [profile]);

    // Clean up blob URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            if (formData.companyLogoUrl && formData.companyLogoUrl.startsWith('blob:')) {
                URL.revokeObjectURL(formData.companyLogoUrl);
            }
        };
    }, [formData.companyLogoUrl]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            contactPerson: {
                ...prev.contactPerson,
                [name]: value
            }
        }));
    };

    const handleToggleChange = (section: 'adminSettings' | 'securitySettings' | 'integrations' | 'gamingSettings' | 'fundingSettings', key: string) => {
        setFormData(prev => {
            const currentSection = prev[section];
            return {
                ...prev,
                [section]: {
                    ...currentSection,
                    [key]: !(currentSection as any)[key]
                }
            };
        });
    };
    
    const handleFundingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            fundingSettings: {
                ...prev.fundingSettings,
                [name]: name === 'isGstRegistered' ? e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : value === 'true'
                      : name === 'normalFunding' ? (parseInt(value) as 50 | 70)
                      : name === 'enhancedFunding' ? parseInt(value)
                      : name === 'gstRate' ? parseFloat(value)
                      : value
            }
        }));
    };

    const handleAddApiKey = () => {
        if (newApiKey.name && newApiKey.value) {
            setFormData(prev => ({
                ...prev,
                apiKeys: {
                    ...(prev.apiKeys || {}),
                    [newApiKey.name]: newApiKey.value
                }
            }));
            setNewApiKey({ name: '', value: '' });
        }
    };

    const handleRemoveApiKey = (keyName: string) => {
        setFormData(prev => {
            const newApiKeys = { ...(prev.apiKeys || {}) };
            delete newApiKeys[keyName];
            return {
                ...prev,
                apiKeys: newApiKeys
            };
        });
    };
    
    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newColor = e.target.value;

        setFormData(prev => ({
            ...prev,
            colorScheme: newColor
        }));

        // Apply the color change immediately for real-time preview
        if (isEditing) {
            applyPrimaryColor(newColor);
            console.log(`🎨 Real-time color preview applied: ${newColor}`);
        }
    };

    const handleThemeToggle = () => {
        const newTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
        setThemeMode(newTheme);
        applyTheme(newTheme);
        console.log(`🌓 Theme toggled to: ${newTheme}`);
    };

    const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'invoiceTemplateUrl' | 'receiptTemplateUrl' | 'certificateTemplateUrl' | 'proFormaInvoiceTemplateUrl' | 'ssgCertFile' | 'ssgPrivateKeyFile') => {
        const file = e.target.files?.[0];
        if (file) {
            // Debug log to see what's happening with the filename and file details
            console.log(`🔍 handleTemplateUpload - Field: ${field}`);
            console.log(`🔍 File details:`, {
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified,
                webkitRelativePath: file.webkitRelativePath
            });
            
            // Check if file is empty
            if (file.size === 0) {
                alert(`⚠️ The selected file "${file.name}" is empty (0 bytes). Please select a file with content.`);
                e.target.value = ''; // Clear the input
                return;
            }
            
            // Store the file in the appropriate state variable
            switch (field) {
                case 'invoiceTemplateUrl':
                    setInvoiceTemplateFile(file);
                    break;
                case 'receiptTemplateUrl':
                    setReceiptTemplateFile(file);
                    break;
                case 'certificateTemplateUrl':
                    setCertificateTemplateFile(file);
                    break;
                case 'proFormaInvoiceTemplateUrl':
                    setProFormaTemplateFile(file);
                    break;
                case 'ssgCertFile':
                    setSsgCertFile(file);
                    break;
                case 'ssgPrivateKeyFile':
                    setSsgPrivateKeyFile(file);
                    break;
            }
            
            // Update the form data to show the cleaned filename for immediate display
            setFormData(prev => {
                const cleanedName = getCleanDisplayName(file.name);
                const newFormData = {
                    ...prev,
                    [field]: cleanedName  // Store cleaned filename for display
                };
                console.log(`🔍 Updated formData[${field}]: original "${file.name}" -> cleaned "${cleanedName}"`);
                return newFormData;
            });
        }
    };

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setLogoFile(file); // Store the file for upload
            
            // Create preview URL for immediate display
            const previewUrl = URL.createObjectURL(file);
            setFormData(prev => ({ ...prev, companyLogoUrl: previewUrl }));
        }
    };

    const handleGenerateLogo = async () => {
        setIsGeneratingLogo(true);
        try {
            const newLogoUrl = await generateCompanyLogo(formData.companyName);
            if (newLogoUrl) {
                setFormData(prev => ({ ...prev, companyLogoUrl: newLogoUrl }));
            } else {
                alert("Failed to generate logo. Please try again.");
            }
        } catch (error) {
            console.error("Logo generation failed:", error);
            alert("An error occurred while generating the logo.");
        } finally {
            setIsGeneratingLogo(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Create FormData for multipart upload
            const formDataToSend = new FormData();

            // Filter out empty API key values before sending
            const filteredApiKeys: Record<string, string> = {};
            if (formData.apiKeys) {
                for (const [key, value] of Object.entries(formData.apiKeys)) {
                    const strValue = typeof value === 'string' ? value.trim() : '';
                    if (strValue !== '') {
                        filteredApiKeys[key] = strValue;
                    }
                }
            }

            // Prepare profile data with filtered API keys
            const profileDataToSend = {
                ...formData,
                apiKeys: filteredApiKeys
            };

            console.log('📤 Sending profile data:', {
                userId: profile.id,
                apiKeysCount: Object.keys(filteredApiKeys).length,
                apiKeyNames: Object.keys(filteredApiKeys)
            });

            // Add user ID and profile data as JSON string
            formDataToSend.append('userId', profile.id);
            formDataToSend.append('profileData', JSON.stringify(profileDataToSend));
            
            // Add file uploads if they exist
            if (logoFile) {
                formDataToSend.append('companyLogo', logoFile);
            }
            if (invoiceTemplateFile) {
                formDataToSend.append('invoiceTemplate', invoiceTemplateFile);
            }
            if (receiptTemplateFile) {
                formDataToSend.append('receiptTemplate', receiptTemplateFile);
            }
            if (certificateTemplateFile) {
                formDataToSend.append('certificateTemplate', certificateTemplateFile);
            }
            if (proFormaTemplateFile) {
                formDataToSend.append('proFormaInvoiceTemplate', proFormaTemplateFile);
            }
            if (ssgCertFile) {
                formDataToSend.append('ssgCertFile', ssgCertFile);
            }
            if (ssgPrivateKeyFile) {
                formDataToSend.append('ssgPrivateKeyFile', ssgPrivateKeyFile);
            }

            // Call the training provider update API
            const response = await fetch(getApiUrl('/api/training-provider-update'), {
                method: 'PUT',
                body: formDataToSend,
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                const errorMsg = result.details
                    ? `${result.error}: ${result.details}`
                    : result.error || 'Failed to update profile';
                throw new Error(errorMsg);
            }

            console.log('✅ Profile updated successfully:', result);
            
            // Clear file states after successful upload
            setLogoFile(null);
            setInvoiceTemplateFile(null);
            setReceiptTemplateFile(null);
            setCertificateTemplateFile(null);
            setProFormaTemplateFile(null);
            setSsgCertFile(null);
            setSsgPrivateKeyFile(null);
            
            // Update the profile with response data to get correct file URLs
            if (result.data && result.data.profile) {
                setFormData(result.data.profile);
                
                // Update the training provider profile in the LMS context for header logo
                updateTrainingProviderProfile({
                    companyLogoUrl: result.data.profile.companyLogoUrl,
                    companyShortname: result.data.profile.companyShortname || result.data.profile.companyName
                });

                // Update the current user profile so the profile dropdown shows the same image
                updateCurrentUserProfile({
                    profilePictureUrl: result.data.profile.companyLogoUrl,
                    name: result.data.profile.companyName
                });

                // Re-apply the color scheme after successful save
                if (formData.colorScheme) {
                    applyPrimaryColor(formData.colorScheme);
                    console.log(`🎨 Re-applied color after save: ${formData.colorScheme}`);
                }
            }
            
            // Update the profile with new data and exit edit mode
            onUpdate(profile.id, formData);
            setIsEditing(false);
            
            // Show success message (you can add toast notification here)
            alert('Profile updated successfully!');
            
        } catch (error) {
            console.error('❌ Failed to update profile:', error);
            alert(`Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <Card className="p-8">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="flex-shrink-0 text-center">
                        <div className="relative group w-24 h-24">
                            <img
                                src={getImageUrl(formData.companyLogoUrl)}
                                alt={formData.companyName}
                                className="w-24 h-24 rounded-md object-cover ring-4 ring-blue-500/20"
                            />
                            {isGeneratingLogo && (
                                <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded-md">
                                    <Spinner />
                                </div>
                            )}
                            {isEditing && !isGeneratingLogo && (
                                <>
                                    <input
                                        type="file"
                                        id="logo-upload"
                                        className="hidden"
                                        accept="image/*"
                                        onChange={handleLogoChange}
                                    />
                                    <label
                                        htmlFor="logo-upload"
                                        className="absolute inset-0 bg-black/60 flex items-center justify-center text-white rounded-md cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Icon name={IconName.Upload} className="w-8 h-8" />
                                    </label>
                                </>
                            )}
                        </div>
                        {isEditing && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="mt-2"
                                onClick={handleGenerateLogo}
                                disabled={isGeneratingLogo}
                            >
                                {isGeneratingLogo ? <Spinner size="sm"/> : 'Generate Logo'}
                            </Button>
                        )}
                    </div>
                    
                    <div className="flex-grow text-center sm:text-left">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <h1 className="text-3xl font-bold text-on-surface">{formData.companyName}</h1>
                                <p className="text-subtle text-lg">{formData.companyShortname}</p>
                            </div>
                            <div className="flex gap-2">
                                {isEditing ? (
                                    <>
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                setIsEditing(false);
                                                setFormData(profile);
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button onClick={handleSave} disabled={isSaving}>
                                            {isSaving ? 'Saving...' : 'Save Changes'}
                                        </Button>
                                    </>
                                ) : (
                                    <Button variant="ghost" onClick={() => setIsEditing(true)}>
                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-2" />
                                        Edit Profile
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Company Details</h2>
                {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Name</label>
                            <input type="text" name="companyName" value={formData.companyName} onChange={handleInputChange} placeholder="Company Name" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Short Name</label>
                            <input type="text" name="companyShortname" value={formData.companyShortname} onChange={handleInputChange} placeholder="Company Short Name" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">UEN</label>
                            <input type="text" name="uen" value={formData.uen} onChange={handleInputChange} placeholder="UEN" className={inputClasses} />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Address</label>
                            <input type="text" name="companyAddress" value={formData.companyAddress} onChange={handleInputChange} placeholder="Company Address" className={inputClasses} />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <ProfileBioItem label="Company Name" value={formData.companyName} />
                        <ProfileBioItem label="Company Short Name" value={formData.companyShortname} />
                        <ProfileBioItem label="UEN" value={formData.uen} />
                        <div className="sm:col-span-2 lg:col-span-3">
                            <ProfileBioItem label="Company Address" value={formData.companyAddress} />
                        </div>
                    </div>
                )}
                
                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Contact Person</h2>
                {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Name</label>
                            <input type="text" name="name" value={formData.contactPerson.name} onChange={handleContactChange} placeholder="Name" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Email</label>
                            <input type="email" name="email" value={formData.contactPerson.email} onChange={handleContactChange} placeholder="Email" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Telephone</label>
                            <input type="tel" name="tel" value={formData.contactPerson.tel} onChange={handleContactChange} placeholder="Telephone" className={inputClasses} />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <ProfileBioItem label="Name" value={formData.contactPerson.name} />
                        <ProfileBioItem label="Email" value={formData.contactPerson.email} />
                        <ProfileBioItem label="Telephone" value={formData.contactPerson.tel} />
                    </div>
                )}

                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">API Keys</h2>
                <div className="space-y-4">
                {FIXED_API_KEY_NAMES.map((keyName) => {
                    const keyValue = (formData.apiKeys || {})[keyName] || '';
                    const isVisible = visibleApiKeys[keyName];

                    return (
                        <div
                            key={keyName}
                            className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                        >
                            {/* API Key Name */}
                            <div className="w-full sm:w-48 flex-shrink-0">
                                <span className="text-sm font-semibold text-on-surface">{keyName}</span>
                            </div>

                            {/* API Key Value Input/Display */}
                            <div className="flex-grow flex items-center gap-2">
                                {isEditing ? (
                                    <div className="relative flex-grow">
                                        <input
                                            type={isVisible ? "text" : "password"}
                                            value={keyValue}
                                            onChange={(e) => {
                                                const newValue = e.target.value;
                                                setFormData(prev => ({
                                                    ...prev,
                                                    apiKeys: {
                                                        ...(prev.apiKeys || {}),
                                                        [keyName]: newValue
                                                    }
                                                }));
                                            }}
                                            placeholder="Enter API key..."
                                            className="w-full px-3 py-2 text-on-surface bg-surface border border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent pr-20"
                                        />
                                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                                className="text-gray-400 hover:text-gray-300 p-1"
                                            >
                                                <Icon
                                                    name={isVisible ? IconName.EyeOff : IconName.Eye}
                                                    className="w-4 h-4"
                                                />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-grow flex items-center gap-2 px-3 py-2 bg-surface border border-gray-600 rounded-md">
                                        <span className="flex-grow text-on-surface font-mono text-sm">
                                            {keyValue ? (
                                                isVisible ? keyValue : `••••••••••••••••••••${keyValue.slice(-4)}`
                                            ) : (
                                                <span className="text-gray-500 italic">Not set</span>
                                            )}
                                        </span>
                                        {keyValue && (
                                            <button
                                                type="button"
                                                onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                                className="text-gray-400 hover:text-gray-300 p-1"
                                            >
                                                <Icon
                                                    name={isVisible ? IconName.EyeOff : IconName.Eye}
                                                    className="w-4 h-4"
                                                />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                </div>

                <div className="border-t my-6"></div>

                <h2 className="text-xl font-bold mb-4">Document Templates</h2>
                <div className="space-y-4">
                    {/* Invoice Template */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <div>
                        <p className="font-semibold">Invoice Template</p>
                        <p className="text-xs text-subtle">
                            {(() => {
                                let displayText;
                                if (invoiceTemplateFile) {
                                    // For newly selected files, clean the name to remove double extensions
                                    displayText = getCleanDisplayName(invoiceTemplateFile.name);
                                    console.log(`🔍 Display - invoiceTemplateFile.name: "${invoiceTemplateFile.name}" -> cleaned: "${displayText}"`);
                                } else if (formData.invoiceTemplateUrl) {
                                    // For existing files, get filename from URL and clean it (remove timestamp and double extensions)
                                    const filename = formData.invoiceTemplateUrl.split('/').pop() || '';
                                    displayText = getCleanDisplayName(filename);
                                    console.log(`🔍 Display - formData.invoiceTemplateUrl: "${formData.invoiceTemplateUrl}" -> filename: "${filename}" -> cleaned: "${displayText}"`);
                                } else {
                                    displayText = 'No template uploaded';
                                }
                                return displayText;
                            })()}
                        </p>
                        </div>
                        {isEditing && (
                        <>
                            <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => document.getElementById('invoice-upload')?.click()}
                            >
                            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                            Upload
                            </Button>
                            <input
                            type="file"
                            id="invoice-upload"
                            className="hidden"
                            accept="*/*"
                            onChange={(e) => handleTemplateUpload(e, 'invoiceTemplateUrl')}
                            />
                        </>
                        )}
                    </div>

                    {/* Receipt Template */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <div>
                        <p className="font-semibold">Receipt Template</p>
                        <p className="text-xs text-subtle">
                            {receiptTemplateFile 
                                ? getCleanDisplayName(receiptTemplateFile.name)
                                : formData.receiptTemplateUrl
                                    ? getCleanDisplayName(formData.receiptTemplateUrl.split('/').pop() || '')
                                    : 'No template uploaded'}
                        </p>
                        </div>
                        {isEditing && (
                        <>
                            <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => document.getElementById('receipt-upload')?.click()}
                            >
                            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                            Upload
                            </Button>
                            <input
                            type="file"
                            id="receipt-upload"
                            className="hidden"
                            accept="*/*"
                            onChange={(e) => handleTemplateUpload(e, 'receiptTemplateUrl')}
                            />
                        </>
                        )}
                    </div>

                    {/* Certificate Template */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <div>
                        <p className="font-semibold">Certificate Template</p>
                        <p className="text-xs text-subtle">
                            {certificateTemplateFile 
                                ? getCleanDisplayName(certificateTemplateFile.name)
                                : formData.certificateTemplateUrl
                                    ? getCleanDisplayName(formData.certificateTemplateUrl.split('/').pop() || '')
                                    : 'No template uploaded'}
                        </p>
                        </div>
                        {isEditing && (
                        <>
                            <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => document.getElementById('certificate-upload')?.click()}
                            >
                            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                            Upload
                            </Button>
                            <input
                            type="file"
                            id="certificate-upload"
                            className="hidden"
                            accept="*/*"
                            onChange={(e) => handleTemplateUpload(e, 'certificateTemplateUrl')}
                            />
                        </>
                        )}
                    </div>

                    {/* Pro Forma Invoice Template */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <div>
                        <p className="font-semibold">Pro Forma Invoice Template</p>
                        <p className="text-xs text-subtle">
                            {proFormaTemplateFile 
                                ? getCleanDisplayName(proFormaTemplateFile.name)
                                : formData.proFormaInvoiceTemplateUrl
                                    ? getCleanDisplayName(formData.proFormaInvoiceTemplateUrl.split('/').pop() || '')
                                    : 'No template uploaded'}
                        </p>
                        </div>
                        {isEditing && (
                        <>
                            <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                document.getElementById('pro-forma-invoice-upload')?.click()
                            }
                            >
                            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                            Upload
                            </Button>
                            <input
                            type="file"
                            id="pro-forma-invoice-upload"
                            className="hidden"
                            accept="*/*"
                            onChange={(e) =>
                                handleTemplateUpload(e, 'proFormaInvoiceTemplateUrl')
                            }
                            />
                        </>
                        )}
                    </div>
                </div>

                <div className="border-t my-6"></div>

                <h2 className="text-xl font-bold mb-4">SSG Developer Authorisation</h2>
                {isEditing ? (
                <div className="space-y-4">
                    {/* Cert File */}
                    <div>
                    <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                        Self Signing Cert File
                    </label>
                    <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                        <span className="text-sm text-on-surface-secondary flex-grow">
                        {ssgCertFile
                            ? getCleanDisplayName(ssgCertFile.name)
                            : formData.ssgCertFile?.split('/').pop() ? getCleanDisplayName(formData.ssgCertFile.split('/').pop() || '') : 'No file uploaded'}
                        </span>
                        <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => document.getElementById('ssg-cert-upload')?.click()}
                        >
                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                        Upload
                        </Button>
                        <input
                        type="file"
                        id="ssg-cert-upload"
                        accept="*/*"
                        className="hidden"
                        onChange={(e) => handleTemplateUpload(e, 'ssgCertFile' as any)}
                        />
                    </div>
                    </div>

                    {/* Private Key File */}
                    <div>
                    <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                        Private Key File
                    </label>
                    <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                        <span className="text-sm text-on-surface-secondary flex-grow">
                        {ssgPrivateKeyFile
                            ? getCleanDisplayName(ssgPrivateKeyFile.name)
                            : formData.ssgPrivateKeyFile?.split('/').pop() ? getCleanDisplayName(formData.ssgPrivateKeyFile.split('/').pop() || '') : 'No file uploaded'}
                        </span>
                        <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                            document.getElementById('ssg-privatekey-upload')?.click()
                        }
                        >
                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                        Upload
                        </Button>
                        <input
                        type="file"
                        id="ssg-privatekey-upload"
                        accept="*/*"
                        className="hidden"
                        onChange={(e) => handleTemplateUpload(e, 'ssgPrivateKeyFile' as any)}
                        />
                    </div>
                    </div>

                    {/* Encryption Key */}
                    <div>
                    <label
                        htmlFor="ssgEncryptionKey"
                        className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold"
                    >
                        Encryption Key
                    </label>
                    <div className="relative">
                        <input
                            type={isEncryptionKeyVisible ? "text" : "password"}
                            id="ssgEncryptionKey"
                            name="ssgEncryptionKey"
                            value={formData.ssgEncryptionKey || ''}
                            onChange={(e) =>
                            setFormData((prev) => ({ ...prev, ssgEncryptionKey: e.target.value }))
                            }
                            className={`${inputClasses} pr-10`}
                            placeholder="Enter your encryption key"
                        />
                        <button
                            type="button"
                            onClick={() => setIsEncryptionKeyVisible(!isEncryptionKeyVisible)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle hover:text-primary"
                        >
                            <Icon
                                name={isEncryptionKeyVisible ? IconName.EyeOff : IconName.Eye}
                                className="w-4 h-4"
                            />
                        </button>
                    </div>
                    </div>
                </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <ProfileBioItem
                    label="Self Signing Cert File"
                    value={formData.ssgCertFile ? getCleanDisplayName(formData.ssgCertFile.split('/').pop() || '') : 'Not Uploaded'}
                    />
                    <ProfileBioItem
                    label="Private Key File"
                    value={formData.ssgPrivateKeyFile ? getCleanDisplayName(formData.ssgPrivateKeyFile.split('/').pop() || '') : 'Not Uploaded'}
                    />
                    <ProfileBioItem
                    label="Encryption Key"
                    value={
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-on-surface break-words">
                                {formData.ssgEncryptionKey 
                                    ? (isEncryptionKeyVisible ? formData.ssgEncryptionKey : '••••••••••••••••')
                                    : 'Not Set'
                                }
                            </span>
                            {formData.ssgEncryptionKey && (
                                <button
                                    type="button"
                                    onClick={() => setIsEncryptionKeyVisible(!isEncryptionKeyVisible)}
                                    className="text-subtle hover:text-primary p-1 rounded-full"
                                >
                                    <Icon
                                        name={isEncryptionKeyVisible ? IconName.EyeOff : IconName.Eye}
                                        className="w-4 h-4"
                                    />
                                </button>
                            )}
                        </div>
                    }
                    />
                </div>
                )}

                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Integrations</h2>
                <div className="space-y-4 font-semibold">
                    <ToggleSwitch
                        checked={formData.integrations.syncGoogleCalendar}
                        onChange={(checked) => handleToggleChange('integrations', 'syncGoogleCalendar')}
                        label="Sync Google Calendar"
                        isEditing={isEditing}
                    />
                    <ToggleSwitch
                        checked={formData.integrations.syncMicrosoftCalendar}
                        onChange={(checked) => handleToggleChange('integrations', 'syncMicrosoftCalendar')}
                        label="Sync Microsoft Calendar"
                        isEditing={isEditing}
                    />
                    <ToggleSwitch
                        checked={formData.integrations.googleDrive}
                        onChange={(checked) => handleToggleChange('integrations', 'googleDrive')}
                        label="Integrate Google Drive"
                        isEditing={isEditing}
                    />
                    <ToggleSwitch
                        checked={formData.integrations.microsoftOneDrive}
                        onChange={(checked) => handleToggleChange('integrations', 'microsoftOneDrive')}
                        label="Integrate Microsoft OneDrive"
                        isEditing={isEditing}
                    />
                </div>

                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Admin Setting</h2>
                <div className="space-y-4 font-semibold">
                    {Object.entries(adminSettingLabels).map(([key, label]) => (
                        <ToggleSwitch
                            key={key}
                            checked={formData.adminSettings[key as keyof typeof formData.adminSettings]}
                            onChange={(checked) => handleToggleChange('adminSettings', key)}
                            label={label}
                            isEditing={isEditing}
                        />
                    ))}
                </div>

                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Security</h2>
                <div className="space-y-4">
                {/* Auto Mask Sensitive Data */}
                <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                    <p className="font-semibold text-sm text-on-surface">Auto Mask Sensitive Data</p>
                    {isEditing ? (
                    <button
                        type="button"
                        onClick={() => handleToggleChange('securitySettings', 'autoMaskSensitiveData')}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        formData.securitySettings.autoMaskSensitiveData ? 'bg-primary' : 'bg-gray-200'
                        }`}
                    >
                        <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            formData.securitySettings.autoMaskSensitiveData ? 'translate-x-6' : 'translate-x-1'
                        }`}
                        />
                    </button>
                    ) : (
                    <span
                        className={`text-sm font-medium ${
                        formData.securitySettings.autoMaskSensitiveData ? 'text-green-600' : 'text-gray-400'
                        }`}
                    >
                        {formData.securitySettings.autoMaskSensitiveData ? 'Enabled' : 'Disabled'}
                    </span>
                    )}
                </div>

                {/* Auto Delete After 6 Months */}
                <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                    <p className="font-semibold text-sm text-on-surface">Auto Delete After 6 Months</p>
                    {isEditing ? (
                    <button
                        type="button"
                        onClick={() => handleToggleChange('securitySettings', 'autoDeleteAfter6Months')}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        formData.securitySettings.autoDeleteAfter6Months ? 'bg-primary' : 'bg-gray-200'
                        }`}
                    >
                        <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            formData.securitySettings.autoDeleteAfter6Months ? 'translate-x-6' : 'translate-x-1'
                        }`}
                        />
                    </button>
                    ) : (
                    <span
                        className={`text-sm font-medium ${
                        formData.securitySettings.autoDeleteAfter6Months ? 'text-green-600' : 'text-gray-400'
                        }`}
                    >
                        {formData.securitySettings.autoDeleteAfter6Months ? 'Enabled' : 'Disabled'}
                    </span>
                    )}
                </div>

                {/* Enable OTP Login */}
                <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                    <p className="font-semibold text-sm text-on-surface">Enable OTP Login</p>
                    {isEditing ? (
                    <button
                        type="button"
                        onClick={() => handleToggleChange('securitySettings', 'enableOtpLogin')}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        formData.securitySettings.enableOtpLogin ? 'bg-primary' : 'bg-gray-200'
                        }`}
                    >
                        <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            formData.securitySettings.enableOtpLogin ? 'translate-x-6' : 'translate-x-1'
                        }`}
                        />
                    </button>
                    ) : (
                    <span
                        className={`text-sm font-medium ${
                        formData.securitySettings.enableOtpLogin ? 'text-green-600' : 'text-gray-400'
                        }`}
                    >
                        {formData.securitySettings.enableOtpLogin ? 'Enabled' : 'Disabled'}
                    </span>
                    )}
                </div>

                {/* Enable Default OTP (only if OTP login enabled) */}
                {formData.securitySettings.enableOtpLogin && (
                    <>
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <p className="font-semibold text-sm text-on-surface">Enable Default OTP</p>
                        {isEditing ? (
                        <button
                            type="button"
                            onClick={() => handleToggleChange('securitySettings', 'enableDefaultOtp')}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            formData.securitySettings.enableDefaultOtp ? 'bg-primary' : 'bg-gray-200'
                            }`}
                        >
                            <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                formData.securitySettings.enableDefaultOtp ? 'translate-x-6' : 'translate-x-1'
                            }`}
                            />
                        </button>
                        ) : (
                        <span
                            className={`text-sm font-medium ${
                            formData.securitySettings.enableDefaultOtp ? 'text-green-600' : 'text-gray-400'
                            }`}
                        >
                            {formData.securitySettings.enableDefaultOtp ? 'Enabled' : 'Disabled'}
                        </span>
                        )}
                    </div>

                    {/* Default OTP Value (only if both OTP and default OTP enabled) */}
                    {formData.securitySettings.enableDefaultOtp && (
                        <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            Default OTP Value
                        </label>
                        {isEditing ? (
                            <input
                            type="text"
                            value={formData.securitySettings.defaultOtpValue || ''}
                            onChange={(e) =>
                                setFormData((prev) => ({
                                ...prev,
                                securitySettings: {
                                    ...prev.securitySettings,
                                    defaultOtpValue: e.target.value,
                                },
                                }))
                            }
                            className={inputClasses}
                            placeholder="Enter default OTP value"
                            />
                        ) : (
                            <p className="font-mono text-sm">
                            {formData.securitySettings.defaultOtpValue || 'Not Set'}
                            </p>
                        )}
                        </div>
                    )}
                    </>
                )}
                </div>

                
                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Gamification Settings</h2>
                <div className="space-y-4 font-semibold">
                    <ToggleSwitch
                        checked={formData.gamingSettings.enableLeaderboard}
                        onChange={(checked) => handleToggleChange('gamingSettings', 'enableLeaderboard')}
                        label="Enable Leaderboard"
                        isEditing={isEditing}
                    />
                    <ToggleSwitch
                        checked={formData.gamingSettings.enablePoints}
                        onChange={(checked) => handleToggleChange('gamingSettings', 'enablePoints')}
                        label="Enable Points System"
                        isEditing={isEditing}
                    />
                </div>

                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Funding & Tax Settings</h2>
                {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* Normal Funding Rate */}
                    <div>
                    <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                        Normal Funding Rate
                    </label>
                    <select
                        name="normalFunding"
                        value={formData.fundingSettings.normalFunding}
                        onChange={handleFundingChange}
                        className={inputClasses}
                    >
                        <option value={50}>50%</option>
                        <option value={70}>70%</option>
                    </select>
                    </div>

                    {/* Enhanced Funding Rate */}
                    <div>
                    <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                        Enhanced Funding Rate (%)
                    </label>
                    <input
                        type="number"
                        name="enhancedFunding"
                        value={formData.fundingSettings.enhancedFunding}
                        onChange={handleFundingChange}
                        className={inputClasses}
                        min="0"
                    />
                    </div>

                    {/* GST Rate */}
                    <div>
                    <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                        GST Rate (%)
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        name="gstRate"
                        value={formData.fundingSettings.gstRate}
                        onChange={handleFundingChange}
                        className={inputClasses}
                        min="0"
                    />
                    </div>

                    {/* GST Registered Toggle */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                    <label className="text-sm text-on-surface">GST Registered</label>
                    <button
                        type="button"
                        onClick={() => {
                        const newValue = !formData.fundingSettings.isGstRegistered;
                        setFormData((prev) => ({
                            ...prev,
                            fundingSettings: {
                            ...prev.fundingSettings,
                            isGstRegistered: newValue,
                            },
                        }));
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        formData.fundingSettings.isGstRegistered ? 'bg-primary' : 'bg-gray-200'
                        }`}
                    >
                        <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            formData.fundingSettings.isGstRegistered ? 'translate-x-6' : 'translate-x-1'
                        }`}
                        />
                    </button>
                    </div>
                </div>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <ProfileBioItem
                    label="Normal Funding Rate"
                    value={`${formData.fundingSettings.normalFunding}%`}
                    />
                    <ProfileBioItem
                    label="Enhanced Funding Rate"
                    value={`${formData.fundingSettings.enhancedFunding}%`}
                    />
                    <ProfileBioItem
                    label="GST Registered"
                    value={formData.fundingSettings.isGstRegistered ? 'Yes' : 'No'}
                    />
                    <ProfileBioItem
                    label="GST Rate"
                    value={`${formData.fundingSettings.gstRate}%`}
                    />
                </div>
                )}

                
                <div className="border-t my-6"></div>
                <h2 className="text-xl font-bold mb-4">Appearance</h2>

                {/* Theme Mode Toggle */}
                <div className="space-y-4">
                    <div className="flex justify-between items-center p-4 bg-surface-elevated rounded-lg border border-default">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${themeMode === 'dark' ? 'bg-gray-700' : 'bg-blue-100'}`}>
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
                                <p className="font-semibold text-on-surface">Theme Mode</p>
                                <p className="text-sm text-on-surface-secondary">
                                    {themeMode === 'dark' ? 'Dark theme active' : 'Light theme active'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleThemeToggle}
                            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${
                                themeMode === 'dark' ? 'bg-primary' : 'bg-gray-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${
                                    themeMode === 'dark' ? 'translate-x-8' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Primary Color */}
                    <div className="flex justify-between items-center p-4 bg-surface-elevated rounded-lg border border-default">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-9 h-9 rounded-lg border-2 border-white shadow-md"
                                style={{ backgroundColor: formData.colorScheme || '#3B82F6' }}
                            />
                            <div>
                                <p className="font-semibold text-on-surface">Primary Color</p>
                                <p className="text-sm text-on-surface-secondary">
                                    {isEditing ? 'Click color to change' : (formData.colorScheme || '#3B82F6').toUpperCase()}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
                                    <input
                                        type="color"
                                        name="primary"
                                        value={formData.colorScheme || '#3B82F6'}
                                        onChange={handleColorChange}
                                        className="w-10 h-10 rounded-md border-2 border-gray-300 cursor-pointer hover:border-primary transition-colors"
                                    />
                                    <span className="font-mono text-sm text-on-surface-secondary">{formData.colorScheme || '#3B82F6'}</span>
                                </>
                            ) : (
                                <span className="font-mono text-sm text-on-surface bg-surface px-3 py-1 rounded-md border border-default">
                                    {formData.colorScheme || '#3B82F6'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

            </Card>
            <LoginDetailsCard 
                loginId={formData.loginId} 
                password={formData.password} 
                userId={profile.id}
                onPasswordUpdate={(newPassword) => {
                    setFormData(prev => ({ ...prev, password: newPassword }));
                }}
            />
        </>
    );
};