import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { Card } from './ui/Card';
import Spinner from './ui/Spinner';
import { UserRole, CourseAssessment, AdminPage, TrainerPage } from '@app-types';
import GradingView from './GradingView';
import { extractFilenameFromPath } from '@utils/fileUtils';
import { courseService } from '@lib/services/courseService';
import { getApiUrl, getDownloadUrl } from '@/lib/urlHelpers';

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
    totalAssessments?: number;
    topics: Topic[];
    assessments?: Assessment[];
    learners?: LearnerProgress[];
    bookmarkedSubtopics?: string[];
    lessonPlanUrl?: string;
    facilitatorGuideUrl?: string;
    learnerGuideUrl?: string;
    slidesUrl?: string;
    trainerSlidesUrl?: string;
    assessmentPlanUrl?: string;
    courseLink?: string;
    assessmentRecordLink?: string;
    writtenAssessmentLink?: string;
    practicalPerformanceAssessmentLink?: string;
    writtenAssessmentPublished?: boolean;
    practicalAssessmentPublished?: boolean;
}

// --- Utility Functions ---
const toId = (label: string) => label.toLowerCase().replace(/ /g, '-');

// --- Reusable Components ---
const ContentSection: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
    <Card className={`p-6 ${className}`}>
        {title && <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{title}</h3>}
        {children}
    </Card>
);

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

    // State for link-based assessment submissions (Written/Practical)
    interface LinkSubmission {
        id: string;
        user_id: string;
        course_run_id: string;
        assessment_type: 'written' | 'practical';
        file_name: string;
        file_url: string;
        submitted_at: string;
    }
    const [linkSubmissions, setLinkSubmissions] = useState<LinkSubmission[]>([]);
    const [selectedLinkFiles, setSelectedLinkFiles] = useState<Record<string, File | null>>({});
    const [isLinkUploading, setIsLinkUploading] = useState<Record<string, boolean>>({});
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
                [assessmentType]: event.target.files![0]
            }));
        }
    };

    const handleLinkSubmit = async (assessmentType: 'written' | 'practical') => {
        const file = selectedLinkFiles[assessmentType];
        if (!file) {
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

            const formData = new FormData();
            formData.append('file', file);

            // Adding query parameters for the backend to build the folder structure
            let fetchUrl = `/api/upload/google-drive?studentName=${encodeURIComponent(studentName)}`;
            if (tgsRef) fetchUrl += `&courseCode=${encodeURIComponent(tgsRef)}`;
            if (courseName) fetchUrl += `&courseName=${encodeURIComponent(courseName)}`;
            if (courseRunId) fetchUrl += `&courseRunId=${encodeURIComponent(courseRunId)}`;

            setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 40 }));

            const uploadResponse = await fetch(fetchUrl, {
                method: 'POST',
                body: formData,
            });

            setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 80 }));

            const uploadData = await uploadResponse.json();

            if (!uploadResponse.ok || !uploadData.success) {
                throw new Error(uploadData.error || 'Failed to upload file to Google Drive.');
            }

            // Record the submission in the database
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
                throw new Error(submitResult.error || 'Failed to record submission.');
            }

            setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 100 }));

            console.log('✅ Link assessment successfully uploaded and recorded');

            // Update local state with the new submission
            const newSubmission: LinkSubmission = {
                id: submitResult.id || `temp-${Date.now()}`,
                user_id: currentUser?.id || '',
                course_run_id: courseRunId || '',
                assessment_type: assessmentType,
                file_name: file.name,
                file_url: uploadData.data.fileUrl,
                submitted_at: new Date().toISOString()
            };

            setLinkSubmissions(prev => {
                // Remove any existing submission for this assessment type and add the new one
                const filtered = prev.filter(s => s.assessment_type !== assessmentType);
                return [...filtered, newSubmission];
            });

            // Auto-verify the uploaded file using the string identifier ('written' or 'practical')
            handleVerifyDrive(assessmentType);

            // Reset UI state
            setSelectedLinkFiles(prev => ({ ...prev, [assessmentType]: null }));
            setIsLinkResubmitting(prev => ({ ...prev, [assessmentType]: false }));

            // Reset the file input visually
            const fileInput = document.getElementById(`link-file-upload-${assessmentType}`) as HTMLInputElement;
            if (fileInput) fileInput.value = '';

        } catch (error: any) {
            alert(`Upload failed: ${error.message || 'Please try again.'}`);
            console.error('Link submission error:', error);
        } finally {
            setIsLinkUploading(prev => ({ ...prev, [assessmentType]: false }));
            setLinkUploadProgress(prev => ({ ...prev, [assessmentType]: 0 }));
        }
    };

    const handlePublishLink = async (field: 'written' | 'practical', published: boolean) => {
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
            } else {
                setPracticalPublished(published);
            }
        } catch (error) {
            console.error('❌ Failed to publish link assessment:', error);
            alert('Failed to update publish status. Please try again.');
        }
    };

    // Show "No Assessments" message if there are no assessments and no links
    if ((!effectiveAssessments || effectiveAssessments.length === 0) && !course.writtenAssessmentLink && !course.practicalPerformanceAssessmentLink) {
        return (
            <ContentSection title="Assessment">
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
        <ContentSection title="Assessment">
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

            {/* Written Assessment - Show only when link exists */}
            {course.writtenAssessmentLink && (userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || writtenPublished) && (
                <div className="mt-4 p-4 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-blue-600" />
                            Written Assessment
                        </h4>
                        {writtenPublished && (
                            <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">Published</span>
                        )}
                    </div>

                    {/* Show Link-based assessment */}
                    {course.writtenAssessmentLink && (
                        <>
                            <a
                                href={course.writtenAssessmentLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors mb-3"
                            >
                                <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 dark:text-white">Open Assessment Link</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to open external form</p>
                                </div>
                            </a>

                            {/* Publish/Unpublish buttons for trainer */}
                            {userRole === UserRole.Trainer && (
                                writtenPublished ? (
                                    <div className="space-y-2">
                                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-200 dark:border-blue-800 text-center">
                                            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Assessment is Live</p>
                                        </div>
                                        <Button onClick={() => handlePublishLink('written', false)} variant="secondary" className="w-full">
                                            Unpublish
                                        </Button>
                                    </div>
                                ) : (
                                    <Button onClick={() => handlePublishLink('written', true)} className="w-full">Publish Assessment</Button>
                                )
                            )}
                        </>
                    )}

                    {/* Learner file submission for Written Assessment */}
                    {userRole === UserRole.Learner && writtenPublished && (() => {
                        const writtenSubmission = linkSubmissions.find(s => s.assessment_type === 'written');
                        const canResubmit = isLinkResubmitting['written'];

                        if (writtenSubmission && !canResubmit) {
                            const vStatus = verificationStatus['written'];
                            return (
                                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 space-y-3">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="font-semibold text-green-800 dark:text-green-300">Submitted: {writtenSubmission.file_name}</p>
                                            <p className="text-xs text-green-600 dark:text-green-400">On: {new Date(writtenSubmission.submitted_at).toLocaleString()}</p>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => setIsLinkResubmitting(prev => ({ ...prev, written: true }))}>
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
                            <div className="mt-3">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {canResubmit ? "Upload a new file to replace your previous submission" : "Upload your completed assessment file"}
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
                                />
                                {selectedLinkFiles['written'] && !isLinkUploading['written'] && (
                                    <div className="mt-3">
                                        <Button
                                            onClick={() => handleLinkSubmit('written')}
                                            className="w-full"
                                        >
                                            Submit Assessment
                                        </Button>
                                    </div>
                                )}
                                {isLinkUploading['written'] && (
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
                    })()}
                </div>
            )}

            {/* Practical Performance Assessment - Show only when link exists */}
            {course.practicalPerformanceAssessmentLink && (userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || practicalPublished) && (
                <div className="mt-4 p-4 bg-gray-100/60 dark:bg-gray-800/60 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-blue-600" />
                            Practical Performance Assessment
                        </h4>
                        {practicalPublished && (
                            <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">Published</span>
                        )}
                    </div>

                    {/* Show Link-based assessment */}
                    {course.practicalPerformanceAssessmentLink && (
                        <>
                            <a
                                href={course.practicalPerformanceAssessmentLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors mb-3"
                            >
                                <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 dark:text-white">Open Assessment Link</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to open external form</p>
                                </div>
                            </a>

                            {/* Publish/Unpublish buttons for trainer */}
                            {userRole === UserRole.Trainer && (
                                practicalPublished ? (
                                    <div className="space-y-2">
                                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-200 dark:border-blue-800 text-center">
                                            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Assessment is Live</p>
                                        </div>
                                        <Button onClick={() => handlePublishLink('practical', false)} variant="secondary" className="w-full">
                                            Unpublish
                                        </Button>
                                    </div>
                                ) : (
                                    <Button onClick={() => handlePublishLink('practical', true)} className="w-full">Publish Assessment</Button>
                                )
                            )}
                        </>
                    )}

                    {/* Learner file submission for Practical Performance Assessment */}
                    {userRole === UserRole.Learner && practicalPublished && (() => {
                        const practicalSubmission = linkSubmissions.find(s => s.assessment_type === 'practical');
                        const canResubmit = isLinkResubmitting['practical'];

                        if (practicalSubmission && !canResubmit) {
                            const vStatus = verificationStatus['practical'];
                            return (
                                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 space-y-3">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="font-semibold text-green-800 dark:text-green-300">Submitted: {practicalSubmission.file_name}</p>
                                            <p className="text-xs text-green-600 dark:text-green-400">On: {new Date(practicalSubmission.submitted_at).toLocaleString()}</p>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => setIsLinkResubmitting(prev => ({ ...prev, practical: true }))}>
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
                            <div className="mt-3">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {canResubmit ? "Upload a new file to replace your previous submission" : "Upload your completed assessment file"}
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
                                />
                                {selectedLinkFiles['practical'] && !isLinkUploading['practical'] && (
                                    <div className="mt-3">
                                        <Button
                                            onClick={() => handleLinkSubmit('practical')}
                                            className="w-full"
                                        >
                                            Submit Assessment
                                        </Button>
                                    </div>
                                )}
                                {isLinkUploading['practical'] && (
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
                    })()}
                </div>
            )}
        </ContentSection>
    );
};

// --- Certificate Section Component ---
const CertificateSection: React.FC<{ userRole: UserRole }> = ({ userRole }) => {
    const { certificate } = useLms();

    // Only show certificate section for learners
    if (userRole !== UserRole.Learner) {
        return null;
    }

    return (
        <ContentSection title="Certificate of Completion">
            {certificate && certificate.certificate_url ? (
                <div className="text-center p-6 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <Icon name={IconName.FileText} className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h4 className="text-lg font-bold text-green-800 dark:text-green-300">Congratulations!</h4>
                    <p className="text-green-700 dark:text-green-400 mt-1 mb-4">You have successfully completed this course.</p>
                    <a href={certificate.certificate_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="secondary">
                            <Icon name={IconName.Download} className="w-5 h-5 mr-2" />
                            Download Your Certificate
                        </Button>
                    </a>
                </div>
            ) : (
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md border border-gray-200 dark:border-gray-600 text-center">
                    <Icon name={IconName.FileText} className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 dark:text-gray-300 font-medium">Coming Soon</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        When this feature is available, your certificate download link will appear right here.
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
                <DetailRow label="TGS Ref" value={course.courseCode} />
                <DetailRow label="TSC Title" value={course.tscTitle || 'N/A'} />
                <DetailRow label="TSC Code" value={course.tscCode || 'N/A'} />
                {/* Hide course run related information for developers and training providers */}
                {userRole !== UserRole.Developer && userRole !== UserRole.TrainingProvider && (
                    <>
                        <DetailRow label="Course Run ID" value={course.courseRunId} />
                        <DetailRow label="Digital Attendance ID" value={course.daId || 'N/A'} />
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
    const { setTrainerPage, setSelectedCourse } = useLms();
    const defaultActive = userRole === UserRole.Learner ? 'Learning Outcomes' : 'Lesson';
    const [activeItem, setActiveItem] = useState(defaultActive);

    const handleItemClick = (label: string) => {
        if (label === 'Grading') {
            // Navigate to Assessment Grading sidebar page
            setSelectedCourse(null);
            setTrainerPage(TrainerPage.AssessmentGrading);
            return;
        } else {
            onSetGradingView(false);
            setActiveItem(label);

            let targetId = toId(label);
            if (label === 'Lesson' || label === 'Lessons' || label === 'Learning Outcomes') targetId = 'lessons';
            else if (label === 'Assessment' || label === 'Assessments') targetId = 'assessments';
            else if (label === 'Certificate') targetId = 'certificate';

            const element = document.getElementById(targetId);
            if (element) {
                const yOffset = -90;
                const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
                window.scrollTo({ top: y, behavior: 'smooth' });
            }
        }
        if (onMobileItemClick) {
            onMobileItemClick();
        }
    };

    const learnerNavItems: NavItem[] = [
        { type: 'link', label: "Lesson Plan", icon: IconName.BookOpen },
        { type: 'link', label: "Learner Guide", icon: IconName.FileText },
        { type: 'link', label: "Learner Slides", icon: IconName.FileText },
        { type: 'link', label: "Learning Outcomes", icon: IconName.BookOpen },
        { type: 'link', label: "TRAQOM Survey", icon: IconName.Edit },
        { type: 'link', label: "Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Certificate", icon: IconName.FileText },
    ];

    let trainerNavItems: NavItem[] = [
        { type: 'link', label: "Courseware Link", icon: IconName.Link },
        { type: 'link', label: "Assessment Record Link", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Lesson Plan", icon: IconName.BookOpen },
        { type: 'link', label: "Learner Guide", icon: IconName.FileText },
        { type: 'link', label: "Facilitator Guide", icon: IconName.FileText },
        { type: 'link', label: "Learner Slides", icon: IconName.FileText },
        { type: 'link', label: "Trainer Slides", icon: IconName.FileText },
        { type: 'link', label: "Assessment Plan", icon: IconName.ClipboardCheck },
        { type: 'separator' },
        { type: 'link', label: "Lesson", icon: IconName.BookOpen },
        { type: 'link', label: "TRAQOM Survey", icon: IconName.Edit },
        { type: 'link', label: "Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Grading", icon: IconName.Edit },
    ];

    if (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) {
        trainerNavItems = trainerNavItems.filter(item =>
            item.type === 'separator' ||
            (item.label !== "TRAQOM Survey" && item.label !== "Grading")
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
}

const TopicAccordion: React.FC<TopicAccordionProps> = ({ topic, progress, bookmarkedSubtopics, onToggleBookmark, userRole, completedSubtopics, onToggleCompletion, completedTopics, onToggleTopicCompletion }) => {
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
                                return (
                                    <li key={subtopic.id} className="flex items-center justify-between py-3">
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
        currentUser,
        role
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
        assessmentPlanUrl: effectiveDetail?.assessmentPlanUrl,
        courseLink: effectiveDetail?.courseLink,
        assessmentRecordLink: effectiveDetail?.assessmentRecordLink,
        writtenAssessmentLink: effectiveDetail?.writtenAssessmentLink,
        practicalPerformanceAssessmentLink: effectiveDetail?.practicalPerformanceAssessmentLink,
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
    const certDeliveryQrCodeUrl = '/qr_codes/cert_delivery_qr_code.png';

    const attendanceLink = convertedCourse.daId ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${convertedCourse.daId}` : null;
    // const attendanceQrCodeUrl = attendanceLink ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(attendanceLink)}` : null;

    // Helper to check if URL is external (Google Drive, etc.)
    const isExternalUrl = (url?: string) => url?.startsWith('http');

    const isLessonPlanExternal = isExternalUrl(convertedCourse.lessonPlanUrl);
    const isLearnerGuideExternal = isExternalUrl(convertedCourse.learnerGuideUrl);
    const isLearnerSlidesExternal = isExternalUrl(convertedCourse.slidesUrl);
    const isTrainerSlidesExternal = isExternalUrl(convertedCourse.trainerSlidesUrl);
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
                            <div className="mb-6 flex justify-between items-center">
                                {userRole !== UserRole.Trainer ? (
                                <button
                                    onClick={handleBackToDashboard}
                                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white rounded-lg flex items-center gap-2"
                                >
                                    {userRole === UserRole.Developer ? 'Back to All Courses' : 'Back to Dashboard'}
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

                            {/* Show loading skeleton while data is being fetched */}
                            {isLoading ? (
                                <LoadingSkeleton />
                            ) : (
                            <>
                            {/* Courseware Link */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.Admin || userRole === UserRole.TrainingProvider) && (
                                <div id={toId("Courseware Link")}>
                                    <ContentSection title="Courseware">
                                        {convertedCourse.courseLink ? (
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
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400 text-sm">No course link available.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Lesson Plan */}
                            <div id={toId("Lesson Plan")}>
                                <ContentSection title="Lesson Plan">
                                    {convertedCourse.lessonPlanUrl ? (
                                        isLessonPlanExternal ? (
                                            <a
                                                href={convertedCourse.lessonPlanUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                            >
                                                <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white">Lesson Plan</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                </div>
                                            </a>
                                        ) : (
                                            <div
                                                onClick={(e) => handleFileDownload(convertedCourse.lessonPlanUrl!, e)}
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                            >
                                                <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white">Lesson Plan</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                </div>
                                            </div>
                                        )
                                    ) : (
                                        <p className="text-gray-500 dark:text-gray-400">No lesson plan available for this course.</p>
                                    )}
                                </ContentSection>
                            </div>

                            {/* Learner Guide */}
                            <div id={toId("Learner Guide")}>
                                <ContentSection title="Learner Guide">
                                    {convertedCourse.learnerGuideUrl ? (
                                        isLearnerGuideExternal ? (
                                            <a
                                                href={convertedCourse.learnerGuideUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                            >
                                                <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white">Learner Guide</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                </div>
                                            </a>
                                        ) : (
                                            <div
                                                onClick={(e) => handleFileDownload(convertedCourse.learnerGuideUrl!, e)}
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                            >
                                                <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white">Learner Guide</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                </div>
                                            </div>
                                        )
                                    ) : (
                                        <p className="text-gray-500 dark:text-gray-400">No learner guide available for this course.</p>
                                    )}
                                </ContentSection>
                            </div>

                            {/* Facilitator Guide */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && (
                                <div id={toId("Facilitator Guide")}>
                                    <ContentSection title="Facilitator Guide">
                                        {convertedCourse.facilitatorGuideUrl ? (
                                            isFacilitatorGuideExternal ? (
                                                <a
                                                    href={convertedCourse.facilitatorGuideUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Facilitator Guide</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                    </div>
                                                </a>
                                            ) : (
                                                <div
                                                    onClick={(e) => handleFileDownload(convertedCourse.facilitatorGuideUrl!, e)}
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                                >
                                                    <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Facilitator Guide</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                    </div>
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">No facilitator guide available for this course.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Learner Slides */}
                            {userRole !== UserRole.Trainer && (
                                <div id={toId("Learner Slides")}>
                                    <ContentSection title="Learner Slides">
                                        {convertedCourse.slidesUrl ? (
                                            isLearnerSlidesExternal ? (
                                                <a
                                                    href={convertedCourse.slidesUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Learner Slides</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                    </div>
                                                </a>
                                            ) : (
                                                <div
                                                    onClick={(e) => handleFileDownload(convertedCourse.slidesUrl!, e)}
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                                >
                                                    <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Learner Slides</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                    </div>
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">No learner slides available for this course.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Trainer Slides */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && (
                                <div id={toId("Trainer Slides")}>
                                    <ContentSection title="Trainer Slides">
                                        {convertedCourse.trainerSlidesUrl ? (
                                            isTrainerSlidesExternal ? (
                                                <a
                                                    href={convertedCourse.trainerSlidesUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Trainer Slides</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                    </div>
                                                </a>
                                            ) : (
                                                <div
                                                    onClick={(e) => handleFileDownload(convertedCourse.trainerSlidesUrl!, e)}
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                                >
                                                    <Icon name={IconName.FileText} className="w-6 h-6 text-orange-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Trainer Slides</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                    </div>
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">No trainer slides available for this course.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Assessment Plan */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && (
                                <div id={toId("Assessment Plan")}>
                                    <ContentSection title="Assessment Plan">
                                        {convertedCourse.assessmentPlanUrl ? (
                                            isAssessmentPlanExternal ? (
                                                <a
                                                    href={convertedCourse.assessmentPlanUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Assessment Plan</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to open</p>
                                                    </div>
                                                </a>
                                            ) : (
                                                <div
                                                    onClick={(e) => handleFileDownload(convertedCourse.assessmentPlanUrl!, e)}
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                                >
                                                    <Icon name={IconName.FileText} className="w-6 h-6 text-red-600 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white">Assessment Plan</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to download</p>
                                                    </div>
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">No assessment plan available for this course.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Lessons */}
                            <div id="lessons">
                                <Card className="p-0 overflow-hidden">
                                    <button className="w-full text-left p-6 flex justify-between items-center" onClick={() => setIsLessonsOpen(!isLessonsOpen)} aria-expanded={isLessonsOpen}>
                                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">{role === UserRole.Learner ? 'Learning Outcomes' : 'Lesson'}</h3>
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
                                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Certificate & TRAQOM Survey</h3>
                                            <Icon name={IconName.ChevronDown} className={`w-6 h-6 text-blue-600 flex-shrink-0 transition-transform ${isTraqomOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        {isTraqomOpen && (
                                            <div className="px-6 pb-6 border-t border-default">
                                                <div className="pt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                    {/* Certificate Delivery Card */}
                                                    <div className="flex flex-col rounded-xl border border-default overflow-hidden">
                                                        <div className="bg-blue-600 px-4 py-2.5 flex items-center gap-2">
                                                            <Icon name={IconName.FileText} className="w-4 h-4 text-white flex-shrink-0" />
                                                            <span className="text-sm font-semibold text-white">Certificate Delivery</span>
                                                        </div>
                                                        <div className="flex flex-col items-center p-5 bg-surface flex-1 justify-between gap-3">
                                                            <div className="flex flex-col items-center gap-3 w-full">
                                                                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                                                                    <img
                                                                        src={certDeliveryQrCodeUrl}
                                                                        alt="Certificate Delivery QR Code"
                                                                        className="w-36 h-36 object-contain"
                                                                    />
                                                                </div>
                                                                <p className="text-sm text-on-surface-secondary text-center">Scan to receive your certificate</p>
                                                            </div>
                                                            <div className="w-full flex flex-col gap-2">
                                                                <p className="text-xs text-on-surface-secondary break-all px-1">https://goo.gl/R2eumq</p>
                                                                <div className="flex gap-2">
                                                                    <a
                                                                        href="https://goo.gl/R2eumq"
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="flex-1 text-center text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 transition-colors"
                                                                    >
                                                                        Open Link
                                                                    </a>
                                                                    <button
                                                                        onClick={() => { navigator.clipboard.writeText('https://goo.gl/R2eumq'); alert('Link copied!'); }}
                                                                        className="px-3 py-2 text-sm font-medium border border-default rounded-lg text-on-surface hover:bg-surface-elevated transition-colors"
                                                                    >
                                                                        Copy
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* TRAQOM Survey Card */}
                                                    <div className="flex flex-col rounded-xl border border-default overflow-hidden">
                                                        <div className="bg-teal-600 px-4 py-2.5 flex items-center gap-2">
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
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </Card>
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

                            {/* Assessment Record Link */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.Admin || userRole === UserRole.TrainingProvider) && (
                                <div id={toId("Assessment Record Link")}>
                                    <ContentSection title="Assessment Records">
                                        {convertedCourse.assessmentRecordLink ? (
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
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400 text-sm">No assessment record link available.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Certificate */}
                            <div id="certificate">
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