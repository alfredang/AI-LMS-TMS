import React, { useState, useEffect, useCallback } from 'react';
import {
    Gender, Nationality, Ethnicity, DeveloperType, TrainerType, TrainerQualification,
    TrainerEducation, DeveloperEducation, WorkExperienceItem, Certification,
    SKILLS_FUTURE_INDUSTRIES
} from '@app-types/profile';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import Spinner from './ui/Spinner';
import { useLms } from '@contexts/LmsContext';
import { UserRole } from '@app-types/index';
import { ensureAbsoluteImageUrl } from '@utils/imageUtils';
import { getApiUrl, getUploadUrl, getDeleteFileUrl, getProfileImageImportUrl, stripBaseUrl } from '@/lib/urlHelpers';
import { ThemeMode, getCurrentTheme, applyTheme } from '@utils/colorUtils';
import { maskNric, formatDate, formatDateForInput } from '../utils';

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

const FALLBACK_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K';

// --- Shared sub-components ---

const ProfileBioItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <p className="text-sm text-subtle dark:text-gray-400">{label}</p>
        <p className="font-semibold text-on-surface break-words dark:text-gray-200">{value || '—'}</p>
    </div>
);

const MultiSelectCheckboxes: React.FC<{
    options: string[]; selected: string[]; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isEditing: boolean; color: 'primary' | 'secondary';
}> = ({ options, selected, onChange, isEditing, color }) => {
    const colorClasses = { primary: { ring: 'focus:ring-primary', text: 'text-primary' }, secondary: { ring: 'focus:ring-secondary', text: 'text-secondary' } };
    if (isEditing) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-h-60 overflow-y-auto p-4 border rounded-md dark:border-gray-700">
                {options.map(option => (
                    <div key={option} className="flex items-center">
                        <input type="checkbox" id={`option-${option}`} value={option} checked={selected.includes(option)}
                            onChange={onChange} className={`h-4 w-4 ${colorClasses[color].text} ${colorClasses[color].ring} border-gray-300 rounded`} />
                        <label htmlFor={`option-${option}`} className="ml-2 text-sm text-gray-900 dark:text-gray-200">{option}</label>
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div className="flex flex-wrap gap-2">
            {selected.map(item => (
                <span key={item} className={`text-sm font-medium px-3 py-1.5 rounded-full ${color === 'primary' ? 'bg-indigo-100 text-indigo-800' : 'bg-green-100 text-green-800'}`}>{item}</span>
            ))}
            {selected.length === 0 && <p className="text-subtle text-sm">Not specified.</p>}
        </div>
    );
};

const SingleSelectEducation: React.FC<{ options: string[]; selected: string; onChange: (v: string) => void; isEditing: boolean }> = ({ options, selected, onChange, isEditing }) => {
    if (isEditing) {
        return (<select value={selected || ''} onChange={(e) => onChange(e.target.value)} className={inputClasses}>
            <option value="">Select highest education</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>);
    }
    return selected ? <span className="text-sm font-medium px-3 py-1.5 rounded-full bg-green-100 text-green-800">{selected}</span> : <p className="text-subtle text-sm">Not specified.</p>;
};

// Work Experience Section
const WorkExperienceSection: React.FC<{
    experience: WorkExperienceItem[]; isEditing: boolean; onUpdate: (newExp: WorkExperienceItem[]) => void;
}> = ({ experience, isEditing, onUpdate }) => {
    if (isEditing) {
        return (
            <div className="space-y-4">
                {experience.map((item, index) => {
                    const isPresent = item.endDate === 'Present';
                    return (
                        <div key={item.id || index} className="p-4 border rounded-md relative group dark:border-gray-700">
                            <div className="grid grid-cols-2 gap-4">
                                <input type="text" placeholder="Job Title" value={item.jobTitle}
                                    onChange={e => { const u = [...experience]; u[index] = { ...item, jobTitle: e.target.value }; onUpdate(u); }}
                                    className={`${inputClasses} col-span-2`} />
                                <input type="text" placeholder="Company" value={item.company}
                                    onChange={e => { const u = [...experience]; u[index] = { ...item, company: e.target.value }; onUpdate(u); }}
                                    className={inputClasses} />
                                <input type="text" placeholder="Start Date (YYYY-MM)" value={item.startDate}
                                    onChange={e => { const u = [...experience]; u[index] = { ...u[index], startDate: e.target.value }; onUpdate(u); }}
                                    className={inputClasses} />
                                <div className="flex items-center gap-2">
                                    <input type="text" placeholder="End Date (YYYY-MM)" value={isPresent ? '' : (item.endDate || '')}
                                        onChange={e => { const u = [...experience]; u[index] = { ...u[index], endDate: e.target.value }; onUpdate(u); }}
                                        className={`${inputClasses} flex-1`} disabled={isPresent} />
                                    <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                                        <input type="checkbox" checked={isPresent}
                                            onChange={() => { const u = [...experience]; u[index] = { ...u[index], endDate: isPresent ? '' : 'Present' }; onUpdate(u); }}
                                            className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" /> Present
                                    </label>
                                </div>
                                <textarea placeholder="Description" value={item.description}
                                    onChange={e => { const u = [...experience]; u[index] = { ...item, description: e.target.value }; onUpdate(u); }}
                                    className={`${inputClasses} col-span-2 h-20`} />
                            </div>
                            <button onClick={() => onUpdate(experience.filter((_, i) => i !== index))}
                                className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                <Icon name={IconName.Delete} className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
                <Button variant="ghost" size="sm" onClick={() => onUpdate([...experience, { id: `we_${Date.now()}`, jobTitle: '', company: '', startDate: '', endDate: '', description: '' }])}>
                    + Add Experience
                </Button>
            </div>
        );
    }
    return (
        <div className="space-y-4">
            {experience.map((item, index) => {
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

// Skills Tags Input Component
const MAX_SKILL_TAGS = 20;
const SkillTagsInput: React.FC<{
    tags: string[]; isEditing: boolean; onUpdate: (tags: string[]) => void;
}> = ({ tags, isEditing, onUpdate }) => {
    const [inputValue, setInputValue] = React.useState('');

    const addTag = () => {
        const tag = inputValue.trim().toLowerCase();
        if (!tag || tags.length >= MAX_SKILL_TAGS || tags.includes(tag)) { setInputValue(''); return; }
        onUpdate([...tags, tag]);
        setInputValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
        if (e.key === 'Backspace' && !inputValue && tags.length > 0) { onUpdate(tags.slice(0, -1)); }
    };

    if (!isEditing) {
        return tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                    <span key={i} className="px-3 py-1 text-sm rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">{tag}</span>
                ))}
            </div>
        ) : <p className="text-subtle text-sm">No skills added.</p>;
    }

    return (
        <div>
            <div className="flex flex-wrap gap-2 p-3 min-h-[44px] border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600">
                {tags.map((tag, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                        {tag}
                        <button type="button" onClick={() => onUpdate(tags.filter((_, idx) => idx !== i))}
                            className="ml-0.5 hover:text-red-600 dark:hover:text-red-400 font-bold text-base leading-none">&times;</button>
                    </span>
                ))}
                {tags.length < MAX_SKILL_TAGS && (
                    <input
                        type="text" value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown} onBlur={addTag}
                        placeholder={tags.length === 0 ? 'Type a skill and press Enter' : 'Add more...'}
                        className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white dark:placeholder-gray-400"
                    />
                )}
            </div>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{tags.length}/{MAX_SKILL_TAGS} tags. Press Enter or comma to add.</p>
        </div>
    );
};

// Document Section
const DocumentSection: React.FC<{
    title: string; cvUrl?: string; cvOriginalFilename?: string; cvFolderUrl?: string; certifications: any[];
    isEditing: boolean; onUpdateCvFolderUrl?: (url: string) => void;
}> = ({ title, cvUrl, cvOriginalFilename, cvFolderUrl, certifications, isEditing, onUpdateCvFolderUrl }) => {

    if (isEditing) {
        return (
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">CV & Documents Folder</label>
                    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md border dark:bg-gray-700 dark:border-gray-600">
                        <Icon name={IconName.Folder} className="w-5 h-5 text-blue-500" />
                        <input type="url" placeholder="Paste Google Drive folder URL" value={cvFolderUrl || ''}
                            onChange={(e) => onUpdateCvFolderUrl?.(e.target.value)}
                            className={`${inputClasses} !py-1.5 !text-sm flex-1`} />
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
        );
    }

    return (
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
                    <a href={cvFolderUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors">
                        <Icon name={IconName.ExternalLink} className="w-3 h-3" /> Open Folder
                    </a>
                </div>
            )}
            {cvUrl && (
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md border dark:bg-gray-700/50 dark:border-gray-600">
                    <div className="flex items-center gap-3"><Icon name={IconName.FilePdf} className="w-6 h-6 text-red-600 flex-shrink-0" /><p className="text-sm font-medium text-gray-900 dark:text-gray-200">Curriculum Vitae</p></div>
                    <a href={getApiUrl(`/api/download${stripBaseUrl(cvUrl) || cvUrl || ''}`)} download={cvOriginalFilename || 'CV.pdf'}
                        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors">
                        <Icon name={IconName.Download} className="w-3 h-3" /> Download
                    </a>
                </div>
            )}
            {certifications && certifications.length > 0 && certifications.map(cert => (
                <div key={cert.id || cert.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-md border dark:bg-gray-700/50 dark:border-gray-600">
                    <div className="flex items-center gap-3"><Icon name={IconName.FilePdf} className="w-6 h-6 text-red-600 flex-shrink-0" /><p className="text-sm font-medium text-gray-900 dark:text-gray-200">{cert.name}</p></div>
                    <a href={getApiUrl(`/api/download${stripBaseUrl(cert.fileUrl) || cert.fileUrl || ''}`)} download={cert.originalFilename || cert.name}
                        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors">
                        <Icon name={IconName.Download} className="w-3 h-3" /> Download
                    </a>
                </div>
            ))}
            {!cvFolderUrl && !cvUrl && (!certifications || certifications.length === 0) && <p className="text-subtle text-sm">No documents uploaded.</p>}
        </div>
    );
};

// Login Details Card
const LoginDetailsCard: React.FC<{ loginId: string; password: string; userId?: string; onPasswordUpdate?: (p: string) => void }> = ({ loginId, password, userId, onPasswordUpdate }) => {
    const { currentUser } = useLms();
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    const handleResetPassword = async () => {
        if (!newPassword.trim()) { alert('Please enter a new password'); return; }
        if (newPassword.length < 6) { alert('Password must be at least 6 characters long'); return; }
        try {
            setIsUpdating(true);
            if (!currentUser?.id) throw new Error('No authenticated user found');
            const response = await fetch(getApiUrl('/api/auth/update-password'), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id, newPassword })
            });
            if (!response.ok) throw new Error(`Password update failed: ${response.status}`);
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'Password update failed');
            alert('Password reset successfully!'); setIsResetting(false); setNewPassword('');
            if (onPasswordUpdate) onPasswordUpdate(newPassword);
        } catch (error) {
            alert(`Failed to reset password: ${error instanceof Error ? error.message : 'Please try again.'}`);
        } finally { setIsUpdating(false); }
    };

    return (
        <Card className="p-8 mt-8">
            <h2 className="text-xl font-bold mb-4">Login Details</h2>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 flex-grow">
                    <div><p className="text-sm text-subtle">Login ID</p><p className="font-semibold text-on-surface break-words">{loginId}</p></div>
                    <div>
                        <p className="text-sm text-subtle">Password</p>
                        <div className="flex items-end gap-2">
                            <div className="flex items-center gap-2 flex-grow">
                                {isResetting ? (
                                    <><input type={isPasswordVisible ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                                        className={`${inputClasses} tracking-wider`} placeholder="Enter new password" />
                                        <button type="button" onClick={() => setIsPasswordVisible(!isPasswordVisible)} className="text-subtle hover:text-primary p-1 rounded-full">
                                            <Icon name={isPasswordVisible ? IconName.EyeOff : IconName.Eye} className="w-5 h-5" />
                                        </button></>
                                ) : (<p className="font-semibold text-on-surface tracking-wider">••••••••••••••••</p>)}
                            </div>
                            {isResetting ? (
                                <div className="flex items-end gap-2 flex-shrink-0">
                                    <Button variant="ghost" onClick={() => { setIsResetting(false); setNewPassword(""); }} disabled={isUpdating}>Cancel</Button>
                                    <Button onClick={handleResetPassword} disabled={isUpdating}>{isUpdating ? <Spinner size="sm" /> : 'Save'}</Button>
                                </div>
                            ) : (
                                <Button variant="ghost" className="border border-gray-300 flex-shrink-0" onClick={() => setIsResetting(true)}>Reset Password</Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

// ========== Types ==========
interface SharedData {
    id: string; name: string; email: string; loginId: string; secondaryEmail: string;
    profilePictureUrl: string; password: string; tel: string; gender: string;
    linkedinUrl: string; nric: string; nationality: string; ethnicity: string; dob: string;
}
interface TrainerRoleData {
    trainerType: string; status: string; cvUrl: string; cvOriginalFilename: string; cvFolderUrl: string;
    qualifications: string[]; education: string; areasOfExpertise: string[]; skillsTags: string[]; certificationTags: string[];
    commonName: string; country: string; cnPlusEmail: string;
    workExperience: WorkExperienceItem[]; certifications: Certification[];
}
interface DeveloperRoleData {
    developerType: string; cvUrl: string; cvOriginalFilename: string; cvFolderUrl: string;
    qualifications: string[]; education: string; areasOfSpecialty: string[]; skillsTags: string[]; certificationTags: string[];
    workExperience: WorkExperienceItem[]; certifications: Certification[];
}
interface MultiRoleProfileData {
    roles: string[];
    shared: SharedData;
    trainer?: TrainerRoleData;
    developer?: DeveloperRoleData;
}

// ========== Main Component ==========
export const MultiRoleProfileCard: React.FC = () => {
    const { currentUser, updateCurrentUserProfile, role } = useLms();
    const [data, setData] = useState<MultiRoleProfileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Editable form state
    const [sharedForm, setSharedForm] = useState<SharedData | null>(null);
    const [trainerForm, setTrainerForm] = useState<TrainerRoleData | null>(null);
    const [developerForm, setDeveloperForm] = useState<DeveloperRoleData | null>(null);

    // Photo state
    const [selectedProfilePictureFile, setSelectedProfilePictureFile] = useState<File | null>(null);
    const [profilePicturePreviewUrl, setProfilePicturePreviewUrl] = useState<string | null>(null);
    const [profileImageLink, setProfileImageLink] = useState('');

    // File pending state for trainer
    const [trainerPendingCv, setTrainerPendingCv] = useState<File | null>(null);
    const [trainerPendingCertsAdd, setTrainerPendingCertsAdd] = useState<Array<{ name: string; file: File; tempId: string }>>([]);
    const [trainerPendingCertsDel, setTrainerPendingCertsDel] = useState<string[]>([]);
    const [trainerCertFilesToDel, setTrainerCertFilesToDel] = useState<Array<{ id: string; fileUrl: string; name: string }>>([]);

    // File pending state for developer
    const [devPendingCv, setDevPendingCv] = useState<File | null>(null);
    const [devPendingCertsAdd, setDevPendingCertsAdd] = useState<Array<{ name: string; file: File; tempId: string }>>([]);
    const [devPendingCertsDel, setDevPendingCertsDel] = useState<string[]>([]);
    const [devCertFilesToDel, setDevCertFilesToDel] = useState<Array<{ id: string; fileUrl: string; name: string }>>([]);

    const [themeMode, setThemeMode] = useState<ThemeMode>(() => getCurrentTheme());

    const fetchProfile = useCallback(async () => {
        if (!currentUser?.id) return;
        setLoading(true);
        try {
            const res = await fetch(getApiUrl(`/api/profile/multi-role?userId=${currentUser.id}`));
            const json = await res.json();
            if (json.success) {
                setData(json.data);
                setSharedForm(json.data.shared);
                setTrainerForm(json.data.trainer || null);
                setDeveloperForm(json.data.developer || null);
                setProfileImageLink(json.data.shared?.profilePictureUrl || '');
            }
        } catch (e) { console.error('Failed to fetch multi-role profile:', e); }
        finally { setLoading(false); }
    }, [currentUser?.id]);

    useEffect(() => { fetchProfile(); }, [fetchProfile]);

    // Sync header avatar
    useEffect(() => {
        if (data?.shared?.profilePictureUrl) {
            updateCurrentUserProfile({ profilePictureUrl: data.shared.profilePictureUrl, name: data.shared.name });
        }
    }, [data?.shared?.profilePictureUrl]);

    if (loading || !data || !sharedForm) {
        return (
            <div className="flex items-center justify-center py-24 bg-background">
                <div className="text-center"><Spinner size="lg" /><p className="mt-4 text-sm text-on-surface-secondary">Loading profile...</p></div>
            </div>
        );
    }

    const hasTrainer = !!data.trainer;
    const hasDeveloper = !!data.developer;

    const handleSharedChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setSharedForm(prev => prev ? { ...prev, [e.target.name]: e.target.value } : prev);
    };

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (!file.type.startsWith('image/')) { alert('Please select a valid image file.'); return; }
            if (file.size > 5 * 1024 * 1024) { alert('File size must be less than 5MB.'); return; }
            setSelectedProfilePictureFile(file);
            setProfileImageLink('');
            const reader = new FileReader();
            reader.onloadend = () => { setProfilePicturePreviewUrl(reader.result as string); };
            reader.readAsDataURL(file);
        }
    };

    const handleThemeToggle = () => {
        const newTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
        setThemeMode(newTheme); applyTheme(newTheme);
    };

    const handlePasswordUpdate = (newPassword: string) => {
        setSharedForm(prev => prev ? { ...prev, password: newPassword } : prev);
    };

    // --- Trainer handlers ---
    const handleTrainerMultiSelect = (field: 'areasOfExpertise' | 'qualifications') => (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = e.target;
        setTrainerForm(prev => {
            if (!prev) return prev;
            const cur = prev[field] || [];
            return { ...prev, [field]: checked ? [...cur, value].filter((v, i, a) => a.indexOf(v) === i) : cur.filter(i => i !== value) };
        });
    };
    const handleTrainerCvUpdate = (file: File) => {
        setTrainerPendingCv(file);
        setTrainerForm(prev => prev ? { ...prev, cvOriginalFilename: file.name } : prev);
    };
    const handleTrainerAddCert = (name: string, file: File) => {
        const tempId = `temp_t_${Date.now()}`;
        setTrainerPendingCertsAdd(prev => [...prev, { name, file, tempId }]);
        setTrainerForm(prev => prev ? { ...prev, certifications: [...(prev.certifications || []), { id: tempId, name, fileUrl: '', originalFilename: file.name }] } : prev);
    };
    const handleTrainerRemoveCert = (id: string) => {
        if (id.startsWith('temp_')) {
            setTrainerPendingCertsAdd(prev => prev.filter(c => c.tempId !== id));
        } else {
            const cert = trainerForm?.certifications?.find(c => c.id === id);
            if (cert?.fileUrl) setTrainerCertFilesToDel(prev => [...prev, { id, fileUrl: cert.fileUrl, name: cert.name }]);
            setTrainerPendingCertsDel(prev => [...prev, id]);
        }
        setTrainerForm(prev => prev ? { ...prev, certifications: (prev.certifications || []).filter(c => c.id !== id) } : prev);
    };

    // --- Developer handlers ---
    const handleDevMultiSelect = (field: 'areasOfSpecialty' | 'qualifications') => (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value, checked } = e.target;
        setDeveloperForm(prev => {
            if (!prev) return prev;
            const cur = prev[field] || [];
            return { ...prev, [field]: checked ? [...cur, value].filter((v, i, a) => a.indexOf(v) === i) : cur.filter(i => i !== value) };
        });
    };
    const handleDevCvUpdate = (file: File) => {
        setDevPendingCv(file);
        setDeveloperForm(prev => prev ? { ...prev, cvOriginalFilename: file.name } : prev);
    };
    const handleDevAddCert = (name: string, file: File) => {
        const tempId = `temp_d_${Date.now()}`;
        setDevPendingCertsAdd(prev => [...prev, { name, file, tempId }]);
        setDeveloperForm(prev => prev ? { ...prev, certifications: [...(prev.certifications || []), { id: tempId, name, fileUrl: '', originalFilename: file.name }] } : prev);
    };
    const handleDevRemoveCert = (id: string) => {
        if (id.startsWith('temp_')) {
            setDevPendingCertsAdd(prev => prev.filter(c => c.tempId !== id));
        } else {
            const cert = developerForm?.certifications?.find(c => c.id === id);
            if (cert?.fileUrl) setDevCertFilesToDel(prev => [...prev, { id, fileUrl: cert.fileUrl, name: cert.name }]);
            setDevPendingCertsDel(prev => [...prev, id]);
        }
        setDeveloperForm(prev => prev ? { ...prev, certifications: (prev.certifications || []).filter(c => c.id !== id) } : prev);
    };

    const handleCancel = () => {
        setSharedForm(data.shared);
        setTrainerForm(data.trainer || null);
        setDeveloperForm(data.developer || null);
        setSelectedProfilePictureFile(null); setProfilePicturePreviewUrl(null);
        setTrainerPendingCv(null); setTrainerPendingCertsAdd([]); setTrainerPendingCertsDel([]); setTrainerCertFilesToDel([]);
        setDevPendingCv(null); setDevPendingCertsAdd([]); setDevPendingCertsDel([]); setDevCertFilesToDel([]);
        setProfileImageLink(data.shared.profilePictureUrl || '');
        setIsEditing(false);
    };

    // ========== SAVE ==========
    const handleSave = async () => {
        if (!currentUser?.id || !sharedForm) return;
        setIsSaving(true);
        try {
            // Helper to upload file
            const uploadFile = async (role: string, type: string, file: File) => {
                const fd = new FormData(); fd.append('file', file); fd.append('originalFilename', file.name);
                const res = await fetch(getUploadUrl(role, type), { method: 'POST', body: fd });
                if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
                const r = await res.json();
                if (!r.success) throw new Error(r.error || 'Upload failed');
                return r.data;
            };

            // Helper to delete file
            const deleteFile = async (url: string) => {
                try { const p = url.startsWith('http') ? stripBaseUrl(url) || url : url; await fetch(getDeleteFileUrl(p), { method: 'DELETE' }); } catch { }
            };

            // 1. Upload profile picture if changed
            let newProfilePicUrl: string | undefined;
            if (profileImageLink.trim()) {
                const response = await fetch(getProfileImageImportUrl('trainer', currentUser.id), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sourceUrl: profileImageLink.trim() })
                });
                if (!response.ok) throw new Error(`Profile image URL import failed: ${response.statusText}`);
                const result = await response.json();
                if (!result.success) throw new Error(result.error || 'Profile image URL import failed');
                newProfilePicUrl = result.data.fileUrl.startsWith('http') ? stripBaseUrl(result.data.fileUrl) || result.data.fileUrl : result.data.fileUrl;
                setProfileImageLink(newProfilePicUrl);
            } else if (selectedProfilePictureFile) {
                if (data.shared.profilePictureUrl?.includes('uploads/')) await deleteFile(data.shared.profilePictureUrl);
                const result = await uploadFile('trainer', 'profilePicture', selectedProfilePictureFile);
                newProfilePicUrl = result.fileUrl.startsWith('http') ? stripBaseUrl(result.fileUrl) || result.fileUrl : result.fileUrl;
                setProfileImageLink(newProfilePicUrl);
            }

            // 2. Save trainer profile
            if (hasTrainer && trainerForm) {
                const trainerUpdate: any = {};

                // Upload trainer CV
                if (trainerPendingCv) {
                    if (data.trainer?.cvUrl?.includes('uploads/')) await deleteFile(data.trainer.cvUrl);
                    const r = await uploadFile('trainer', 'cv', trainerPendingCv);
                    trainerUpdate.cvUrl = r.fileUrl; trainerUpdate.cvOriginalFilename = r.originalFilename;
                }

                // Upload trainer certs
                const newTrainerCerts = [];
                for (const c of trainerPendingCertsAdd) {
                    const r = await uploadFile('trainer', 'certification', c.file);
                    newTrainerCerts.push({ name: c.name, fileUrl: r.fileUrl, originalFilename: r.originalFilename });
                }
                if (newTrainerCerts.length > 0) trainerUpdate.newCertifications = newTrainerCerts;
                if (trainerPendingCertsDel.length > 0) trainerUpdate.certificationsToDelete = trainerPendingCertsDel;

                // Shared fields that go to trainer_profile
                if (sharedForm.tel !== data.shared.tel) trainerUpdate.tel = sharedForm.tel;
                if (sharedForm.gender !== data.shared.gender) trainerUpdate.gender = sharedForm.gender;
                if (sharedForm.nric !== data.shared.nric) trainerUpdate.nric = sharedForm.nric;
                if (sharedForm.nationality !== data.shared.nationality) trainerUpdate.nationality = sharedForm.nationality;
                if (sharedForm.ethnicity !== data.shared.ethnicity) trainerUpdate.ethnicity = sharedForm.ethnicity;
                if (sharedForm.dob !== data.shared.dob) trainerUpdate.dob = sharedForm.dob;
                if (sharedForm.linkedinUrl !== data.shared.linkedinUrl) trainerUpdate.linkedinUrl = sharedForm.linkedinUrl;

                // Trainer-specific fields
                if (trainerForm.trainerType !== data.trainer?.trainerType) trainerUpdate.trainerType = trainerForm.trainerType;
                if (trainerForm.cvFolderUrl !== data.trainer?.cvFolderUrl) trainerUpdate.cvFolderUrl = trainerForm.cvFolderUrl;
                if (trainerForm.education !== data.trainer?.education) trainerUpdate.education = trainerForm.education;
                if (JSON.stringify(trainerForm.qualifications) !== JSON.stringify(data.trainer?.qualifications)) trainerUpdate.qualifications = trainerForm.qualifications;
                if (JSON.stringify(trainerForm.areasOfExpertise) !== JSON.stringify(data.trainer?.areasOfExpertise)) trainerUpdate.areasOfExpertise = trainerForm.areasOfExpertise;
                if (JSON.stringify(trainerForm.skillsTags) !== JSON.stringify(data.trainer?.skillsTags)) trainerUpdate.skillsTags = trainerForm.skillsTags;
                if (JSON.stringify(trainerForm.certificationTags) !== JSON.stringify(data.trainer?.certificationTags)) trainerUpdate.certificationTags = trainerForm.certificationTags;
                if (JSON.stringify(trainerForm.workExperience) !== JSON.stringify(data.trainer?.workExperience)) trainerUpdate.workExperience = trainerForm.workExperience;

                // app_user fields
                const appUserChanges: any = {};
                if (sharedForm.name !== data.shared.name) appUserChanges.name = sharedForm.name;
                if (sharedForm.email !== data.shared.email) appUserChanges.email = sharedForm.email;
                if (sharedForm.secondaryEmail !== data.shared.secondaryEmail) appUserChanges.secondaryEmail = sharedForm.secondaryEmail;
                if (newProfilePicUrl) appUserChanges.profilePictureUrl = newProfilePicUrl;

                const allTrainerChanges = { ...trainerUpdate, ...appUserChanges };
                if (Object.keys(allTrainerChanges).length > 0) {
                    const res = await fetch(getApiUrl('/api/profile/update-trainer'), {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: currentUser.id, profileData: allTrainerChanges })
                    });
                    if (!res.ok) throw new Error(`Trainer update failed: ${res.status}`);
                    const result = await res.json();
                    if (!result.success) throw new Error(result.message || 'Trainer update failed');
                }

                // Delete old cert files
                for (const cf of trainerCertFilesToDel) await deleteFile(cf.fileUrl);
            }

            // 3. Save developer profile
            if (hasDeveloper && developerForm) {
                const devUpdate: any = {};

                // Upload developer CV
                if (devPendingCv) {
                    if (data.developer?.cvUrl?.includes('uploads/')) await deleteFile(data.developer.cvUrl);
                    const r = await uploadFile('developer', 'cv', devPendingCv);
                    devUpdate.cvUrl = r.fileUrl; devUpdate.cvOriginalFilename = r.originalFilename;
                }

                // Upload developer certs
                const newDevCerts = [];
                for (const c of devPendingCertsAdd) {
                    const r = await uploadFile('developer', 'certification', c.file);
                    newDevCerts.push({ name: c.name, fileUrl: r.fileUrl, originalFilename: r.originalFilename });
                }
                if (newDevCerts.length > 0) devUpdate.newCertifications = newDevCerts;
                if (devPendingCertsDel.length > 0) devUpdate.certificationsToDelete = devPendingCertsDel;

                // Shared fields that go to developer_profile
                if (sharedForm.tel !== data.shared.tel) devUpdate.tel = sharedForm.tel;
                if (sharedForm.gender !== data.shared.gender) devUpdate.gender = sharedForm.gender;
                if (sharedForm.nric !== data.shared.nric) devUpdate.nric = sharedForm.nric;
                if (sharedForm.nationality !== data.shared.nationality) devUpdate.nationality = sharedForm.nationality;
                if (sharedForm.ethnicity !== data.shared.ethnicity) devUpdate.ethnicity = sharedForm.ethnicity;
                if (sharedForm.dob !== data.shared.dob) devUpdate.dob = sharedForm.dob;
                if (sharedForm.linkedinUrl !== data.shared.linkedinUrl) devUpdate.linkedinUrl = sharedForm.linkedinUrl;

                // Developer-specific fields
                if (developerForm.developerType !== data.developer?.developerType) devUpdate.developerType = developerForm.developerType;
                if (developerForm.cvFolderUrl !== data.developer?.cvFolderUrl) devUpdate.cvFolderUrl = developerForm.cvFolderUrl;
                if (developerForm.education !== data.developer?.education) devUpdate.education = developerForm.education;
                if (JSON.stringify(developerForm.qualifications) !== JSON.stringify(data.developer?.qualifications)) devUpdate.qualifications = developerForm.qualifications;
                if (JSON.stringify(developerForm.areasOfSpecialty) !== JSON.stringify(data.developer?.areasOfSpecialty)) devUpdate.areasOfSpecialty = developerForm.areasOfSpecialty;
                if (JSON.stringify(developerForm.skillsTags) !== JSON.stringify(data.developer?.skillsTags)) devUpdate.skillsTags = developerForm.skillsTags;
                if (JSON.stringify(developerForm.workExperience) !== JSON.stringify(data.developer?.workExperience)) devUpdate.workExperience = developerForm.workExperience;

                // app_user fields (only if trainer didn't already save them)
                if (!hasTrainer) {
                    if (sharedForm.name !== data.shared.name) devUpdate.name = sharedForm.name;
                    if (sharedForm.email !== data.shared.email) devUpdate.email = sharedForm.email;
                    if (sharedForm.secondaryEmail !== data.shared.secondaryEmail) devUpdate.secondaryEmail = sharedForm.secondaryEmail;
                    if (newProfilePicUrl) devUpdate.profilePictureUrl = newProfilePicUrl;
                }

                if (Object.keys(devUpdate).length > 0) {
                    const res = await fetch(getApiUrl('/api/profile/update-developer'), {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: currentUser.id, profileData: devUpdate })
                    });
                    if (!res.ok) throw new Error(`Developer update failed: ${res.status}`);
                    const result = await res.json();
                    if (!result.success) throw new Error(result.message || 'Developer update failed');
                }

                // Delete old cert files
                for (const cf of devCertFilesToDel) await deleteFile(cf.fileUrl);
            }

            // 4. Cleanup & refresh
            setSelectedProfilePictureFile(null); setProfilePicturePreviewUrl(null);
            setTrainerPendingCv(null); setTrainerPendingCertsAdd([]); setTrainerPendingCertsDel([]); setTrainerCertFilesToDel([]);
            setDevPendingCv(null); setDevPendingCertsAdd([]); setDevPendingCertsDel([]); setDevCertFilesToDel([]);
            if (!newProfilePicUrl) setProfileImageLink(sharedForm.profilePictureUrl || '');
            setIsEditing(false);
            alert('Profile saved successfully!');
            await fetchProfile();

        } catch (error) {
            console.error('❌ Failed to save multi-role profile:', error);
            alert(`Failed to save profile: ${error instanceof Error ? error.message : 'Please try again.'}`);
        } finally { setIsSaving(false); }
    };

    const roleLabels = data.roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' & ');

    return (
        <div className="max-w-5xl mx-auto">
            {/* ===== SHARED BIO DATA ===== */}
            <Card className="p-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="flex-shrink-0 text-center">
                        <div className="relative group w-24 h-24">
                            <img src={profilePicturePreviewUrl || (isEditing && profileImageLink.trim() ? ensureAbsoluteImageUrl(profileImageLink.trim()) : undefined) || ensureAbsoluteImageUrl(sharedForm.profilePictureUrl) || FALLBACK_AVATAR}
                                alt={sharedForm.name} className="w-24 h-24 rounded-full object-cover ring-4 ring-secondary/20"
                                onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }} />
                            {isEditing && (
                                <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <label htmlFor="photo-upload-multi" className="cursor-pointer"><Icon name={IconName.Upload} className="w-6 h-6 text-white" /></label>
                                </div>
                            )}
                        </div>
                        {isEditing && <input type="file" id="photo-upload-multi" accept="image/*" onChange={handlePhotoChange} className="hidden" />}
                    </div>
                    <div className="text-center sm:text-left flex-grow">
                        <h1 className="text-2xl font-bold text-on-surface">{sharedForm.name}</h1>
                        <p className="text-subtle">{roleLabels} Profile</p>
                        <div className="flex gap-2 mt-1">
                            {data.roles.map(role => (
                                <span key={role} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${role.toLowerCase() === 'trainer' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                                    {role}
                                </span>
                            ))}
                        </div>
                    </div>
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={handleCancel} disabled={isSaving}>Cancel</Button>
                            <Button variant="primary" onClick={handleSave} disabled={isSaving}>{isSaving ? <Spinner size="sm" /> : 'Save Changes'}</Button>
                        </div>
                    ) : (
                        <Button variant="primary" onClick={() => setIsEditing(true)}>Edit Profile</Button>
                    )}
                </div>
                <div className="border-t my-6"></div>

                {/* Shared Bio Data */}
                <div className="space-y-6">
                    <section>
                        <h2 className="text-xl font-bold mb-4">Bio Data</h2>
                        {isEditing ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                                <div><label className="text-sm font-medium">Name</label><input type="text" name="name" value={sharedForm.name} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Phone</label><input type="tel" name="tel" value={sharedForm.tel} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Email</label><input type="email" name="email" value={sharedForm.email} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Secondary Email</label><input type="email" name="secondaryEmail" value={sharedForm.secondaryEmail} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Gender</label><select name="gender" value={sharedForm.gender} onChange={handleSharedChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Gender).map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                                <div><label className="text-sm font-medium">Race</label><select name="ethnicity" value={sharedForm.ethnicity} onChange={handleSharedChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Ethnicity).map(e => <option key={e} value={e}>{e}</option>)}</select></div>
                                <div><label className="text-sm font-medium">Nationality</label><select name="nationality" value={sharedForm.nationality} onChange={handleSharedChange} className={inputClasses}><option value="">— Select —</option>{Object.values(Nationality).map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                                <div><label className="text-sm font-medium">NRIC</label><input type="text" name="nric" value={sharedForm.nric} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Date of Birth</label><input type="date" name="dob" value={formatDateForInput(sharedForm.dob)} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">LinkedIn Profile</label><input type="url" name="linkedinUrl" value={sharedForm.linkedinUrl} onChange={handleSharedChange} className={inputClasses} /></div>
                                <div><label className="text-sm font-medium">Profile Image Link</label><input type="url" value={profileImageLink} onChange={(e) => { setProfileImageLink(e.target.value); if (e.target.value.trim()) { setSelectedProfilePictureFile(null); setProfilePicturePreviewUrl(null); } }} placeholder="Paste image URL to save into Google Drive" className={inputClasses} /></div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                                <ProfileBioItem label="Name" value={sharedForm.name} />
                                <ProfileBioItem label="Phone" value={sharedForm.tel} />
                                <ProfileBioItem label="Email" value={sharedForm.email} />
                                <ProfileBioItem label="Secondary Email" value={sharedForm.secondaryEmail || '—'} />
                                <ProfileBioItem label="Gender" value={sharedForm.gender || '—'} />
                                <ProfileBioItem label="Race" value={sharedForm.ethnicity || '—'} />
                                <ProfileBioItem label="Nationality" value={sharedForm.nationality || '—'} />
                                <ProfileBioItem label="NRIC" value={sharedForm.nric ? maskNric(sharedForm.nric) : '—'} />
                                <ProfileBioItem label="Date of Birth" value={sharedForm.dob ? formatDate(sharedForm.dob) : '—'} />
                                {sharedForm.linkedinUrl && (
                                    <ProfileBioItem label="LinkedIn Profile" value={
                                        <a href={sharedForm.linkedinUrl.startsWith('http') ? sharedForm.linkedinUrl : `https://${sharedForm.linkedinUrl}`}
                                            target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1.5">
                                            <Icon name={IconName.Linkedin} className="w-4 h-4" /> View Profile
                                        </a>
                                    } />
                                )}
                            </div>
                        )}
                    </section>
                </div>

            </Card>

            {/* ===== TRAINER SECTION ===== */}
            {hasTrainer && trainerForm && role !== UserRole.Developer && (
                <Card className="p-8 mt-8">
                    <div className="flex items-center gap-3 mb-6">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800">Trainer</span>
                        <h2 className="text-xl font-bold">Trainer Profile</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left Column */}
                            <div className="space-y-6">
                                {/* Trainer Type */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Trainer Details</h3>
                                    {isEditing ? (
                                        <div><label className="text-sm font-medium">Trainer Type</label>
                                            <select name="trainerType" value={trainerForm.trainerType} onChange={(e) => setTrainerForm(prev => prev ? { ...prev, trainerType: e.target.value } : prev)} className={inputClasses}>
                                                {Object.values(TrainerType).map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                    ) : (
                                        <ProfileBioItem label="Trainer Type" value={trainerForm.trainerType || '—'} />
                                    )}
                                </section>

                                {/* Trainer Qualifications */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Qualifications</h3>
                                    <MultiSelectCheckboxes options={Object.values(TrainerQualification)} selected={trainerForm.qualifications || []}
                                        onChange={handleTrainerMultiSelect('qualifications')} isEditing={isEditing} color="secondary" />
                                </section>
                            </div>

                            {/* Right Column */}
                            <div className="space-y-6">
                                {/* Trainer Education */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Highest Education</h3>
                                    <SingleSelectEducation options={Object.values(TrainerEducation)} selected={trainerForm.education || ''}
                                        onChange={(v) => setTrainerForm(prev => prev ? { ...prev, education: v } : prev)} isEditing={isEditing} />
                                </section>
                            </div>
                        </div>
                        {/* Area of Expertise (spans 2 columns) */}
                        <section className="md:col-span-2">
                            <h3 className="text-lg font-bold mb-3">Area of Expertise</h3>
                            <MultiSelectCheckboxes options={SKILLS_FUTURE_INDUSTRIES} selected={trainerForm.areasOfExpertise || []}
                                onChange={handleTrainerMultiSelect('areasOfExpertise')} isEditing={isEditing} color="secondary" />
                        </section>

                        {/* Skill Tags (examples) */}
                        <section>
                            <h3 className="text-lg font-bold mb-3">Skill Tags <span className="text-xs text-gray-400 ml-2">e.g. python, finance, excel, project management</span></h3>
                            <SkillTagsInput tags={trainerForm.skillsTags || []} isEditing={isEditing}
                                onUpdate={(tags) => setTrainerForm(prev => prev ? { ...prev, skillsTags: tags } : prev)} />
                        </section>

                        {/* Certification Tags (examples) */}
                        <section>
                            <h3 className="text-lg font-bold mb-3">Certification Tags <span className="text-xs text-gray-400 ml-2">e.g. CKA, CKAD, PL-300, CISSP</span></h3>
                            <SkillTagsInput tags={trainerForm.certificationTags || []} isEditing={isEditing}
                                onUpdate={(tags) => setTrainerForm(prev => prev ? { ...prev, certificationTags: tags } : prev)} />
                        </section>

                        {/* CV & Certifications (full width) */}
                        <section>
                            <h3 className="text-lg font-bold mb-3">CV & Supporting Document Folder</h3>
                            <p className="text-xs text-gray-400 mb-2">Please upload your CV, ACLP certification, and other supporting documents in the Google Drive folder.</p>
                            <DocumentSection title="" cvUrl={trainerForm.cvUrl} cvOriginalFilename={trainerForm.cvOriginalFilename}
                                cvFolderUrl={trainerForm.cvFolderUrl}
                                certifications={trainerForm.certifications || []} isEditing={isEditing}
                                onUpdateCvFolderUrl={(url) => setTrainerForm(prev => prev ? { ...prev, cvFolderUrl: url } : prev)} />
                        </section>


                    </div>
                </Card>
            )}

            {/* ===== DEVELOPER SECTION ===== */}
            {hasDeveloper && developerForm && role !== UserRole.Trainer && (
                <Card className="p-8 mt-8">
                    <div className="flex items-center gap-3 mb-6">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-800">Developer</span>
                        <h2 className="text-xl font-bold">Developer Profile</h2>
                    </div>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left Column */}
                            <div className="space-y-6">
                                {/* Developer Type */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Developer Details</h3>
                                    {isEditing ? (
                                        <div><label className="text-sm font-medium">Developer Type</label>
                                            <select name="developerType" value={developerForm.developerType} onChange={(e) => setDeveloperForm(prev => prev ? { ...prev, developerType: e.target.value } : prev)} className={inputClasses}>
                                                {Object.values(DeveloperType).map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                    ) : (
                                        <ProfileBioItem label="Developer Type" value={developerForm.developerType || '—'} />
                                    )}
                                </section>

                                {/* Developer Qualifications */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Qualifications</h3>
                                    <MultiSelectCheckboxes options={Object.values(TrainerQualification)} selected={developerForm.qualifications || []}
                                        onChange={handleDevMultiSelect('qualifications')} isEditing={isEditing} color="secondary" />
                                </section>

                                {/* Developer Education */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Highest Education</h3>
                                    <SingleSelectEducation options={Object.values(DeveloperEducation)} selected={developerForm.education || ''}
                                        onChange={(v) => setDeveloperForm(prev => prev ? { ...prev, education: v } : prev)} isEditing={isEditing} />
                                </section>
                            </div>

                            {/* Right Column */}
                            <div className="space-y-6">
                                {/* Developer Areas of Specialty */}
                                <section>
                                    <h3 className="text-lg font-bold mb-3">Area of Specialty</h3>
                                    <MultiSelectCheckboxes options={SKILLS_FUTURE_INDUSTRIES} selected={developerForm.areasOfSpecialty || []}
                                        onChange={handleDevMultiSelect('areasOfSpecialty')} isEditing={isEditing} color="secondary" />
                                </section>
                            </div>
                        </div>

                        {/* Full-width sections */}
                        <section>
                            <h3 className="text-lg font-bold mb-3">Skill Tags</h3>
                            <SkillTagsInput tags={developerForm.skillsTags || []} isEditing={isEditing}
                                onUpdate={(tags) => setDeveloperForm(prev => prev ? { ...prev, skillsTags: tags } : prev)} />
                        </section>

                        <section>
                            <h3 className="text-lg font-bold mb-3">CV & Supporting Document Folder</h3>
                            <p className="text-xs text-gray-400 mb-2">Please upload your CV, ACLP certification, and other supporting documents in the Google Drive folder.</p>
                            <DocumentSection title="" cvUrl={developerForm.cvUrl} cvOriginalFilename={developerForm.cvOriginalFilename}
                                cvFolderUrl={developerForm.cvFolderUrl}
                                certifications={developerForm.certifications || []} isEditing={isEditing}
                                onUpdateCvFolderUrl={(url) => setDeveloperForm(prev => prev ? { ...prev, cvFolderUrl: url } : prev)} />
                        </section>


                    </div>
                </Card>
            )}

            {/* ===== LOGIN DETAILS ===== */}
            <LoginDetailsCard loginId={sharedForm.loginId || sharedForm.email} password={sharedForm.password || '••••••••'}
                userId={currentUser?.id} onPasswordUpdate={handlePasswordUpdate} />

            {/* ===== APPEARANCE ===== */}
            {!isEditing && (
                <Card className="p-8 mt-8">
                    <h2 className="text-xl font-bold mb-4 dark:text-white">Appearance</h2>
                    <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${themeMode === 'dark' ? 'bg-gray-600' : 'bg-blue-100'}`}>
                                {themeMode === 'dark' ? (
                                    <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>
                                ) : (
                                    <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" /></svg>
                                )}
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-gray-200">Theme Mode</p>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{themeMode === 'dark' ? 'Dark theme active' : 'Light theme active'}</p>
                            </div>
                        </div>
                        <button type="button" onClick={handleThemeToggle}
                            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${themeMode === 'dark' ? 'bg-blue-600' : 'bg-gray-300'}`}>
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${themeMode === 'dark' ? 'translate-x-8' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default MultiRoleProfileCard;
