import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// Helper function for status colors (matching the reference)
const getStatusColor = (status: string) => {
  switch (status) {
    case 'Paid':
    case 'Claimed':
    case 'Approved':
    case 'Competent':
    case 'Pass':
    case 'Success':
    case 'Successful':
    case 'Full Payment':
    case 'Confirmed':
      return 'bg-green-100 text-green-800';
    case 'Processing':
    case 'Reschedule':
      return 'bg-blue-100 text-blue-800';
    case 'Pending':
    case 'In Progress':
      return 'bg-yellow-100 text-yellow-800';
    case 'Overdue':
    case 'Rejected':
    case 'Unpaid':
    case 'Not Yet Competent':
    case 'Fail':
    case 'Failed':
    case 'Cancelled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

interface OperationalSummary {
  trainer: string;
  startDate: string;
  mode: string;
  overallAssessment: string;
  tgsRef: string;
  courseRunId: string;
  overallGrantStatus: string;
  overallClaimStatus: string;
}

interface EnrolledLearner {
  learnerName: string;
  learnerEmail: string;
  learnerTel: string;
  company: string;
  sponsorship: string;
  nationality: string;
  dob: string;
  paymentDetails: string;
  assessment: string;
  grantId: string;
  claimId: string;
}

interface ClassDetail {
  courseTitle: string;
  operationalSummary: OperationalSummary;
  enrolledLearners: EnrolledLearner[];
}

interface ClassDetailViewProps {
  courseRunId?: string;
}

const ClassDetailView: React.FC<ClassDetailViewProps> = ({ courseRunId }) => {
  const { setAdminPage } = useLms();
  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search Enrolment state
  const [enrolmentData, setEnrolmentData] = useState<any>(null);
  const [enrolmentLoading, setEnrolmentLoading] = useState(false);
  const [enrolmentError, setEnrolmentError] = useState<string | null>(null);
  const [showEnrolmentSearch, setShowEnrolmentSearch] = useState(false);

  useEffect(() => {
    const fetchClassDetails = async () => {
      if (!courseRunId) {
        setError('Course run ID is required');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log('🔍 Fetching class details for course run:', courseRunId);

        const response = await fetch(getApiUrl(`/api/admin/class-details?courseRunId=${courseRunId}`));
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Failed to fetch class details');
        }

        console.log('✅ Class details loaded:', result.data);
        setClassDetail(result.data);
        
        // Automatically search for enrolment records when class details are loaded
        setTimeout(async () => {
          await searchEnrolmentRecords(result.data.operationalSummary?.courseRunId);
        }, 100); // Small delay to ensure classDetail state is updated
        
        setError(null);
      } catch (err) {
        console.error('❌ Error fetching class details:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch class details');
      } finally {
        setLoading(false);
      }
    };

    fetchClassDetails();
  }, [courseRunId]);

  // Debug useEffect to monitor enrolmentData changes
  useEffect(() => {
    console.log('🔍 EnrolmentData state changed:', {
      enrolmentData,
      status: enrolmentData?.status,
      hasData: !!enrolmentData?.data,
      isArray: Array.isArray(enrolmentData?.data),
      dataLength: enrolmentData?.data?.length,
      firstRecord: enrolmentData?.data?.[0]
    });
  }, [enrolmentData]);

  // Helper function to calculate age group from date of birth (matching reference)
  const getAgeGroup = (dob: string): 'Above 40' | 'Below 40' | 'N/A' => {
    if (!dob) return 'N/A';
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age > 40 ? 'Above 40' : 'Below 40';
  };

  // Helper function to format date
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not specified';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Function to search enrolment records
  const searchEnrolmentRecords = async (targetCourseRunId?: string) => {
    const courseRunIdToUse = targetCourseRunId || classDetail?.operationalSummary?.courseRunId;
    
    if (!courseRunIdToUse) {
      setEnrolmentError('Course Run ID is required for enrolment search');
      return;
    }

    try {
      setEnrolmentLoading(true);
      setEnrolmentError(null);
      console.log('🔍 Searching enrolment records for course run:', courseRunIdToUse);

      // Fetch UEN from database
      const uenResponse = await fetch(getApiUrl('/api/training-provider/uen'));
      if (!uenResponse.ok) {
        throw new Error('Failed to fetch UEN from database');
      }
      const uenData = await uenResponse.json();
      
      if (!uenData.uen) {
        throw new Error('UEN not found in database');
      }

      // Prepare search request
      const searchRequest = {
        courseRunId: courseRunIdToUse,
        trainingPartnerUen: uenData.uen,
        trainingPartnerCode: `${uenData.uen}-01`, // Concatenate UEN with "-01"
        pageSize: 100
      };

      console.log('📤 Enrolment search request:', searchRequest);

      const response = await fetch(getApiUrl('/api/enrolment/search'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchRequest)
      });

      const result = await response.json();

      // Treat 404 as valid response (no records found), only throw error for other failures
      if (!response.ok || (!result.success && result.status !== "404" && result.status !== 404)) {
        throw new Error(result.error || 'Failed to search enrolment records');
      }

      // Extract the actual SSG response from the wrapper
      const ssgResponse = result.data;

      console.log('✅ Enrolment search results:', ssgResponse);
      console.log('🔍 Setting enrolmentData to SSG response:', ssgResponse);
      console.log('🔍 SSG Response structure check:', {
        hasSSGResponse: !!ssgResponse,
        hasData: !!ssgResponse?.data,
        isArray: Array.isArray(ssgResponse?.data),
        dataLength: ssgResponse?.data?.length,
        status: ssgResponse?.status,
        statusType: typeof ssgResponse?.status
      });
      console.log('🔍 Full SSG response object:', JSON.stringify(ssgResponse, null, 2));
      
      setEnrolmentData(ssgResponse);
      setShowEnrolmentSearch(true); // Show the search section when data is loaded
      
    } catch (err) {
      console.error('❌ Error searching enrolment records:', err);
      setEnrolmentError(err instanceof Error ? err.message : 'Failed to search enrolment records');
    } finally {
      setEnrolmentLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading class details...</p>
        </div>
      </div>
    );
  }

  if (error || !classDetail) {
    return (
      <div className="text-center py-12">
        <Icon name={IconName.InfoCircle} className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Class Details</h3>
        <p className="text-gray-500 mb-6">
          {error || 'The requested class details could not be found.'}
        </p>
        <Button variant="primary" onClick={() => setAdminPage(AdminPage.Dashboard)}>
          <Icon name={IconName.Back} className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Back button and header (matching reference style) */}
      <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)} className="mb-4">
        &larr; Back to List
      </Button>
      
      <h2 className="text-3xl font-bold mb-2">Class Details</h2>
      <p className="text-xl text-primary font-semibold mb-6">{classDetail.courseTitle}</p>

      {/* Operational Summary Card (matching reference layout) */}
      <Card className="p-6 mb-8">
        <h3 className="text-xl font-bold mb-4">Operational Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8">
          <div>
            <p className="text-sm text-subtle">Trainer</p>
            <p className="font-semibold">{classDetail.operationalSummary.trainer}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">Start Date</p>
            <p className="font-semibold">{formatDate(classDetail.operationalSummary.startDate)}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">Mode</p>
            <p className="font-semibold">{classDetail.operationalSummary.mode || 'Not specified'}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">Overall Assessment</p>
            <p className="font-semibold">{classDetail.operationalSummary.overallAssessment}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">TGS Ref</p>
            <p className="font-semibold">{classDetail.operationalSummary.tgsRef}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">Course Run ID</p>
            <p className="font-semibold">{classDetail.operationalSummary.courseRunId}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">Overall Grant Status</p>
            <p className="font-semibold">{classDetail.operationalSummary.overallGrantStatus}</p>
          </div>
          <div>
            <p className="text-sm text-subtle">Overall Claim Status</p>
            <p className="font-semibold">{classDetail.operationalSummary.overallClaimStatus}</p>
          </div>
        </div>
      </Card>

      {/* Enrolled Learners Section - Using Search Enrolment API Data */}
      <h3 className="text-2xl font-bold mb-4">Enrolled Learners</h3>
      <Card className="p-0 overflow-x-auto">
        {/* Original database data (commented out) */}
        {/* 
        {classDetail.enrolledLearners && classDetail.enrolledLearners.length > 0 ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Learner
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Company
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Sponsorship
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nationality
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Age Group
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payment Details
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Assessment
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Grant ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Claim ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {classDetail.enrolledLearners.map((learner, index) => {
                const ageGroup = getAgeGroup(learner.dob);
                return (
                  <tr key={index}>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <p className="font-medium text-gray-900">{learner.learnerName}</p>
                      <p className="text-gray-500">{learner.learnerEmail}</p>
                      <p className="text-gray-500">{learner.learnerTel}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {learner.company || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {learner.sponsorship || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {learner.nationality || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {ageGroup}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(learner.paymentDetails)}`}>
                        {learner.paymentDetails || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(learner.assessment)}`}>
                        {learner.assessment || 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      {learner.grantId || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      {learner.claimId || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                      <Button size="sm" variant="ghost">
                        <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-center text-subtle py-10">No learners are enrolled in this course yet.</p>
        )}
        */}

        {/* New table using Search Enrolment API data */}
        {enrolmentData && (enrolmentData.status === "200" || enrolmentData.status === 200) && enrolmentData.data && Array.isArray(enrolmentData.data) && enrolmentData.data.length > 0 ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Learner
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Company
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Sponsorship
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID Type
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Age Group
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payment Details
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Assessment
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Grant ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Claim ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {enrolmentData.data.map((record: any, index: number) => {
                const trainee = record.enrolment.trainee;
                const ageGroup = getAgeGroup(trainee.dateOfBirth || '');
                
                return (
                  <tr key={index}>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <p className="font-medium text-gray-900">{trainee.fullName || 'N/A'}</p>
                      <p className="text-gray-500">{trainee.email.full || 'N/A'}</p>
                      <p className="text-gray-500">{trainee.contactNumber.phoneNumber || 'N/A'}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {trainee.employer.name || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {trainee.sponsorshipType || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {trainee.idType.type || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {ageGroup}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(trainee.fees.collectionStatus || '')}`}>
                        {trainee.fees.collectionStatus || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                        Pending
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      N/A
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      N/A
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                      <Button size="sm" variant="ghost">
                        <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="text-center text-subtle py-10">
            {enrolmentData && (enrolmentData.status === "200" || enrolmentData.status === 200) && enrolmentData.data && Array.isArray(enrolmentData.data) && enrolmentData.data.length === 0 ? (
              <p>No enrolment records found for this course run.</p>
            ) : enrolmentData && (enrolmentData.status === "200" || enrolmentData.status === 200) ? (
              <p>Data received but no valid enrolment records found.</p>
            ) : enrolmentData && (enrolmentData.status === "404" || enrolmentData.status === 404) ? (
              <p>No enrolment records found for this course run.</p>
            ) : enrolmentData ? (
              <p>Invalid response status: {enrolmentData.status || 'Unknown'} (Type: {typeof enrolmentData.status})</p>
            ) : (
              <p>Click "Search Enrolment Records" below to load learner data from SSG API.</p>
            )}
          </div>
        )}
      </Card>

      {/* Search Enrolment Records Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-2xl font-bold">Enrolment Records Search</h3>
          <Button 
            variant="primary" 
            onClick={() => {
              if (!showEnrolmentSearch) {
                setShowEnrolmentSearch(true);
                searchEnrolmentRecords();
              } else {
                setShowEnrolmentSearch(false);
                setEnrolmentData(null);
                setEnrolmentError(null);
              }
            }}
            disabled={enrolmentLoading}
          >
            {enrolmentLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Searching...
              </>
            ) : showEnrolmentSearch ? (
              'Hide Enrolment Search'
            ) : (
              <>
                <Icon name={IconName.Eye} className="w-4 h-4 mr-2" />
                Search Enrolment Records
              </>
            )}
          </Button>
        </div>

        {showEnrolmentSearch && (
          <Card className="p-6">
            {enrolmentError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <div className="flex">
                  <Icon name={IconName.InfoCircle} className="w-5 h-5 text-red-400 mr-2 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-red-800">Error</h4>
                    <p className="text-sm text-red-700 mt-1">{enrolmentError}</p>
                  </div>
                </div>
              </div>
            )}

            {enrolmentData && (
              <div className="space-y-6">
                {/* Request Details */}
                <div>
                  <h4 className="text-lg font-semibold mb-3">Search Parameters</h4>
                  <div className="bg-gray-50 p-4 rounded-md">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="font-medium text-gray-600">Course Run ID:</span>
                        <p className="font-mono">{enrolmentData.requestBody?.enrolment?.course?.run?.id || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">Training Partner UEN:</span>
                        <p className="font-mono">{enrolmentData.requestBody?.enrolment?.trainingPartner?.uen || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">Training Partner Code:</span>
                        <p className="font-mono">{enrolmentData.requestBody?.enrolment?.trainingPartner?.code || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">Page Size:</span>
                        <p className="font-mono">{enrolmentData.requestBody?.parameters?.pageSize || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Response Data */}
                <div>
                  <h4 className="text-lg font-semibold mb-3">Search Results</h4>
                  <div className="bg-gray-50 p-4 rounded-md max-h-96 overflow-auto">
                    <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                      {JSON.stringify(enrolmentData.data, null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Summary */}
                {enrolmentData.data && (
                  <div>
                    <h4 className="text-lg font-semibold mb-3">Summary</h4>
                    <div className="bg-blue-50 p-4 rounded-md">
                      <div className="flex items-center">
                        <Icon name={IconName.InfoCircle} className="w-5 h-5 text-blue-400 mr-2" />
                        <span className="text-blue-800">
                          {enrolmentData.data.count !== undefined 
                            ? `Found ${enrolmentData.data.count} enrolment record(s)`
                            : 'Enrolment search completed'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!enrolmentLoading && !enrolmentError && !enrolmentData && (
              <div className="text-center py-8">
                <Icon name={IconName.Eye} className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Click "Search Enrolment Records" to fetch enrolment data for this course run.</p>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
};

export default ClassDetailView;