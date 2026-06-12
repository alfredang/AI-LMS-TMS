import React, { useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { UserRole } from '@app-types';

interface ClassPhotoUploadProps {
    courseRunUuid: string;
    userRole: UserRole;
}

export const ClassPhotoUpload: React.FC<ClassPhotoUploadProps> = ({ courseRunUuid, userRole }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ fileName: string; fileUrl?: string; sessionFolder: string } | null>(null);

    if (
        userRole !== UserRole.Trainer &&
        userRole !== UserRole.Admin &&
        userRole !== UserRole.TrainingProvider &&
        userRole !== UserRole.Developer
    ) {
        return null;
    }

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setError(null);
        setSuccess(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('courseRunId', courseRunUuid);

        try {
            const res = await fetch('/api/trainer/upload-class-photo', {
                method: 'POST',
                body: formData,
            });
            const result = await res.json();
            if (result.success) {
                setSuccess(result.data);
            } else {
                setError(result.error || 'Upload failed');
            }
        } catch {
            setError('An error occurred during upload');
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    return (
        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
            <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-1 uppercase tracking-wider">
                Class Photo
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                Upload to the session folder (YYYY_MM_DD_&lt;Trainer Name&gt;) under Assessment Records.
            </p>

            <input
                type="file"
                accept="image/*"
                onChange={handleUpload}
                disabled={isUploading}
                className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
            />

            {isUploading && (
                <div className="flex items-center gap-2 mt-3 text-blue-600 dark:text-blue-400 text-sm italic">
                    <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                    <span>Uploading class photo to session folder...</span>
                </div>
            )}

            {success && (
                <div className="mt-3 text-green-600 dark:text-green-400 text-sm font-medium flex items-start gap-2">
                    <Icon name={IconName.CheckCircle} className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                        Uploaded <span className="font-semibold">{success.fileName}</span> to{' '}
                        <span className="font-semibold">{success.sessionFolder}</span>
                        {success.fileUrl && (
                            <>
                                {' '}·{' '}
                                <a href={success.fileUrl} target="_blank" rel="noopener noreferrer" className="underline">
                                    View
                                </a>
                            </>
                        )}
                    </span>
                </div>
            )}

            {error && (
                <div className="mt-3 text-red-600 dark:text-red-400 text-sm font-medium">
                    Error: {error}
                </div>
            )}
        </div>
    );
};
