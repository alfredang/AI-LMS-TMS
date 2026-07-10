import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { detectIdType } from '@/lib/utils/id-type';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { ssgFetch } from '@/lib/ssgAppState';

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
  start_date?: string; // YYYY-MM-DD — used to build the Company Application row
  // Add other properties as needed
}

// Employer option from /api/admin/list-employers (distinct companies already
// seen in Company Applications). Selecting one routes this enrolment through
// the Company Application pipeline so it appears in View Company Application.
interface EmployerOption {
  id: string;
  employerUen: string;
  employerOrgName: string;
  employerContactName: string;
  employerContactDesignation: string;
  employerContactEmail: string;
  employerContactPhone: string;
  source: 'qb' | 'history' | 'both';
}

// Sentinel dropdown value for entering a brand-new employer by hand.
const NEW_EMPLOYER_KEY = '__new__';

// Trainee Identity Type options accepted by the Company Application pipeline.
const IDENTITY_TYPE_OPTIONS = ['Singapore Citizen', 'Singapore Permanent Resident'];

interface Learner {
  id: string;
  name: string;
  email: string;
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

  // Company Application extras — only used when an employer is picked from the
  // dropdown (routes through the Company Application pipeline).
  employerOrgName?: string;
  employerContactDesignation?: string;
  traineeIdentityType?: string;
  traineeHighestQualification?: string;

  // Training Partner Info
  trainingPartnerUen: string;
  trainingPartnerCode: string;
}

// Default form values, reused by the initial state and the various resets so
// the Company Application fields don't drift out of sync.
const buildInitialFormData = (uen?: string): EnrolmentFormData => ({
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
  employerCountryCode: '+65',
  employerOrgName: '',
  employerContactDesignation: '',
  traineeIdentityType: IDENTITY_TYPE_OPTIONS[0],
  traineeHighestQualification: '',
  trainingPartnerUen: uen || '',
  trainingPartnerCode: uen ? `${uen}-01` : '',
});

