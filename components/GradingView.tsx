import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import { getApiUrl, stripBaseUrl } from '@/lib/urlHelpers';

// Define types for grading functionality based on database structure
interface Assessment {
    assessment_id: string;
    assessment_title: string;
    assessment_category: string;
    assessment_status: string;
}

interface Submission {
    submission_id: string | null;
    submission_file: string | null;
    file_url: string | null;
    submitted_at: string | null;
    grading: string | null;
}

interface Learner {
    learner_id: string;
    learner_name: string;
    learner_email: string;
    submissions: { [assessmentId: string]: Submission };
}

interface GradingViewProps {
    onBack: () => void;
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Competent': return 'bg-green-100 text-green-800 border-green-200';
        case 'Pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        case 'Not Yet Competent': return 'bg-red-100 text-red-800 border-red-200';
        default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

const GradingView: React.FC<GradingViewProps> = ({ onBack }) => {
    const { selectedCourse, courseDetail } = useLms();
    const [assessments, setAssessments] = useState<Assessment[]>([]);
    const [learners, setLearners] = useState<Learner[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Get course run UUID from courseDetail (this is the GUID format we need for grading APIs)
    // Priority: courseRunUuid (UUID) > selectedCourse.courseRunId (UUID) > courseDetail.courseRunId (string, fallback)
    const courseRunId = courseDetail?.courseRunUuid || selectedCourse?.courseRunId || courseDetail?.courseRunId;

    useEffect(() => {
        console.log('🔍 GradingView - courseDetail:', courseDetail);
        console.log('🔍 GradingView - selectedCourse:', selectedCourse);
        console.log('🔍 GradingView - extracted courseRunId:', courseRunId);
        
        if (!courseRunId) {
            console.error('❌ No course run ID available');
            setError('No course run ID available');
            setLoading(false);
            return;
        }

        fetchGradingData();
    }, [courseRunId]);

    const fetchGradingData = async () => {
        try {
            setLoading(true);
            setError(null);

            console.log('🚀 Fetching grading data for courseRunId:', courseRunId);

            // Fetch assessments and submissions data
            const assessmentsUrl = getApiUrl(`/api/grading/course-run-assessments?courseRunId=${courseRunId}`);
            const submissionsUrl = getApiUrl(`/api/grading/learner-submissions?courseRunId=${courseRunId}`);

            console.log('📡 Fetching from URLs:', { assessmentsUrl, submissionsUrl });

            const [assessmentsResponse, submissionsResponse] = await Promise.all([
                fetch(assessmentsUrl),
                fetch(submissionsUrl)
            ]);

            console.log('📨 Response status:', { 
                assessments: assessmentsResponse.status, 
                submissions: submissionsResponse.status 
            });

            if (!assessmentsResponse.ok || !submissionsResponse.ok) {
                const assessmentError = !assessmentsResponse.ok ? await assessmentsResponse.text() : null;
                const submissionError = !submissionsResponse.ok ? await submissionsResponse.text() : null;
                console.error('❌ HTTP Error:', { assessmentError, submissionError });
                throw new Error(`HTTP Error: Assessments ${assessmentsResponse.status}, Submissions ${submissionsResponse.status}`);
            }

            const assessmentsData = await assessmentsResponse.json();
            const submissionsData = await submissionsResponse.json();

            console.log('📋 Raw API Data:', { assessmentsData, submissionsData });

            if (!assessmentsData.success || !submissionsData.success) {
                console.error('❌ API Error:', { 
                    assessmentsError: assessmentsData.error, 
                    submissionsError: submissionsData.error 
                });
                throw new Error(`API Error: ${assessmentsData.error || submissionsData.error}`);
            }

            // Process assessments
            const processedAssessments: Assessment[] = assessmentsData.data.map((item: any) => ({
                assessment_id: item.assessment_id,
                assessment_title: item.assessment_title,
                assessment_category: item.assessment_category,
                assessment_status: item.assessment_status
            }));

            // Process submissions and group by learner
            const learnerMap = new Map<string, Learner>();
            
            submissionsData.data.forEach((item: any) => {
                if (!learnerMap.has(item.learner_id)) {
                    learnerMap.set(item.learner_id, {
                        learner_id: item.learner_id,
                        learner_name: item.learner_name,
                        learner_email: item.learner_email,
                        submissions: {}
                    });
                }

                const learner = learnerMap.get(item.learner_id)!;
                learner.submissions[item.assessment_id] = {
                    submission_id: item.submission_id,
                    submission_file: item.submission_file,
                    file_url: item.file_url,
                    submitted_at: item.submitted_at,
                    grading: item.grading || 'Pending'
                };
            });

            setAssessments(processedAssessments);
            setLearners(Array.from(learnerMap.values()));
            
            console.log('✅ Grading data processed successfully:', { 
                assessmentsCount: processedAssessments.length, 
                learnersCount: learnerMap.size 
            });
            
        } catch (err: any) {
            console.error('❌ Error fetching grading data:', err);
            const errorMessage = err.message || 'Unknown error occurred';
            setError(`Failed to load grading data: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (learnerEmail: string, assessmentId: string, newStatus: 'Competent' | 'Pending' | 'Not Yet Competent') => {
        try {
            console.log('🔄 Updating grade:', { learnerEmail, assessmentId, newStatus });
            
            // First get the enrollment ID
            const enrollmentResponse = await fetch(getApiUrl(`/api/grading/enrollment-lookup?learnerEmail=${learnerEmail}&courseRunId=${courseRunId}`));

            if (!enrollmentResponse.ok) {
                throw new Error('Failed to find enrollment');
            }

            const enrollmentData = await enrollmentResponse.json();
            if (!enrollmentData.success) {
                throw new Error('Could not find enrollment for this learner');
            }

            // Update the grading
            const updateResponse = await fetch(getApiUrl('/api/grading/update-grading'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    enrollmentId: enrollmentData.data.enrollment_id,
                    assessmentId: assessmentId,
                    grading: newStatus
                })
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                console.error('❌ Update failed:', errorText);
                throw new Error(`Failed to update grading: ${updateResponse.status}`);
            }

            const updateResult = await updateResponse.json();
            if (!updateResult.success) {
                throw new Error(updateResult.error || 'Failed to update grading');
            }

            // Update local state
            setLearners(prevLearners => 
                prevLearners.map(learner => {
                    if (learner.learner_email === learnerEmail) {
                        return {
                            ...learner,
                            submissions: {
                                ...learner.submissions,
                                [assessmentId]: {
                                    ...learner.submissions[assessmentId],
                                    grading: newStatus
                                }
                            }
                        };
                    }
                    return learner;
                })
            );

            console.log('✅ Grade updated successfully');
            
        } catch (err: any) {
            console.error('❌ Error updating grading:', err);
            const errorMessage = err.message || 'Unknown error occurred';
            alert(`Failed to update grading: ${errorMessage}`);
        }
    };

    if (!selectedCourse) {
        return <div>Error: No course selected for grading.</div>;
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center py-10">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading grading data...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-10">
                <p className="text-red-600 mb-4">{error}</p>
                <Button onClick={fetchGradingData}>Try Again</Button>
            </div>
        );
    }

    return (
        <div>
            <Button
                variant="ghost"
                onClick={onBack}
                className="mb-4 flex items-center gap-2"
            >
                <Icon name={IconName.Back} className="w-5 h-5" />
                Back to Course Details
            </Button>
            <h2 className="text-3xl font-bold mb-2">Grading Roster</h2>
            <p className="text-xl text-blue-600 font-semibold mb-6">{selectedCourse.title}</p>

            <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    {(learners.length > 0 && assessments.length > 0) ? (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">Learner Name</th>
                                    {assessments.map((assessment: Assessment) => (
                                        <th key={assessment.assessment_id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            {assessment.assessment_title}
                                            <span className="block text-gray-400 font-normal">{assessment.assessment_category}</span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {learners.map((learner: Learner) => (
                                    <tr key={learner.learner_email}>
                                        <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white font-medium text-gray-900 z-10 border-r">
                                            {learner.learner_name}
                                        </td>
                                        {assessments.map((assessment: Assessment) => {
                                            const submission = learner.submissions[assessment.assessment_id];
                                            const status = submission?.grading || 'Pending';
                                            
                                            return (
                                                <td key={assessment.assessment_id} className="px-6 py-4 whitespace-nowrap align-top">
                                                     <div className="space-y-2">
                                                        {submission?.submission_file ? (
                                                            <div className="p-2 bg-gray-50 rounded-md border">
                                                                <div className="flex items-start gap-2">
                                                                    <Icon name={IconName.FileText} className="w-5 h-5 text-blue-500 flex-shrink-0 mt-1" />
                                                                    <div>
                                                                        <p className="font-semibold text-sm leading-tight break-all">{submission.submission_file}</p>
                                                                        <p className="text-xs text-gray-500">
                                                                            {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : 'N/A'}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                {submission.file_url && (
                                                                    <a
                                                                        href={getApiUrl(`/api/download${stripBaseUrl(submission.file_url) || submission.file_url}`)}
                                                                        download
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="inline-flex items-center gap-1.5 mt-2 px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                                                                    >
                                                                        <Icon name={IconName.Download} className="w-3 h-3" />
                                                                        Download
                                                                    </a>
                                                                )}
                                                            </div>
                                                        ) : (
                                                             <div className="text-sm text-gray-500 italic text-center py-2 h-[84px] flex items-center justify-center">Not Submitted</div>
                                                        )}
                                                        
                                                        {submission?.submission_file && (
                                                            <select
                                                                value={status}
                                                                onChange={(e) => handleStatusChange(learner.learner_email, assessment.assessment_id, e.target.value as 'Competent' | 'Pending' | 'Not Yet Competent')}
                                                                className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${getStatusColor(status)}`}
                                                            >
                                                                <option value="Pending">Pending</option>
                                                                <option value="Competent">Competent</option>
                                                                <option value="Not Yet Competent">Not Yet Competent</option>
                                                            </select>
                                                        )}                                                        
                                                    </div>
                                                </td>
                                            )
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-center text-gray-500 py-10">
                            {learners.length === 0 ? "No learners are enrolled in this class yet." : "No assessments have been added to this course."}
                        </p>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default GradingView;
