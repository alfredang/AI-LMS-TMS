import React, { useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { UserRole } from '@app-types';

interface VirtualMeetingLinkEditorProps {
    courseRunUuid: string;
    userRole: UserRole;
    providerLabel: string;
    /** Current link, if any — used to seed the input when editing. */
    currentLink?: string | null;
    /** Called with the saved link so the parent can show it immediately. */
    onSaved: (link: string | null) => void;
}

/**
 * Manual entry for a class's virtual meeting link. Calendar sync fills this in
 * automatically for most classes; this covers the ones where the trainer
 * creates the meeting themselves.
 */
export const VirtualMeetingLinkEditor: React.FC<VirtualMeetingLinkEditorProps> = ({
    courseRunUuid,
    userRole,
    providerLabel,
    currentLink,
    onSaved,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(currentLink || '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (
        userRole !== UserRole.Trainer &&
        userRole !== UserRole.Admin &&
        userRole !== UserRole.TrainingProvider &&
        userRole !== UserRole.Developer
    ) {
        return null;
    }

    if (!courseRunUuid) return null;

    const save = async (link: string) => {
        setIsSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/trainer/update-virtual-meeting-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunId: courseRunUuid, link }),
            });
            const result = await res.json();
            if (result.success) {
                onSaved(result.data?.virtualMeetingLink || null);
                setIsEditing(false);
            } else {
                setError(result.error || 'Failed to save the link');
            }
        } catch {
            setError('An error occurred while saving');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isEditing) {
        return (
            <button
                type="button"
                onClick={() => { setValue(currentLink || ''); setError(null); setIsEditing(true); }}
                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            >
                <Icon name={IconName.Edit} className="w-4 h-4" />
                {currentLink ? `Edit ${providerLabel} link` : `Add ${providerLabel} link`}
            </button>
        );
    }

    return (
        <div className="mt-3">
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                {providerLabel} link
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    type="url"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isSaving) save(value); }}
                    placeholder="https://meet.google.com/abc-defg-hij"
                    disabled={isSaving}
                    autoFocus
                    className="flex-1 min-w-0 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => save(value)}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setIsEditing(false); setError(null); }}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                </div>
            </div>
            {currentLink && (
                <button
                    type="button"
                    onClick={() => save('')}
                    disabled={isSaving}
                    className="mt-2 text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                    Remove link
                </button>
            )}
            {error && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
        </div>
    );
};
