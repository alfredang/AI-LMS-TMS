import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

// Enums based on the Python constants
enum IdTypeSummary {
  NRIC = "NRIC",
  FIN = "FIN",
  OTHERS = "OTHERS"
}

enum CollectionStatus {
  PENDING_PAYMENT = "Pending Payment",
  PARTIAL_PAYMENT = "Partial Payment",
  FULL_PAYMENT = "Full Payment"
}

enum SponsorshipType {
  EMPLOYER = "EMPLOYER",
  INDIVIDUAL = "INDIVIDUAL"
}

interface Course {
  id: string;
  title: string;
  courseCode: string;
  tscTitle: string;
  tscCode: string;
}

interface CourseRun {
  course_run_id: string;
  // Add other properties as needed
}

interface Learner {
  name: string;
  email: string;
  // Add other properties as needed
}

interface SelectedCourse {
  learners?: Learner[];
  // Add other properties as needed
}

interface EnrolmentFormData {
  // Course Info
  courseReferenceNumber: string;
  courseRunId: string;

  // Payment Info
  traineeFeesDiscountAmount?: number;
  traineeFeesCollectionStatus: CollectionStatus;

  // Trainee Info
  traineeIdType: IdTypeSummary;
  traineeId: string;
  traineeFullName: string;
  traineeDateOfBirth: string;
  traineeEmailAddress: string;
  traineeContactNumberAreaCode?: string;
  traineeContactNumberCountryCode: string;
  traineeContactNumberPhoneNumber: string;
  traineeEnrolmentDate?: string;
  traineeSponsorshipType: SponsorshipType;

  // Employer Info (conditional based on sponsorship)
  employerUen?: string;
  employerFullName?: string;
  employerEmailAddress?: string;
  employerAreaCode?: string;
  employerCountryCode?: string;
  employerPhoneNumber?: string;

  // Training Partner Info
  trainingPartnerUen: string;
  trainingPartnerCode: string;
}

