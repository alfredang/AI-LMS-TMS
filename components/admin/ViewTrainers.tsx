import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import AddTrainerForm from './AddTrainerForm';
import { BulkUploadTrainersView } from './BulkUploadTrainersView';
import { SKILLS_FUTURE_INDUSTRIES } from '@app-types/profile';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';
import { maskNric } from '../../utils';

interface Trainer {
  trainer_name: string;
  email: string;
  secondary_email: string | null;
  profile_picture: string | null;
  telephone: string | null;
  trainer_type: string | null;
  status: string | null;
  account_status: string | null;
  linkedin_url: string | null;
  cv_folder_url: string | null;
  areas_of_expertise: string[] | null;
  skills_tags?: string[] | null;
  certification_tags?: string[] | null;
  nric?: string | null;
  user_id: string;
}

const getStatusColor = (status: string | null) => {
  switch (status) {
    case 'Active':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'Inactive':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
    default:
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  }
};

const getAccountStatusColor = (status: string | null) => {
  const normalised = (status || '').toLowerCase();
  if (normalised === 'active') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (normalised === 'inactive' || normalised === 'disabled' || normalised === 'suspended')
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
};

const capitalise = (s: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A';

const TRAINER_TYPES = ['ACLP', 'non-ACLP'];
const TRAINER_STATUSES = ['Active', 'Inactive'];
const DEFAULT_TRAINER_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#F3F4F6"/>
    <circle cx="20" cy="15" r="7" fill="#A3A3A3"/>
    <path d="M8 34c2.8-6.2 7.5-9.5 12-9.5S29.2 27.8 32 34" fill="#A3A3A3"/>
  </svg>`
)}`;

const getTrainerThumbnailSrc = (trainer: Trainer): string => {
  // If trainer has an explicit profile picture URL, use it directly
  if (trainer.profile_picture) {
    return ensureAbsoluteImageUrl(trainer.profile_picture) || DEFAULT_TRAINER_AVATAR;
  }

  // Otherwise, auto-search Google Drive folder by trainer name
  const params = new URLSearchParams({ name: trainer.trainer_name });
  return `/api/admin/trainer-image?${params.toString()}`;
};

const ViewTrainers: React.FC = () => {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterTrainerTypes, setFilterTrainerTypes] = useState<string[]>([]);
  const [filterTrainerStatuses, setFilterTrainerStatuses] = useState<string[]>([]);
  const [filterAreasOfExpertise, setFilterAreasOfExpertise] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddTrainerForm, setShowAddTrainerForm] = useState(false);
  const [visibleNrics, setVisibleNrics] = useState<Set<string>>(new Set());

  const toggleNricVisibility = (userId: string) => {
    setVisibleNrics(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Status update confirmation states
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [targetStatus, setTargetStatus] = useState<'Active' | 'Inactive' | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Inline NRIC editing states
  const [editingNricId, setEditingNricId] = useState<string | null>(null);
  const [nricEditValue, setNricEditValue] = useState('');
  const [savingNric, setSavingNric] = useState(false);
  const [nricMessage, setNricMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Profile image upload
  const [uploadingImageFor, setUploadingImageFor] = useState<string | null>(null);
  const [syncingAllImages, setSyncingAllImages] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);

  const handleImageUploadClick = (userId: string) => {
    uploadTargetRef.current = userId;
    fileInputRef.current?.click();
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const userId = uploadTargetRef.current;
    if (!file || !userId) return;
    e.target.value = '';

    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be under 5MB');
      return;
    }

    setUploadingImageFor(userId);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(`/api/upload/profile-picture-drive?role=trainer&userId=${userId}`, {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();

      if (uploadData.success) {
        await fetch('/api/profile/update-trainer', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            profileData: { profilePictureUrl: uploadData.data.fileUrl },
          }),
        });

        setTrainers(prev => prev.map(t =>
          t.user_id === userId ? { ...t, profile_picture: uploadData.data.fileUrl } : t
        ));
      } else {
        alert('Upload failed: ' + (uploadData.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Upload failed');
    } finally {
      setUploadingImageFor(null);
    }
  };

  // Sync single trainer image: prompt for LinkedIn image URL, download, upload to Drive
  const handleSyncLinkedInImage = async (trainer: Trainer) => {
    // Open LinkedIn profile so admin can copy the image URL
    if (trainer.linkedin_url) {
      window.open(trainer.linkedin_url.startsWith('http') ? trainer.linkedin_url : `https://${trainer.linkedin_url}`, '_blank');
    }

    const imageUrl = prompt(
      `Paste the LinkedIn profile image URL for ${trainer.trainer_name}:\n\n` +
      `1. Right-click the profile photo on LinkedIn\n` +
      `2. Select "Copy image address"\n` +
      `3. Paste below:`
    );

    if (!imageUrl || !imageUrl.trim()) return;

    setUploadingImageFor(trainer.user_id);
    setSyncMessage(null);
    try {
      // Download the image via our proxy API
      const res = await fetch('/api/admin/download-linkedin-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: trainer.user_id,
          trainerName: trainer.trainer_name,
          imageUrl: imageUrl.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTrainers(prev => prev.map(t =>
          t.user_id === trainer.user_id ? { ...t, profile_picture: data.data.fileUrl } : t
        ));
        setSyncMessage({ type: 'success', text: `Profile image saved to Google Drive for ${trainer.trainer_name}` });
      } else {
        setSyncMessage({ type: 'error', text: data.error || 'Failed to download image.' });
      }
    } catch {
      setSyncMessage({ type: 'error', text: 'Failed to sync image.' });
    } finally {
      setUploadingImageFor(null);
      setTimeout(() => setSyncMessage(null), 8000);
    }
  };

  // Bulk sync: fetch LinkedIn images via Playwright, upload to Drive for all trainers missing images
  const handleSyncAllImages = async () => {
    if (!confirm('This will fetch LinkedIn profile images for all trainers without a photo. This may take a few minutes. Continue?')) return;
    setSyncingAllImages(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/admin/sync-trainer-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setSyncMessage({
          type: 'success',
          text: `Synced ${data.summary.updated} images from LinkedIn to Google Drive (${data.summary.skipped} skipped, ${data.summary.failed} failed).`,
        });
        if (data.summary.updated > 0) fetchTrainers();
      } else {
        setSyncMessage({ type: 'error', text: data.error || 'Sync failed.' });
      }
    } catch {
      setSyncMessage({ type: 'error', text: 'Failed to sync images.' });
    } finally {
      setSyncingAllImages(false);
      setTimeout(() => setSyncMessage(null), 10000);
    }
  };

  const itemsPerPage = 10;
  const inputClasses = "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

  const toggleCheckbox = (
    value: string,
    _current: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setSelected(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterTrainerTypes([]);
    setFilterTrainerStatuses([]);
    setFilterAreasOfExpertise([]);
    setCurrentPage(1);
  };

  const handleAddTrainerSuccess = () => {
    setShowAddTrainerForm(false);
    fetchTrainers();
  };

  const handleStatusChange = (trainer: Trainer, newStatus: 'Active' | 'Inactive') => {
    setSelectedTrainer(trainer);
    setTargetStatus(newStatus);
    setShowStatusConfirmation(true);
  };

  const confirmStatusUpdate = async () => {
    if (!selectedTrainer || !targetStatus) return;

    try {
      setIsUpdatingStatus(true);

      const response = await fetch('/api/admin/update-trainer-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedTrainer.user_id, newStatus: targetStatus })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to update trainer status');
      }

      alert(`Trainer ${targetStatus.toLowerCase()} successfully!`);
      await fetchTrainers();
      setShowStatusConfirmation(false);
      setSelectedTrainer(null);
      setTargetStatus(null);

    } catch (error) {
      alert(`Failed to update trainer status: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSaveNric = async (userId: string) => {
    setSavingNric(true);
    setNricMessage(null);
    try {
      const res = await fetch('/api/admin/update-trainer-nric', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, nric: nricEditValue }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || 'Failed to update NRIC');
      setTrainers(prev => prev.map(t => t.user_id === userId ? { ...t, nric: nricEditValue || null } : t));
      setNricMessage({ type: 'success', text: 'NRIC saved.' });
      setEditingNricId(null);
      setTimeout(() => setNricMessage(null), 3000);
    } catch (err) {
      setNricMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save NRIC' });
    } finally {
      setSavingNric(false);
    }
  };

  const fetchTrainers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/trainers-detail');
      const data = await response.json();
      if (data.success) setTrainers(data.data.trainers);
    } catch (error) {
      console.error('Error fetching trainers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrainers(); }, []);

  const filteredTrainers = trainers.filter(trainer => {
    const matchesSearch = !searchQuery ||
      trainer.trainer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trainer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (trainer.secondary_email && trainer.secondary_email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (trainer.telephone && trainer.telephone.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (Array.isArray(trainer.skills_tags) && trainer.skills_tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))) ||
      (Array.isArray(trainer.certification_tags) && trainer.certification_tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));

    const matchesTrainerType = filterTrainerTypes.length === 0 || filterTrainerTypes.includes(trainer.trainer_type || '');

    const matchesTrainerStatus = filterTrainerStatuses.length === 0 ||
      filterTrainerStatuses.includes(trainer.status || '');

    const areas = Array.isArray(trainer.areas_of_expertise)
      ? trainer.areas_of_expertise
      : (typeof trainer.areas_of_expertise === 'string' ? JSON.parse(trainer.areas_of_expertise) : []);
    const matchesAreasOfExpertise = filterAreasOfExpertise.length === 0 ||
      (areas.length > 0 && areas.some((a: string) => filterAreasOfExpertise.includes(a)));

    return matchesSearch && matchesTrainerType && matchesTrainerStatus && matchesAreasOfExpertise;
  });

  const totalPages = Math.ceil(filteredTrainers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTrainers = filteredTrainers.slice(startIndex, startIndex + itemsPerPage);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading trainers...</p>
        </div>
      </div>
    );
  }

  if (showAddTrainerForm) {
    return (
      <AddTrainerForm
        onCancel={() => setShowAddTrainerForm(false)}
        onSuccess={handleAddTrainerSuccess}
      />
    );
  }

  if (showBulkUpload) {
    return (
      <BulkUploadTrainersView
        onBack={() => { setShowBulkUpload(false); fetchTrainers(); }}
      />
    );
  }

  const totalTrainers = trainers.length;
  const aclpTrainers = trainers.filter(t => (t.trainer_type || '').toUpperCase() === 'ACLP').length;
  const nonAclpTrainers = totalTrainers - aclpTrainers;

  return (
    <div className="space-y-6">
      {/* Hidden file input for profile image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleImageFileChange}
      />
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">View Trainers</h1>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={handleSyncAllImages}
            disabled={syncingAllImages}
            className="border border-purple-500 text-purple-600 hover:bg-purple-50 dark:border-purple-400 dark:text-purple-400 dark:hover:bg-purple-900/20"
          >
            {syncingAllImages ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600 mr-2" />
            ) : (
              <Icon name={IconName.User} className="w-4 h-4 mr-2" />
            )}
            {syncingAllImages ? 'Syncing...' : 'Sync LinkedIn Images'}
          </Button>
          <Button variant="ghost" onClick={() => setShowBulkUpload(true)} className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20">
            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
            Bulk Upload Trainers
          </Button>
          <Button variant="primary" onClick={() => setShowAddTrainerForm(true)}>
            <Icon name={IconName.Add} className="w-4 h-4 mr-2" />
            Add New Trainer
          </Button>
        </div>
      </div>

      {/* Feedback messages */}
      {nricMessage && (
        <div className={`px-4 py-2 rounded-md text-sm ${nricMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300' : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300'}`}>
          {nricMessage.text}
        </div>
      )}
      {syncMessage && (
        <div className={`px-4 py-2 rounded-md text-sm ${syncMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300' : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300'}`}>
          {syncMessage.text}
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{totalTrainers}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Trainers</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-green-600">{aclpTrainers}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">ACLP Trainers</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-purple-600">{nonAclpTrainers}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Non-ACLP Trainers</p>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="p-6 mb-8 dark:bg-gray-800 dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="lg:col-span-2">
            <label htmlFor="general-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300">General Search</label>
            <div className="relative mt-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icon name={IconName.User} className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="text"
                id="general-search"
                placeholder="Search name, email..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className={`${inputClasses} pl-10`}
              />
            </div>
          </div>
          <div className="lg:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={handleResetFilters}>Reset Filters</Button>
            <Button variant="primary" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
              {showAdvancedFilters ? 'Hide' : 'Show'} Advanced Filters
            </Button>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="mt-4 pt-4 border-t dark:border-gray-700 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              {/* Trainer Type checkboxes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Trainer Type</label>
                <div className="flex flex-wrap gap-3">
                  {TRAINER_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterTrainerTypes.includes(t)}
                        onChange={() => toggleCheckbox(t, filterTrainerTypes, setFilterTrainerTypes)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{t}</span>
                    </label>
                  ))}
                </div>
                {filterTrainerTypes.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterTrainerTypes.join(', ')}</p>
                )}
              </div>

              {/* Trainer Status checkboxes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Trainer Status</label>
                <div className="flex flex-wrap gap-3">
                  {TRAINER_STATUSES.map(s => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterTrainerStatuses.includes(s)}
                        onChange={() => toggleCheckbox(s, filterTrainerStatuses, setFilterTrainerStatuses)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s}</span>
                    </label>
                  ))}
                </div>
                {filterTrainerStatuses.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterTrainerStatuses.join(', ')}</p>
                )}
              </div>

              {/* Area of Expertise dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Area of Expertise</label>
                <select
                  value={filterAreasOfExpertise[0] || ''}
                  onChange={(e) => {
                    setFilterAreasOfExpertise(e.target.value ? [e.target.value] : []);
                    setCurrentPage(1);
                  }}
                  className={inputClasses}
                >
                  <option value="">None</option>
                  {SKILLS_FUTURE_INDUSTRIES.map(area => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Results */}
      <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
        {paginatedTrainers.length > 0 ? (
          <>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Contact</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">NRIC</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer Type</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Area of Expertise</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Account Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">LinkedIn Profile</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">CV Folder</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Skill Tags</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Certification Tags</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                {paginatedTrainers.map((trainer, index) => (
                  <tr key={`${trainer.trainer_name}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div
                          className="flex-shrink-0 h-10 w-10 relative group cursor-pointer"
                          onClick={() => handleImageUploadClick(trainer.user_id)}
                          title="Click to upload profile image"
                        >
                          <img
                            className="h-10 w-10 rounded-full object-cover"
                            src={getTrainerThumbnailSrc(trainer)}
                            alt={trainer.trainer_name}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_TRAINER_AVATAR;
                            }}
                          />
                          {uploadingImageFor === trainer.user_id ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <Icon name={IconName.Upload} className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{trainer.trainer_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">{trainer.email}</div>
                      {trainer.secondary_email && (
                        <div className="text-sm text-gray-500 dark:text-gray-400">{trainer.secondary_email}</div>
                      )}
                      <div className="text-sm text-gray-500 dark:text-gray-400">{trainer.telephone || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {editingNricId === trainer.user_id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={nricEditValue}
                            onChange={e => setNricEditValue(e.target.value)}
                            placeholder="e.g. S1234567A"
                            className="w-32 px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-blue-500"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveNric(trainer.user_id);
                              if (e.key === 'Escape') setEditingNricId(null);
                            }}
                          />
                          <button
                            onClick={() => handleSaveNric(trainer.user_id)}
                            disabled={savingNric}
                            className="text-green-600 hover:text-green-800 disabled:opacity-50"
                            title="Save"
                          >
                            <Icon name={IconName.Check} className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingNricId(null)}
                            disabled={savingNric}
                            className="text-red-500 hover:text-red-700 disabled:opacity-50"
                            title="Cancel"
                          >
                            <Icon name={IconName.Close} className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-900 dark:text-white">
                            {trainer.nric && trainer.nric !== 'N/A'
                              ? (visibleNrics.has(trainer.user_id) ? trainer.nric : maskNric(trainer.nric))
                              : <span className="text-gray-400 italic">N/A</span>}
                          </span>
                          {trainer.nric && trainer.nric !== 'N/A' && (
                            <button
                              onClick={() => toggleNricVisibility(trainer.user_id)}
                              className="text-gray-400 hover:text-blue-500 transition-colors"
                              title={visibleNrics.has(trainer.user_id) ? 'Hide NRIC' : 'Show full NRIC'}
                            >
                              <Icon name={visibleNrics.has(trainer.user_id) ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingNricId(trainer.user_id);
                              setNricEditValue(trainer.nric && trainer.nric !== 'N/A' ? trainer.nric : '');
                            }}
                            className="text-gray-400 hover:text-blue-500 transition-colors"
                            title="Edit NRIC"
                          >
                            <Icon name={IconName.Edit} className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{trainer.trainer_type || 'N/A'}</td>
                    <td className="px-6 py-4">
                      {(() => {
                        const areas = Array.isArray(trainer.areas_of_expertise)
                          ? trainer.areas_of_expertise
                          : (typeof trainer.areas_of_expertise === 'string' ? JSON.parse(trainer.areas_of_expertise) : []);
                        return areas.length > 0 ? (
                          <div className="flex items-center gap-1 max-w-[200px]" title={areas.join(', ')}>
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 truncate max-w-[150px]">
                              {areas[0]}
                            </span>
                            {areas.length > 1 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">+{areas.length - 1} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500 dark:text-gray-400">N/A</span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(trainer.status)}`}>
                        {trainer.status || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getAccountStatusColor(trainer.account_status)}`}>
                        {capitalise(trainer.account_status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {trainer.linkedin_url ? (
                        <a
                          href={trainer.linkedin_url.startsWith('http') ? trainer.linkedin_url : `https://${trainer.linkedin_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1.5"
                        >
                          <Icon name={IconName.Linkedin} className="w-4 h-4" />
                          View
                        </a>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {trainer.cv_folder_url ? (
                        <a
                          href={trainer.cv_folder_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1.5"
                        >
                          <Icon name={IconName.Folder} className="w-4 h-4" />
                          Open
                        </a>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    {/* Skill Tags */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {Array.isArray(trainer.skills_tags) && trainer.skills_tags.length > 0 ? (
                        <div className="flex items-center gap-1 max-w-[200px]" title={trainer.skills_tags.join(', ')}>
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 truncate max-w-[150px]">
                            {trainer.skills_tags[0]}
                          </span>
                          {trainer.skills_tags.length > 1 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">+{trainer.skills_tags.length - 1} more</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500 dark:text-gray-400">N/A</span>
                      )}
                    </td>
                    {/* Certification Tags */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {Array.isArray(trainer.certification_tags) && trainer.certification_tags.length > 0 ? (
                        <div className="flex items-center gap-1 max-w-[200px]" title={trainer.certification_tags.join(', ')}>
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 truncate max-w-[150px]">
                            {trainer.certification_tags[0]}
                          </span>
                          {trainer.certification_tags.length > 1 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">+{trainer.certification_tags.length - 1} more</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500 dark:text-gray-400">N/A</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-2">
                        {trainer.linkedin_url ? (
                          <Button
                            variant="ghost"
                            onClick={() => handleSyncLinkedInImage(trainer)}
                            disabled={uploadingImageFor === trainer.user_id}
                            className="text-purple-600 hover:text-purple-800 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                          >
                            {uploadingImageFor === trainer.user_id ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600 mr-1" />
                            ) : (
                              <Icon name={IconName.User} className="w-4 h-4 mr-1" />
                            )}
                            {uploadingImageFor === trainer.user_id ? 'Syncing...' : 'Sync Image'}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={() => handleImageUploadClick(trainer.user_id)}
                            disabled={uploadingImageFor === trainer.user_id}
                            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          >
                            {uploadingImageFor === trainer.user_id ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-1" />
                            ) : (
                              <Icon name={IconName.Upload} className="w-4 h-4 mr-1" />
                            )}
                            {uploadingImageFor === trainer.user_id ? 'Uploading...' : 'Upload Photo'}
                          </Button>
                        )}
                        {trainer.status === 'Active' ? (
                          <Button
                            variant="ghost"
                            onClick={() => handleStatusChange(trainer, 'Inactive')}
                            className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Icon name={IconName.Close} className="w-4 h-4 mr-1" />
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={() => handleStatusChange(trainer, 'Active')}
                            className="text-green-600 hover:text-green-800 hover:bg-green-50 dark:hover:bg-green-900/20"
                          >
                            <Icon name={IconName.Check} className="w-4 h-4 mr-1" />
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="p-4 flex items-center justify-between border-t dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredTrainers.length)} of {filteredTrainers.length} trainers
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(i => i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1)
                    .reduce<(number | 'ellipsis')[]>((acc, i, idx, arr) => {
                      if (idx > 0 && i - (arr[idx - 1] as number) > 1) acc.push('ellipsis');
                      acc.push(i);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === 'ellipsis' ? (
                        <span key={`e${idx}`} className="px-2 text-gray-400">...</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setCurrentPage(item)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                            currentPage === item
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <Icon name={IconName.User} className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No trainers found</h3>
            <p className="text-gray-500 mb-6 dark:text-gray-400">
              {trainers.length === 0
                ? "There are no trainers in the system yet."
                : "No trainers match your current search criteria."}
            </p>
          </div>
        )}
      </Card>

      {/* Status Update Confirmation Dialog */}
      {showStatusConfirmation && selectedTrainer && targetStatus && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-auto">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${targetStatus === 'Active' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                  <Icon
                    name={targetStatus === 'Active' ? IconName.Check : IconName.Close}
                    className={`w-6 h-6 ${targetStatus === 'Active' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                  />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {targetStatus === 'Active' ? 'Activate' : 'Deactivate'} Trainer
                </h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to {targetStatus.toLowerCase()} the trainer{' '}
                <strong>"{selectedTrainer.trainer_name}"</strong>?
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => { setShowStatusConfirmation(false); setSelectedTrainer(null); setTargetStatus(null); }}
                  disabled={isUpdatingStatus}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmStatusUpdate}
                  disabled={isUpdatingStatus}
                  className={`${targetStatus === 'Active' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                >
                  {isUpdatingStatus ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Updating...
                    </>
                  ) : (
                    `${targetStatus === 'Active' ? 'Activate' : 'Deactivate'} Trainer`
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewTrainers;
