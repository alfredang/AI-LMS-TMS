import { displayCourseCodes } from '@lib/utils/courseCodes';
import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { Card } from './ui/Card';
import Spinner from './ui/Spinner';
import { UserRole, CourseAssessment, AdminPage, TrainerPage, AssessmentMethodKey, ASSESSMENT_METHOD_LABELS } from '@app-types';
import GradingView from './GradingView';
import { extractFilenameFromPath } from '@utils/fileUtils';
import { courseService } from '@lib/services/courseService';
import { getApiUrl, getDownloadUrl } from '@/lib/urlHelpers';
import { AssessmentSummarySection } from './trainer/AssessmentSummarySection';
import { ClassPhotoUpload } from './trainer/ClassPhotoUpload';
import QuizTakerModal from './QuizTakerModal';

// --- Types (assuming these exist in your project) ---
interface Topic {
    id: string;
    title: string;
    subtopics: Subtopic[];
}

interface Subtopic {
    id: string;
    title: string;
}

interface Assessment {
    id: string;
    title: string;
    category: string;
    status: string;
    file_url: string;
}

interface LearnerProgress {
    email: string;
    name: string;
    progressPercent: number;
    completedSubtopics: string[];
    submissions: Submission[];
}

interface Submission {
    assessmentId: string;
    fileName: string;
    submittedAt: string;
}

interface Course {
    id: string;
    title: string;
    courseCode: string;
    tscTitle?: string;
    tscCode?: string;
    courseRunId: string;
    daId?: string;
    trainingHours: number;
    assessmentHours: number;
    courseType: string;
    modeOfLearning: string[];
    classStatus?: string;
    classType?: string;
    virtualMeetingLink?: string | null;
    virtualMeetingHostLink?: string | null;
    virtualMeetingJoinLink?: string | null;
    virtualMeetingProvider?: 'google_meet' | 'zoom' | 'teams' | string | null;
    totalAssessments?: number;
    topics: Topic[];
    assessments?: Assessment[];
    learners?: LearnerProgress[];
    bookmarkedSubtopics?: string[];
    startDate?: string;
    endDate?: string;
    lessonPlanUrl?: string;
    facilitatorGuideUrl?: string;
    learnerGuideUrl?: string;
    slidesUrl?: string;
    trainerSlidesUrl?: string;
    activitiesUrl?: string;
    assessmentPlanUrl?: string;
    courseLink?: string;
    assessmentRecordLink?: string;
    writtenAssessmentLink?: string;
    practicalPerformanceAssessmentLink?: string;
    writtenAssessmentPublished?: boolean;
    practicalAssessmentPublished?: boolean;
    assessmentMethods?: Record<string, { enabled: boolean; link: string }>;
    publishedAssessmentMethods?: Record<string, boolean>;
    fundingValidity?: string;
    assessmentSummaryRecordUrl?: string;
}

// --- Utility Functions ---
const toId = (label: string) => label.toLowerCase().replace(/ /g, '-');

// Standard assessment briefing shown when a course developer hasn't set custom text.
const DEFAULT_ASSESSMENT_BRIEFING = [
    'Place phones & other materials under the table or on the floor',
    'No photos or recording of assessment scripts',
    'No discussion during assessment',
    'Use black/blue pen for assessment [hard copies]',
    'No usage of liquid paper or correction tape',
    'Assessment scripts will be collected when the time is up',
];

const inferVirtualMeetingProvider = (link?: string | null): 'google_meet' | 'zoom' | 'teams' | null => {
    if (!link) return null;
    const normalized = link.toLowerCase();
    if (normalized.includes('zoom.us') || normalized.includes('zoomgov.com')) return 'zoom';
    if (normalized.includes('teams.microsoft.com') || normalized.includes('teams.live.com')) return 'teams';
    if (normalized.includes('meet.google.com')) return 'google_meet';
    return null;
};

// --- Reusable Components ---
const ContentSection: React.FC<{ title?: string; children: React.ReactNode; className?: string; collapsible?: boolean; defaultOpen?: boolean }> = ({ title, children, className, collapsible = false, defaultOpen = true }) => {
    const [open, setOpen] = useState(defaultOpen);
    if (collapsible && title) {
        return (
            <Card className={`p-6 ${className}`}>
                <button
                    type="button"
                    onClick={() => setOpen(prev => !prev)}
                    className="w-full flex items-center justify-between text-left"
                    aria-expanded={open}
                >
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h3>
                    <Icon
                        name={IconName.ChevronDown}
                        className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
                    />
                </button>
                {open && <div className="mt-4">{children}</div>}
            </Card>
        );
    }
    return (
        <Card className={`p-6 ${className}`}>
            {title && <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{title}</h3>}
            {children}
        </Card>
    );
};

// --- Leaderboard Component ---
// const Leaderboard: React.FC<{ course: Course }> = ({ course }) => {
//     const { currentUser } = useLms();
//     const currentUserEmail = currentUser?.email || ""; 

//     if (!course.learners || course.learners.length === 0) {
//         return (
//             <ContentSection title="Game Leaderboard">
//                 <p className="text-gray-500 text-center py-4">
//                     No learners enrolled yet. Be the first!
//                 </p>
//             </ContentSection>
//         );
//     }

//     const totalTasks = course.topics.reduce((sum, topic) => sum + topic.subtopics.length, 0);

//     const leaderboardData = course.learners
//         .map(learner => {
//             const completedTasks = Math.floor((learner.progressPercent / 100) * totalTasks);
//             const score = completedTasks * 10;
//             return {
//                 name: learner.name,
//                 email: learner.email,
//                 score,
//             };
//         })
//         .sort((a, b) => b.score - a.score);

//     const currentUserData = leaderboardData.find(l => l.email === currentUserEmail);
//     const currentUserRank = leaderboardData.findIndex(l => l.email === currentUserEmail) + 1;

//     return (
//         <ContentSection title="Game Leaderboard">
//             {currentUserData && (
//                 <div className="p-4 bg-blue-50 rounded-lg mb-4 flex justify-between items-center">
//                     <div>
//                         <p className="text-sm font-semibold text-blue-600">Your Score</p>
//                         <p className="text-3xl font-bold text-blue-600">{currentUserData.score} Points</p>
//                     </div>
//                     <div className="text-right">
//                          <p className="text-sm font-semibold text-blue-600">Your Rank</p>
//                         <p className="text-3xl font-bold text-blue-600">#{currentUserRank}</p>
//                     </div>
//                 </div>
//             )}
//             <ol className="space-y-2">
//                 {leaderboardData.map((learner, index) => (
//                     <li key={learner.email} className={`flex items-center p-3 rounded-md transition-colors ${learner.email === currentUserEmail ? 'bg-indigo-100 border border-blue-500' : 'bg-gray-50'}`}>
//                         <span className="font-bold text-lg w-8">{index + 1}</span>
//                         <div className="flex-grow">
//                             <p className="font-semibold">{learner.name}</p>
//                         </div>
//                         <span className="font-bold text-blue-600">{learner.score} pts</span>
//                     </li>
//                 ))}
//             </ol>
//         </ContentSection>
//     );
// };

