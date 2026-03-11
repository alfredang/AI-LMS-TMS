import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

interface AddTrainerFormProps {
  onCancel: () => void;
  onSuccess: () => void;
}

interface TrainerFormData {
  email: string;
  fullName: string;
  telephone: string;
  trainerType: 'ACLP' | 'non-ACLP' | 'DACE' | '';
  status: 'Active' | 'Inactive' | '';
  linkedinUrl: string;
  gender: 'Male' | 'Female' | 'Other' | '';
  profilePictureUrl: string;
}

const AddTrainerForm: React.FC<AddTrainerFormProps> = ({ onCancel, onSuccess }) => {
  const [formData, setFormData] = useState<TrainerFormData>({
    email: '',
    fullName: '',
    telephone: '',
    trainerType: '',
    status: '',
    linkedinUrl: '',
    gender: '',
    profilePictureUrl: ''
  });
  
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProfilePictureFile, setSelectedProfilePictureFile] = useState<File | null>(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(null);
  
  // Email validation states
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  
  const defaultPassword = 'Tertiary888';
  const inputClasses = "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear email error when user starts typing
    if (name === 'email') {
      setEmailError(null);
      setEmailExists(false);
    }
  };

  const checkEmailExists = async (email: string) => {
    if (!email || !email.includes('@')) return;
    
    setIsCheckingEmail(true);
    setEmailError(null);
    
    try {
      const response = await fetch('/api/admin/check-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        if (result.data.exists) {
          setEmailExists(true);
          setEmailError('This email address is already registered in the system');
        } else {
          setEmailExists(false);
          setEmailError(null);
        }
      } else {
        setEmailError('Unable to verify email. Please try again.');
      }
    } catch (error) {
      console.error('Email check error:', error);
      setEmailError('Unable to verify email. Please try again.');
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const handleEmailBlur = () => {
    if (formData.email) {
      checkEmailExists(formData.email);
    }
  };

  const handleGenerateAvatar = async () => {
    setIsGeneratingAvatar(true);
    try {
      // Clear any selected file since we're generating an AI avatar
      setSelectedProfilePictureFile(null);
      setProfilePicturePreview(null);
      
      // Use the same approach as TrainerProfileCard - simple and reliable
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
      
      // Clear generated avatar since we have a new file
      setFormData(prev => ({ ...prev, profilePictureUrl: '' }));
      
      // Create preview URL for immediate display
      const reader = new FileReader();
      reader.onload = (e) => {
        const previewUrl = e.target?.result as string;
        setProfilePicturePreview(previewUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const validateForm = () => {
    const requiredFields = [
      { field: formData.email, name: 'Email' },
      { field: formData.fullName, name: 'Full Name' },
      { field: formData.telephone, name: 'Telephone' },
      { field: formData.trainerType, name: 'Trainer Type' },
      { field: formData.status, name: 'Status' },
      { field: formData.gender, name: 'Gender' }
    ];

    const missingFields = requiredFields.filter(({ field }) => !field || field === '').map(({ name }) => name);

    if (missingFields.length > 0) {
      alert(`Please fill in all required fields:\n${missingFields.join('\n')}`);
      return false;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      alert('Please enter a valid email address.');
      return false;
    }

    // Check if email exists
    if (emailExists) {
      alert('This email address is already registered in the system. Please use a different email.');
      return false;
    }

    // LinkedIn URL validation (if provided)
    if (formData.linkedinUrl && !formData.linkedinUrl.includes('linkedin.com')) {
      alert('Please enter a valid LinkedIn URL.');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // Prepare form data for upload
      const formDataToSend = new FormData();
      
      // Add required fields
      formDataToSend.append('email', formData.email);
      formDataToSend.append('password', defaultPassword);
      formDataToSend.append('fullName', formData.fullName);
      formDataToSend.append('telephone', formData.telephone);
      formDataToSend.append('trainerType', formData.trainerType);
      formDataToSend.append('status', formData.status);
      formDataToSend.append('gender', formData.gender);
      
      // Add optional fields if they exist
      if (formData.linkedinUrl) {
        formDataToSend.append('linkedinUrl', formData.linkedinUrl);
      }
      if (formData.profilePictureUrl) {
        formDataToSend.append('profilePictureUrl', formData.profilePictureUrl);
      }
      
      // Add profile picture file if selected
      if (selectedProfilePictureFile) {
        formDataToSend.append('profilePicture', selectedProfilePictureFile);
      }

      console.log('📤 Submitting new trainer data via FormData');

      const response = await fetch('/api/admin/add-trainer', {
        method: 'POST',
        body: formDataToSend // Send as FormData for file upload support
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || `Failed to add trainer: ${response.status}`);
      }

      console.log('✅ Trainer added successfully:', result);
      alert('Trainer added successfully!');
      onSuccess();

    } catch (error) {
      console.error('❌ Failed to add trainer:', error);
      alert(`Failed to add trainer: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Add New Trainer</h1>
        <Button variant="ghost" onClick={onCancel}>
          <Icon name={IconName.Back} className="w-4 h-4 mr-2" />
          Back to Trainers
        </Button>
      </div>

      <Card className="p-8 dark:bg-gray-800 dark:border-gray-700">
        <div className="space-y-6">
          {/* Profile Picture Section */}
          <div className="bg-gray-50 dark:bg-gray-700/50 p-6 rounded-lg">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Profile Picture</h3>
            <div className="flex items-center space-x-6">
              <div className="flex-shrink-0">
                <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden">
                  {profilePicturePreview ? (
                    <img 
                      src={profilePicturePreview} 
                      alt="Profile Preview" 
                      className="w-full h-full object-cover" 
                    />
                  ) : formData.profilePictureUrl ? (
                    <img 
                      src={formData.profilePictureUrl} 
                      alt="Profile Picture" 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <Icon name={IconName.User} className="w-8 h-8 text-gray-400" />
                  )}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex flex-col space-y-3">
                  <label className="block">
                    <span className="sr-only">Choose photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange}
                      className="block w-full text-sm text-gray-500 dark:text-gray-400
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-md file:border-0
                        file:text-sm file:font-medium
                        file:bg-blue-50 file:text-blue-700
                        dark:file:bg-blue-900/20 dark:file:text-blue-400
                        hover:file:bg-blue-100 dark:hover:file:bg-blue-900/40
                        cursor-pointer"
                    />
                  </label>
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-500 dark:text-gray-400 text-sm">or</span>
                    <button
                      type="button"
                      onClick={handleGenerateAvatar}
                      disabled={isGeneratingAvatar}
                      className="px-3 py-1 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingAvatar ? 'Generating...' : 'Generate AI Avatar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onBlur={handleEmailBlur}
                  className={`${inputClasses} ${emailError ? 'border-red-500 focus:ring-red-500' : emailExists === false && formData.email ? 'border-green-500 focus:ring-green-500' : ''}`}
                  required
                />
                {isCheckingEmail && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                  </div>
                )}
                {!isCheckingEmail && emailExists === false && formData.email && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <Icon name={IconName.Check} className="w-4 h-4 text-green-500" />
                  </div>
                )}
                {emailError && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <Icon name={IconName.X} className="w-4 h-4 text-red-500" />
                  </div>
                )}
              </div>
              {emailError && (
                <p className="mt-1 text-sm text-red-600">{emailError}</p>
              )}
              {!emailError && emailExists === false && formData.email && (
                <p className="mt-1 text-sm text-green-600">✓ Email is available</p>
              )}
            </div>

            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                className={inputClasses}
                required
              />
            </div>

            {/* Default Password (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Default Password
              </label>
              <input
                type="text"
                value={defaultPassword}
                className={`${inputClasses} bg-gray-100 dark:bg-gray-600 cursor-not-allowed`}
                readOnly
                disabled
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This default password will be assigned to the new trainer</p>
            </div>

            {/* Telephone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Telephone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                name="telephone"
                value={formData.telephone}
                onChange={handleChange}
                className={inputClasses}
                required
              />
            </div>

            {/* Trainer Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Trainer Type <span className="text-red-500">*</span>
              </label>
              <select
                name="trainerType"
                value={formData.trainerType}
                onChange={handleChange}
                className={inputClasses}
                required
              >
                <option value="">Select Trainer Type</option>
                <option value="ACLP">ACLP</option>
                <option value="non-ACLP">non-ACLP</option>
                <option value="DACE">DACE</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className={inputClasses}
                required
              >
                <option value="">Select Status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            {/* Gender */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Gender <span className="text-red-500">*</span>
              </label>
              <select
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                className={inputClasses}
                required
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Prefer not to say</option>
              </select>
            </div>

            {/* LinkedIn URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                LinkedIn Profile URL
              </label>
              <input
                type="url"
                name="linkedinUrl"
                value={formData.linkedinUrl}
                onChange={handleChange}
                className={inputClasses}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-4 pt-6 border-t dark:border-gray-700">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              onClick={handleSubmit}
              disabled={isSubmitting || emailExists || isCheckingEmail}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Adding...
                </>
              ) : (
                <>
                  Add Trainer
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AddTrainerForm;