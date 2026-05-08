import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { UserRole } from '@app-types';
import { useLms } from '@contexts/LmsContext';

interface Course {
    id: string;
    title: string;
    courseCode: string;
    courseRunId: string;
    assessmentSummaryRecordUrl?: string;
}

interface AssessmentSummarySectionProps {
    course: Course;
    userRole: UserRole;
    courseRunUuid: string;
}

const ContentSection: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
    <Card className={`p-6 ${className}`}>
        {title && <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{title}</h3>}
        {children}
    </Card>
);

export const AssessmentSummarySection: React.FC<AssessmentSummarySectionProps> = ({
    course,
    userRole,
    courseRunUuid
}) => {
    const { currentUser } = useLms();
    const [learners, setLearners] = useState<any[]>([]);
    const [selectedLearner, setSelectedLearner] = useState<string>('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState(false);

    useEffect(() => {
        if (userRole === UserRole.Trainer) {
            fetch(`/api/admin/course-run-enrollments?courseRunId=${courseRunUuid}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) setLearners(data.data);
                })
                .catch(err => console.error('Error fetching learners:', err));
        }
    }, [userRole, courseRunUuid]);

    if (userRole !== UserRole.Trainer && userRole !== UserRole.Admin && userRole !== UserRole.Developer && userRole !== UserRole.TrainingProvider && userRole !== UserRole.Learner) {
        return null;
    }

    const isLearner = userRole === UserRole.Learner;

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        let studentName: string | undefined;
        if (isLearner) {
            studentName = currentUser?.fullName;
            if (!studentName) {
                setUploadError('Unable to identify your name; please refresh and try again.');
                return;
            }
        } else {
            if (!selectedLearner) return;
            const learner = learners.find(l => l.user_id === selectedLearner);
            if (!learner) return;
            studentName = learner.full_name;
        }

        setIsUploading(true);
        setUploadError(null);
        setUploadSuccess(false);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('studentName', studentName);
        formData.append('courseRunId', courseRunUuid);

        try {
            const res = await fetch('/api/trainer/upload-summary-record', {
                method: 'POST',
                body: formData,
            });
            const result = await res.json();
            if (result.success) {
                setUploadSuccess(true);
            } else {
                setUploadError(result.error || 'Upload failed');
            }
        } catch (err) {
            setUploadError('An error occurred during upload');
        } finally {
            setIsUploading(false);
            // Reset input
            if (e.target) e.target.value = '';
        }
    };

    return (
        <ContentSection title="Assessment Summary Record">
            <div className="space-y-4">
                {course.assessmentSummaryRecordUrl && (
                    <a
                        href={course.assessmentSummaryRecordUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 dark:text-white">Assessment Summary Record Template</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open template</p>
                        </div>
                    </a>
                )}

                {(userRole === UserRole.Trainer || isLearner) && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-3 uppercase tracking-wider">
                            {isLearner
                                ? 'Upload Assessment Summary Record after fill up the learner info and signed'
                                : 'Upload Assessment Summary Record after fill up the trainer info and signed'}
                        </h4>

                        <div className={`grid grid-cols-1 ${isLearner ? '' : 'md:grid-cols-2'} gap-4`}>
                            {!isLearner && (
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Select Learner</label>
                                    <select
                                        className="w-full p-2 text-sm border rounded-md dark:bg-gray-800 dark:border-gray-700 font-sans"
                                        value={selectedLearner}
                                        onChange={(e) => setSelectedLearner(e.target.value)}
                                    >
                                        <option value="">Choose a learner...</option>
                                        {learners.map(l => (
                                            <option key={l.user_id} value={l.user_id}>{l.full_name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Upload File</label>
                                <input
                                    type="file"
                                    onChange={handleUpload}
                                    disabled={(!isLearner && !selectedLearner) || isUploading}
                                    className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
                                />
                            </div>
                        </div>

                        {isUploading && (
                            <div className="flex items-center gap-2 mt-3 text-blue-600 dark:text-blue-400 text-sm italic">
                                <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                                <span>Uploading to learner's specific folder...</span>
                            </div>
                        )}
                        
                        {uploadSuccess && (
                            <div className="mt-3 text-green-600 dark:text-green-400 text-sm font-medium flex items-center gap-2">
                                <Icon name={IconName.CheckCircle} className="w-4 h-4" />
                                <span>Successfully uploaded to learner's Assessment Record folder.</span>
                            </div>
                        )}

                        {uploadError && (
                            <div className="mt-3 text-red-600 dark:text-red-400 text-sm font-medium">
                                Error: {uploadError}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </ContentSection>
    );
};