// --- Assessment Section Component ---
const AssessmentsSection: React.FC<{
    course: Course;
    userRole: UserRole;
    developerAssessments?: any[];
    courseRunId?: string;
    courseId?: string;
    setDeveloperAssessments?: (assessments: any[]) => void;
    handleFileDownload: (filePath: string, e?: React.MouseEvent) => void;
}> = ({ course, userRole, developerAssessments, courseRunId, courseId, setDeveloperAssessments, handleFileDownload }) => {
    const {
        submissions,
        submitAssessment,
        courseAssessments,
        publishAssessment,
        loadSubmissions,
        currentUser
    } = useLms();


    const [accessCodeInputs, setAccessCodeInputs] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({});
    const [isResubmitting, setIsResubmitting] = useState<Record<string, boolean>>({});
    const [isUploading, setIsUploading] = useState<Record<string, boolean>>({});
    const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
    const [verificationStatus, setVerificationStatus] = useState<Record<string, { loading: boolean, exists?: boolean, count?: number, error?: string }>>({});
    const [hasTriggeredVerification, setHasTriggeredVerification] = useState<Record<string, boolean>>({});
    const [currentEnrollmentId, setCurrentEnrollmentId] = useState<string | null>(null);

    // Fetch current user's enrollment ID for this course run
    useEffect(() => {
        const fetchEnrollmentId = async () => {
            if (!currentUser?.id || !courseRunId || userRole !== UserRole.Learner) {
                return;
            }

            try {
                const response = await fetch(getApiUrl(`/api/enrollments?userId=${currentUser.id}&courseRunId=${courseRunId}`));
                if (!response.ok) {
                    throw new Error('Failed to fetch enrollment information');
                }

                const result = await response.json();
                if (result.success && result.data.length > 0) {
                    const enrollmentId = result.data[0].id;
                    setCurrentEnrollmentId(enrollmentId);
                    console.log('✅ Current enrollment ID fetched:', enrollmentId);
                } else {
                    console.warn('⚠️ No enrollment found for current user and course run');
                }
            } catch (error) {
                console.error('❌ Failed to fetch enrollment ID:', error);
            }
        };

        fetchEnrollmentId();
    }, [currentUser?.id, courseRunId, userRole]);

    // Function to reload developer assessments after publish/unpublish
    const reloadDeveloperAssessments = async () => {
        if ((userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && courseId && setDeveloperAssessments) {
            try {
                const assessmentsResponse = await fetch(`/api/courses/developer-course-assessments?courseId=${courseId}`);
                const assessmentsResult = await assessmentsResponse.json();

                if (assessmentsResult.success) {
                    setDeveloperAssessments(assessmentsResult.data);
                }
            } catch (error) {
                console.error('❌ Failed to reload developer assessments:', error);
            }
        } else if (userRole !== UserRole.Developer && userRole !== UserRole.TrainingProvider && courseRunId && setDeveloperAssessments) {
            // For non-developers and non-training providers, use the original course run based endpoint
            try {
                const assessmentsResponse = await fetch(`/api/courses/developer-assessments?courseRunId=${courseRunId}`);
                const assessmentsResult = await assessmentsResponse.json();

                if (assessmentsResult.success) {
                    setDeveloperAssessments(assessmentsResult.data);
                }
            } catch (error) {
                console.error('❌ Failed to reload assessments:', error);
            }
        }
    };

    // Use developer assessments for developers and training providers, otherwise use context assessments
    const effectiveAssessments = (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && developerAssessments ? developerAssessments : courseAssessments;

    const [writtenPublished, setWrittenPublished] = useState<boolean>(course.writtenAssessmentPublished ?? false);
    const [practicalPublished, setPracticalPublished] = useState<boolean>(course.practicalAssessmentPublished ?? false);
    const [methodPublishState, setMethodPublishState] = useState<Record<string, boolean>>((course as any).publishedAssessmentMethods || {});

    // Filter out file-based assessments that match the link-based types (Written/Practical)
    // Only show URL/link-based assessments for these types
    const filteredFileAssessments = effectiveAssessments?.filter(assessment => {
        const category = assessment.category?.toLowerCase() || '';
        const isWrittenType = category.includes('written') || category === 'written exam';
        const isPracticalType = category.includes('practical') || category === 'practical exam';

        // Hide file-based Written/Practical assessments when link versions exist
        if (isWrittenType && course.writtenAssessmentLink) return false;
        if (isPracticalType && course.practicalPerformanceAssessmentLink) return false;

        return true;
    }) || [];

    const hasLegacyAssessmentLink = (methodKey: string) => {
        // Written/Practical always rendered via their dedicated sections, so skip in dynamic loop
        if (methodKey === 'writtenAssessment') return true;
        if (methodKey === 'practicalExam') return true;
        return false;
    };

    // State for link-based assessment submissions (Written/Practical)
    interface LinkSubmission {
        id: string;
        user_id: string;
        course_run_id: string;
        assessment_type: string;
        file_name: string;
        file_url: string;
        submitted_at: string;
    }
    const [linkSubmissions, setLinkSubmissions] = useState<LinkSubmission[]>([]);
    const [selectedLinkFiles, setSelectedLinkFiles] = useState<Record<string, File[]>>({});
    const [isLinkUploading, setIsLinkUploading] = useState<Record<string, boolean>>({});
    const [linkUploadSuccess, setLinkUploadSuccess] = useState<Record<string, boolean>>({});
    const [linkUploadProgress, setLinkUploadProgress] = useState<Record<string, number>>({});
    const [isLinkResubmitting, setIsLinkResubmitting] = useState<Record<string, boolean>>({});

    // Fetch link-based assessment submissions for learners
    useEffect(() => {
        const fetchLinkSubmissions = async () => {
            if (!currentUser?.id || !courseRunId || userRole !== UserRole.Learner) {
                return;
            }

            try {
                const response = await fetch(`/api/assessments/submit-link?userId=${currentUser.id}&courseRunId=${courseRunId}`);
                if (!response.ok) {
                    // Don't throw - just log and continue (table might not exist yet)
                    console.warn('⚠️ Could not fetch link assessment submissions - table may not exist yet');
                    return;
                }

                const result = await response.json();
                if (result.success) {
                    setLinkSubmissions(result.data || []);
                    console.log('✅ Link assessment submissions fetched:', result.data);
                }
            } catch (error) {
                // Silently handle - this is not critical if the table doesn't exist yet
                console.warn('⚠️ Failed to fetch link assessment submissions:', error);
            }
        };

        fetchLinkSubmissions();
    }, [currentUser?.id, courseRunId, userRole]);

    // Handlers for link-based assessment file upload
    const handleLinkFileChange = (assessmentType: string, event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            setSelectedLinkFiles(prev => ({
                ...prev,
                [assessmentType]: Array.from(event.target.files!)
            }));
        }
    };

    const handleLinkSubmit = async (assessmentType: string) => {
        const files = selectedLinkFiles[assessmentType];
        if (!files || files.length === 0) {
            alert('Please select a file to submit.');
            return;
        }

        setIsLinkUploading(prev => ({ ...prev, [assessmentType]: true }));
        setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 10 }));

        try {
            const courseCode = course?.courseCode || '';
            const courseName = course?.title || '';
            const studentName = currentUser?.fullName || 'Unknown Student';
            const tgsRefMatch = courseName.match(/(TGS-\d+)/) || courseCode.match(/(TGS-\d+)/);
            const tgsRef = tgsRefMatch ? tgsRefMatch[1] : courseCode;

            const newSubmissions: LinkSubmission[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const progress = Math.round(10 + ((i / files.length) * 80));
                setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: progress }));

                const formData = new FormData();
                formData.append('file', file);

                let fetchUrl = `/api/upload/google-drive?studentName=${encodeURIComponent(studentName)}`;
                if (tgsRef) fetchUrl += `&courseCode=${encodeURIComponent(tgsRef)}`;
                if (courseName) fetchUrl += `&courseName=${encodeURIComponent(courseName)}`;
                if (courseRunId) fetchUrl += `&courseRunId=${encodeURIComponent(courseRunId)}`;

                const uploadResponse = await fetch(fetchUrl, {
                    method: 'POST',
                    body: formData,
                });

                const uploadData = await uploadResponse.json();

                if (!uploadResponse.ok || !uploadData.success) {
                    throw new Error(uploadData.error || `Failed to upload file "${file.name}" to Google Drive.`);
                }

                const submitResponse = await fetch('/api/assessments/submit-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: currentUser?.id,
                        courseRunId,
                        assessmentType,
                        fileName: file.name,
                        fileUrl: uploadData.data.fileUrl
                    }),
                });

                const submitResult = await submitResponse.json();

                if (!submitResponse.ok || !submitResult.success) {
                    throw new Error(submitResult.error || `Failed to record submission for "${file.name}".`);
                }

                newSubmissions.push({
                    id: submitResult.id || `temp-${Date.now()}-${i}`,
                    user_id: currentUser?.id || '',
                    course_run_id: courseRunId || '',
                    assessment_type: assessmentType,
                    file_name: file.name,
                    file_url: uploadData.data.fileUrl,
                    submitted_at: new Date().toISOString()
                });
            }

            setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 100 }));
            console.log(`✅ ${newSubmissions.length} file(s) uploaded and recorded`);

            setLinkSubmissions(prev => [...prev, ...newSubmissions]);
            handleVerifyDrive(assessmentType);

            // Reset UI state
            setSelectedLinkFiles(prev => ({ ...prev, [assessmentType]: [] }));
            setIsLinkResubmitting(prev => ({ ...prev, [assessmentType]: false }));

            const fileInput = document.getElementById(`link-file-upload-${assessmentType}`) as HTMLInputElement;
            if (fileInput) fileInput.value = '';

            // Show "uploaded successfully" confirmation, auto-clear after 5s
            setLinkUploadSuccess(prev => ({ ...prev, [assessmentType]: true }));
            setTimeout(() => {
                setLinkUploadSuccess(prev => ({ ...prev, [assessmentType]: false }));
            }, 5000);

        } catch (error: any) {
            alert(`Upload failed: ${error.message || 'Please try again.'}`);
            console.error('Link submission error:', error);
        } finally {
            setIsLinkUploading(prev => ({ ...prev, [assessmentType]: false }));
            setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 0 }));
        }
    };

    const handleDeleteSubmission = async (submissionId: string) => {
        if (!confirm('Are you sure you want to delete this uploaded file?')) return;

        try {
            const response = await fetch('/api/assessments/submit-link', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submissionId }),
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to delete submission.');
            }

            setLinkSubmissions(prev => prev.filter(s => s.id !== submissionId));
        } catch (error: any) {
            alert(`Delete failed: ${error.message || 'Please try again.'}`);
            console.error('Delete submission error:', error);
        }
    };

    const handlePublishLink = async (field: string, published: boolean) => {
        if (!courseRunId) return;
        try {
            const response = await fetch('/api/assessments/publish-link', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunId, field, published }),
            });
            if (!response.ok) throw new Error('Failed to update publish status');

            if (field === 'written') {
                setWrittenPublished(published);
            } else if (field === 'practical') {
                setPracticalPublished(published);
            } else {
                setMethodPublishState(prev => ({ ...prev, [field]: published }));
            }
        } catch (error) {
            console.error('❌ Failed to publish link assessment:', error);
            alert('Failed to update publish status. Please try again.');
        }
    };

    // Show "No Assessments" message if there are no assessments and no links
    const hasEnabledMethods = course.assessmentMethods && Object.values(course.assessmentMethods).some(m => m.enabled && m.link);
    if ((!effectiveAssessments || effectiveAssessments.length === 0) && !course.writtenAssessmentLink && !course.practicalPerformanceAssessmentLink && !hasEnabledMethods) {
        return (
            <ContentSection title="Assessment" collapsible>
                <div className="text-center p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border dark:border-gray-700">
                    <Icon name={IconName.ClipboardCheck} className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-2">No Assessments Available</h4>
                    <p className="text-gray-500 dark:text-gray-400">
                        {userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin
                            ? "No assessments have been created for this course yet."
                            : "This section will display the assessment once it is published by your trainer. The assessment may be either a handwritten assessment or a soft copy assessment, depending on your trainer's arrangement."
                        }
                    </p>
                </div>
            </ContentSection>
        );
    }


    const handlePublish = async (assessmentId: string) => {
        try {
            if (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) {
                // Developers, Training Providers, and Admins cannot publish assessments - this should not be called
                console.warn('⚠️ Developers, Training Providers, and Admins cannot publish assessments');
                return;
            }

            // Find the assessment to check its category
            const assessment = effectiveAssessments?.find(a => a.id === assessmentId);
            const category = assessment?.category?.toLowerCase() || '';

            // Use standard LMS context for trainer and other roles
            await publishAssessment(assessmentId, true);

            // If publishing file-based written assessment, unpublish link-based written
            if ((category.includes('written') || category === 'written exam') && course.writtenAssessmentLink && writtenPublished) {
                await handlePublishLink('written', false);
            }

            // If publishing file-based practical assessment, unpublish link-based practical
            if ((category.includes('practical') || category === 'practical exam') && course.practicalPerformanceAssessmentLink && practicalPublished) {
                await handlePublishLink('practical', false);
            }
        } catch (error) {
            console.error('❌ Failed to publish assessment:', error);
            alert('Failed to publish assessment. Please try again.');
        }
    };

    const handleUnpublish = async (assessmentId: string) => {
        try {
            if (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) {
                // Developers, Training Providers, and Admins cannot unpublish assessments - this should not be called
                console.warn('⚠️ Developers, Training Providers, and Admins cannot unpublish assessments');
                return;
            }

            // Use standard LMS context for trainer and other roles
            await publishAssessment(assessmentId, false);
        } catch (error) {
            console.error('❌ Failed to unpublish assessment:', error);
            alert('Failed to unpublish assessment. Please try again.');
        }
    };


    const handleFileChange = (assessmentId: string, event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            setSelectedFiles(prev => ({
                ...prev,
                [assessmentId]: event.target.files![0]
            }));
        }
    };

    const handleSubmit = async (assessmentId: string) => {
        const file = selectedFiles[assessmentId];
        if (!file) {
            alert('Please select a file to submit.');
            return;
        }

        setIsUploading(prev => ({ ...prev, [assessmentId]: true }));
        setUploadProgress(prev => ({ ...prev, [assessmentId]: 10 })); // Start progress

        try {
            const courseCode = course?.courseCode || '';
            const courseName = course?.title || '';
            const studentName = currentUser?.fullName || 'Unknown Student';
            const tgsRefMatch = courseName.match(/(TGS-\d+)/) || courseCode.match(/(TGS-\d+)/);
            const tgsRef = tgsRefMatch ? tgsRefMatch[1] : courseCode;

            const formData = new FormData();
            formData.append('file', file);

            // Adding query parameters for the backend to build the folder structure
            let fetchUrl = `/api/upload/google-drive?studentName=${encodeURIComponent(studentName)}`;
            if (tgsRef) fetchUrl += `&courseCode=${encodeURIComponent(tgsRef)}`;
            if (courseName) fetchUrl += `&courseName=${encodeURIComponent(courseName)}`;
            if (courseRunId) fetchUrl += `&courseRunId=${encodeURIComponent(courseRunId)}`;

            setUploadProgress(prev => ({ ...prev, [assessmentId]: 40 })); // Updating progress

            const response = await fetch(fetchUrl, {
                method: 'POST',
                body: formData,
            });

            setUploadProgress(prev => ({ ...prev, [assessmentId]: 80 })); // Almost done

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to upload file to Google Drive.');
            }

            setUploadProgress(prev => ({ ...prev, [assessmentId]: 100 })); // Upload complete

            // Mark as submitted in the LMS database using the returned Google Drive link
            await submitAssessment(assessmentId, file.name, data.data.fileUrl);

            console.log('✅ Assessment successfully uploaded and recorded');
            await loadSubmissions();

            // Auto-verify the uploaded file
            handleVerifyDrive(assessmentId);

            // Reset UI state
            setSelectedFiles(prev => ({ ...prev, [assessmentId]: null }));
            setIsResubmitting(prev => ({ ...prev, [assessmentId]: false }));

            // Reset the file input visually
            const fileInput = document.getElementById(`file-upload-${assessmentId}`) as HTMLInputElement;
            if (fileInput) fileInput.value = '';

        } catch (error: any) {
            alert(`Upload failed: ${error.message || 'Please try again.'}`);
            console.error('Submission error:', error);
        } finally {
            setIsUploading(prev => ({ ...prev, [assessmentId]: false }));
            setUploadProgress(prev => ({ ...prev, [assessmentId]: 0 }));
        }
    };

    const handleVerifyDrive = async (assessmentId: string) => {
        setVerificationStatus(prev => ({ ...prev, [assessmentId]: { loading: true } }));
        try {
            const courseCode = course?.courseCode || '';
            const courseName = course?.title || '';
            const studentName = currentUser?.fullName || 'Unknown Student';
            const tgsRefMatch = courseName.match(/(TGS-\d+)/) || courseCode.match(/(TGS-\d+)/);
            const tgsRef = tgsRefMatch ? tgsRefMatch[1] : courseCode;

            let fetchUrl = `/api/upload/verify-drive?studentName=${encodeURIComponent(studentName)}`;
            if (tgsRef) fetchUrl += `&courseCode=${encodeURIComponent(tgsRef)}`;
            if (courseName) fetchUrl += `&courseName=${encodeURIComponent(courseName)}`;
            if (courseRunId) fetchUrl += `&courseRunId=${encodeURIComponent(courseRunId)}`;

            const response = await fetch(fetchUrl);
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || data.reason || 'Verification failed');
            }

            setVerificationStatus(prev => ({ 
                ...prev, 
                [assessmentId]: { 
                    loading: false, 
                    exists: data.exists, 
                    count: data.count 
                } 
            }));
        } catch (error: any) {
            setVerificationStatus(prev => ({ 
                ...prev, 
                [assessmentId]: { 
                    loading: false, 
                    error: error.message 
                } 
            }));
        }
    };

    // Automatically trigger verification on load for existing submissions
    useEffect(() => {
        if (submissions && submissions.length > 0) {
            submissions.forEach(sub => {
                if (!hasTriggeredVerification[sub.assessment_id]) {
                    setHasTriggeredVerification(prev => ({ ...prev, [sub.assessment_id]: true }));
                    handleVerifyDrive(sub.assessment_id);
                }
            });
        }
        
        if (linkSubmissions && linkSubmissions.length > 0) {
            linkSubmissions.forEach(sub => {
                if (!hasTriggeredVerification[sub.assessment_type]) {
                    setHasTriggeredVerification(prev => ({ ...prev, [sub.assessment_type]: true }));
                    handleVerifyDrive(sub.assessment_type);
                }
            });
        }
    }, [submissions, linkSubmissions, hasTriggeredVerification]);

    const renderLearnerAssessment = (assessment: CourseAssessment) => {
        const canResubmit = isResubmitting[assessment.id];

        // Filter submissions by both assessment_id and enrollment_id to ensure 
        // submissions are specific to this learner's enrollment in this course run
        let submission;
        if (currentEnrollmentId) {
            // Use enrollment-based filtering (preferred method)
            submission = submissions.find(s =>
                s.assessment_id === assessment.id &&
                s.enrollment_id === currentEnrollmentId
            );
        } else {
            // Fallback to assessment-only filtering if enrollment ID not available yet
            submission = submissions.find(s => s.assessment_id === assessment.id);
        }

        // Debug logging to help verify enrollment-based filtering
        console.log(`🔍 Filtering submissions for assessment ${assessment.id}:`, {
            currentEnrollmentId,
            assessmentId: assessment.id,
            totalSubmissions: submissions.length,
            filteringMethod: currentEnrollmentId ? 'enrollment-based' : 'assessment-only (fallback)',
            allSubmissions: submissions.map(s => ({
                assessment_id: s.assessment_id,
                enrollment_id: s.enrollment_id,
                course_run_id: s.course_run_id,
                file_name: s.file_name
            })),
            matchingByAssessment: submissions.filter(s => s.assessment_id === assessment.id),
            foundSubmissionByEnrollment: submission
        });

        // Only show assessments that are published by the trainer
        if (!assessment.published) {
            return (
                <div className="text-center py-4 px-2">
                    <Icon name={IconName.ClipboardCheck} className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        This section will display the assessment once it is published by your trainer. The assessment may be either a handwritten assessment or a soft copy assessment, depending on your trainer's arrangement.
                    </p>
                </div>
            );
        }

        if (submission && !canResubmit) {
            const vStatus = verificationStatus[assessment.id];
            
            return (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 space-y-3">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="font-semibold text-green-800 dark:text-green-300">Submitted: {submission.file_name}</p>
                            <p className="text-xs text-green-600 dark:text-green-400">On: {new Date(submission.submitted_at).toLocaleString()}</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setIsResubmitting(prev => ({ ...prev, [assessment.id]: true }))}>
                            Resubmit
                        </Button>
                    </div>
                    {vStatus && (
                        <div className={`text-sm p-2 rounded-md ${vStatus.loading ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30' : vStatus.exists ? 'bg-green-100 text-green-800 dark:bg-green-800/40 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'}`}>
                            {vStatus.loading && <span className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div> Checking Google Drive...</span>}
                            {!vStatus.loading && vStatus.exists && `✅ Verified: Found in Drive`}
                            {!vStatus.loading && !vStatus.exists && `⚠️ File missing from Google Drive! (${vStatus.error || 'Folder empty or deleted'})`}
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div>
                {assessment.file_url && (
                    <div className="mb-4">
                        <div
                            onClick={(e) => handleFileDownload(assessment.file_url!, e)}
                            className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                        >
                            <Icon name={IconName.FilePdf} className="w-8 h-8 text-red-600 flex-shrink-0" />
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-white">{extractFilenameFromPath(assessment.file_url)}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to download assessment questions</p>
                            </div>
                        </div>
                    </div>
                )}
                {/* Step 1: File Upload Input */}
                <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {canResubmit ? "Upload a new file to replace your previous submission" : "Upload your completed assessment file"}
                    </label>
                    <input
                        type="file"
                        id={`file-upload-${assessment.id}`}
                        onChange={(e) => handleFileChange(assessment.id, e)}
                        className="block w-full text-sm text-gray-500 dark:text-gray-400
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-md file:border-0
                            file:text-sm file:font-semibold
                            file:bg-blue-50 file:text-blue-700
                            hover:file:bg-blue-100
                            dark:file:bg-blue-900/20 dark:file:text-blue-300
                            dark:hover:file:bg-blue-900/40"
                    />
                </div>

                {/* Step 2: Submit Button & Progress */}
                {selectedFiles[assessment.id] && !isUploading[assessment.id] && (
                    <div className="mt-4">
                        <Button
                            onClick={() => handleSubmit(assessment.id)}
                            className="w-full"
                        >
                            Submit Assessment
                        </Button>
                    </div>
                )}
                {isUploading[assessment.id] && (
                    <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex flex-col items-center justify-center space-y-3">
                            <Spinner size="md" />
                            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Uploading your assessment...</p>
                            <p className="text-xs text-blue-600 dark:text-blue-400">Please wait while we upload your file...</p>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderTrainerAssessment = (assessment: CourseAssessment) => {
        return (
            <div className="space-y-3">
                {/* Show assessment file download if available */}
                {assessment.file_url && (
                    <div
                        onClick={(e) => handleFileDownload(assessment.file_url!, e)}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                    >
                        <Icon name={IconName.FilePdf} className="w-8 h-8 text-red-600 flex-shrink-0" />
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{extractFilenameFromPath(assessment.file_url)}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download assessment questions</p>
                        </div>
                    </div>
                )}

                {/* Show publish/unpublish buttons only for trainers */}
                {userRole === UserRole.Trainer && (
                    assessment.published ? (
                        <div className="space-y-3">
                            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-200 dark:border-blue-800 text-center">
                                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Assessment is Live</p>
                                <p className="text-xs text-blue-600 dark:text-blue-400">Learners can now submit their work.</p>
                            </div>
                            <Button
                                onClick={() => handleUnpublish(assessment.id)}
                                variant="secondary"
                                className="w-full"
                            >
                                Unpublish Assessment
                            </Button>
                        </div>
                    ) : (
                        <Button onClick={() => handlePublish(assessment.id)}>Publish Assessment</Button>
                    )
                )}
            </div>
        );
    };

    return (
        <ContentSection title="Assessment" collapsible>
            {(userRole === UserRole.Learner || userRole === UserRole.Trainer) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Open the assessment link, download the questions as a Microsoft Word document (or make a Google Doc copy), fill in the answers, then submit the completed file on the LMS.
                </p>
            )}
            {/* Other file-based assessments (excluding Written/Practical which are shown separately with toggle) */}
            {filteredFileAssessments && filteredFileAssessments.length > 0 && (
                <ul className="space-y-4">
                    {filteredFileAssessments.map(assessment => (
                        <li key={assessment.id} className="p-4 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center">
                                    <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-blue-600 mr-3" />
                                    <span className="font-semibold text-gray-900 dark:text-white">{assessment.title}</span>
                                </div>
                                <span className="text-sm font-medium bg-indigo-100 text-indigo-800 px-3 py-1 rounded-full">{assessment.category}</span>
                            </div>
                            {/* Learners see assessment submission interface, trainers and developers can view/download files, trainers can also publish/unpublish */}
                            {userRole === UserRole.Learner ?
                                renderLearnerAssessment(assessment) :
                                (userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) ?
                                    renderTrainerAssessment(assessment) :
                                    null
                            }
                        </li>
                    ))}
                </ul>
            )}

            {/* Written Exam - Show when legacy link exists OR assessmentMethods has it enabled with a link */}
            {(() => {
                const effectiveWrittenLink = (course.assessmentMethods?.writtenAssessment?.enabled && course.assessmentMethods.writtenAssessment.link)
                    ? course.assessmentMethods.writtenAssessment.link
                    // Only fall back to legacy link when assessmentMethods is not configured at all
                    : (!course.assessmentMethods ? course.writtenAssessmentLink : null);
                return effectiveWrittenLink && (userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || writtenPublished) && (
                <div className="mt-1 p-3 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-blue-600" />
                            Written Exam
                        </h4>
                        {writtenPublished && (
                            <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">Published</span>
                        )}
                    </div>

                    {effectiveWrittenLink && (
                        <>
                            <div className="flex items-center gap-3 mb-3">
                                <a
                                    href={effectiveWrittenLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 flex-1 min-w-0 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                >
                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 dark:text-white">Open Assessment Link</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open external form</p>
                                    </div>
                                </a>
                                {userRole === UserRole.Trainer && (
                                    writtenPublished ? (
                                        <Button onClick={() => handlePublishLink('written', false)} variant="secondary" className="flex-shrink-0">
                                            Unpublish
                                        </Button>
                                    ) : (
                                        <Button onClick={() => handlePublishLink('written', true)} className="flex-shrink-0">Publish</Button>
                                    )
                                )}
                            </div>
                        </>
                    )}

                    {/* Learner file submission for Written Exam */}
                    {userRole === UserRole.Learner && writtenPublished && (() => {
                        const writtenSubs = linkSubmissions.filter(s => s.assessment_type === 'written');

                        return (
                            <div className="mt-3 space-y-3">
                                {/* Show all uploaded files */}
                                {writtenSubs.length > 0 && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Uploaded Files ({writtenSubs.length})</p>
                                        {writtenSubs.map((sub) => (
                                            <div key={sub.id} className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 flex justify-between items-center">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-medium text-green-800 dark:text-green-300 truncate">{sub.file_name}</p>
                                                    <p className="text-xs text-green-600 dark:text-green-400">{new Date(sub.submitted_at).toLocaleString()}</p>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                    <a href={sub.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm font-medium">
                                                        View
                                                    </a>
                                                    <button onClick={() => handleDeleteSubmission(sub.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium">
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Upload input — always visible */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {writtenSubs.length > 0 ? "Upload another file" : "Upload your completed assessment file"}
                                    </label>
                                    <input
                                        type="file"
                                        id="link-file-upload-written"
                                        onChange={(e) => handleLinkFileChange('written', e)}
                                        className="block w-full text-sm text-gray-500 dark:text-gray-400
                                            file:mr-4 file:py-2 file:px-4
                                            file:rounded-md file:border-0
                                            file:text-sm file:font-semibold
                                            file:bg-blue-50 file:text-blue-700
                                            hover:file:bg-blue-100
                                            dark:file:bg-blue-900/20 dark:file:text-blue-300
                                            dark:hover:file:bg-blue-900/40"
                                        multiple
                                    />
                                    {selectedLinkFiles['written']?.length > 0 && !isLinkUploading['written'] && (
                                        <div className="mt-3">
                                            <Button onClick={() => handleLinkSubmit('written')} className="w-full">
                                                Upload {selectedLinkFiles['written'].length > 1 ? `${selectedLinkFiles['written'].length} Files` : 'File'}
                                            </Button>
                                        </div>
                                    )}
                                    {isLinkUploading['written'] && (
                                        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                            <div className="flex flex-col items-center justify-center space-y-3">
                                                <Spinner size="md" />
                                                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Uploading your file...</p>
                                            </div>
                                        </div>
                                    )}
                                    {linkUploadSuccess['written'] && !isLinkUploading['written'] && (
                                        <p className="mt-3 text-sm font-medium text-green-600 dark:text-green-400">✓ File uploaded successfully</p>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
            })()}

            {/* Practical Exam - Show when legacy link exists OR assessmentMethods has it enabled with a link */}
            {(() => {
                const effectivePracticalLink = (course.assessmentMethods?.practicalExam?.enabled && course.assessmentMethods.practicalExam.link)
                    ? course.assessmentMethods.practicalExam.link
                    // Only fall back to legacy link when assessmentMethods is not configured at all
                    : (!course.assessmentMethods ? course.practicalPerformanceAssessmentLink : null);
                return effectivePracticalLink && (userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || practicalPublished) && (
                <div className="mt-1 p-3 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-blue-600" />
                            Practical Exam
                        </h4>
                        {practicalPublished && (
                            <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">Published</span>
                        )}
                    </div>

                    {effectivePracticalLink && (
                        <>
                            <div className="flex items-center gap-3 mb-3">
                                <a
                                    href={effectivePracticalLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 flex-1 min-w-0 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                >
                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900 dark:text-white">Open Assessment Link</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open external form</p>
                                    </div>
                                </a>
                                {userRole === UserRole.Trainer && (
                                    practicalPublished ? (
                                        <Button onClick={() => handlePublishLink('practical', false)} variant="secondary" className="flex-shrink-0">
                                            Unpublish
                                        </Button>
                                    ) : (
                                        <Button onClick={() => handlePublishLink('practical', true)} className="flex-shrink-0">Publish</Button>
                                    )
                                )}
                            </div>
                        </>
                    )}

                    {/* Learner file submission for Practical Exam */}
                    {userRole === UserRole.Learner && practicalPublished && (() => {
                        const practicalSubs = linkSubmissions.filter(s => s.assessment_type === 'practical');

                        return (
                            <div className="mt-3 space-y-3">
                                {/* Show all uploaded files */}
                                {practicalSubs.length > 0 && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Uploaded Files ({practicalSubs.length})</p>
                                        {practicalSubs.map((sub) => (
                                            <div key={sub.id} className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 flex justify-between items-center">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-medium text-green-800 dark:text-green-300 truncate">{sub.file_name}</p>
                                                    <p className="text-xs text-green-600 dark:text-green-400">{new Date(sub.submitted_at).toLocaleString()}</p>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                    <a href={sub.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm font-medium">
                                                        View
                                                    </a>
                                                    <button onClick={() => handleDeleteSubmission(sub.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium">
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Upload input — always visible */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {practicalSubs.length > 0 ? "Upload another file" : "Upload your completed assessment file"}
                                    </label>
                                    <input
                                        type="file"
                                        id="link-file-upload-practical"
                                        onChange={(e) => handleLinkFileChange('practical', e)}
                                        className="block w-full text-sm text-gray-500 dark:text-gray-400
                                            file:mr-4 file:py-2 file:px-4
                                            file:rounded-md file:border-0
                                            file:text-sm file:font-semibold
                                            file:bg-blue-50 file:text-blue-700
                                            hover:file:bg-blue-100
                                            dark:file:bg-blue-900/20 dark:file:text-blue-300
                                            dark:hover:file:bg-blue-900/40"
                                        multiple
                                    />
                                    {selectedLinkFiles['practical']?.length > 0 && !isLinkUploading['practical'] && (
                                        <div className="mt-3">
                                            <Button onClick={() => handleLinkSubmit('practical')} className="w-full">
                                                Upload {selectedLinkFiles['practical'].length > 1 ? `${selectedLinkFiles['practical'].length} Files` : 'File'}
                                            </Button>
                                        </div>
                                    )}
                                    {isLinkUploading['practical'] && (
                                        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                            <div className="flex flex-col items-center justify-center space-y-3">
                                                <Spinner size="md" />
                                                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Uploading your file...</p>
                                            </div>
                                        </div>
                                    )}
                                    {linkUploadSuccess['practical'] && !isLinkUploading['practical'] && (
                                        <p className="mt-3 text-sm font-medium text-green-600 dark:text-green-400">✓ File uploaded successfully</p>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
            })()}

            {/* Dynamic Assessment Methods — ordered so Written Exam is always first */}
            {course.assessmentMethods && Object.entries(course.assessmentMethods)
            .sort(([a], [b]) => {
                const order = ['writtenAssessment', 'practicalExam', 'caseStudy', 'rolePlay', 'oralQuestioning', 'project', 'assignment'];
                return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
            })
            .map(([methodKey, config]) => {
                if (!config.enabled || !config.link) return null;
                if (hasLegacyAssessmentLink(methodKey)) return null;
                const label = ASSESSMENT_METHOD_LABELS[methodKey as AssessmentMethodKey] || methodKey;
                const isPublished = methodPublishState[methodKey] === true;
                const isPrivileged = userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider;

                // Learners can only see published methods
                if (userRole === UserRole.Learner && !isPublished) return null;

                return (
                    <div key={methodKey} className="mt-1 p-3 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-blue-600" />
                                {label}
                            </h4>
                            {isPublished && (
                                <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">Published</span>
                            )}
                        </div>

                        <div className="flex items-center gap-3 mb-3">
                            <a
                                href={config.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 flex-1 min-w-0 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                            >
                                <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 dark:text-white">Open Assessment Link</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to open external form</p>
                                </div>
                            </a>
                            {userRole === UserRole.Trainer && (
                                isPublished ? (
                                    <Button onClick={() => handlePublishLink(methodKey as any, false)} variant="secondary" className="flex-shrink-0">
                                        Unpublish
                                    </Button>
                                ) : (
                                    <Button onClick={() => handlePublishLink(methodKey as any, true)} className="flex-shrink-0">Publish</Button>
                                )
                            )}
                        </div>

                        {/* Learner file submission */}
                        {userRole === UserRole.Learner && isPublished && (() => {
                            const methodSubs = linkSubmissions.filter(s => s.assessment_type === methodKey);
                            return (
                                <div className="mt-3 space-y-3">
                                    {methodSubs.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Uploaded Files ({methodSubs.length})</p>
                                            {methodSubs.map((sub) => (
                                                <div key={sub.id} className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 flex justify-between items-center">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-medium text-green-800 dark:text-green-300 truncate">{sub.file_name}</p>
                                                        <p className="text-xs text-green-600 dark:text-green-400">{new Date(sub.submitted_at).toLocaleString()}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                        <a href={sub.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm font-medium">
                                                            View
                                                        </a>
                                                        <button onClick={() => handleDeleteSubmission(sub.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium">
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {methodSubs.length > 0 ? "Upload another file" : "Upload your completed assessment file"}
                                        </label>
                                        <input
                                            type="file"
                                            id={`link-file-upload-${methodKey}`}
                                            onChange={(e) => handleLinkFileChange(methodKey, e)}
                                            className="block w-full text-sm text-gray-500 dark:text-gray-400
                                                file:mr-4 file:py-2 file:px-4
                                                file:rounded-md file:border-0
                                                file:text-sm file:font-semibold
                                                file:bg-blue-50 file:text-blue-700
                                                hover:file:bg-blue-100
                                                dark:file:bg-blue-900/20 dark:file:text-blue-300
                                                dark:hover:file:bg-blue-900/40"
                                            multiple
                                        />
                                        {selectedLinkFiles[methodKey]?.length > 0 && !isLinkUploading[methodKey] && (
                                            <div className="mt-3">
                                                <Button onClick={() => handleLinkSubmit(methodKey as any)} className="w-full">
                                                    Upload {selectedLinkFiles[methodKey].length > 1 ? `${selectedLinkFiles[methodKey].length} Files` : 'File'}
                                                </Button>
                                            </div>
                                        )}
                                        {isLinkUploading[methodKey] && (
                                            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                                <div className="flex flex-col items-center justify-center space-y-3">
                                                    <Spinner size="md" />
                                                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Uploading your file...</p>
                                                </div>
                                            </div>
                                        )}
                                        {linkUploadSuccess[methodKey] && !isLinkUploading[methodKey] && (
                                            <p className="mt-3 text-sm font-medium text-green-600 dark:text-green-400">✓ File uploaded successfully</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                );
            })}
        </ContentSection>
    );
};

// --- Announcements Section Component ---
type Announcement = {
    id: string;
    courseRunId: string;
    title: string | null;
    message: string | null;
    linkUrl: string | null;
    fileName: string | null;
    fileUrl: string | null;
    postedBy: string;
    createdAt: string;
};

const AnnouncementsSection: React.FC<{ userRole: UserRole, courseRunId: string, currentUser: any }> = ({ userRole, courseRunId, currentUser }) => {
    const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [composing, setComposing] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const [title, setTitle] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [linkUrl, setLinkUrl] = React.useState('');
    const [pendingFile, setPendingFile] = React.useState<File | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const fetchAnnouncements = React.useCallback(async () => {
        if (!courseRunId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/course/announcements?courseRunId=${courseRunId}`);
            const data = await res.json();
            if (data.success) {
                setAnnouncements(data.announcements);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [courseRunId]);

    React.useEffect(() => {
        fetchAnnouncements();
    }, [fetchAnnouncements]);

    const resetComposer = () => {
        setTitle('');
        setMessage('');
        setLinkUrl('');
        setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setComposing(false);
    };

    const handleSubmit = async () => {
        const trimmedMessage = message.trim();
        const trimmedLink = linkUrl.trim();

        if (!trimmedMessage && !trimmedLink && !pendingFile) {
            alert('Add a message, link, or file before posting.');
            return;
        }

        setSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('courseRunId', courseRunId);
            formData.append('postedBy', currentUser?.name || currentUser?.email || 'Trainer');
            if (title.trim()) formData.append('title', title.trim());
            if (trimmedMessage) formData.append('message', trimmedMessage);
            if (trimmedLink) formData.append('linkUrl', trimmedLink);
            if (pendingFile) formData.append('file', pendingFile);

            const res = await fetch('/api/trainer/create-announcement', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to post announcement');
            }
            resetComposer();
            fetchAnnouncements();
        } catch (err: any) {
            console.error(err);
            alert(err?.message || 'Failed to post announcement');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this announcement?')) return;
        try {
            const res = await fetch(`/api/course/announcements?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setAnnouncements(prev => prev.filter(a => a.id !== id));
            } else {
                alert('Failed to delete announcement');
            }
        } catch (err) {
            console.error(err);
        }
    };

    if (!courseRunId) return null;

    const isTrainerOrAdmin = userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider;

    return (
        <ContentSection title="Announcements" collapsible>
            <div className="space-y-4">
                {isTrainerOrAdmin && !composing && (
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Post messages, links, or documents that all learners in this class can see.
                        </p>
                        <button
                            onClick={() => setComposing(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
                        >
                            <Icon name={IconName.Bell} className="w-4 h-4" />
                            New Announcement
                        </button>
                    </div>
                )}

                {isTrainerOrAdmin && composing && (
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Title (optional)"
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Write a message for your learners…"
                            rows={4}
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex items-center gap-2">
                            <Icon name={IconName.Link} className="w-4 h-4 text-gray-400" />
                            <input
                                type="url"
                                value={linkUrl}
                                onChange={e => setLinkUrl(e.target.value)}
                                placeholder="https://example.com (optional link)"
                                className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={e => setPendingFile(e.target.files?.[0] || null)}
                                style={{ display: 'none' }}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                            >
                                <Icon name={IconName.FileText} className="w-4 h-4" />
                                {pendingFile ? 'Change file' : 'Attach file'}
                            </button>
                            {pendingFile && (
                                <span className="text-sm text-gray-600 dark:text-gray-300 truncate" title={pendingFile.name}>
                                    {pendingFile.name}
                                    <button
                                        onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                        className="ml-2 text-red-600 hover:underline"
                                    >
                                        remove
                                    </button>
                                </span>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                onClick={resetComposer}
                                disabled={submitting}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={submitting}
                                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {submitting && <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />}
                                {submitting ? 'Posting…' : 'Post Announcement'}
                            </button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center p-8">
                        <Icon name={IconName.Spinner} className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : announcements.length === 0 ? (
                    <div className="text-center p-8 bg-gray-50 dark:bg-gray-800 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
                        <Icon name={IconName.Bell} className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                        <p className="text-gray-600 dark:text-gray-300 font-medium">No announcements yet</p>
                        {isTrainerOrAdmin && <p className="text-sm text-gray-500 mt-1">Click "New Announcement" to post a message, link, or file.</p>}
                    </div>
                ) : (
                    <ul className="space-y-3">
                        {announcements.map(a => (
                            <li key={a.id} className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        {a.title && (
                                            <p className="font-semibold text-gray-900 dark:text-white">{a.title}</p>
                                        )}
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Posted by {a.postedBy} • {new Date(a.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    {isTrainerOrAdmin && (
                                        <button
                                            onClick={() => handleDelete(a.id)}
                                            className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors flex-shrink-0"
                                            title="Delete"
                                        >
                                            <Icon name={IconName.Delete} className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                                {a.message && (
                                    <p className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{a.message}</p>
                                )}
                                {a.linkUrl && (
                                    <a
                                        href={a.linkUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline break-all"
                                    >
                                        <Icon name={IconName.Link} className="w-4 h-4 flex-shrink-0" />
                                        <span className="truncate">{a.linkUrl}</span>
                                    </a>
                                )}
                                {a.fileUrl && (
                                    <a
                                        href={a.fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        download={a.fileName || undefined}
                                        className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
                                    >
                                        <Icon name={IconName.FileText} className="w-4 h-4 flex-shrink-0" />
                                        <span className="truncate">{a.fileName || 'Attachment'}</span>
                                        <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5 flex-shrink-0" />
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ContentSection>
    );
};

// --- Course Sessions Section Component (Admin / Developer only) ---
const DAY_SESSION_COUNT = 11;
const EVENING_SESSION_COUNT = 3;
const MODE_OPTIONS = [
    { value: '1', label: '1 - Classroom Facilitated Training' },
    { value: '2', label: '2 - Asynchronous E-learning' },
    { value: '4', label: '4 - On the Job Training' },
    { value: '8', label: '8 - Assessment' },
    { value: '9', label: '9 - Synchronous E-learning' },
    { value: '10', label: '10 - Work-based/Workplace Learning' },
];

const CourseSessionsSection: React.FC<{ courseCode: string }> = ({ courseCode }) => {
    const [timing, setTiming] = React.useState<Record<string, string> | null>(null);
    const [draft, setDraft] = React.useState<Record<string, string>>({});
    const [loading, setLoading] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = React.useState(false);

    React.useEffect(() => {
        if (!courseCode) return;
        setLoading(true);
        setError(null);
        fetch(`/api/admin/course-session-timing?courseCode=${encodeURIComponent(courseCode)}`)
            .then(res => res.json())
            .then(json => { setTiming(json?.data ?? null); })
            .catch(() => setError('Failed to load session timing'))
            .finally(() => setLoading(false));
    }, [courseCode]);

    const startEdit = () => {
        setDraft(timing ? { ...timing } : {});
        setEditing(true);
        setSaveSuccess(false);
    };

    const cancelEdit = () => { setEditing(false); setDraft({}); };

    const setField = (key: string, value: string) => {
        setDraft(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/course-session-timing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseCode, ...draft }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
            setTiming(json.data ?? draft);
            setEditing(false);
            setDraft({});
            setSaveSuccess(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const buildRows = (t: Record<string, string>) => {
        const rows: { key: string; label: string; startKey: string; endKey: string; modeKey: string }[] = [];
        for (let i = 1; i <= DAY_SESSION_COUNT; i++) {
            rows.push({
                key: `day-${i}`, label: `Session ${i}`,
                startKey: `session_${i}_start_time`,
                endKey: `session_${i}_end_time`,
                modeKey: `session_${i}_mode_of_training`,
            });
        }
        for (let i = 1; i <= EVENING_SESSION_COUNT; i++) {
            rows.push({
                key: `eve-${i}`, label: `Session ${i} Evening`,
                startKey: `session_${i}_evening_start_time`,
                endKey: `session_${i}_evening_end_time`,
                modeKey: `session_${i}_evening_mode_of_training`,
            });
        }
        return rows;
    };

    const inputCls = 'w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono';

    const source = editing ? draft : (timing ?? {});
    const rows = buildRows(source);
    const hasAnyData = rows.some(r => source[r.startKey] || source[r.endKey] || source[r.modeKey]);

    return (
        <ContentSection title="Course Sessions">
            {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                    Loading session timing…
                </div>
            )}
            {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
            {saveSuccess && !editing && (
                <p className="text-sm text-green-600 dark:text-green-400 mb-2">Saved successfully.</p>
            )}
            {!loading && !timing && !editing && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No session timing configured for this course.</p>
            )}

            {!loading && (
                <>
                    {(hasAnyData || editing) && (
                        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 mb-4">
                            <table className="w-full text-sm border-collapse">
                                <thead className="bg-gray-50 dark:bg-gray-800">
                                    <tr>
                                        {['Session', 'Start Time', 'End Time', 'Mode of Training'].map(h => (
                                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-900">
                                    {rows.map(row => (
                                        <tr key={row.key} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                            <td className="px-4 py-2 text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{row.label}</td>
                                            {editing ? (
                                                <>
                                                    <td className="px-4 py-1.5">
                                                        <input type="time" value={draft[row.startKey] ?? ''} onChange={e => setField(row.startKey, e.target.value)} className={inputCls} />
                                                    </td>
                                                    <td className="px-4 py-1.5">
                                                        <input type="time" value={draft[row.endKey] ?? ''} onChange={e => setField(row.endKey, e.target.value)} className={inputCls} />
                                                    </td>
                                                    <td className="px-4 py-1.5">
                                                        {(() => {
                                                            const stored = draft[row.modeKey] ?? '';
                                                            const knownValues = MODE_OPTIONS.map(o => o.value);
                                                            return (
                                                                <select value={stored} onChange={e => setField(row.modeKey, e.target.value)} className={inputCls}>
                                                                    <option value="">— Select —</option>
                                                                    {stored && !knownValues.includes(stored) && (
                                                                        <option value={stored}>{stored}</option>
                                                                    )}
                                                                    {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                                </select>
                                                            );
                                                        })()}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="px-4 py-2 text-gray-900 dark:text-white font-mono">{source[row.startKey] || '—'}</td>
                                                    <td className="px-4 py-2 text-gray-900 dark:text-white font-mono">{source[row.endKey] || '—'}</td>
                                                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                                                        {source[row.modeKey]
                                                            ? (MODE_OPTIONS.find(o => o.value === String(source[row.modeKey]).trim())?.label ?? source[row.modeKey])
                                                            : '—'}
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="flex gap-2">
                        {editing ? (
                            <>
                                <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                                <button onClick={cancelEdit} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <button onClick={startEdit} className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                {timing ? 'Edit' : 'Add Session Timing'}
                            </button>
                        )}
                    </div>
                </>
            )}
        </ContentSection>
    );
};

// --- Certificate Section Component ---
const CertificateSection: React.FC<{ userRole: UserRole }> = ({ userRole }) => {
    const { certificate, selectedCourse } = useLms();
    const [localCertUrl, setLocalCertUrl] = React.useState<string | null>(null);
    const [verification, setVerification] = React.useState<{ checking: boolean, exists?: boolean }>({ checking: false });

    React.useEffect(() => {
        if (certificate?.certificate_url) {
            setLocalCertUrl(certificate.certificate_url);
        }
    }, [certificate?.certificate_url]);

    React.useEffect(() => {
        if (localCertUrl) {
            setVerification({ checking: true });
            fetch(`/api/certificates/verify-drive?url=${encodeURIComponent(localCertUrl)}`)
                .then(res => res.json())
                .then(data => {
                    setVerification({ checking: false, exists: data.exists === true });
                })
                .catch(() => {
                    setVerification({ checking: false, exists: false });
                });
        }
    }, [localCertUrl]);

    // Only show certificate section for learners
    if (userRole !== UserRole.Learner) {
        return null;
    }

    const isCompetent = selectedCourse?.assessmentStatus === 'Competent' || selectedCourse?.assessmentStatus === 'Passed';

    return (
        <ContentSection title="Certificate of Achievement">
            {isCompetent ? (
                <>
                    {localCertUrl ? (
                        verification.checking ? (
                            <div className="text-center p-8 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-200 dark:border-blue-800">
                                <Icon name={IconName.Spinner} className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
                                <h4 className="text-xl font-bold text-gray-900 dark:text-white">Verifying Certificate...</h4>
                                <p className="text-blue-700 dark:text-blue-400 mt-1 mb-4">Please wait while we locate your secure certificate record.</p>
                            </div>
                        ) : verification.exists ? (
                            <div className="text-center p-8 bg-green-50 dark:bg-green-900/30 rounded-xl border border-green-200 dark:border-green-800">
                                <Icon name={IconName.CheckCircle} className="w-16 h-16 text-green-500 mx-auto mb-4" />
                                <h4 className="text-xl font-bold text-gray-900 dark:text-white">Certificate Ready</h4>
                                <p className="text-green-700 dark:text-green-400 mt-1 mb-6">Your certificate has been formally issued and verified in the secure folder.</p>
                                <a href={localCertUrl} target="_blank" rel="noopener noreferrer" className="inline-block bg-primary text-white font-semibold py-2 px-6 rounded-lg hover:bg-secondary transition-colors shadow-md hover:shadow-lg">
                                    Download Certificate
                                </a>
                            </div>
                        ) : (
                            <div className="text-center p-8 bg-red-50 dark:bg-red-900/30 rounded-xl border border-red-200 dark:border-red-800">
                                <Icon name={IconName.Close} className="w-16 h-16 text-red-500 mx-auto mb-4" />
                                <h4 className="text-xl font-bold text-gray-900 dark:text-white">Certificate Missing</h4>
                                <p className="text-red-700 dark:text-red-400 mt-1 mb-4">You have achieved competency, but your certificate file could not be found in the secure folder.</p>
                                <p className="text-sm font-semibold text-gray-500">Please contact your training provider for assistance.</p>
                            </div>
                        )
                    ) : (
                        <div className="text-center p-8 bg-amber-50 dark:bg-amber-900/30 rounded-xl border border-amber-200 dark:border-amber-800">
                            <Icon name={IconName.Clock} className="w-16 h-16 text-amber-500 mx-auto mb-4 animate-pulse" />
                            <h4 className="text-xl font-bold text-gray-900 dark:text-white">Certificate Generating</h4>
                            <p className="text-amber-700 dark:text-amber-400 mt-1 mb-4">You have achieved competency! Your certificate is currently being securely generated.</p>
                            <p className="text-sm font-semibold text-gray-500 line-clamp-2">Please refresh the page in a few moments.</p>
                        </div>
                    )}
                </>
            ) : (
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md border border-gray-200 dark:border-gray-600 text-center">
                    <Icon name={IconName.FileText} className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 dark:text-gray-300 font-medium">Minimum Attendance Not Fulfilled</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        When you have fulfilled the minimum attendance requirement, your certificate will be available here.
                    </p>
                </div>
            )}
        </ContentSection>
    );
};

//---- Course Info Panel ---
const CourseInfoPanel: React.FC<{ course: Course; userRole: UserRole }> = ({ course, userRole }) => {
    const totalDuration = Number(course.trainingHours) + Number(course.assessmentHours);

    const DetailRow = ({ label, value }: { label: string, value: string | number }) => (
        <div className="flex justify-between items-start gap-4">
            <p className="text-gray-500 dark:text-gray-400 flex-shrink-0">{label}</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100 text-right">{value}</p>
        </div>
    );
    console.log("course code", course.courseCode);
    console.log('tsc ref', course.tscCode);

    return (
        <div className="p-6 border-b dark:border-gray-700">
            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-6">Course Details</h3>
            <div className="space-y-4 text-sm">
                <DetailRow label="Course Title" value={course.title} />
                <DetailRow label="Course Ref Code" value={displayCourseCodes(course)} />
                <DetailRow label="TSC Title" value={course.tscTitle || 'N/A'} />
                <DetailRow label="TSC Code" value={course.tscCode || 'N/A'} />
                {(() => {
                    const expiry = course.fundingValidity ? new Date(course.fundingValidity) : null;
                    const isExpired = expiry ? expiry < new Date() : false;
                    const formatted = expiry ? expiry.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
                    return (
                        <div className="flex justify-between items-start gap-4">
                            <p className="text-gray-500 dark:text-gray-400 flex-shrink-0">Funding Validity</p>
                            <p className={`font-semibold text-right ${expiry && isExpired ? 'text-red-600 dark:text-red-400' : expiry ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'}`}>
                                {formatted}{expiry ? (isExpired ? ' (Expired)' : ' (Valid)') : ''}
                            </p>
                        </div>
                    );
                })()}
                {/* Course run fields — hide for Developer, TP, and Admin (admin views course-level, not run-level) */}
                {userRole !== UserRole.Developer && userRole !== UserRole.TrainingProvider && userRole !== UserRole.Admin && (
                    <>
                        <DetailRow label="Course Run ID" value={course.courseRunId} />
                        <DetailRow label="Digital Attendance ID" value={course.daId || 'N/A'} />
                        <DetailRow label="Start Date" value={course.startDate ? new Date(course.startDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'} />
                        <DetailRow label="End Date" value={course.endDate ? new Date(course.endDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'} />
                        <DetailRow label="Class Type" value={
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                course.classType === 'Virtual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                                : course.classType === 'Hybrid' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                                {course.classType || 'Physical'}
                            </span>
                        } />
                        <DetailRow label="Class Status" value={(() => {
                            const status = (course.classStatus || '').toLowerCase();
                            const styleMap: Record<string, string> = {
                                cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
                                pending:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                                confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                            };
                            const style = styleMap[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
                            const label = course.classStatus || 'N/A';
                            return (
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${style}`}>
                                    {label}
                                </span>
                            );
                        })()} />
                    </>
                )}

                <div className="pt-4">
                    <p className="font-semibold text-gray-500 dark:text-gray-400 mb-3">Course Duration</p>
                    <div className="space-y-3">
                        <div className="flex justify-between items-baseline">
                            <p className="text-gray-500 dark:text-gray-400">Training Hours:</p>
                            <p className="font-semibold text-gray-900 dark:text-gray-100">{course.trainingHours}</p>
                        </div>
                        <div className="flex justify-between items-baseline">
                            <p className="text-gray-500 dark:text-gray-400">Assessment Hours:</p>
                            <p className="font-semibold text-gray-900 dark:text-gray-100">{course.assessmentHours}</p>
                        </div>
                        <div className="flex justify-between items-baseline font-bold pt-2 border-t dark:border-gray-700">
                            <p className="text-gray-900 dark:text-white">Total Duration:</p>
                            <p className="text-gray-900 dark:text-white">{totalDuration}</p>
                        </div>
                    </div>
                </div>


            </div>
        </div>
    );
};

// --- Course Sidebar ---
interface CourseSidebarProps {
    userRole: UserRole;
    onSetGradingView: (isGrading: boolean) => void;
    selectedCourse: Course;
    onMobileItemClick?: () => void;
}

type NavItem = { type: 'link'; label: string; icon: IconName } | { type: 'separator' };

const CourseSidebar: React.FC<CourseSidebarProps> = ({ userRole, onSetGradingView, selectedCourse, onMobileItemClick }) => {
    const { setTrainerPage, setSelectedCourse, trainingProviderProfile } = useLms();
    const defaultActive = 'Lesson';
    const [activeItem, setActiveItem] = useState(defaultActive);
    const showLessonPlanForLearner = !!trainingProviderProfile?.showLessonPlanLearnerView;

    const handleItemClick = (label: string) => {
        onSetGradingView(false);
        setActiveItem(label);

        let targetId = toId(label);
        if (label === 'Lesson' || label === 'Lessons') targetId = 'lessons';
        else if (label === 'Lesson Plan' || label === 'Learner Guide' || label === 'Learner Slides') targetId = toId('Courseware Link');
        else if (label === 'Assessment' || label === 'Assessments') targetId = 'assessments';
        else if (label === 'Certificate') targetId = 'certificate';
        else if (label === 'Announcements') targetId = 'announcements';
        else if (label === 'Assessment Summary Record') targetId = toId(label);
        else if (label === 'Grading') targetId = 'assessment-grading';

            const element = document.getElementById(targetId);
            if (element) {
                const yOffset = -90;
                const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
                window.scrollTo({ top: y, behavior: 'smooth' });
            }
        if (onMobileItemClick) {
            onMobileItemClick();
        }
    };

    const learnerNavItems: NavItem[] = [
        { type: 'link', label: "E-Attendance", icon: IconName.ClipboardCheck },
        ...(showLessonPlanForLearner ? [{ type: 'link', label: "Lesson Plan", icon: IconName.BookOpen } as NavItem] : []),
        { type: 'link', label: "Learner Guide", icon: IconName.FileText },
        { type: 'link', label: "Learner Slides", icon: IconName.FileText },
        { type: 'link', label: "Lesson", icon: IconName.BookOpen },
        { type: 'link', label: "TRAQOM Survey", icon: IconName.Edit },
        { type: 'link', label: "Briefing on Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Announcements", icon: IconName.Bell },
        { type: 'link', label: "Certificate", icon: IconName.FileText },
    ];

    let trainerNavItems: NavItem[] = [
        { type: 'link', label: "E-Attendance", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Courseware Link", icon: IconName.Link },
        { type: 'link', label: "Assessment Grading", icon: IconName.Edit },
        { type: 'link', label: "Assessment Summary Record", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Lesson Plan", icon: IconName.BookOpen },
        { type: 'link', label: "Learner Guide", icon: IconName.FileText },
        { type: 'link', label: "Facilitator Guide", icon: IconName.FileText },
        { type: 'link', label: "Learner Slides", icon: IconName.FileText },
        { type: 'link', label: "Trainer Slides", icon: IconName.FileText },
        { type: 'link', label: "Assessment Plan", icon: IconName.ClipboardCheck },
        { type: 'separator' },
        { type: 'link', label: "Lesson", icon: IconName.BookOpen },
        { type: 'link', label: "TRAQOM Survey", icon: IconName.Edit },
        { type: 'link', label: "Briefing on Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Grading", icon: IconName.Edit },
        { type: 'link', label: "Announcements", icon: IconName.Bell },
    ];

    if (userRole === UserRole.Developer || userRole === UserRole.Admin) {
        trainerNavItems = [
            ...trainerNavItems,
            { type: 'link', label: "Course Sessions", icon: IconName.ClipboardCheck },
        ];
    }

    if (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) {
        trainerNavItems = trainerNavItems.filter(item =>
            item.type === 'separator' ||
            (item.label !== "TRAQOM Survey" && item.label !== "Grading" && item.label !== "Briefing on Assessment")
        );
    } else if (userRole === UserRole.Trainer) {
        trainerNavItems = trainerNavItems.filter(item =>
            item.type === 'separator' ||
            (item.label !== "TRAQOM Survey" && item.label !== "Learner Slides")
        );
    }

    const navItems = userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin ? trainerNavItems : learnerNavItems;

    return (
        <>
            {(userRole === UserRole.Learner || userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && <CourseInfoPanel course={selectedCourse} userRole={userRole} />}
            <ul className="space-y-1 p-2">
                {navItems.map((item, index) => {
                    if (item.type === 'separator') {
                        return <li key={`sep-${index}`}><div className="border-t my-2 mx-4" /></li>;
                    }

                    return (
                        <li key={item.label}>
                            <a
                                href={`#${toId(item.label)}`}
                                onClick={(e) => { e.preventDefault(); handleItemClick(item.label); }}
                                className={`flex items-center space-x-3 px-4 py-3 rounded-md font-semibold transition-colors ${activeItem === item.label ? 'bg-primary/10 text-primary' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                            >
                                <Icon name={item.icon} className="w-5 h-5" />
                                <span>{item.label}</span>
                            </a>
                        </li>
                    );
                })}
            </ul>
        </>
    );
};

// --- Topic Accordion Component ---
const isUrl = (str: string) => /^https?:\/\//i.test(str) || /^www\./i.test(str);

interface QuizResourceQuestion {
    id: string;
    question: string;
    options: string[];
    correctIndex: number;
}

interface TopicAccordionProps {
    topic: Topic;
    progress: number;
    bookmarkedSubtopics: Set<string>;
    onToggleBookmark: (e: React.MouseEvent, subtopicId: string) => void;
    userRole: UserRole;
    completedSubtopics: Set<string>;
    onToggleCompletion: (subtopicId: string) => void;
    completedTopics: Set<string>;
    onToggleTopicCompletion: (topicId: string) => void;
    resourceLinks?: { id: string; topicId: string; type: string; title: string; url: string; instructions?: string; questions?: QuizResourceQuestion[] }[];
    // Quiz-related props: when present, enable the learner-facing Take Quiz
    // flow inside this accordion's subtopic resource rows.
    userId?: string;
    courseId?: string;
    latestQuizScores?: Record<string, { score: number; total: number }>;
    onQuizSubmitted?: (quizId: string, result: { score: number; total: number }) => void;
}

export const TopicAccordion: React.FC<TopicAccordionProps> = ({ topic, progress, bookmarkedSubtopics, onToggleBookmark, userRole, completedSubtopics, onToggleCompletion, completedTopics, onToggleTopicCompletion, resourceLinks = [], userId, courseId, latestQuizScores, onQuizSubmitted }) => {
    const [openQuizId, setOpenQuizId] = React.useState<string | null>(null);
    const [isOpen, setIsOpen] = React.useState(true);
    const displayTitle = topic.title.replace('Module', 'Learning Unit');

    const hasSubtopics = topic.subtopics.length > 0;
    // For topics WITH subtopics: all-complete when every subtopic is ticked
    const isAllCompleted = hasSubtopics
        ? topic.subtopics.every(st => completedSubtopics.has(st.id))
        : completedTopics.has(topic.id);

    const handleMarkTopicComplete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (hasSubtopics) {
            if (isAllCompleted) {
                topic.subtopics.forEach(st => onToggleCompletion(st.id));
            } else {
                topic.subtopics.filter(st => !completedSubtopics.has(st.id)).forEach(st => onToggleCompletion(st.id));
            }
        } else {
            // No subtopics — use topic-level toggle
            onToggleTopicCompletion(topic.id);
        }
    };

    return (
        <Card>
            <button
                className="w-full text-left p-4 flex justify-between items-center"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex-grow mr-4">
                    <h4 className="font-bold text-lg text-gray-900 dark:text-white">{displayTitle}</h4>
                    {userRole === UserRole.Learner && (
                        <div className="flex items-center mt-2 gap-2">
                            <p className="text-sm font-bold text-green-600 w-12 flex-shrink-0">{progress.toFixed(0)}%</p>
                            <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                            </div>
                            <button
                                onClick={handleMarkTopicComplete}
                                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0 ${
                                    isAllCompleted
                                        ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                                        : 'bg-surface text-on-surface-secondary border-default hover:bg-surface-elevated hover:text-on-surface'
                                }`}
                            >
                                {isAllCompleted ? '✓ Completed' : 'Mark Complete'}
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <Icon name={IconName.ChevronDown} className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
            </button>
            {isOpen && hasSubtopics && (
                <div className="px-4 pb-2">
                    <ul className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                            {topic.subtopics.map(subtopic => {
                                const isBookmarked = bookmarkedSubtopics.has(subtopic.id);
                                const isCompleted = completedSubtopics.has(subtopic.id);
                                const titleIsUrl = isUrl(subtopic.title);
                                const subtopicLinks = resourceLinks.filter(rl => rl.topicId === subtopic.id);
                                return (
                                    <li key={subtopic.id} className="py-3">
                                        <div className="flex items-center justify-between">
                                            <label htmlFor={`subtopic-complete-${subtopic.id}`} className="flex items-center flex-grow cursor-pointer group min-w-0">
                                                {userRole === UserRole.Learner && (
                                                    <input
                                                        id={`subtopic-complete-${subtopic.id}`}
                                                        type="checkbox"
                                                        checked={isCompleted}
                                                        onChange={(e) => {
                                                            e.stopPropagation();
                                                            onToggleCompletion(subtopic.id);
                                                        }}
                                                        className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary mr-3 flex-shrink-0"
                                                        aria-label={`Mark '${subtopic.title}' as complete`}
                                                    />
                                                )}
                                                <Icon name={IconName.FileText} className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                                                {titleIsUrl ? (
                                                    <a
                                                        href={subtopic.title}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={e => e.stopPropagation()}
                                                        className={`font-medium text-primary hover:underline truncate transition-colors ${isCompleted ? 'line-through opacity-50' : ''}`}
                                                    >
                                                        {subtopic.title}
                                                    </a>
                                                ) : (
                                                    <span className={`font-medium text-gray-800 dark:text-gray-200 group-hover:text-primary transition-colors ${isCompleted ? 'line-through text-gray-500 dark:text-gray-500' : ''}`}>
                                                        {subtopic.title}
                                                    </span>
                                                )}
                                            </label>
                                            {(userRole === UserRole.Learner || userRole === UserRole.Trainer) && (
                                                <button
                                                    onClick={(e) => onToggleBookmark(e, subtopic.id)}
                                                    className={`p-2 rounded-full transition-colors flex-shrink-0 ${isBookmarked ? 'text-primary bg-primary/10' : 'text-gray-500 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                                    aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                                                >
                                                    <Icon name={isBookmarked ? IconName.Bookmark : IconName.Bookmark} className="w-5 h-5" />
                                                </button>
                                            )}
                                        </div>
                                        {subtopicLinks.length > 0 && (
                                            <div className="ml-11 mt-2 space-y-1.5">
                                                {subtopicLinks.map(rl => {
                                                    // Activity resources can carry free-text instructions
                                                    // instead of a URL. If `instructions` is set and
                                                    // non-empty, render a non-clickable block with the
                                                    // title + text; otherwise fall through to the normal
                                                    // anchor-tag rendering.
                                                    // Quiz: learners get a Take Quiz button that opens
                                                    // the QuizTakerModal. Developers / admins / trainers
                                                    // just see a summary badge (no taker UI — they
                                                    // already author the quiz from CourseEditor).
                                                    const isQuiz = rl.type === 'quiz' && Array.isArray(rl.questions) && rl.questions.length > 0;
                                                    if (isQuiz) {
                                                        const questions = rl.questions as QuizResourceQuestion[];
                                                        const prev = latestQuizScores?.[rl.id] || null;
                                                        const canTake = userRole === UserRole.Learner && !!userId && !!courseId;
                                                        return (
                                                            <div key={rl.id}>
                                                                <div className="p-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 flex items-center justify-between gap-2">
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <Icon
                                                                            name={IconName.FileText}
                                                                            className="w-3.5 h-3.5 flex-shrink-0 text-green-600 dark:text-green-400"
                                                                        />
                                                                        <span className="text-sm font-semibold text-green-700 dark:text-green-300 truncate">
                                                                            {rl.title || 'Quiz'}
                                                                        </span>
                                                                        <span className="text-[11px] text-green-600/80 dark:text-green-400/80 flex-shrink-0">
                                                                            · {questions.length} question{questions.length === 1 ? '' : 's'}
                                                                        </span>
                                                                        {prev && (
                                                                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-green-200 dark:bg-green-800/60 text-green-800 dark:text-green-200 flex-shrink-0">
                                                                                Last: {prev.score}/{prev.total}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {canTake && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setOpenQuizId(rl.id);
                                                                            }}
                                                                            className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                                                                        >
                                                                            {prev ? 'Retake Quiz' : 'Take Quiz'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {openQuizId === rl.id && canTake && (
                                                                    <QuizTakerModal
                                                                        title={rl.title || 'Quiz'}
                                                                        questions={questions}
                                                                        userId={userId!}
                                                                        courseId={courseId!}
                                                                        quizId={rl.id}
                                                                        previousScore={prev}
                                                                        onClose={() => setOpenQuizId(null)}
                                                                        onSubmitted={(result) => {
                                                                            onQuizSubmitted?.(rl.id, result);
                                                                        }}
                                                                    />
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    const hasInstructions =
                                                        rl.type === 'activity' &&
                                                        typeof rl.instructions === 'string' &&
                                                        rl.instructions.trim().length > 0;
                                                    if (hasInstructions) {
                                                        return (
                                                            <div
                                                                key={rl.id}
                                                                className="p-2 rounded-md bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/50"
                                                            >
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <Icon
                                                                        name={IconName.Award}
                                                                        className="w-3.5 h-3.5 flex-shrink-0 text-purple-600 dark:text-purple-400"
                                                                    />
                                                                    <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                                                                        {rl.title || 'Activity'}
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                                                                    {rl.instructions}
                                                                </p>
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <a
                                                            key={rl.id}
                                                            href={rl.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-400 hover:underline"
                                                        >
                                                            <Icon
                                                                name={rl.type === 'youtube' ? IconName.Video : rl.type === 'quiz' ? IconName.FileText : rl.type === 'document' ? IconName.FileText : rl.type === 'activity' ? IconName.Award : IconName.ExternalLink}
                                                                className="w-3.5 h-3.5 flex-shrink-0"
                                                            />
                                                            <span className="truncate">{rl.title || rl.url}</span>
                                                        </a>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                    </ul>
                </div>
            )}
        </Card>
    );
}

// --- Main Course Detail Component ---
export const CourseDetail: React.FC = () => {
    const {
        selectedCourse,
        setSelectedCourse,
        courseDetail,
        resourceLinks,
        learningUnits,
        courseAssessments,
        bookmarkedSubtopics,
        completedSubtopics,
        completedTopics,
        toggleBookmark,
        toggleCompletion,
        toggleTopicCompletion,
        setEditingCourse,
        setAdminPage,
        setTrainerPage,
        setPendingAttendanceCourseRunId,
        setPendingGradingCourseRunId,
        currentUser,
        role,
        trainingProviderProfile,
    } = useLms();

    const handleFileDownload = (filePath: string, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
        }

        if (!filePath) return;

        // Remove leading slash if present to normalize the path
        let cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

        // Fix assessment file paths: if it starts with "assessments/", prepend "uploads/"
        if (cleanPath.startsWith('assessments/')) {
            cleanPath = `uploads/${cleanPath}`;
        }

        // Use the dynamic download API that can handle any file in public directory
        const downloadUrl = getApiUrl(`/api/download/${cleanPath}`);

        // Create a temporary link and trigger download
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = extractFilenameFromPath(filePath); // Use original filename
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const [isGradingView, setIsGradingView] = useState(false);
    const [isLessonsOpen, setIsLessonsOpen] = useState(true);
    // Latest quiz score per quizId for this learner on this course, used
    // to show a "Last: 7/10" badge on the Quiz card without refetching.
    const [latestQuizScores, setLatestQuizScores] = useState<Record<string, { score: number; total: number }>>({});
    const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
    const [isTraqomOpen, setIsTraqomOpen] = useState(false);
    const [isCourseMenuOpen, setIsCourseMenuOpen] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

    // Loading state
    const [isLoading, setIsLoading] = useState(true);

    // Developer-specific state
    const [developerCourseDetail, setDeveloperCourseDetail] = useState<any>(null);
    const [developerLearningUnits, setDeveloperLearningUnits] = useState<any[]>([]);
    const [developerAssessments, setDeveloperAssessments] = useState<any[]>([]);

    // Use actual user role from context
    const userRole = role || UserRole.Learner;

    // Load developer-specific data
    useEffect(() => {
        const loadDeveloperData = async () => {
            setIsLoading(true);
            if ((userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && selectedCourse?.id) {
                try {
                    // Load developer course detail (use courseId instead of courseRunId)
                    const detailResponse = await fetch(`/api/courses/developer-course-detail?courseId=${selectedCourse.id}&_t=${Date.now()}`);
                    const detailResult = await detailResponse.json();

                    if (detailResult.success) {
                        setDeveloperCourseDetail(detailResult.data);
                    }

                    // Load developer learning units
                    const unitsResponse = await fetch(`/api/courses/developer-learning-units?courseId=${selectedCourse.id}`);
                    const unitsResult = await unitsResponse.json();

                    if (unitsResult.success) {
                        setDeveloperLearningUnits(unitsResult.data);
                    }

                    // Load developer assessments (use courseId instead of courseRunId)
                    const assessmentsResponse = await fetch(`/api/courses/developer-course-assessments?courseId=${selectedCourse.id}`);
                    const assessmentsResult = await assessmentsResponse.json();

                    if (assessmentsResult.success) {
                        setDeveloperAssessments(assessmentsResult.data);
                    }
                } catch (error) {
                    console.error('❌ CourseDetail: Failed to load developer data:', error);
                }
            }
            setIsLoading(false);
        };

        loadDeveloperData();
    }, [userRole, selectedCourse?.id]);

    // For non-developer roles, track when courseDetail from context is loaded
    useEffect(() => {
        if (userRole === UserRole.Learner || userRole === UserRole.Trainer) {
            if (courseDetail) {
                setIsLoading(false);
            } else {
                setIsLoading(true);
            }
        }
    }, [userRole, courseDetail]);

    // Fetch this learner's prior quiz attempts on this course so we can show
    // a "Last: 7/10" badge next to each Quiz resource. Only runs for learners.
    useEffect(() => {
        if (userRole !== UserRole.Learner) return;
        if (!currentUser?.id || !selectedCourse?.id) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/courses/quiz-attempts?userId=${currentUser.id}&courseId=${selectedCourse.id}`);
                const data = await res.json();
                if (cancelled || !data?.success || !Array.isArray(data.data)) return;
                // Rows come back ordered by completed_at DESC, so the first
                // row we see per quiz_id is already the latest attempt.
                const latest: Record<string, { score: number; total: number }> = {};
                for (const row of data.data) {
                    if (!latest[row.quiz_id]) {
                        latest[row.quiz_id] = { score: row.score, total: row.total };
                    }
                }
                setLatestQuizScores(latest);
            } catch (err) {
                console.error('❌ CourseDetail: failed to load quiz attempts', err);
            }
        })();
        return () => { cancelled = true; };
    }, [userRole, currentUser?.id, selectedCourse?.id]);

    const handleQuizSubmitted = React.useCallback((quizId: string, result: { score: number; total: number }) => {
        setLatestQuizScores(prev => ({ ...prev, [quizId]: result }));
    }, []);

    if (!selectedCourse) {
        return null;
    }

    // Loading Skeleton Component
    const LoadingSkeleton = () => (
        <div className="animate-pulse space-y-6">
            {/* Back button skeleton */}
            <div className="flex justify-between items-center mb-6">
                <div className="h-10 w-40 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
                <div className="flex gap-3">
                    <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
                </div>
            </div>

            {/* Content sections skeleton */}
            {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="p-6">
                    <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                    <div className="space-y-3">
                        <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-md"></div>
                    </div>
                </Card>
            ))}

            {/* Lessons skeleton */}
            <Card className="p-6">
                <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                            <div className="h-5 w-64 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );

    // Convert your existing data structure to match the old component's expectations
    // Use developer data if available, otherwise fall back to context data
    const contextDetail = courseDetail;
    const contextUnits = learningUnits;

    const effectiveDetail = (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && developerCourseDetail ? developerCourseDetail : contextDetail;
    const effectiveUnits = (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && developerLearningUnits.length > 0 ? developerLearningUnits : contextUnits;

    const convertedCourse: Course & {
        facilitatorGuideUrl?: string;
        trainerSlidesUrl?: string;
        activitiesUrl?: string;
        assessmentPlanUrl?: string;
    } = {
        id: selectedCourse.id || '1',
        title: effectiveDetail?.title || selectedCourse.title,
        courseCode: effectiveDetail?.tgsRef || selectedCourse.courseCode, // Use tgsRef from courseDetail as courseCode
        courseRunId: effectiveDetail?.courseRunId || selectedCourse.courseRunId || selectedCourse.courseCode,
        tscTitle: effectiveDetail?.tscTitle,
        tscCode: effectiveDetail?.tscCode,
        trainingHours: effectiveDetail?.trainingHours || selectedCourse.trainingHours,
        assessmentHours: effectiveDetail?.assessmentHours || selectedCourse.assessmentHours,
        startDate: effectiveDetail?.startDate || selectedCourse.startDate,
        endDate: effectiveDetail?.endDate || selectedCourse.endDate,
        courseType: selectedCourse.courseType,
        modeOfLearning: selectedCourse.modeOfLearning,
        classStatus: selectedCourse.classStatus,
        totalAssessments: selectedCourse.totalAssessments,
        daId: effectiveDetail?.digitalAttendanceId,
        lessonPlanUrl: effectiveDetail?.lessonPlanUrl,
        learnerGuideUrl: effectiveDetail?.learnerGuideUrl,
        slidesUrl: effectiveDetail?.slidesUrl,
        // Add trainer-specific URLs
        facilitatorGuideUrl: effectiveDetail?.facilitatorGuideUrl,
        trainerSlidesUrl: effectiveDetail?.trainerSlidesUrl,
        activitiesUrl: effectiveDetail?.activitiesUrl,
        assessmentPlanUrl: effectiveDetail?.assessmentPlanUrl,
        courseLink: effectiveDetail?.courseLink,
        assessmentRecordLink: effectiveDetail?.assessmentRecordLink,
        assessmentSummaryRecordUrl: effectiveDetail?.assessmentSummaryRecordUrl,
        writtenAssessmentLink: effectiveDetail?.writtenAssessmentLink,
        practicalPerformanceAssessmentLink: effectiveDetail?.practicalPerformanceAssessmentLink,
        classType: (effectiveDetail as any)?.classType || selectedCourse.classType || 'Physical',
        virtualMeetingLink: (effectiveDetail as any)?.virtualMeetingLink || selectedCourse.virtualMeetingLink || null,
        virtualMeetingHostLink: (effectiveDetail as any)?.virtualMeetingHostLink || selectedCourse.virtualMeetingHostLink || null,
        virtualMeetingJoinLink: (effectiveDetail as any)?.virtualMeetingJoinLink || selectedCourse.virtualMeetingJoinLink || null,
        virtualMeetingProvider: (effectiveDetail as any)?.virtualMeetingProvider || selectedCourse.virtualMeetingProvider || null,
        fundingValidity: (effectiveDetail as any)?.fundingValidity || selectedCourse.fundingValidity || undefined,
        assessmentMethods: effectiveDetail?.assessmentMethods || undefined,
        publishedAssessmentMethods: effectiveDetail?.publishedAssessmentMethods || {},
        writtenAssessmentPublished: userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider
            ? true
            : effectiveDetail?.writtenAssessmentPublished ?? false,
        practicalAssessmentPublished: userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider
            ? true
            : effectiveDetail?.practicalAssessmentPublished ?? false,
        topics: effectiveUnits?.map((unit, index) => ({
            id: unit.id || `topic-${index}`,
            title: unit.title,
            subtopics: unit.subtopics?.map((subtopic: any) => ({
                id: subtopic.id, // Use real subtopic ID from database
                title: subtopic.title
            })) || []
        })) || selectedCourse.topics || [], // Fallback to selectedCourse topics if no effectiveUnits
        assessments: courseAssessments?.map(assessment => ({
            id: assessment.id,
            title: assessment.title,
            category: assessment.category,
            status: assessment.status,
            file_url: assessment.file_url
        })) || selectedCourse.assessments || [], // Fallback to selectedCourse assessments
        learners: [{
            email: currentUser?.email || "",
            name: currentUser?.fullName || "",
            progressPercent: selectedCourse.progressPercent || 0,
            completedSubtopics: [],
            submissions: []
        }],
        bookmarkedSubtopics: []
    };

    const handleBackToDashboard = () => {
        setSelectedCourse(null);
    };

    const handleEditCourse = async () => {
        if (!selectedCourse?.id) return;

        try {
            const response = await fetch(`/api/courses/edit-data?courseId=${selectedCourse.id}&_t=${Date.now()}`);
            const result = await response.json();

            if (result.success && result.data) {
                setEditingCourse(result.data);
            } else {
                console.error('❌ Failed to load course edit data:', result.message);
                alert('Failed to load course data for editing. Please try again.');
            }
        } catch (error) {
            console.error('❌ Error loading course edit data:', error);
            alert('Failed to load course data for editing. Please try again.');
        }
    };

    const handleDeleteCourse = async () => {
        if (!selectedCourse?.id) return;

        // Show custom confirmation dialog
        setShowDeleteConfirmation(true);
    };

    const confirmDeleteCourse = async () => {
        if (!selectedCourse?.id) return;

        setShowDeleteConfirmation(false);

        try {
            console.log('🗑️ Deleting course:', selectedCourse.id);
            const result = await courseService.deleteCourse(selectedCourse.id.toString());

            if (result.success) {
                console.log('✅ Course deleted successfully');
                alert('Course deleted successfully');
                // Navigate back to course list
                setSelectedCourse(null);
            } else {
                console.error('❌ Failed to delete course:', result.message);
                alert(`Failed to delete course: ${result.message}`);
            }
        } catch (error) {
            console.error('❌ Error deleting course:', error);
            alert('Failed to delete course. Please try again.');
        }
    };

    const handleToggleBookmark = (e: React.MouseEvent, subtopicId: string) => {
        e.preventDefault();
        e.stopPropagation();
        toggleBookmark(subtopicId);
    };

    const handleToggleCompletion = (subtopicId: string) => {
        toggleCompletion(subtopicId);
    };

    const bookmarkedSubtopicsSet = new Set(bookmarkedSubtopics);
    const completedSubtopicsSet = new Set(completedSubtopics);
    const completedTopicsSet = new Set(completedTopics);

    const traqomSurveyLink = 'https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr';
    const traqomQrCodeUrl = '/qr_codes/traqom_survey_qr_code.png';
    // Certificate Delivery card now points to the customizable feedback form.
    // Admin can override the URL via training_provider.feedback_form_external_link.
    // Use whichever class identifier is available: real UUID, the TGS-* code, or course code.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const feedbackRouteId = selectedCourse?.courseRunUuid
        || selectedCourse?.courseRunId
        || convertedCourse?.courseCode
        || '';
    const builtInFeedbackUrl = feedbackRouteId ? `${origin}/feedback/${encodeURIComponent(feedbackRouteId)}` : '';
    const certDeliveryLink = trainingProviderProfile?.feedbackFormExternalLink
        || builtInFeedbackUrl
        || trainingProviderProfile?.certificateDeliveryLink
        || 'https://goo.gl/R2eumq';
    const certDeliveryQrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(certDeliveryLink)}`;

    const attendanceLink = convertedCourse.daId ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${convertedCourse.daId}` : null;
    // const attendanceQrCodeUrl = attendanceLink ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(attendanceLink)}` : null;

    // Helper to check if URL is external (Google Drive, etc.)
    const isExternalUrl = (url?: string) => url?.startsWith('http');

    const isLessonPlanExternal = isExternalUrl(convertedCourse.lessonPlanUrl);
    const isLearnerGuideExternal = isExternalUrl(convertedCourse.learnerGuideUrl);
    const isLearnerSlidesExternal = isExternalUrl(convertedCourse.slidesUrl);

    // Gate materials for Learners: accessible only on/after startDate at 08:30 SGT
    const materialsUnlockTime = (() => {
        const raw = convertedCourse.startDate;
        if (!raw) return null;
        // Convert to SGT date string (handles both DATE strings and TIMESTAMP objects)
        // en-CA locale reliably returns YYYY-MM-DD format
        const sgtDateStr = new Date(raw).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
        // 08:30 SGT = 00:30 UTC
        return new Date(`${sgtDateStr}T00:30:00.000Z`);
    })();
    const isMaterialsUnlocked = userRole !== UserRole.Learner || !materialsUnlockTime || new Date() >= materialsUnlockTime;
    const isTrainerSlidesExternal = isExternalUrl(convertedCourse.trainerSlidesUrl);
    const isActivitiesExternal = isExternalUrl(convertedCourse.activitiesUrl);
    const isFacilitatorGuideExternal = isExternalUrl(convertedCourse.facilitatorGuideUrl);
    const isAssessmentPlanExternal = isExternalUrl(convertedCourse.assessmentPlanUrl);

    return (
        <div className="relative">
            {/* Delete Confirmation Dialog */}
            {showDeleteConfirmation && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-auto">
                        <div className="p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                                    <Icon name={IconName.Delete} className="w-6 h-6 text-red-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Delete Course</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">This action cannot be undone</p>
                                </div>
                            </div>

                            <div className="mb-6">
                                <p className="text-gray-700 dark:text-gray-300 mb-4">
                                    Are you sure you want to delete the course <strong>"{selectedCourse?.title}"</strong>?
                                </p>
                            </div>

                            <div className="flex gap-3 justify-end">
                                <Button
                                    variant="primary"
                                    onClick={() => setShowDeleteConfirmation(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={confirmDeleteCourse}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    Delete Course
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Show Grading View for Trainers */}
            {userRole === UserRole.Trainer && isGradingView ? (
                <GradingView onBack={() => setIsGradingView(false)} />
            ) : (
                <>
                    {/* Mobile Menu Toggle Button */}
                    <div className="xl:hidden mb-4">
                        <Button onClick={() => setIsCourseMenuOpen(true)} className="w-full justify-center">
                            <Icon name={IconName.Menu} className="w-5 h-5 mr-2" />
                            Course Menu
                        </Button>
                    </div>

                    {/* Mobile Sidebar (Overlay) */}
                    {isCourseMenuOpen && (
                        <div
                            className="fixed inset-0 bg-black/50 z-40 xl:hidden"
                            onClick={() => setIsCourseMenuOpen(false)}
                        >
                            <div
                                className="absolute left-0 top-0 h-full w-72 max-w-[calc(100%-3rem)] bg-white dark:bg-gray-800 shadow-xl flex flex-col"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="p-4 flex justify-between items-center border-b dark:border-gray-700 flex-shrink-0">
                                    <h3 className="font-bold dark:text-white">Course Menu</h3>
                                    <button onClick={() => setIsCourseMenuOpen(false)} className="p-2 -mr-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                                        <Icon name={IconName.X} className="w-6 h-6" />
                                    </button>
                                </div>
                                <div className="overflow-y-auto">
                                    <CourseSidebar
                                        userRole={userRole}
                                        onSetGradingView={setIsGradingView}
                                        selectedCourse={convertedCourse}
                                        onMobileItemClick={() => setIsCourseMenuOpen(false)}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="xl:grid xl:grid-cols-[320px_minmax(0,1fr)] xl:gap-8">
                        {/* Desktop Sidebar */}
                        <aside className="hidden xl:block">
                            <Card className="">
                                <CourseSidebar userRole={userRole} onSetGradingView={setIsGradingView} selectedCourse={convertedCourse} />
                            </Card>
                        </aside>

                        {/* Main Content */}
                        <main className="space-y-6">
                            {/* Back Button + Action Buttons */}
                            {(userRole === UserRole.Developer || userRole === UserRole.Admin) && (
                            <div className="mb-6 flex justify-between items-center">
                                {userRole === UserRole.Developer ? (
                                <button
                                    onClick={handleBackToDashboard}
                                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white rounded-lg flex items-center gap-2"
                                >
                                    Back to All Courses
                                </button>
                                ) : <div />}
                                {!isLoading && (
                                <div className="ml-auto flex gap-3">
                                    {userRole === UserRole.Admin && (
                                        <Button onClick={() => setAdminPage(AdminPage.AddCourseRun)} leftIcon={<Icon name={IconName.Add} className="w-4 h-4" />}>
                                            Add Course Run
                                        </Button>
                                    )}
                                    {(userRole === UserRole.Developer || userRole === UserRole.Admin) && (
                                        <Button onClick={handleEditCourse} leftIcon={<Icon name={IconName.Edit} className="w-4 h-4" />}>
                                            Edit Course
                                        </Button>
                                    )}
                                    {(userRole === UserRole.Developer || userRole === UserRole.Admin) && (
                                        <Button onClick={handleDeleteCourse} leftIcon={<Icon name={IconName.Delete} className="w-4 h-4" />}>
                                            Delete Course
                                        </Button>
                                    )}
                                </div>
                                )}
                            </div>
                            )}

                            {/* Show loading skeleton while data is being fetched */}
                            {isLoading ? (
                                <LoadingSkeleton />
                            ) : (
                            <>
                            {/* E-Attendance */}
                            {userRole === UserRole.Trainer && (
                                <div id={toId("E-Attendance")}>
                                    <ContentSection title="E-Attendance">
                                        <button
                                            onClick={() => {
                                                // Pass the UUID for matching in E-Attendance dashboard
                                                // effectiveDetail.courseRunUuid is the UUID, selectedCourse.courseRunId is also UUID from trainer-search
                                                const runUuid = effectiveDetail?.courseRunUuid || selectedCourse?.courseRunId || '';
                                                setPendingAttendanceCourseRunId(String(runUuid));
                                                if (typeof window !== 'undefined' && selectedCourse) {
                                                    try { sessionStorage.setItem('attendanceSourceCourse', JSON.stringify(selectedCourse)); } catch {}
                                                }
                                                setSelectedCourse(null);
                                                setTrainerPage(TrainerPage.EAttendance);
                                            }}
                                            className="flex items-center gap-3 p-3 w-full text-left bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                        >
                                            <Icon name={IconName.ClipboardCheck} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-900 dark:text-white">E-Attendance</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Open E-Attendance for Course Run {selectedCourse?.courseRunCode || selectedCourse?.courseRunId || convertedCourse.courseRunId || ''}
                                                </p>
                                            </div>
                                            <Icon name={IconName.ExternalLink} className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                        </button>
                                    </ContentSection>
                                </div>
                            )}

                            {userRole === UserRole.Learner && (
                                <div id={toId("E-Attendance")}>
                                    <ContentSection title="E-Attendance">
                                        {attendanceLink ? (
                                            <a
                                                href={attendanceLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-3 w-full text-left bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                            >
                                                <Icon name={IconName.ClipboardCheck} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white">E-Attendance</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        Open E-Attendance for Course Run {selectedCourse?.courseRunCode || selectedCourse?.courseRunId || convertedCourse.courseRunId || ''}
                                                    </p>
                                                </div>
                                                <Icon name={IconName.ExternalLink} className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                            </a>
                                        ) : (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                                                E-Attendance link not yet available for this course run.
                                            </p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Virtual Meeting */}
                            {(() => {
                                const vmp = (
                                    (convertedCourse as any)?.virtualMeetingProvider ||
                                    inferVirtualMeetingProvider(convertedCourse.virtualMeetingLink) ||
                                    ((trainingProviderProfile as any)?.integrations?.virtualMeetingProvider as 'google_meet' | 'zoom' | 'teams' | undefined) ||
                                    'google_meet'
                                );
                                const providerLabel = vmp === 'zoom' ? 'Zoom' : vmp === 'teams' ? 'Microsoft Teams' : 'Google Meet';
                                const isZoom = vmp === 'zoom';
                                const zoomStartUrl = (convertedCourse as any)?.virtualMeetingHostLink || convertedCourse.virtualMeetingLink || '';
                                const zoomJoinUrl = (convertedCourse as any)?.virtualMeetingJoinLink || '';
                                const isTrainerView = userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.TrainingProvider || userRole === UserRole.Developer;
                                const hasVirtualMeetingLink = isZoom && isTrainerView
                                    ? !!(zoomStartUrl || zoomJoinUrl)
                                    : !!convertedCourse.virtualMeetingLink;
                                return (
                            <div id={toId("Google Meet")}>
                                <ContentSection title={providerLabel} collapsible>
                                    {(convertedCourse.classType === 'Virtual' || convertedCourse.classType === 'Hybrid') && hasVirtualMeetingLink ? (
                                        isZoom && isTrainerView ? (
                                            <div className="space-y-3">
                                                {zoomStartUrl && (
                                                    <a
                                                        href={zoomStartUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-3 p-3 w-full bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                    >
                                                        <Icon name={IconName.Video} className="w-6 h-6 text-green-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Start Zoom Meeting</p>
                                                            <p className="text-xs text-amber-600 dark:text-amber-400 truncate">
                                                                Trainer-only host URL. Do not share with learners.
                                                            </p>
                                                        </div>
                                                        <Icon name={IconName.ExternalLink} className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                                    </a>
                                                )}
                                                {zoomJoinUrl && (
                                                    <a
                                                        href={zoomJoinUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-3 p-3 w-full bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                    >
                                                        <Icon name={IconName.Video} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Join as Participant</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                                {zoomJoinUrl}
                                                            </p>
                                                        </div>
                                                        <Icon name={IconName.ExternalLink} className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                                    </a>
                                                )}
                                            </div>
                                        ) : (
                                            <a
                                                href={convertedCourse.virtualMeetingLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-3 w-full bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                            >
                                                <Icon name={IconName.Video} className="w-6 h-6 text-green-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white">{`Join ${providerLabel}`}</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                        {convertedCourse.virtualMeetingLink}
                                                    </p>
                                                </div>
                                                <Icon name={IconName.ExternalLink} className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                            </a>
                                        )
                                    ) : (
                                        <div className="flex items-center gap-3 p-3 w-full bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                            <Icon name={IconName.Video} className="w-6 h-6 text-gray-400 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-500 dark:text-gray-400">N/A</p>
                                                <p className="text-xs text-gray-400 dark:text-gray-500">No virtual meeting link for this class</p>
                                            </div>
                                        </div>
                                    )}
                                    <ClassPhotoUpload
                                        courseRunUuid={effectiveDetail?.courseRunUuid || selectedCourse?.courseRunId || ''}
                                        userRole={userRole}
                                    />
                                </ContentSection>
                            </div>
                                );
                            })()}

                            {/* Courseware - grouped container for Trainer/Developer/Admin/TrainingProvider */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.Admin || userRole === UserRole.TrainingProvider) && (
                                <div id={toId("Courseware Link")}>
                                    <ContentSection title="Courseware" collapsible>
                                        <div className="space-y-3">
                                            {/* Courseware Link */}
                                            {convertedCourse.courseLink && (
                                                <a
                                                    href={convertedCourse.courseLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Courseware Link</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                    </div>
                                                </a>
                                            )}

                                            {/* Lesson Plan */}
                                            {convertedCourse.lessonPlanUrl && (
                                                isLessonPlanExternal ? (
                                                    <a href={convertedCourse.lessonPlanUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Lesson Plan</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                        </div>
                                                    </a>
                                                ) : (
                                                    <div onClick={(e) => handleFileDownload(convertedCourse.lessonPlanUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                        <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Lesson Plan</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* Learner Guide */}
                                            {convertedCourse.learnerGuideUrl && (
                                                isLearnerGuideExternal ? (
                                                    <a href={convertedCourse.learnerGuideUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Learner Guide</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                        </div>
                                                    </a>
                                                ) : (
                                                    <div onClick={(e) => handleFileDownload(convertedCourse.learnerGuideUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                        <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Learner Guide</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* Facilitator Guide */}
                                            {convertedCourse.facilitatorGuideUrl && (
                                                isFacilitatorGuideExternal ? (
                                                    <a href={convertedCourse.facilitatorGuideUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Facilitator Guide</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                        </div>
                                                    </a>
                                                ) : (
                                                    <div onClick={(e) => handleFileDownload(convertedCourse.facilitatorGuideUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                        <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Facilitator Guide</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* Trainer Slides */}
                                            {convertedCourse.trainerSlidesUrl && (
                                                isTrainerSlidesExternal ? (
                                                    <a href={convertedCourse.trainerSlidesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Trainer Slides</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                        </div>
                                                    </a>
                                                ) : (
                                                    <div onClick={(e) => handleFileDownload(convertedCourse.trainerSlidesUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                        <Icon name={IconName.FileText} className="w-6 h-6 text-orange-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Trainer Slides</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* Activities/Lab */}
                                            {convertedCourse.activitiesUrl && (
                                                isActivitiesExternal ? (
                                                    <a href={convertedCourse.activitiesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Activities/Lab</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                        </div>
                                                    </a>
                                                ) : (
                                                    <div onClick={(e) => handleFileDownload(convertedCourse.activitiesUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                        <Icon name={IconName.FileText} className="w-6 h-6 text-green-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Activities/Lab</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* Assessment Plan */}
                                            {convertedCourse.assessmentPlanUrl && (
                                                isAssessmentPlanExternal ? (
                                                    <a href={convertedCourse.assessmentPlanUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Assessment Plan</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                        </div>
                                                    </a>
                                                ) : (
                                                    <div onClick={(e) => handleFileDownload(convertedCourse.assessmentPlanUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                        <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-gray-900 dark:text-white">Assessment Plan</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                        </div>
                                                    </div>
                                                )
                                            )}

                                            {/* Show message if nothing available */}
                                            {!convertedCourse.courseLink && !convertedCourse.lessonPlanUrl && !convertedCourse.learnerGuideUrl && !convertedCourse.facilitatorGuideUrl && !convertedCourse.trainerSlidesUrl && !convertedCourse.activitiesUrl && !convertedCourse.assessmentPlanUrl && (
                                                <p className="text-gray-500 dark:text-gray-400 text-sm">No courseware available.</p>
                                            )}
                                        </div>
                                    </ContentSection>
                                </div>
                            )}

                            {/* Materials locked banner for Learners */}
                            {!isMaterialsUnlocked && materialsUnlockTime && (
                                <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-3 mb-2">
                                    <svg className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-6a4 4 0 100-8 4 4 0 000 8zm0 0v1" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0v4M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2z" /></svg>
                                    <div>
                                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Course materials are not yet available</p>
                                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                            Materials will be accessible from <span className="font-semibold">8:30 AM SGT</span> on{' '}
                                            <span className="font-semibold">
                                                {materialsUnlockTime.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' })}
                                            </span>
                                            , the first day of your course.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Learner-only: Courseware (Lesson Plan, Learner Guide, Learner Slides) */}
                            {userRole !== UserRole.Trainer && userRole !== UserRole.Developer && userRole !== UserRole.Admin && userRole !== UserRole.TrainingProvider && (
                                <div id={toId("Courseware Link")}>
                                    <ContentSection title="Courseware">
                                        {!isMaterialsUnlocked ? (
                                            <p className="text-sm text-amber-600 dark:text-amber-400 italic">Available from 8:30 AM SGT on your course start date.</p>
                                        ) : (
                                            <div className="space-y-3">
                                                {/* Lesson Plan (gated by Company Admin Setting) */}
                                                {trainingProviderProfile?.showLessonPlanLearnerView && convertedCourse.lessonPlanUrl && (
                                                    isLessonPlanExternal ? (
                                                        <a href={convertedCourse.lessonPlanUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                            <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-semibold text-gray-900 dark:text-white">Lesson Plan</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                            </div>
                                                        </a>
                                                    ) : (
                                                        <div onClick={(e) => handleFileDownload(convertedCourse.lessonPlanUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                            <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-semibold text-gray-900 dark:text-white">Lesson Plan</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                            </div>
                                                        </div>
                                                    )
                                                )}

                                                {/* Learner Guide */}
                                                {convertedCourse.learnerGuideUrl && (
                                                    isLearnerGuideExternal ? (
                                                        <a href={convertedCourse.learnerGuideUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                            <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-semibold text-gray-900 dark:text-white">Learner Guide</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                            </div>
                                                        </a>
                                                    ) : (
                                                        <div onClick={(e) => handleFileDownload(convertedCourse.learnerGuideUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                            <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-semibold text-gray-900 dark:text-white">Learner Guide</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                            </div>
                                                        </div>
                                                    )
                                                )}

                                                {/* Learner Slides */}
                                                {convertedCourse.slidesUrl && (
                                                    isLearnerSlidesExternal ? (
                                                        <a href={convertedCourse.slidesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                            <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-semibold text-gray-900 dark:text-white">Learner Slides</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                            </div>
                                                        </a>
                                                    ) : (
                                                        <div onClick={(e) => handleFileDownload(convertedCourse.slidesUrl!, e)} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                                                            <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-semibold text-gray-900 dark:text-white">Learner Slides</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                            </div>
                                                        </div>
                                                    )
                                                )}

                                                {/* Empty state */}
                                                {!convertedCourse.learnerGuideUrl && !convertedCourse.slidesUrl && !(trainingProviderProfile?.showLessonPlanLearnerView && convertedCourse.lessonPlanUrl) && (
                                                    <p className="text-gray-500 dark:text-gray-400 text-sm">No courseware available.</p>
                                                )}
                                            </div>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Lessons */}
                            <div id="lessons">
                                <Card className="p-0 overflow-hidden">
                                    <button className="w-full text-left p-6 flex justify-between items-center" onClick={() => setIsLessonsOpen(!isLessonsOpen)} aria-expanded={isLessonsOpen}>
                                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">Lesson</h3>
                                        <Icon name={IconName.ChevronDown} className={`w-5 h-5 transition-transform duration-200 ${isLessonsOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isLessonsOpen && (
                                        <div className="px-6 pb-6 space-y-4 border-t pt-4">
                                            {convertedCourse.topics.map(topic => {
                                                let topicProgress: number;
                                                if (topic.subtopics.length > 0) {
                                                    const done = topic.subtopics.filter(st => completedSubtopicsSet.has(st.id)).length;
                                                    topicProgress = (done / topic.subtopics.length) * 100;
                                                } else {
                                                    topicProgress = completedTopicsSet.has(topic.id) ? 100 : 0;
                                                }

                                                return (
                                                    <TopicAccordion
                                                        key={topic.id}
                                                        topic={topic}
                                                        progress={topicProgress}
                                                        bookmarkedSubtopics={bookmarkedSubtopicsSet}
                                                        onToggleBookmark={handleToggleBookmark}
                                                        userRole={userRole}
                                                        completedSubtopics={completedSubtopicsSet}
                                                        onToggleCompletion={handleToggleCompletion}
                                                        completedTopics={completedTopicsSet}
                                                        onToggleTopicCompletion={toggleTopicCompletion}
                                                        resourceLinks={resourceLinks.filter(rl => topic.subtopics.some(st => st.id === rl.topicId))}
                                                        userId={currentUser?.id}
                                                        courseId={selectedCourse?.id}
                                                        latestQuizScores={latestQuizScores}
                                                        onQuizSubmitted={handleQuizSubmitted}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </Card>
                            </div>

                            {/* TRAQOM Survey & Certificate Delivery */}
                            {(userRole === UserRole.Learner || userRole === UserRole.Trainer) && (
                                <div id={toId("TRAQOM Survey")}>
                                    <Card className="p-0 overflow-hidden">
                                        <button
                                            className="w-full text-left p-6 flex justify-between items-center"
                                            onClick={() => setIsTraqomOpen(!isTraqomOpen)}
                                            aria-expanded={isTraqomOpen}
                                        >
                                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{[
                                                trainingProviderProfile?.showCertificateDelivery ? 'Course Feedback' : null,
                                                'TRAQOM Survey',
                                            ].filter(Boolean).join(' & ')}</h3>
                                            <Icon name={IconName.ChevronDown} className={`w-6 h-6 text-blue-600 flex-shrink-0 transition-transform ${isTraqomOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        {isTraqomOpen && (
                                            <div className="px-6 pb-6 border-t border-default">
                                                <div className={`pt-5 grid grid-cols-1 ${trainingProviderProfile?.showCertificateDelivery ? 'md:grid-cols-2' : ''} gap-4`}>
                                                                    {/* Certificate Delivery Card */}
                                                    {trainingProviderProfile?.showCertificateDelivery && (
                                                    <div className="flex flex-col rounded-xl border border-default overflow-hidden">
                                                        <div className="bg-blue-600 px-4 py-2.5 flex items-center justify-center gap-2">
                                                            <Icon name={IconName.ClipboardCheck} className="w-4 h-4 text-white flex-shrink-0" />
                                                            <span className="text-sm font-semibold text-white">Course Feedback</span>
                                                        </div>
                                                        <div className="flex flex-col items-center p-5 bg-surface flex-1 justify-between gap-3">
                                                            <div className="flex flex-col items-center gap-3 w-full">
                                                                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                                                                    <img
                                                                        src={certDeliveryQrCodeUrl}
                                                                        alt="Course Feedback QR Code"
                                                                        className="w-36 h-36 object-contain"
                                                                    />
                                                                </div>
                                                                <p className="text-sm text-on-surface-secondary text-center">Scan to share your feedback</p>
                                                            </div>
                                                            <div className="w-full flex flex-col gap-2">
                                                                <p className="text-xs text-on-surface-secondary break-all px-1">{certDeliveryLink}</p>
                                                                <div className="flex gap-2">
                                                                    <a
                                                                        href={certDeliveryLink}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="flex-1 text-center text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 transition-colors"
                                                                    >
                                                                        Open Link
                                                                    </a>
                                                                    <button
                                                                        onClick={() => { navigator.clipboard.writeText(certDeliveryLink); alert('Link copied!'); }}
                                                                        className="px-3 py-2 text-sm font-medium border border-default rounded-lg text-on-surface hover:bg-surface-elevated transition-colors"
                                                                    >
                                                                        Copy
                                                                    </button>
                                                                </div>
                                                                {convertedCourse.courseCode && (
                                                                    <p className="text-xs text-on-surface-secondary text-center mt-1">Course Ref: <span className="font-medium text-on-surface">{convertedCourse.courseCode}</span></p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    )}

                                                    {/* TRAQOM Survey Card */}
                                                    <div className="flex flex-col rounded-xl border border-default overflow-hidden">
                                                        <div className="bg-teal-600 px-4 py-2.5 flex items-center justify-center gap-2">
                                                            <Icon name={IconName.Edit} className="w-4 h-4 text-white flex-shrink-0" />
                                                            <span className="text-sm font-semibold text-white">TRAQOM Survey</span>
                                                        </div>
                                                        <div className="flex flex-col items-center p-5 bg-surface flex-1 justify-between gap-3">
                                                            <div className="flex flex-col items-center gap-3 w-full">
                                                                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                                                                    <img
                                                                        src={traqomQrCodeUrl}
                                                                        alt="TRAQOM Survey QR Code"
                                                                        className="w-36 h-36 object-contain"
                                                                    />
                                                                </div>
                                                                <p className="text-sm text-on-surface-secondary text-center">Your feedback helps us improve</p>
                                                            </div>
                                                            <div className="w-full flex flex-col gap-2">
                                                                <p className="text-xs text-on-surface-secondary break-all px-1">{traqomSurveyLink}</p>
                                                                <div className="flex gap-2">
                                                                    <a
                                                                        href={traqomSurveyLink}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="flex-1 text-center text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-lg py-2 transition-colors"
                                                                    >
                                                                        Open Link
                                                                    </a>
                                                                    <button
                                                                        onClick={() => { navigator.clipboard.writeText(traqomSurveyLink); alert('Link copied!'); }}
                                                                        className="px-3 py-2 text-sm font-medium border border-default rounded-lg text-on-surface hover:bg-surface-elevated transition-colors"
                                                                    >
                                                                        Copy
                                                                    </button>
                                                                </div>
                                                                {convertedCourse.courseRunId && (
                                                                    <p className="text-xs text-on-surface-secondary text-center mt-1">Course Run ID: <span className="font-medium text-on-surface">{convertedCourse.courseRunId}</span></p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                </div>
                            )}

                            {/* Briefing on Assessment — Training-Provider template, shown to learners & trainers */}
                            {(userRole === UserRole.Learner || userRole === UserRole.Trainer) && (
                                <div id={toId("Briefing on Assessment")}>
                                    <ContentSection title="Briefing on Assessment" collapsible defaultOpen={false}>
                                        <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
                                            {(trainingProviderProfile?.briefingOnAssessment && trainingProviderProfile.briefingOnAssessment.trim()
                                                ? trainingProviderProfile.briefingOnAssessment.split('\n').map(line => line.trim()).filter(Boolean)
                                                : DEFAULT_ASSESSMENT_BRIEFING
                                            ).map((point, idx) => (
                                                <li key={idx}>{point}</li>
                                            ))}
                                        </ul>
                                    </ContentSection>
                                </div>
                            )}

                            {/* Assessments */}
                            <div id="assessments">
                                <AssessmentsSection
                                    course={convertedCourse}
                                    userRole={userRole}
                                    developerAssessments={developerAssessments}
                                    courseRunId={selectedCourse?.courseRunId}
                                    courseId={selectedCourse?.id}
                                    setDeveloperAssessments={setDeveloperAssessments}
                                    handleFileDownload={handleFileDownload}
                                />
                            </div>

                            {/* Assessment Summary Record — Learner view */}
                            {userRole === UserRole.Learner && (
                                <div id={toId("Assessment Summary Record")}>
                                    <AssessmentSummarySection
                                        course={convertedCourse}
                                        userRole={userRole}
                                        courseRunUuid={effectiveDetail?.courseRunUuid || selectedCourse?.courseRunId || ''}
                                    />
                                </div>
                            )}

                            {/* Assessment Grading (includes Assessment Record + Grading button) */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.Admin || userRole === UserRole.TrainingProvider) && (
                                <div id={toId("Assessment Grading")}>
                                    <ContentSection title="Assessment Grading" collapsible>
                                        <div className="space-y-3">
                                            {convertedCourse.assessmentRecordLink && (
                                                <a
                                                    href={convertedCourse.assessmentRecordLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Assessment Record Link</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                    </div>
                                                </a>
                                            )}
                                            {userRole === UserRole.Trainer && (
                                                <button
                                                    onClick={() => {
                                                        const runUuid = effectiveDetail?.courseRunUuid || selectedCourse?.courseRunId || '';
                                                        setPendingGradingCourseRunId(String(runUuid));
                                                        setSelectedCourse(null);
                                                        setTrainerPage(TrainerPage.AssessmentGrading);
                                                    }}
                                                    className="flex items-center gap-3 p-3 w-full text-left bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.Edit} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Assessment Grading</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            Open Assessment Grading for Course Run {selectedCourse?.courseRunCode || selectedCourse?.courseRunId || convertedCourse.courseRunId || ''}
                                                        </p>
                                                    </div>
                                                    <Icon name={IconName.ExternalLink} className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                                </button>
                                            )}
                                            {!convertedCourse.assessmentRecordLink && userRole !== UserRole.Trainer && (
                                                <p className="text-gray-500 dark:text-gray-400 text-sm">No assessment grading available.</p>
                                            )}
                                        </div>
                                    </ContentSection>
                                </div>
                            )}

                            {/* Assessment Summary Record */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.Admin || userRole === UserRole.TrainingProvider) && (
                                <div id={toId("Assessment Summary Record")}>
                                    <AssessmentSummarySection 
                                        course={convertedCourse} 
                                        userRole={userRole} 
                                        courseRunUuid={effectiveDetail?.courseRunUuid || selectedCourse?.courseRunId || ''} 
                                    />
                                </div>
                            )}

                            {/* Course Sessions — Admin and Developer only */}
                            {(userRole === UserRole.Admin || userRole === UserRole.Developer) && (() => {
                                const courseCode = effectiveDetail?.tgsRef || selectedCourse?.courseCode || convertedCourse.courseCode || '';
                                if (!courseCode) return null;
                                return (
                                    <div id={toId("Course Sessions")}>
                                        <CourseSessionsSection courseCode={courseCode} />
                                    </div>
                                );
                            })()}

                            {/* Announcements */}
                            <div id={toId("Announcements")}>
                                <AnnouncementsSection
                                    userRole={userRole}
                                    courseRunId={convertedCourse.courseRunId || selectedCourse?.courseRunId || ''}
                                    currentUser={currentUser}
                                />
                            </div>

                            {/* Certificate */}
                            <div id={toId("Certificate")}>
                                <CertificateSection userRole={userRole} />
                            </div>

                            {/* Leaderboard */}
                            {/* {userRole === UserRole.Learner && (
                        <Leaderboard course={convertedCourse} />
                    )} */}
                            </>
                            )}
                        </main>
                    </div>
                </>
            )}
        </div>
    );
};