const EnrollLearners: React.FC = () => {
  const [formData, setFormData] = useState<EnrolmentFormData>({
    courseReferenceNumber: '',
    courseRunId: '',
    traineeFeesCollectionStatus: CollectionStatus.PENDING_PAYMENT,
    traineeIdType: IdTypeSummary.NRIC,
    traineeId: '',
    traineeFullName: '',
    traineeDateOfBirth: '',
    traineeEmailAddress: '',
    traineeContactNumberCountryCode: '+65',
    traineeContactNumberPhoneNumber: '',
    traineeSponsorshipType: SponsorshipType.INDIVIDUAL,
    trainingPartnerUen: '201200696W',
    trainingPartnerCode: '201200696W-01'
  });

  // Course management state
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [availableCourseRuns, setAvailableCourseRuns] = useState<CourseRun[]>([]);
  const [loadingCourseRuns, setLoadingCourseRuns] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState('');

  // Learner search and management state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Learner[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<SelectedCourse | null>(null);
  const [isAddingLearner, setIsAddingLearner] = useState(false);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);

  // Enrolment search state (similar to ClassDetailView)
  const [enrolmentData, setEnrolmentData] = useState<any>(null);
  const [enrolmentLoading, setEnrolmentLoading] = useState(false);
  const [enrolmentError, setEnrolmentError] = useState<string | null>(null);

  const [showOptionalFields, setShowOptionalFields] = useState({
    feeDiscount: false,
    traineeAreaCode: false,
    enrolmentDate: false,
    employerUen: false,
    employerFullName: false,
    employerEmail: false,
    employerAreaCode: false,
    employerCountryCode: false,
    employerPhoneNumber: false
  });

  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputClasses = "block w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

  // Helper function to calculate age group from date of birth (from ClassDetailView)
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

  // Helper function for status colors (from ClassDetailView)
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
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  // Fetch available courses on component mount
  const fetchAvailableCourses = async () => {
    setLoadingCourses(true);
    try {
      const response = await fetch(getApiUrl('/api/courses/list'));
      if (!response.ok) {
        throw new Error('Failed to fetch courses');
      }
      const result = await response.json();
      setAvailableCourses(result.data || []);
    } catch (error) {
      console.error('Error fetching courses:', error);
      alert('Failed to load available courses. Please refresh the page.');
    } finally {
      setLoadingCourses(false);
    }
  };

  // Fetch course runs when a course is selected
  const fetchCourseRuns = async (courseId: string) => {
    if (!courseId) {
      setAvailableCourseRuns([]);
      return;
    }

    setLoadingCourseRuns(true);
    try {
      const response = await fetch(getApiUrl(`/api/course-runs/by-course/${courseId}`));
      if (!response.ok) {
        throw new Error('Failed to fetch course runs');
      }
      const result = await response.json();
      setAvailableCourseRuns(result.data || []);
    } catch (error) {
      console.error('Error fetching course runs:', error);
      alert('Failed to load course runs. Please try again.');
      setAvailableCourseRuns([]);
    } finally {
      setLoadingCourseRuns(false);
    }
  };

  // Search for learners
  const searchLearners = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await fetch(getApiUrl(`/api/learners/search?query=${encodeURIComponent(query)}`));
      if (!response.ok) {
        throw new Error('Failed to search learners');
      }
      const result = await response.json();
      setSearchResults(result.data || []);
    } catch (error) {
      console.error('Error searching learners:', error);
      setSearchResults([]);
    }
  };

  // Enroll learner in class
  const enrollLearnerInClass = async (courseId: string, learnerEmail: string) => {
    try {
      const response = await fetch(getApiUrl('/api/enrolments/enroll'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: courseId,
          learnerEmail: learnerEmail,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to enroll learner');
      }

      alert('Learner enrolled successfully!');
      // Refresh the enrolment data to show updated enrollment list
      if (formData.courseRunId) {
        searchEnrolmentRecords(formData.courseRunId);
      }
    } catch (error) {
      console.error('Error enrolling learner:', error);
      alert('Failed to enroll learner. Please try again.');
    }
  };

  // Unenroll learner from class
  const unenrollLearnerFromClass = async (courseId: string, learnerEmail: string) => {
    try {
      const response = await fetch(getApiUrl('/api/enrolments/unenroll'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: courseId,
          learnerEmail: learnerEmail,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to unenroll learner');
      }

      alert('Learner removed successfully!');
      // Refresh the enrolment data to show updated enrollment list
      if (formData.courseRunId) {
        searchEnrolmentRecords(formData.courseRunId);
      }
    } catch (error) {
      console.error('Error removing learner:', error);
      alert('Failed to remove learner. Please try again.');
    }
  };

  // Handle learner selection for enrollment
  const handleLearnerSelection = (learner: Learner) => {
    setSelectedLearner(learner);
    setIsAddingLearner(false); // Hide the search section
    // Auto-fill trainee information when a learner is selected
    setFormData(prev => ({
      ...prev,
      traineeFullName: learner.name,
      traineeEmailAddress: learner.email
    }));
  };

  // Handle going back to search from adding learner
  const handleBackToSearch = () => {
    setIsAddingLearner(false);
    setSelectedLearner(null);
    // Reset form data related to trainee
    setFormData(prev => ({
      ...prev,
      traineeId: '',
      traineeFullName: '',
      traineeDateOfBirth: '',
      traineeEmailAddress: '',
      traineeContactNumberAreaCode: '',
      traineeContactNumberPhoneNumber: '',
      traineeEnrolmentDate: '',
      employerUen: '',
      employerFullName: '',
      employerEmailAddress: '',
      employerAreaCode: '',
      employerCountryCode: '',
      employerPhoneNumber: ''
    }));
  };

  // Fetch courses when component mounts
  useEffect(() => {
    fetchAvailableCourses();
  }, []);

  // Fetch course runs when course reference number changes
  useEffect(() => {
    const selectedCourse = availableCourses.find(course => course.courseCode === formData.courseReferenceNumber);
    if (selectedCourse) {
      setSelectedCourseId(selectedCourse.id);
      fetchCourseRuns(selectedCourse.id);
    } else {
      setSelectedCourseId('');
      setAvailableCourseRuns([]);
    }
  }, [formData.courseReferenceNumber, availableCourses]);

  // Search learners when search query changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchLearners(searchQuery);
    }, 300); // Debounce search

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Search for enrolment records when courseRunId changes
  useEffect(() => {
    if (formData.courseRunId) {
      searchEnrolmentRecords(formData.courseRunId);
    } else {
      setEnrolmentData(null);
      setEnrolmentError(null);
    }
  }, [formData.courseRunId]);

  // Function to search enrolment records (similar to ClassDetailView)
  const searchEnrolmentRecords = async (courseRunId: string) => {
    if (!courseRunId) {
      setEnrolmentError('Course Run ID is required for enrolment search');
      return;
    }

    try {
      setEnrolmentLoading(true);
      setEnrolmentError(null);
      console.log('🔍 Searching enrolment records for course run:', courseRunId);

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
        courseRunId: courseRunId,
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
      setEnrolmentData(ssgResponse);

    } catch (err) {
      console.error('❌ Error searching enrolment records:', err);
      setEnrolmentError(err instanceof Error ? err.message : 'Failed to search enrolment records');
    } finally {
      setEnrolmentLoading(false);
    }
  };

  const handleInputChange = (field: keyof EnrolmentFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear course run ID when course reference number changes
    if (field === 'courseReferenceNumber') {
      setFormData(prev => ({ ...prev, courseRunId: '' }));
    }

    // Clear errors when user types
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  const toggleOptionalField = (field: keyof typeof showOptionalFields) => {
    setShowOptionalFields(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateNRIC = (nric: string): boolean => {
    // Basic NRIC validation - starts with letter, 7 digits, ends with letter
    const nricRegex = /^[STFG]\d{7}[A-Z]$/i;
    return nricRegex.test(nric);
  };

  const validateUEN = (uen: string): boolean => {
    // Basic UEN validation - 8-10 digits followed by a letter
    const uenRegex = /^\d{8,10}[A-Z]$/i;
    return uenRegex.test(uen);
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];
    const newWarnings: string[] = [];

    // Required field validations
    if (!formData.courseReferenceNumber.trim()) {
      newErrors.push('Course Reference Number is required');
    }

    if (!formData.courseRunId.trim()) {
      newErrors.push('Course Run ID is required');
    }

    // Trainee validation - only required when adding a new learner
    if (isAddingLearner) {
      if (!formData.traineeId.trim()) {
        newErrors.push('Trainee ID is required');
      } else if (formData.traineeIdType !== IdTypeSummary.OTHERS && !validateNRIC(formData.traineeId)) {
        newWarnings.push('ID Number may not be valid');
      }

      if (!formData.traineeFullName.trim()) {
        newErrors.push('Trainee Full Name is required');
      }

      if (!formData.traineeDateOfBirth) {
        newErrors.push('Trainee Date of Birth is required');
      }

      if (!formData.traineeEmailAddress.trim()) {
        newErrors.push('Trainee Email Address is required');
      } else if (!validateEmail(formData.traineeEmailAddress)) {
        newErrors.push('Trainee Email format is not valid');
      }

      if (!formData.traineeContactNumberCountryCode.trim()) {
        newErrors.push('Trainee Country Code is required');
      }

      if (!formData.traineeContactNumberPhoneNumber.trim()) {
        newErrors.push('Trainee Phone Number is required');
      }
    }

    // Validate that either a learner is selected or we're adding a new learner
    if (!selectedLearner && !isAddingLearner) {
      newErrors.push('Please select an existing learner or add a new learner profile');
    }

    if (!formData.trainingPartnerCode.trim()) {
      newErrors.push('Training Partner Code is required');
    }

    if (!formData.trainingPartnerUen.trim()) {
      newErrors.push('Training Partner UEN is required');
    } else if (!validateUEN(formData.trainingPartnerUen)) {
      newErrors.push('Training Partner UEN is not valid');
    }

    if (!formData.trainingPartnerUen.trim()) {
      newErrors.push('Training Partner UEN is required');
    } else if (!validateUEN(formData.trainingPartnerUen)) {
      newErrors.push('Training Partner UEN is not valid');
    }

    // Employer validations (when sponsorship is EMPLOYER)
    if (formData.traineeSponsorshipType === SponsorshipType.EMPLOYER) {
      if (!formData.employerUen?.trim()) {
        newErrors.push('Employer UEN is required for employer-sponsored trainees');
      } else if (!validateUEN(formData.employerUen)) {
        newErrors.push('Employer UEN is not valid');
      }

      if (!formData.employerFullName?.trim()) {
        newErrors.push('Employer Full Name is required for employer-sponsored trainees');
      }

      if (!formData.employerEmailAddress?.trim()) {
        newErrors.push('Employer Email Address is required for employer-sponsored trainees');
      } else if (!validateEmail(formData.employerEmailAddress)) {
        newErrors.push('Employer Email format is not valid');
      }

      if (!formData.employerCountryCode?.trim()) {
        newErrors.push('Employer Country Code is required for employer-sponsored trainees');
      }

      if (!formData.employerPhoneNumber?.trim()) {
        newErrors.push('Employer Phone Number is required for employer-sponsored trainees');
      }
    }

    setErrors(newErrors);
    setWarnings(newWarnings);
    return newErrors.length === 0;
  };

  const buildPayload = () => {
    return {
      enrolment: {
        course: {
          run: {
            id: formData.courseRunId || null
          },
          referenceNumber: formData.courseReferenceNumber
        },
        trainee: {
          id: formData.traineeId,
          fees: {
            discountAmount: formData.traineeFeesDiscountAmount || null,
            collectionStatus: formData.traineeFeesCollectionStatus
          },
          idType: {
            type: formData.traineeIdType
          },
          employer: {
            uen: formData.employerUen || null,
            contact: {
              fullName: formData.employerFullName || null,
              emailAddress: formData.employerEmailAddress || null,
              contactNumber: {
                areaCode: formData.employerAreaCode || null,
                countryCode: formData.employerCountryCode || null,
                phoneNumber: formData.employerPhoneNumber || null
              }
            }
          },
          fullName: formData.traineeFullName,
          dateOfBirth: formData.traineeDateOfBirth,
          emailAddress: formData.traineeEmailAddress,
          contactNumber: {
            areaCode: formData.traineeContactNumberAreaCode || null,
            countryCode: formData.traineeContactNumberCountryCode,
            phoneNumber: formData.traineeContactNumberPhoneNumber
          },
          enrolmentDate: formData.traineeEnrolmentDate || null,
          sponsorshipType: formData.traineeSponsorshipType
        },
        trainingPartner: {
          uen: formData.trainingPartnerUen,
          code: formData.trainingPartnerCode
        }
      }
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = buildPayload();

      console.log('Submitting enrolment payload:', JSON.stringify(payload, null, 2));

      const response = await fetch('/api/enrolment/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        alert('Enrolment created successfully!');
        // Reset form or redirect
        setFormData({
          courseReferenceNumber: '',
          courseRunId: '',
          traineeFeesCollectionStatus: CollectionStatus.PENDING_PAYMENT,
          traineeIdType: IdTypeSummary.NRIC,
          traineeId: '',
          traineeFullName: '',
          traineeDateOfBirth: '',
          traineeEmailAddress: '',
          traineeContactNumberCountryCode: '+65',
          traineeContactNumberPhoneNumber: '',
          traineeSponsorshipType: SponsorshipType.INDIVIDUAL,
          trainingPartnerUen: '',
          trainingPartnerCode: ''
        });
      } else {
        setErrors([result.error || 'Failed to create enrolment']);
      }
    } catch (error) {
      console.error('Error submitting enrolment:', error);
      setErrors(['Network error occurred while creating enrolment']);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEmployerSponsored = formData.traineeSponsorshipType === SponsorshipType.EMPLOYER;

  return (
    <div className="bg-white rounded-lg shadow-md dark:bg-gray-800 dark:border-gray-700">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 pt-4 dark:text-white">Enroll Learners</h1>

        {/* Errors and Warnings */}
        {errors.length > 0 && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <h3 className="text-sm font-medium text-red-800 mb-2">Please fix the following errors:</h3>
            <ul className="list-disc list-inside text-sm text-red-700">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <h3 className="text-sm font-medium text-yellow-800 mb-2">Warnings:</h3>
            <ul className="list-disc list-inside text-sm text-yellow-700">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Course Info Section */}
          <div className="bg-gray-50 p-6 rounded-lg dark:bg-gray-700/30">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-white">Course Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Course Reference Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.courseReferenceNumber}
                  onChange={(e) => handleInputChange('courseReferenceNumber', e.target.value)}
                  className={inputClasses}
                  placeholder="Enter course code (e.g., TGS-2024001234)"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Enter the course code manually or select from available courses below
                </p>
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Or Select from Available Courses
                  </label>
                  {loadingCourses ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">Loading courses...</span>
                    </div>
                  ) : (
                    <select
                      value={formData.courseReferenceNumber}
                      onChange={(e) => handleInputChange('courseReferenceNumber', e.target.value)}
                      className={inputClasses}
                    >
                      <option value="">Select a course...</option>
                      {availableCourses.map((course) => (
                        <option key={course.courseCode} value={course.courseCode}>
                          {course.title} ({course.courseCode})
                        </option>
                      ))}
                    </select>
                  )}
                  {availableCourses.length === 0 && !loadingCourses && (
                    <p className="text-xs text-amber-600 mt-1">
                      No courses found in the database. You can still enter a course code manually above.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Course Run ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.courseRunId}
                  onChange={(e) => handleInputChange('courseRunId', e.target.value)}
                  className={inputClasses}
                  placeholder="Enter course run ID (e.g., 101)"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Enter the course run ID manually or select from available runs below
                </p>
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Or Select from Available Course Runs
                  </label>
                  {loadingCourseRuns ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">Loading course runs...</span>
                    </div>
                  ) : (
                    <select
                      value={formData.courseRunId}
                      onChange={(e) => handleInputChange('courseRunId', e.target.value)}
                      className={inputClasses}
                    >
                      <option value="">Select a course run...</option>
                      {availableCourseRuns.map((courseRun) => (
                        <option key={courseRun.course_run_id} value={courseRun.course_run_id}>
                          {courseRun.course_run_id}
                        </option>
                      ))}
                    </select>
                  )}
                  {formData.courseReferenceNumber && availableCourseRuns.length === 0 && !loadingCourseRuns && (
                    <p className="text-xs text-amber-600 mt-1">
                      No course runs found for this course. You can still enter a course run ID manually above.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Add Learners to Class Section - Only show when not adding a new learner */}
          {!isAddingLearner && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                <h3 className="text-xl font-bold mb-4 dark:text-white">Add Learners to Class</h3>
                <div className="relative">
                  <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search existing learners by name or email..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className={`${inputClasses} pl-9`}
                    disabled={!selectedCourseId}
                  />
                </div>
                <div className="mt-4 max-h-60 overflow-y-auto space-y-2">
                  {searchResults.map(learner => (
                    <div key={learner.email} className="p-2 flex justify-between items-center bg-gray-50 rounded-md dark:bg-gray-700/50">
                      <div>
                        <p className="font-semibold text-sm dark:text-white">{learner.name}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{learner.email}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleLearnerSelection(learner)}>
                        Select
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="text-center p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md mt-4">
                  <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">Can't find a learner?</p>
                  <Button size="sm" onClick={() => setIsAddingLearner(true)} disabled={!selectedCourseId}>
                    + Add New Learner Profile
                  </Button>
                </div>
              </Card>

              <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                <h3 className="text-xl font-bold mb-4 dark:text-white">Currently Enrolled ({enrolmentData && enrolmentData.data ? enrolmentData.data.length : 0})</h3>
                <div className="max-h-[22rem] overflow-y-auto space-y-2">
                  {enrolmentLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                      <p className="text-gray-500 dark:text-gray-400 mt-2">Loading enrolled learners...</p>
                    </div>
                  ) : enrolmentData && (enrolmentData.status === "200" || enrolmentData.status === 200) && enrolmentData.data && Array.isArray(enrolmentData.data) && enrolmentData.data.length > 0 ? (
                    enrolmentData.data.map((record: any, index: number) => {
                      const ageGroup = getAgeGroup(record.enrolment?.trainee?.dateOfBirth);
                      return (
                        <div key={index} className="p-2 bg-blue-50 rounded-md dark:bg-blue-900/30">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-semibold text-sm dark:text-white">{record.enrolment?.trainee?.fullName || 'N/A'}</p>
                              <p className="text-xs text-gray-600 dark:text-gray-300">{record.enrolment?.trainee?.email.full || 'N/A'}</p>
                            </div>
                            <Button size="sm" variant="danger" onClick={() => unenrollLearnerFromClass(selectedCourseId, record.enrolment?.trainee?.emailAddress)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-center text-gray-600 dark:text-gray-400 py-10">
                      {formData.courseRunId ? 'No enrolled learners found for this course run.' : 'Select a course run to see enrolled learners.'}
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* Selected Learner Section - Show when a learner is selected but not adding new */}
          {selectedLearner && !isAddingLearner && (
            <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300">Selected Learner</h3>
                <Button size="sm" variant="ghost" onClick={() => setSelectedLearner(null)} className="dark:text-blue-300 dark:hover:text-blue-200">
                  × Clear Selection
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-blue-700 dark:text-blue-400">Name</p>
                  <p className="font-semibold text-blue-900 dark:text-blue-200">{selectedLearner.name}</p>
                </div>
                <div>
                  <p className="text-sm text-blue-700 dark:text-blue-400">Email</p>
                  <p className="font-semibold text-blue-900 dark:text-blue-200">{selectedLearner.email}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm text-blue-600 dark:text-blue-400">Please fill in the sponsorship and employer information below to complete the enrollment.</p>
              </div>
            </div>
          )}

          {/* Trainee Info Section - Only show when adding a new learner */}
          {isAddingLearner && (
            <div className="bg-gray-50 p-6 rounded-lg dark:bg-gray-700/30">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Trainee Information</h2>
                <Button size="sm" variant="ghost" onClick={handleBackToSearch} className="dark:text-gray-300 dark:hover:text-white">
                  ← Back to Search
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Trainee ID Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.traineeIdType}
                    onChange={(e) => handleInputChange('traineeIdType', e.target.value as IdTypeSummary)}
                    className={inputClasses}
                  >
                    {Object.values(IdTypeSummary).map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Trainee ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.traineeId}
                    onChange={(e) => handleInputChange('traineeId', e.target.value)}
                    placeholder="e.g., S7020587D"
                    maxLength={20}
                    className={inputClasses}
                  />
                </div>
              </div>

              <h3 className="text-md font-semibold text-gray-800 mb-4 dark:text-gray-200">Trainee Particulars</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Trainee Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.traineeFullName}
                    onChange={(e) => handleInputChange('traineeFullName', e.target.value)}
                    placeholder="e.g., Aileen Chong"
                    maxLength={200}
                    className={inputClasses}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Trainee Date of Birth <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.traineeDateOfBirth}
                    onChange={(e) => handleInputChange('traineeDateOfBirth', e.target.value)}
                    min="1900-01-01"
                    className={inputClasses}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Trainee Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.traineeEmailAddress}
                    onChange={(e) => handleInputChange('traineeEmailAddress', e.target.value)}
                    placeholder="e.g., test@test.com"
                    maxLength={100}
                    className={inputClasses}
                  />
                </div>

                {/* Contact Number Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Country Code <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.traineeContactNumberCountryCode}
                      onChange={(e) => handleInputChange('traineeContactNumberCountryCode', e.target.value)}
                      placeholder="+65"
                      maxLength={5}
                      className={inputClasses}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.traineeContactNumberPhoneNumber}
                      onChange={(e) => handleInputChange('traineeContactNumberPhoneNumber', e.target.value)}
                      placeholder="98765432"
                      maxLength={20}
                      className={inputClasses}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Employer Info Section - Only show when a learner is selected */}
          {(selectedLearner || isAddingLearner) && (
            <div className="bg-gray-50 p-6 rounded-lg dark:bg-gray-700/30">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-white">Sponsorship and Employer Information</h2>

              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showOptionalFields.enrolmentDate}
                    onChange={() => toggleOptionalField('enrolmentDate')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Specify Trainee Date of Enrolment?</span>
                </label>

                {showOptionalFields.enrolmentDate && (
                  <div className="mt-2">
                    <input
                      type="date"
                      value={formData.traineeEnrolmentDate || ''}
                      onChange={(e) => handleInputChange('traineeEnrolmentDate', e.target.value)}
                      min="1900-01-01"
                      className={inputClasses}
                    />
                  </div>
                )}
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Trainee Sponsorship Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.traineeSponsorshipType}
                  onChange={(e) => handleInputChange('traineeSponsorshipType', e.target.value as SponsorshipType)}
                  className={inputClasses}
                >
                  {Object.values(SponsorshipType).map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              {/* Conditional Employer Fields */}
              {isEmployerSponsored && (
                <div className="space-y-4">
                  <h3 className="text-md font-semibold text-gray-800 dark:text-white">Employer Details</h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Employer UEN <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.employerUen || ''}
                      onChange={(e) => handleInputChange('employerUen', e.target.value)}
                      placeholder="e.g., 201000372W"
                      maxLength={50}
                      className={inputClasses}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Employer organisation's UEN</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Employer Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.employerFullName || ''}
                      onChange={(e) => handleInputChange('employerFullName', e.target.value)}
                      placeholder="e.g., Stephen Chua"
                      maxLength={50}
                      className={inputClasses}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The employer contact's person name</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Employer Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.employerEmailAddress || ''}
                      onChange={(e) => handleInputChange('employerEmailAddress', e.target.value)}
                      placeholder="test@test.com"
                      maxLength={100}
                      className={inputClasses}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The employer contact's email address</p>
                  </div>

                  {/* Employer Contact Number */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="flex items-center space-x-2 mb-2">
                        <input
                          type="checkbox"
                          checked={showOptionalFields.employerAreaCode}
                          onChange={() => toggleOptionalField('employerAreaCode')}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">Specify Area Code</span>
                      </label>

                      {showOptionalFields.employerAreaCode && (
                        <input
                          type="text"
                          value={formData.employerAreaCode || ''}
                          onChange={(e) => handleInputChange('employerAreaCode', e.target.value)}
                          placeholder="Area Code"
                          maxLength={10}
                          className={inputClasses}
                        />
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Country Code <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerCountryCode || '+65'}
                        onChange={(e) => handleInputChange('employerCountryCode', e.target.value)}
                        placeholder="+65"
                        maxLength={5}
                        className={inputClasses}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerPhoneNumber || ''}
                        onChange={(e) => handleInputChange('employerPhoneNumber', e.target.value)}
                        placeholder="98765432"
                        maxLength={20}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Optional Employer Fields for Individual Sponsorship */}
              {!isEmployerSponsored && (
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={showOptionalFields.employerUen}
                        onChange={() => toggleOptionalField('employerUen')}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Specify Employer UEN?</span>
                    </label>

                    {showOptionalFields.employerUen && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={formData.employerUen || ''}
                          onChange={(e) => handleInputChange('employerUen', e.target.value)}
                          placeholder="e.g., 201000372W"
                          maxLength={50}
                          className={inputClasses}
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={showOptionalFields.employerFullName}
                        onChange={() => toggleOptionalField('employerFullName')}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Specify Employer Full Name?</span>
                    </label>

                    {showOptionalFields.employerFullName && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={formData.employerFullName || ''}
                          onChange={(e) => handleInputChange('employerFullName', e.target.value)}
                          placeholder="e.g., Stephen Chua"
                          maxLength={50}
                          className={inputClasses}
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={showOptionalFields.employerEmail}
                        onChange={() => toggleOptionalField('employerEmail')}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Specify Employer Email Address?</span>
                    </label>

                    {showOptionalFields.employerEmail && (
                      <div className="mt-2">
                        <input
                          type="email"
                          value={formData.employerEmailAddress || ''}
                          onChange={(e) => handleInputChange('employerEmailAddress', e.target.value)}
                          placeholder="test@test.com"
                          maxLength={100}
                          className={inputClasses}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Training Partner Info Section */}
          <div className="bg-gray-50 p-6 rounded-lg dark:bg-gray-700/30">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-white">Training Partner Information</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Training Partner UEN <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.trainingPartnerUen}
                  onChange={(e) => handleInputChange('trainingPartnerUen', e.target.value)}
                  placeholder="e.g., 199900650G"
                  maxLength={12}
                  className={inputClasses}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Training Partner Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.trainingPartnerCode}
                  onChange={(e) => handleInputChange('trainingPartnerCode', e.target.value)}
                  placeholder="e.g., 199900650G-01"
                  maxLength={15}
                  className={inputClasses}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Code for the training partner conducting the course for which the trainee is enrolled</p>
              </div>
            </div>
          </div>

          {/* Preview Request Body */}
          <div className="bg-gray-50 p-6 rounded-lg dark:bg-gray-700/30">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-white">Preview Request Body</h2>
            <div className="bg-white p-4 rounded border dark:bg-gray-800 dark:border-gray-700">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto dark:text-gray-300">
                {JSON.stringify(buildPayload(), null, 2)}
              </pre>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => {
                if (confirm('Are you sure you want to clear all fields?')) {
                  setFormData({
                    courseReferenceNumber: '',
                    courseRunId: '',
                    traineeFeesCollectionStatus: CollectionStatus.PENDING_PAYMENT,
                    traineeIdType: IdTypeSummary.NRIC,
                    traineeId: '',
                    traineeFullName: '',
                    traineeDateOfBirth: '',
                    traineeEmailAddress: '',
                    traineeContactNumberCountryCode: '+65',
                    traineeContactNumberPhoneNumber: '',
                    traineeSponsorshipType: SponsorshipType.INDIVIDUAL,
                    trainingPartnerUen: '201200696W',
                    trainingPartnerCode: '201200696W-01'
                  });
                  setShowOptionalFields({
                    feeDiscount: false,
                    traineeAreaCode: false,
                    enrolmentDate: false,
                    employerUen: false,
                    employerFullName: false,
                    employerEmail: false,
                    employerAreaCode: false,
                    employerCountryCode: false,
                    employerPhoneNumber: false
                  });
                  setErrors([]);
                  setWarnings([]);
                }
              }}
              className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Clear Form
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {isSubmitting ? 'Creating Enrolment...' : 'Create Enrolment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EnrollLearners;