import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { Card } from './ui/Card';
import { UserRole, CourseAssessment } from '@app-types';
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
}

// --- Utility Functions ---
const toId = (label: string) => label.toLowerCase().replace(/ /g, '-');

// --- Reusable Components ---
const ContentSection: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
    <Card className={`p-6 ${className}`}>
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{title}</h3>
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

    if (!effectiveAssessments || effectiveAssessments.length === 0) {
        return (
            <ContentSection title="Assessment">
                <div className="text-center p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border dark:border-gray-700">
                    <Icon name={IconName.ClipboardCheck} className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-2">No Assessments Available</h4>
                    <p className="text-gray-500 dark:text-gray-400">
                        {userRole === UserRole.Developer || userRole === UserRole.Trainer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin
                            ? "No assessments have been created for this course yet."
                            : "No assessments are currently published for this course."
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

            // Use standard LMS context for trainer and other roles
            await publishAssessment(assessmentId, true);
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


    const handleFileChange = (assessmentId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFiles(prev => ({ ...prev, [assessmentId]: e.target.files![0] }));
        }
    };

    const handleSubmit = async (assessmentId: string) => {
        const file = selectedFiles[assessmentId];
        if (file) {
            try {
                // First upload the file to get the file URL
                const formData = new FormData();
                formData.append('file', file);

                const uploadResponse = await fetch('/api/upload/file', {
                    method: 'POST',
                    body: formData,
                });

                if (!uploadResponse.ok) {
                    throw new Error('Failed to upload file');
                }

                const uploadResult = await uploadResponse.json();
                if (!uploadResult.success) {
                    throw new Error(uploadResult.error || 'Failed to upload file');
                }

                // Then submit the assessment with the file URL
                await submitAssessment(assessmentId, file.name, uploadResult.data.fileUrl);
                console.log('✅ Assessment submitted successfully, refreshing submissions...');

                // Refresh submissions to show the newly submitted file
                await loadSubmissions();
                console.log('✅ Submissions refreshed after successful submission');

                alert(`Submitted '${file.name}' for assessment.`);
                setIsResubmitting(prev => ({ ...prev, [assessmentId]: false }));
                setSelectedFiles(prev => ({ ...prev, [assessmentId]: null }));
            } catch (error) {
                alert('Failed to submit assessment. Please try again.');
                console.error('Submission error:', error);
            }
        }
    };

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
            return <p className="text-gray-500">This assessment has not been published by the trainer yet.</p>;
        }

        if (submission && !canResubmit) {
            return (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="font-semibold text-green-800 dark:text-green-300">Submitted: {submission.file_name}</p>
                            <p className="text-xs text-green-600 dark:text-green-400">On: {new Date(submission.submitted_at).toLocaleString()}</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setIsResubmitting(prev => ({ ...prev, [assessment.id]: true }))}>
                            Resubmit
                        </Button>
                    </div>
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
                <p className="mb-2 text-gray-500 dark:text-gray-400">{canResubmit ? "Select a new file to replace your previous submission." : "The assessment is now available. Please upload your submission."}</p>
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        onChange={(e) => handleFileChange(assessment.id, e)}
                        className="flex-grow text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-blue-600 hover:file:bg-indigo-100"
                        accept=".doc,.docx,.pdf"
                    />
                    <Button onClick={() => handleSubmit(assessment.id)} disabled={!selectedFiles[assessment.id]}>
                        {canResubmit ? 'Submit Again' : 'Submit'}
                    </Button>
                </div>
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
            <ul className="space-y-4">
                {effectiveAssessments.map(assessment => (
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
                    <p className="text-gray-600 dark:text-gray-300 font-medium">Certificate Not Available</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Complete all assessments and course requirements to receive your certificate
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
    const defaultActive = 'Lesson';
    const [activeItem, setActiveItem] = useState(defaultActive);

    const handleItemClick = (label: string) => {
        if (label === 'Grading') {
            onSetGradingView(true);
        } else {
            onSetGradingView(false);
            setActiveItem(label);

            let targetId = toId(label);
            if (label === 'Lesson' || label === 'Lessons') targetId = 'lessons';
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
        { type: 'link', label: "Digital Attendance", icon: IconName.Calendar },
        { type: 'link', label: "Lesson Plan", icon: IconName.BookOpen },
        { type: 'link', label: "Learner Guide", icon: IconName.FileText },
        { type: 'link', label: "Learner Slides", icon: IconName.FileText },
        { type: 'link', label: "Lesson", icon: IconName.BookOpen },
        { type: 'link', label: "TRAQOM Survey", icon: IconName.Edit },
        { type: 'link', label: "Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Certificate", icon: IconName.FileText },
    ];

    let trainerNavItems: NavItem[] = [
        { type: 'link', label: "Digital Attendance", icon: IconName.Calendar },
        { type: 'link', label: "Lesson Plan", icon: IconName.BookOpen },
        { type: 'link', label: "Assessment Plan", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Facilitator Guide", icon: IconName.FileText },
        { type: 'link', label: "Learner Slides", icon: IconName.FileText },
        { type: 'link', label: "Trainer Slides", icon: IconName.FileText },
        { type: 'separator' },
        { type: 'link', label: "Lesson", icon: IconName.BookOpen },
        { type: 'link', label: "TRAQOM Survey", icon: IconName.Edit },
        { type: 'link', label: "Assessment", icon: IconName.ClipboardCheck },
        { type: 'link', label: "Grading", icon: IconName.Edit },
    ];

    if (userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) {
        trainerNavItems = trainerNavItems.filter(item =>
            item.type === 'separator' ||
            (item.label !== "Digital Attendance" && item.label !== "TRAQOM Survey" && item.label !== "Grading")
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
interface TopicAccordionProps {
    topic: Topic;
    progress: number;
    bookmarkedSubtopics: Set<string>;
    onToggleBookmark: (e: React.MouseEvent, subtopicId: string) => void;
    userRole: UserRole;
    completedSubtopics: Set<string>;
    onToggleCompletion: (subtopicId: string) => void;
}

const TopicAccordion: React.FC<TopicAccordionProps> = ({ topic, progress, bookmarkedSubtopics, onToggleBookmark, userRole, completedSubtopics, onToggleCompletion }) => {
    const [isOpen, setIsOpen] = React.useState(true);
    const displayTitle = topic.title.replace('Module', 'Learning Unit');
    return (
        <Card>
            <button
                className="w-full text-left p-4 flex justify-between items-center"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex-grow">
                    <h4 className="font-bold text-lg text-gray-900 dark:text-white">{displayTitle}</h4>
                    {userRole === UserRole.Learner && (
                        <div className="flex items-center mt-2">
                            <p className="text-sm font-bold text-green-600 w-12">{progress.toFixed(0)}%</p>
                            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    )}
                </div>
                <Icon name={IconName.ChevronDown} className={`w-5 h-5 ml-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="px-4 pb-2">
                    <ul className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                        {topic.subtopics.map(subtopic => {
                            const isBookmarked = bookmarkedSubtopics.has(subtopic.id);
                            const isCompleted = completedSubtopics.has(subtopic.id);
                            return (
                                <li key={subtopic.id} className="flex items-center justify-between py-3">
                                    <label htmlFor={`subtopic-complete-${subtopic.id}`} className="flex items-center flex-grow cursor-pointer group">
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
                                        <span className={`font-medium text-gray-800 dark:text-gray-200 group-hover:text-primary transition-colors ${isCompleted ? 'line-through text-gray-500 dark:text-gray-500' : ''}`}>{subtopic.title}</span>
                                    </label>
                                    {/* Only show bookmarks for Learner and Trainer roles */}
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
        toggleBookmark,
        toggleCompletion,
        setEditingCourse,
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

    // Developer-specific state
    const [developerCourseDetail, setDeveloperCourseDetail] = useState<any>(null);
    const [developerLearningUnits, setDeveloperLearningUnits] = useState<any[]>([]);
    const [developerAssessments, setDeveloperAssessments] = useState<any[]>([]);

    // Use actual user role from context
    const userRole = role || UserRole.Learner;

    // Load developer-specific data
    useEffect(() => {
        const loadDeveloperData = async () => {
            if ((userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && selectedCourse?.id) {
                try {
                    // Load developer course detail (use courseId instead of courseRunId)
                    const detailResponse = await fetch(`/api/courses/developer-course-detail?courseId=${selectedCourse.id}`);
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
        };

        loadDeveloperData();
    }, [userRole, selectedCourse?.id]);

    if (!selectedCourse) {
        return null;
    }

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
            const response = await fetch(`/api/courses/edit-data?courseId=${selectedCourse.id}`);
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

    const traqomSurveyLink = 'https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr';
    // QR Code URLs temporarily disabled
    // const traqomQrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(traqomSurveyLink)}`;

    const attendanceLink = convertedCourse.daId ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${convertedCourse.daId}` : null;
    // const attendanceQrCodeUrl = attendanceLink ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(attendanceLink)}` : null;

    const isTrainerSlidesExternal = convertedCourse.trainerSlidesUrl?.startsWith('http');

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
                            <Card className="sticky top-24">
                                <CourseSidebar userRole={userRole} onSetGradingView={setIsGradingView} selectedCourse={convertedCourse} />
                            </Card>
                        </aside>

                        {/* Main Content */}
                        <main className="space-y-6">
                            {/* Back Button */}
                            <div className="mb-6 flex justify-between items-center">
                                <button
                                    onClick={handleBackToDashboard}
                                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white rounded-lg flex items-center gap-2"
                                >
                                    Back to Dashboard
                                </button>
                                <div className="ml-auto flex gap-3">
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
                            </div>

                            {/* Digital Attendance */}
                            {(userRole === UserRole.Learner || userRole === UserRole.Trainer) && (
                                <div id={toId("Digital Attendance")}>
                                    <Card className="p-0 overflow-hidden">
                                        <button
                                            className="w-full text-left p-6 flex justify-between items-center"
                                            onClick={() => setIsAttendanceOpen(!isAttendanceOpen)}
                                            aria-expanded={isAttendanceOpen}
                                        >
                                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Digital Attendance</h3>
                                            <Icon name={isAttendanceOpen ? IconName.Minus : IconName.Plus} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                        </button>
                                        {isAttendanceOpen && (
                                            <div className="px-6 pb-6 border-t">
                                                <div className="pt-4">
                                                    {attendanceLink ? (
                                                        <div className="flex flex-col gap-5 w-full">
                                                            {/* Instructions Card */}
                                                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg p-5 border border-blue-100 dark:border-blue-800">
                                                                <p className="text-gray-800 dark:text-gray-200 font-semibold mb-3 flex items-center gap-2">
                                                                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">?</span>
                                                                    How to Take Attendance
                                                                </p>
                                                                <ol className="text-gray-600 space-y-2 text-sm ml-1">
                                                                    <li className="flex items-start gap-3 text-gray-600 dark:text-gray-300">
                                                                        <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">1</span>
                                                                        <span>Click on the attendance link below</span>
                                                                    </li>
                                                                    <li className="flex items-start gap-3 text-gray-600 dark:text-gray-300">
                                                                        <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">2</span>
                                                                        <span>Select <strong>"Trainees"</strong></span>
                                                                    </li>
                                                                    <li className="flex items-start gap-3 text-gray-600 dark:text-gray-300">
                                                                        <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">3</span>
                                                                        <span>Select <strong>Click The "Next" Button</strong></span>
                                                                    </li>
                                                                    <li className="flex items-start gap-3 text-gray-600 dark:text-gray-300">
                                                                        <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">4</span>
                                                                        <span>Scan the QR Code displayed on screen</span>
                                                                    </li>
                                                                    <li className="flex items-start gap-3 text-gray-600 dark:text-gray-300">
                                                                        <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">5</span>
                                                                        <span>Click <strong>"Retrieve Myinfo With Singpass"</strong></span>
                                                                    </li>
                                                                </ol>
                                                            </div>

                                                            {/* Note */}
                                                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
                                                                <span className="text-amber-500 text-lg flex-shrink-0">!</span>
                                                                <p className="text-sm text-amber-700 dark:text-amber-400">
                                                                    <strong>Note:</strong> If you see the message "Please enable location settings in your browser before submitting your attendance", please follow the SkillsFuture link guide on how to activate the location settings.
                                                                </p>
                                                            </div>

                                                            {/* QR Code temporarily disabled
                                                            <img
                                                                src={attendanceQrCodeUrl}
                                                                alt="Digital Attendance QR Code"
                                                                className="rounded-lg shadow-md"
                                                            />
                                                            */}

                                                            {/* Link Section */}
                                                            <div className="w-full">
                                                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 font-medium">Attendance Link:</p>
                                                                <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-between gap-3">
                                                                    <a
                                                                        href={attendanceLink}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate flex-1"
                                                                    >
                                                                        {attendanceLink}
                                                                    </a>
                                                                    <Button
                                                                        onClick={() => {
                                                                            navigator.clipboard.writeText(attendanceLink);
                                                                            alert('Link copied to clipboard!');
                                                                        }}
                                                                        className="flex-shrink-0"
                                                                    >
                                                                        Copy Link
                                                                    </Button>
                                                                </div>
                                                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
                                                                    DA ID: <span className="font-semibold text-gray-700 dark:text-gray-300">{convertedCourse.daId}</span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <p className="text-gray-500 text-center">Digital Attendance ID not available for this class.</p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                </div>
                            )}

                            {/* Lesson Plan */}
                            <div id={toId("Lesson Plan")}>
                                <ContentSection title="Lesson Plan">
                                    {convertedCourse.lessonPlanUrl ? (
                                        <div
                                            onClick={(e) => handleFileDownload(convertedCourse.lessonPlanUrl!, e)}
                                            className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                        >
                                            <Icon name={IconName.FileText} className="w-8 h-8 text-red-600 flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="font-semibold text-gray-900 dark:text-white break-all">{extractFilenameFromPath(convertedCourse.lessonPlanUrl)}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to download the lesson plan</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 dark:text-gray-400">The lesson plan for this course will be displayed here.</p>
                                    )}
                                </ContentSection>
                            </div>

                            {/* Learner Guide */}
                            <div id={toId("Learner Guide")}>
                                <ContentSection title="Learner Guide">
                                    {convertedCourse.learnerGuideUrl ? (
                                        <div
                                            onClick={(e) => handleFileDownload(convertedCourse.learnerGuideUrl!, e)}
                                            className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                        >
                                            <Icon name={IconName.FileText} className="w-8 h-8 text-red-600 flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="font-semibold text-gray-900 dark:text-white break-all">{extractFilenameFromPath(convertedCourse.learnerGuideUrl)}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Click to download the guide</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 dark:text-gray-400">The learner guide for this course will be displayed here.</p>
                                    )}
                                </ContentSection>
                            </div>

                            {/* Facilitator/Learner Guide */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && (
                                <div id={toId("Facilitator Guide")}>
                                    <ContentSection title="Facilitator Guide">
                                        {convertedCourse.facilitatorGuideUrl ? (
                                            <div
                                                onClick={(e) => handleFileDownload(convertedCourse.facilitatorGuideUrl!, e)}
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                            >
                                                <Icon name={IconName.FileText} className="w-8 h-8 text-red-600 flex-shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white break-all">{extractFilenameFromPath(convertedCourse.facilitatorGuideUrl)}</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to download the guide</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">The facilitator guide for this course will be displayed here.</p>
                                        )}
                                    </ContentSection>
                                </div>
                            )}

                            {/* Learner Slides */}
                            {userRole !== UserRole.Trainer && (
                                <div id={toId("Learner Slides")}>
                                    <ContentSection title="Learner Slides">
                                        {convertedCourse.slidesUrl ? (
                                            <div
                                                onClick={(e) => handleFileDownload(convertedCourse.slidesUrl!, e)}
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                            >
                                                <Icon name={IconName.FileText} className="w-8 h-8 text-red-600 flex-shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-gray-900 dark:text-white break-all">{extractFilenameFromPath(convertedCourse.slidesUrl)}</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to download the slides</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">The learner slides for this course will be displayed here.</p>
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
                                                // External URL (Google Slides) - open in new tab
                                                <a href={convertedCourse.trainerSlidesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                                                    <Icon name={IconName.ExternalLink} className="w-8 h-8 text-orange-600 flex-shrink-0" />
                                                    <div>
                                                        <p className="font-semibold text-gray-900 dark:text-white">Trainer Slide</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to view presentation online</p>
                                                    </div>
                                                </a>
                                            ) : (
                                                // Local file - download
                                                <div
                                                    onClick={(e) => handleFileDownload(convertedCourse.trainerSlidesUrl!, e)}
                                                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                                >
                                                    <Icon name={IconName.FileText} className="w-8 h-8 text-orange-600 flex-shrink-0" />
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-gray-900 dark:text-white break-all">{extractFilenameFromPath(convertedCourse.trainerSlidesUrl)}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Click to download the trainer slides</p>
                                                    </div>
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">The trainer slides for this course will be displayed here.</p>
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
                                                const topicCompletedCount = topic.subtopics.filter(st => completedSubtopicsSet.has(st.id)).length;
                                                const topicProgress = topic.subtopics.length > 0 ? (topicCompletedCount / topic.subtopics.length) * 100 : 0;

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
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </Card>
                            </div>

                            {/* TRAQOM Survey */}
                            {userRole === UserRole.Learner && (
                                <div id={toId("TRAQOM Survey")}>
                                    <Card className="p-0 overflow-hidden">
                                        <button
                                            className="w-full text-left p-6 flex justify-between items-center"
                                            onClick={() => setIsTraqomOpen(!isTraqomOpen)}
                                            aria-expanded={isTraqomOpen}
                                        >
                                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">TRAQOM Survey</h3>
                                            <Icon name={isTraqomOpen ? IconName.Minus : IconName.Plus} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                                        </button>
                                        {isTraqomOpen && (
                                            <div className="px-6 pb-6 border-t">
                                                <div className="pt-4 flex flex-col items-center gap-4 text-center">
                                                    <p className="text-gray-500 dark:text-gray-400">
                                                        Your feedback is important. Please use the link below to complete the survey.
                                                    </p>
                                                    {/* QR Code temporarily disabled
                                                    <img
                                                        src={traqomQrCodeUrl}
                                                        alt="TRAQOM Survey QR Code"
                                                        className="rounded-lg shadow-md"
                                                    />
                                                    */}
                                                    <div className="w-full max-w-md">
                                                        <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center gap-2">
                                                            <a
                                                                href={traqomSurveyLink}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
                                                            >
                                                                {traqomSurveyLink}
                                                            </a>
                                                            <Button
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(traqomSurveyLink);
                                                                    alert('Link copied to clipboard!');
                                                                }}
                                                            >
                                                                Copy Link
                                                            </Button>
                                                        </div>
                                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                                                            Course Run ID: <span className="font-semibold text-gray-700 dark:text-gray-300">{convertedCourse.courseRunId}</span>
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                </div>
                            )}

                            {/* Assessment Plan */}
                            {(userRole === UserRole.Trainer || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider || userRole === UserRole.Admin) && (
                                <div id={toId("Assessment Plan")}>
                                    <ContentSection title="Assessment Plan">
                                        {convertedCourse.assessmentPlanUrl ? (
                                            <div
                                                onClick={(e) => handleFileDownload(convertedCourse.assessmentPlanUrl!, e)}
                                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                                            >
                                                <Icon name={IconName.FileText} className="w-8 h-8 text-red-600 flex-shrink-0" />
                                                <div>
                                                    <p className="font-semibold text-gray-900 dark:text-white">{extractFilenameFromPath(convertedCourse.assessmentPlanUrl)}</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Click to download the assessment plan</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-gray-500 dark:text-gray-400">The assessment plan for this course will be displayed here.</p>
                                        )}
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

                            {/* Certificate */}
                            <div id="certificate">
                                <CertificateSection userRole={userRole} />
                            </div>

                            {/* Leaderboard */}
                            {/* {userRole === UserRole.Learner && (
                        <Leaderboard course={convertedCourse} />
                    )} */}
                        </main>
                    </div>
                </>
            )}
        </div>
    );
};