const EnrollLearners: React.FC = () => {
  const { trainingProviderProfile, setAdminPage } = useLms();
  const [formData, setFormData] = useState<EnrolmentFormData>(
    buildInitialFormData(trainingProviderProfile?.uen)
  );

  // Employer dropdown (Company Application) state.
  const [employers, setEmployers] = useState<EmployerOption[]>([]);
  const [loadingEmployers, setLoadingEmployers] = useState(false);
  // '' = nothing chosen yet (show the company search); an employer id = existing
  // company picked (auto-fills); NEW_EMPLOYER_KEY = entering a new company by hand.
  // Only used when sponsorship is EMPLOYER.
  const [selectedEmployerKey, setSelectedEmployerKey] = useState('');
  const [employerSearch, setEmployerSearch] = useState('');

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

  const abortControllerRef = useRef<AbortController | null>(null);

  interface SubmissionResult {
    success: boolean;
    referenceNumber?: string;
    enrolmentStatus?: string;
    errorMessages?: string[];
    // Trainee snapshot from localStorage
    traineeName?: string;
    traineeId?: string;
    traineeIdType?: string;
    traineeEmail?: string;
    courseReferenceNumber?: string;
    courseRunId?: string;
    sponsorshipType?: string;
    feesCollectionStatus?: string;
    submittedAt?: string;
    // Company Application path only
    companyApplication?: boolean;
    employerOrgName?: string;
  }
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const ENROLMENT_DRAFT_KEY = 'enrolment_submission_draft';

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

  // Date conversion helpers
  const toDisplayDate = (isoDate: string): string => {
    if (!isoDate) return '';
    // YYYY-MM-DD → DD/MM/YYYY
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    return isoDate;
  };

  const toApiDate = (displayDate: string): string => {
    if (!displayDate) return '';
    // DD/MM/YYYY → YYYY-MM-DD
    const match = displayDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) return displayDate;
    return displayDate;
  };

  // Fetch UEN from training provider table on mount
  useEffect(() => {
    const fetchUen = async () => {
      try {
        const res = await fetch('/api/training-provider/uen');
        if (!res.ok) return;
        const data = await res.json();
        if (data.uen) {
          setFormData(prev => ({
            ...prev,
            trainingPartnerUen: data.uen,
            trainingPartnerCode: `${data.uen}-01`
          }));
        }
      } catch {
        // Silently fail — user can fill manually
      }
    };
    fetchUen();
  }, []);

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

  // Fetch course information by course run ID
  const fetchCourseByRunId = async (courseRunId: string) => {
    if (!courseRunId.trim()) return;

    try {
      const response = await fetch(getApiUrl(`/api/course-runs/get-course-by-run-id?courseRunId=${encodeURIComponent(courseRunId)}`));
      if (!response.ok) {
        // If not found, just silently fail - user might be entering a new course run
        return;
      }
      const result = await response.json();
      if (result.success && result.data && result.data.courseCode) {
        // Auto-fill the course reference number if found
        setFormData(prev => ({ ...prev, courseReferenceNumber: result.data.courseCode }));
      }
    } catch (error) {
      console.error('Error fetching course by run ID:', error);
      // Silently fail - don't disrupt user input
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
  const handleLearnerSelection = async (learner: Learner) => {
    // Pre-fill what we already have from search results
    setFormData(prev => ({
      ...prev,
      traineeFullName: learner.name,
      traineeEmailAddress: learner.email,
      traineeId: '',
      traineeDateOfBirth: '',
      traineeContactNumberPhoneNumber: '',
    }));

    // Switch to the "Add New Learner Profile" view
    setSelectedLearner(learner);
    setIsAddingLearner(true);
    setSearchQuery('');
    setSearchResults([]);

    // Fetch full profile from app_user + learner_profile
    try {
      const url = getApiUrl(`/api/learners/profile?id=${encodeURIComponent(learner.id)}`);
      console.log('Fetching learner profile:', url);
      const res = await fetch(url);
      const result = await res.json();
      console.log('Learner profile response:', result);
      if (res.ok && result.success && result.data) {
        const profile = result.data;
        // Prefer SSG raw_data fields over learner_profile fields (more accurate)
        const dobRaw = profile.ssg_dob || profile.dob || '';
        const dobFormatted = dobRaw ? toDisplayDate(dobRaw) : '';
        const nric = profile.ssg_nric || profile.nric || '';
        const phone = profile.ssg_phone || profile.tel || '';
        const countryCode = profile.ssg_country_code || '+65';
        const areaCode = profile.ssg_area_code || '';
        const idType = profile.ssg_id_type as IdTypeSummary || IdTypeSummary.NRIC;
        const tpUen = profile.ssg_tp_uen || '';
        const tpCode = profile.ssg_tp_code || (tpUen ? `${tpUen}-01` : '');
        console.log('Populating form with:', { nric, phone, dob: dobFormatted, tpUen });
        setFormData(prev => ({
          ...prev,
          traineeFullName: profile.full_name || learner.name,
          traineeEmailAddress: profile.email || learner.email,
          traineeId: nric,
          traineeIdType: idType,
          traineeDateOfBirth: dobFormatted,
          traineeContactNumberCountryCode: countryCode,
          traineeContactNumberAreaCode: areaCode,
          traineeContactNumberPhoneNumber: phone,
          ...(tpUen ? { trainingPartnerUen: tpUen, trainingPartnerCode: tpCode } : {}),
        }));
      }
    } catch (err) {
      console.warn('Could not fetch learner profile, using search data only:', err);
    }
  };

  // Load the list of employers already seen in Company Applications.
  const fetchEmployers = async () => {
    setLoadingEmployers(true);
    try {
      const res = await fetch('/api/admin/list-employers');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.employers)) setEmployers(data.employers);
    } catch {
      // Non-critical — the admin can still pick "Add new employer".
    } finally {
      setLoadingEmployers(false);
    }
  };

  // Employer picker (shown under EMPLOYER sponsorship). Picking an existing
  // company auto-fills its details; NEW_EMPLOYER_KEY blanks them for manual
  // entry. Sponsorship type — not this — decides Company Application routing.
  const handleEmployerSelect = (key: string) => {
    setSelectedEmployerKey(key);
    setEmployerSearch('');
    setErrors([]);

    if (key === NEW_EMPLOYER_KEY) {
      setFormData(prev => ({
        ...prev,
        employerOrgName: '',
        employerUen: '',
        employerFullName: '',
        employerContactDesignation: '',
        employerEmailAddress: '',
        employerCountryCode: '+65',
        employerPhoneNumber: '',
      }));
      return;
    }

    const employer = employers.find(e => e.id === key);
    if (!employer) return;
    setFormData(prev => ({
      ...prev,
      employerOrgName: employer.employerOrgName,
      employerUen: employer.employerUen,
      employerFullName: employer.employerContactName,
      employerContactDesignation: employer.employerContactDesignation,
      employerEmailAddress: employer.employerContactEmail,
      employerCountryCode: '+65',
      employerPhoneNumber: employer.employerContactPhone,
    }));
  };

  // "Can't find it?" — switch to manual new-employer entry.
  const handleAddNewEmployer = () => handleEmployerSelect(NEW_EMPLOYER_KEY);

  // Back to the company search (clears the chosen/typed employer).
  const handleChangeEmployer = () => {
    setSelectedEmployerKey('');
    setEmployerSearch('');
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
      employerCountryCode: '+65',
      employerPhoneNumber: ''
    }));
  };

  // Fetch courses and employers when component mounts
  useEffect(() => {
    fetchAvailableCourses();
    fetchEmployers();
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

  // Search for enrolment records when courseRunId changes (trigger when exactly 7 digits)
  useEffect(() => {
    setEnrolmentData(null);
    setEnrolmentError(null);
    if (/^\d{7}$/.test(formData.courseRunId.trim())) {
      searchEnrolmentRecords(formData.courseRunId.trim());
    }
  }, [formData.courseRunId]);

  // Function to search enrolment records via direct SSG API
  const searchEnrolmentRecords = async (courseRunId: string) => {
    if (!courseRunId) {
      setEnrolmentError('Course Run ID is required for enrolment search');
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      setEnrolmentLoading(true);
      setEnrolmentError(null);
      console.log('🔍 Searching enrolment records for course run:', courseRunId);

      const response = await ssgFetch('/api/enrolment/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunId }),
        signal
      });

      const result = await response.json();

      if (!response.ok) {
        // Don't throw (avoids Next.js redbox overlay); just show error state.
        const msg = result?.error || `Enrolment search failed with status: ${response.status}`;
        setEnrolmentError(msg);
        return;
      }

      console.log('✅ Enrolment search results:', result);
      // Store in format the UI expects: { status: 200, data: [...] }
      const records = Array.isArray(result.data) ? result.data : [];
      setEnrolmentData({ status: 200, data: records });

      // Auto-fill course reference number from the first record
      const refNumber = records[0]?.enrolment?.course?.referenceNumber;
      if (refNumber) {
        setFormData(prev => ({ ...prev, courseReferenceNumber: refNumber }));
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return; // stale request cancelled — ignore
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

    // Auto-detect ID type when trainee ID changes
    if (field === 'traineeId' && typeof value === 'string' && value.trim()) {
      const detectedType = detectIdType(value);
      // Only switch to NRIC or FIN if detected. Don't auto-switch back to OTHERS if they're typing a passport.
      if (detectedType !== IdTypeSummary.OTHERS) {
        setFormData(prev => ({ ...prev, traineeIdType: detectedType as IdTypeSummary }));
      }
    }

    // Fetch course code when course run ID is entered
    if (field === 'courseRunId' && value) {
      fetchCourseByRunId(value as string);
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
    const trainee: any = {
      id: formData.traineeId,
      idType: { type: formData.traineeIdType },
      fullName: formData.traineeFullName,
      dateOfBirth: toApiDate(formData.traineeDateOfBirth),
      emailAddress: formData.traineeEmailAddress,
      contactNumber: {
        countryCode: formData.traineeContactNumberCountryCode,
        phoneNumber: formData.traineeContactNumberPhoneNumber,
        ...(formData.traineeContactNumberAreaCode ? { areaCode: formData.traineeContactNumberAreaCode } : {})
      },
      enrolmentDate: formData.traineeEnrolmentDate ? toApiDate(formData.traineeEnrolmentDate) : new Date().toISOString().split('T')[0],
      sponsorshipType: formData.traineeSponsorshipType,
      fees: {
        discountAmount: formData.traineeFeesDiscountAmount ?? 0,
        collectionStatus: formData.traineeFeesCollectionStatus
      }
    };

    if (formData.traineeSponsorshipType === SponsorshipType.EMPLOYER) {
      trainee.employer = {
        uen: formData.employerUen,
        contact: {
          fullName: formData.employerFullName,
          emailAddress: formData.employerEmailAddress,
          contactNumber: {
            countryCode: formData.employerCountryCode,
            phoneNumber: formData.employerPhoneNumber,
            ...(formData.employerAreaCode ? { areaCode: formData.employerAreaCode } : {})
          }
        }
      };
    }

    return {
      enrolment: {
        trainingPartner: {
          code: formData.trainingPartnerCode,
          uen: formData.trainingPartnerUen
        },
        course: {
          referenceNumber: formData.courseReferenceNumber,
          run: { id: formData.courseRunId }
        },
        trainee
      }
    };
  };

  // DD/MM/YYYY or YYYY-MM-DD → DD-MM-YYYY (the format the Company Application
  // pipeline validates against).
  const toDdMmYyyy = (value: string): string => {
    if (!value) return '';
    const v = value.trim();
    const ymd = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymd) return `${ymd[3].padStart(2, '0')}-${ymd[2].padStart(2, '0')}-${ymd[1]}`;
    const dmy = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`;
    return v;
  };

  // Company Application path: build a single row keyed by the CA Excel column
  // names and POST it to the same endpoint the Excel upload uses, so the full
  // pipeline (SSG enrol → grant → calendar → native enrolment → invoice) runs
  // and the learner shows up in View Company Application. No Excel required.
  const handleCompanyApplicationSubmit = async () => {
    const newErrors: string[] = [];

    const course = availableCourses.find(c => c.courseCode === formData.courseReferenceNumber);
    const run = availableCourseRuns.find(r => r.course_run_id === formData.courseRunId);
    const courseTitle = course?.title || '';
    const startDate = run?.start_date ? toDdMmYyyy(run.start_date) : '';

    if (!courseTitle) newErrors.push('Select the course from the "Available Courses" dropdown so the Company Application can resolve its title.');
    if (!startDate) newErrors.push('Select the course run from the "Available Course Runs" dropdown so the Company Application can resolve its start date.');
    if (!formData.traineeId.trim()) newErrors.push('Trainee NRIC/FIN is required.');
    if (!formData.traineeFullName.trim()) newErrors.push('Trainee Full Name is required.');
    if (!formData.traineeDateOfBirth.trim()) newErrors.push('Trainee Date of Birth is required.');
    if (!formData.traineeEmailAddress.trim()) newErrors.push('Trainee Email is required.');
    if (!formData.traineeContactNumberPhoneNumber.trim()) newErrors.push('Trainee Phone Number is required.');
    if (!formData.employerOrgName?.trim()) newErrors.push('Employer Organization Name is required.');
    if (!formData.employerUen?.trim()) newErrors.push('Employer UEN is required.');
    if (!formData.employerFullName?.trim()) newErrors.push('Employer Contact Name is required.');
    if (!formData.employerContactDesignation?.trim()) newErrors.push('Employer Contact Designation is required.');
    if (!formData.employerPhoneNumber?.trim()) newErrors.push('Employer Contact Telephone is required.');
    if (!formData.employerEmailAddress?.trim()) newErrors.push('Employer Contact Email is required.');

    if (newErrors.length > 0) {
      setErrors(newErrors);
      setWarnings([]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const row: Record<string, string> = {
      'Course Title*': courseTitle,
      'Course Start Date (DD-MM-YYYY)*': startDate,
      'Trainee Identity Type*': formData.traineeIdentityType || '',
      'Trainee FULL Name as on government ID*': formData.traineeFullName,
      'Trainee ID Type*': formData.traineeIdType,
      'Trainee NRIC/FIN Number*': formData.traineeId,
      'Date of Birth* (DD-MM-YYYY)': toDdMmYyyy(formData.traineeDateOfBirth),
      'Trainee Company email Address*': formData.traineeEmailAddress,
      'Trainee Mobile Phone Number*': formData.traineeContactNumberPhoneNumber,
      'Trainee Highest Qualification*': formData.traineeHighestQualification || '',
      'Employer Organization Name*': formData.employerOrgName || '',
      'Employer UEN*': formData.employerUen || '',
      'Employer Contact Name*': formData.employerFullName || '',
      'Employer Contact Designation*': formData.employerContactDesignation || '',
      'Employer Contact Telephone No.*': formData.employerPhoneNumber || '',
      'Employer Contact Email Address*': formData.employerEmailAddress || '',
    };

    setIsSubmitting(true);
    setErrors([]);
    setWarnings([]);
    try {
      const response = await fetch('/api/admin/upload-company-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [row] }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Row-level validation issues from companyApplicationValidator.
        if (Array.isArray(data?.validationErrors) && data.validationErrors.length > 0) {
          const msgs = data.validationErrors.flatMap((v: any) =>
            (v.issues || []).map((issue: string) => issue)
          );
          setErrors(msgs.length ? msgs : [data?.message || 'The enrolment could not be validated.']);
        } else {
          setErrors([data?.message || `Failed to submit (${response.status})`]);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      setSubmissionResult({
        success: true,
        companyApplication: true,
        traineeName: formData.traineeFullName,
        traineeId: formData.traineeId,
        traineeIdType: formData.traineeIdType,
        traineeEmail: formData.traineeEmailAddress,
        courseReferenceNumber: formData.courseReferenceNumber,
        courseRunId: formData.courseRunId,
        sponsorshipType: SponsorshipType.EMPLOYER,
        employerOrgName: formData.employerOrgName,
        submittedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Company Application submit failed:', err);
      setErrors(['Network error while submitting the Company Application enrolment. Please try again.']);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Employer picked from the dropdown → Company Application pipeline.
    if (isCompanyApplication) {
      await handleCompanyApplicationSubmit();
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmissionResult(null);

    try {
      const payload = buildPayload();

      // Snapshot the submitted form data to localStorage before the network call
      const submittedAt = new Date().toISOString();
      const draft = {
        traineeFullName:       formData.traineeFullName,
        traineeId:             formData.traineeId,
        traineeIdType:         formData.traineeIdType,
        traineeEmailAddress:   formData.traineeEmailAddress,
        courseReferenceNumber: formData.courseReferenceNumber,
        courseRunId:           formData.courseRunId,
        sponsorshipType:       formData.traineeSponsorshipType,
        feesCollectionStatus:  formData.traineeFeesCollectionStatus,
        submittedAt,
      };
      localStorage.setItem(ENROLMENT_DRAFT_KEY, JSON.stringify(draft));

      console.log('Submitting enrolment to SSG API:', JSON.stringify(payload, null, 2));

      const response = await ssgFetch('/api/enrolment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const parsed = await response.json();

      // Read back from localStorage to populate the result page
      const storedDraft = JSON.parse(localStorage.getItem(ENROLMENT_DRAFT_KEY) || '{}');

      if (parsed?.success) {
        const d = parsed.data ?? {};
        const ref =
          d?.enrolment?.referenceNumber ??
          d?.referenceNumber ??
          undefined;
        const st =
          d?.enrolment?.status ??
          d?.status ??
          undefined;

        setSubmissionResult({
          success: true,
          referenceNumber:       ref,
          enrolmentStatus:       st,
          traineeName:           storedDraft.traineeFullName,
          traineeId:             storedDraft.traineeId,
          traineeIdType:         storedDraft.traineeIdType,
          traineeEmail:          storedDraft.traineeEmailAddress,
          courseReferenceNumber: storedDraft.courseReferenceNumber,
          courseRunId:           storedDraft.courseRunId,
          sponsorshipType:       storedDraft.sponsorshipType,
          feesCollectionStatus:  storedDraft.feesCollectionStatus,
          submittedAt:           storedDraft.submittedAt,
        });

        // Server runs the same sync in /api/enrolment/create (invoice enqueue). Retry here only if that failed.
        if (parsed.localEnrollmentSynced !== true) {
          try {
            const syncRes = await fetch(getApiUrl('/api/enrolments/post-ssg-enrol'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                traineeEmail:          storedDraft.traineeEmailAddress,
                courseReferenceNumber: storedDraft.courseReferenceNumber,
                courseRunId:           storedDraft.courseRunId,
                sponsorshipType:       storedDraft.sponsorshipType,
                traineeName:           storedDraft.traineeFullName,
                traineeNric:           storedDraft.traineeId,
                enrolmentId:           ref,
                enrolmentStatus:       st,
              }),
            });
            const syncData = await syncRes.json();
            console.log('📋 Local enrollment sync (client fallback):', syncData);
          } catch (syncErr) {
            console.warn('⚠️ Local enrollment sync failed (non-critical):', syncErr);
          }
        }

        setFormData(buildInitialFormData(trainingProviderProfile?.uen));
      } else {
        const errorMessages: string[] =
          (typeof parsed?.error === 'string' ? [parsed.error] : null) ||
          parsed?.error?.details?.map((d: { field: string; message: string }) => d.message) ||
          (parsed?.error?.message ? [parsed.error.message] : ['Failed to create enrolment']);
        setSubmissionResult({
          success: false,
          errorMessages,
          traineeName:           storedDraft.traineeFullName,
          traineeId:             storedDraft.traineeId,
          traineeIdType:         storedDraft.traineeIdType,
          traineeEmail:          storedDraft.traineeEmailAddress,
          courseReferenceNumber: storedDraft.courseReferenceNumber,
          courseRunId:           storedDraft.courseRunId,
          sponsorshipType:       storedDraft.sponsorshipType,
          feesCollectionStatus:  storedDraft.feesCollectionStatus,
          submittedAt:           storedDraft.submittedAt,
        });
      }
    } catch (error) {
      console.error('Error submitting enrolment:', error);
      const storedDraft = JSON.parse(localStorage.getItem(ENROLMENT_DRAFT_KEY) || '{}');
      setSubmissionResult({
        success: false,
        errorMessages: ['Network error occurred while creating enrolment. Please try again.'],
        traineeName:           storedDraft.traineeFullName,
        traineeId:             storedDraft.traineeId,
        traineeIdType:         storedDraft.traineeIdType,
        traineeEmail:          storedDraft.traineeEmailAddress,
        courseReferenceNumber: storedDraft.courseReferenceNumber,
        courseRunId:           storedDraft.courseRunId,
        sponsorshipType:       storedDraft.sponsorshipType,
        feesCollectionStatus:  storedDraft.feesCollectionStatus,
        submittedAt:           storedDraft.submittedAt,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEmployerSponsored = formData.traineeSponsorshipType === SponsorshipType.EMPLOYER;
  // Employer sponsorship = Company Application: runs the full CA pipeline and
  // appears in View Company Application.
  const isCompanyApplication = isEmployerSponsored;

  // Client-side company search over the merged QB + history list.
  const filteredEmployers = (() => {
    const q = employerSearch.trim().toLowerCase();
    if (!q) return [];
    return employers
      .filter(e =>
        e.employerOrgName.toLowerCase().includes(q) ||
        e.employerUen.toLowerCase().includes(q)
      )
      .slice(0, 30);
  })();

  const resetForm = () => {
    localStorage.removeItem(ENROLMENT_DRAFT_KEY);
    setSubmissionResult(null);
    setFormData(buildInitialFormData(trainingProviderProfile?.uen));
    setErrors([]);
    setWarnings([]);
    setSelectedLearner(null);
    setIsAddingLearner(false);
    setSelectedEmployerKey('');
    setEmployerSearch('');
    setSearchQuery('');
    setSearchResults([]);
  };

  if (submissionResult?.companyApplication) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <div className="p-6 border-b dark:border-gray-700 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Company Application Submitted</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Enrolment is processing in the background
              </p>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-200">
              <span className="font-semibold">{submissionResult.traineeName}</span> is being enrolled under{' '}
              <span className="font-semibold">{submissionResult.employerOrgName}</span> via TPGateway. The system will
              automatically run enrolment → grant lookup → calendar → invoice, then the learner will appear in{' '}
              <span className="font-semibold">View Company Application</span> with live status.
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Trainee Name', value: submissionResult.traineeName },
                { label: 'Trainee ID', value: submissionResult.traineeId },
                { label: 'Employer', value: submissionResult.employerOrgName },
                { label: 'Course Ref No.', value: submissionResult.courseReferenceNumber },
                { label: 'Course Run ID', value: submissionResult.courseRunId },
                { label: 'Sponsorship', value: submissionResult.sponsorshipType },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white break-all">{value || 'N/A'}</p>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t dark:border-gray-700 flex flex-col sm:flex-row gap-3">
              <Button onClick={() => setAdminPage(AdminPage.ViewCompanyApplication)} className="flex-1">
                Go to View Company Application
              </Button>
              <Button onClick={resetForm} variant="outline" className="flex-1">
                Enrol Another Learner
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (submissionResult) {
    const formatDateTime = (iso?: string) => {
      if (!iso) return 'N/A';
      return new Date(iso).toLocaleString('en-SG', {
        dateStyle: 'medium', timeStyle: 'medium', hour12: false
      });
    };

    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card>
          {/* Header */}
          <div className="p-6 border-b dark:border-gray-700">
            <div className="flex items-center gap-3">
              {submissionResult.success ? (
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              )}
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Enrolment Creation Result</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Submitted at: {formatDateTime(submissionResult.submittedAt)}
                </p>
              </div>
              <div className="ml-auto">
                <span className={`inline-flex px-3 py-1.5 text-sm font-semibold rounded-full border ${
                  submissionResult.success
                    ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
                    : 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
                }`}>
                  {submissionResult.success ? 'Success' : 'Error'}
                </span>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Section 1: Submitted Trainee Data (from localStorage) */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Submitted Data
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Trainee Name',    value: submissionResult.traineeName },
                  { label: 'Trainee ID',      value: submissionResult.traineeId },
                  { label: 'ID Type',         value: submissionResult.traineeIdType },
                  { label: 'Email',           value: submissionResult.traineeEmail },
                  { label: 'Course Ref No.',  value: submissionResult.courseReferenceNumber },
                  { label: 'Course Run ID',   value: submissionResult.courseRunId },
                  { label: 'Sponsorship',     value: submissionResult.sponsorshipType },
                  { label: 'Fee Status',      value: submissionResult.feesCollectionStatus },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white break-all">
                      {value || 'N/A'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 2: SSG Response */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                SSG Response
              </h3>
              {submissionResult.success ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
                    <p className="text-xs text-green-600 dark:text-green-400 mb-1">Enrolment ID</p>
                    <p className="text-lg font-bold text-green-800 dark:text-green-300">
                      {submissionResult.referenceNumber || 'N/A'}
                    </p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
                    <p className="text-xs text-green-600 dark:text-green-400 mb-1">Enrolment Status</p>
                    <p className="text-lg font-bold text-green-800 dark:text-green-300">
                      {submissionResult.enrolmentStatus || 'Confirmed'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">Error Details</p>
                  <ul className="space-y-1">
                    {submissionResult.errorMessages?.map((msg, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                        <span className="flex-shrink-0 mt-0.5">✗</span>
                        <span>{msg}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Action Button */}
            <div className="pt-2 border-t dark:border-gray-700">
              <Button onClick={resetForm} variant="outline" className="w-full">
                {submissionResult.success ? 'Create Another Enrolment' : 'Try Again'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

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
                  />
                </div>
                <div className="mt-4 max-h-60 overflow-y-auto space-y-2">
                  {searchResults.map(learner => (
                    <div key={learner.email} className="p-2 flex justify-between items-center bg-gray-50 rounded-md dark:bg-gray-700/50">
                      <div>
                        <p className="font-semibold text-sm dark:text-white">{learner.name}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{learner.email}</p>
                      </div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => handleLearnerSelection(learner)}>
                        Select
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="text-center p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md mt-4">
                  <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">Can't find a learner?</p>
                  <Button type="button" size="sm" onClick={() => setIsAddingLearner(true)}>
                    + Add New Learner Profile
                  </Button>
                </div>
              </Card>

              <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                {/* Header */}
                <h3 className="text-xl font-bold mb-3 dark:text-white">
                  Currently Enrolled ({enrolmentData && enrolmentData.data ? enrolmentData.data.length : 0})
                </h3>

                {/* Course run summary — shown once when data is available */}
                {enrolmentData && (enrolmentData.status === "200" || enrolmentData.status === 200) && enrolmentData.data && Array.isArray(enrolmentData.data) && enrolmentData.data.length > 0 && (() => {
                  const firstRun = enrolmentData.data[0]?.enrolment?.course?.run ?? enrolmentData.data[0]?.enrolment?.courseRun ?? {};
                  const startDate = firstRun.startDate || firstRun.start_date || '';
                  const endDate = firstRun.endDate || firstRun.end_date || '';
                  const formatDate = (d: string) => {
                    if (!d) return 'N/A';
                    // Handle YYYYMMDD format
                    if (/^\d{8}$/.test(d)) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
                    return d;
                  };
                  return (
                    <div className="mb-4 p-3 bg-gray-50 rounded-md dark:bg-gray-700/50 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Course Run ID</span>
                        <span className="font-medium dark:text-white">{formData.courseRunId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Start Date</span>
                        <span className="font-medium dark:text-white">{formatDate(startDate)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">End Date</span>
                        <span className="font-medium dark:text-white">{formatDate(endDate)}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
                        <span className="text-gray-500 dark:text-gray-400">Total Enrolments</span>
                        <span className="font-semibold dark:text-white">{enrolmentData.data.length}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Learner list */}
                <div className="max-h-[18rem] overflow-y-auto space-y-2">
                  {enrolmentLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                      <p className="text-gray-500 dark:text-gray-400 mt-2">Loading enrolled learners...</p>
                    </div>
                  ) : enrolmentData && (enrolmentData.status === "200" || enrolmentData.status === 200) && enrolmentData.data && Array.isArray(enrolmentData.data) && enrolmentData.data.length > 0 ? (
                    enrolmentData.data.map((record: any, index: number) => {
                      const enrolment = record.enrolment ?? {};
                      const refNum = enrolment.referenceNumber || enrolment.enrolmentReferenceNumber || 'N/A';
                      const status = enrolment.status || enrolment.enrolmentStatus || '';
                      return (
                        <div key={index} className="p-2 bg-blue-50 rounded-md dark:bg-blue-900/30">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm dark:text-white truncate">{enrolment.trainee?.fullName || 'N/A'}</p>
                              <p className="text-xs text-gray-600 dark:text-gray-300 truncate">{enrolment.trainee?.email?.full || 'N/A'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Ref: {refNum}</p>
                            </div>
                            {status && (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${getStatusColor(status)}`}>
                                {status}
                              </span>
                            )}
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
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedLearner(null)} className="dark:text-blue-300 dark:hover:text-blue-200">
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
                <Button type="button" size="sm" variant="ghost" onClick={handleBackToSearch} className="dark:text-gray-300 dark:hover:text-white">
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
                    type="text"
                    value={formData.traineeDateOfBirth}
                    onChange={(e) => handleInputChange('traineeDateOfBirth', e.target.value)}
                    placeholder="DD/MM/YYYY"
                    maxLength={10}
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
                      placeholder="65"
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
                      type="text"
                      value={formData.traineeEnrolmentDate || ''}
                      onChange={(e) => handleInputChange('traineeEnrolmentDate', e.target.value)}
                      placeholder="DD/MM/YYYY"
                      maxLength={10}
                      className={inputClasses}
                    />
                  </div>
                )}
              </div>

              {/* Sponsorship type — the single control. EMPLOYER = Company
                  Application (runs the full CA pipeline, shows in View
                  Company Application). INDIVIDUAL = plain enrolment. */}
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
                {isCompanyApplication && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    This learner will be enrolled as a Company Application and appear in View Company Application.
                  </p>
                )}
              </div>

              {/* Company Application details — shown for EMPLOYER sponsorship. */}
              {isCompanyApplication && (
                <div className="space-y-4 mb-6">
                  <h3 className="text-md font-semibold text-gray-800 dark:text-white">Employer Details</h3>

                  {/* Find the company first; add a new one only if it isn't listed. */}
                  {selectedEmployerKey === '' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Find Company
                      </label>
                      <input
                        type="text"
                        value={employerSearch}
                        onChange={(e) => setEmployerSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        placeholder="Search company by name or UEN…"
                        className={inputClasses}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {loadingEmployers ? 'Loading companies…' : 'Searches QuickBooks + past applications.'}
                      </p>

                      {employerSearch.trim() && (
                        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                          {filteredEmployers.length === 0 ? (
                            <p className="p-3 text-sm text-gray-500 dark:text-gray-400">No matching company found — use "Add a new employer" below.</p>
                          ) : (
                            filteredEmployers.map(emp => (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => handleEmployerSelect(emp.id)}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                              >
                                <span className="block text-sm font-medium text-gray-900 dark:text-white">{emp.employerOrgName || '(no name)'}</span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400">
                                  {emp.employerUen ? `UEN ${emp.employerUen}` : 'From QuickBooks — UEN needed'}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleAddNewEmployer}
                        className="mt-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        + Can't find it? Add a new employer
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-md bg-gray-100 dark:bg-gray-700/40 px-3 py-2">
                      <span className="text-sm text-gray-700 dark:text-gray-200">
                        {selectedEmployerKey === NEW_EMPLOYER_KEY
                          ? 'Entering a new employer'
                          : <>Selected: <span className="font-semibold">{formData.employerOrgName || '(company)'}</span></>}
                      </span>
                      <button
                        type="button"
                        onClick={handleChangeEmployer}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                        Change
                      </button>
                    </div>
                  )}

                  {selectedEmployerKey !== '' && (
                  <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Trainee Identity Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.traineeIdentityType || ''}
                      onChange={(e) => handleInputChange('traineeIdentityType', e.target.value)}
                      className={inputClasses}
                    >
                      {IDENTITY_TYPE_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Determines the SSG grant the employer is eligible for.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Employer Organization Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerOrgName || ''}
                        onChange={(e) => handleInputChange('employerOrgName', e.target.value)}
                        placeholder="e.g., Acme Pte Ltd"
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Employer UEN <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerUen || ''}
                        onChange={(e) => handleInputChange('employerUen', e.target.value)}
                        placeholder="e.g., 201000372W"
                        className={inputClasses}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Employer Contact Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerFullName || ''}
                        onChange={(e) => handleInputChange('employerFullName', e.target.value)}
                        placeholder="e.g., Stephen Chua"
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Employer Contact Designation <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerContactDesignation || ''}
                        onChange={(e) => handleInputChange('employerContactDesignation', e.target.value)}
                        placeholder="e.g., HR Manager"
                        className={inputClasses}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Employer Contact Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={formData.employerEmailAddress || ''}
                        onChange={(e) => handleInputChange('employerEmailAddress', e.target.value)}
                        placeholder="hr@acme.com"
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Employer Contact Telephone <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.employerPhoneNumber || ''}
                        onChange={(e) => handleInputChange('employerPhoneNumber', e.target.value)}
                        placeholder="98765432"
                        className={inputClasses}
                      />
                    </div>
                  </div>
                  </>
                  )}
                </div>
              )}

              {/* Dead branch retained intentionally minimal: EMPLOYER now always
                  means Company Application (rendered above), so this never shows. */}
              {false && (
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
              {!isCompanyApplication && !isEmployerSponsored && (
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

          {/* Preview Request Body — hidden for Company Applications (which use a
              different payload shape submitted to the CA pipeline). */}
          {!isCompanyApplication && (
            <div className="bg-gray-50 p-6 rounded-lg dark:bg-gray-700/30">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-white">Preview Request Body</h2>
              <div className="bg-white p-4 rounded border dark:bg-gray-800 dark:border-gray-700">
                <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto dark:text-gray-300">
                  {JSON.stringify(buildPayload(), null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => {
                if (confirm('Are you sure you want to clear all fields?')) {
                  setFormData(buildInitialFormData(trainingProviderProfile?.uen));
                  setSelectedEmployerKey('');
                  setEmployerSearch('');
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
              {isSubmitting
                ? (isCompanyApplication ? 'Submitting Company Application...' : 'Creating Enrolment...')
                : (isCompanyApplication ? 'Enrol as Company Application' : 'Create Enrolment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EnrollLearners;