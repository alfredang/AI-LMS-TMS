import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/router';
import { View, UserRole, AdminPage, TrainerPage, CurrentUserProfile, CalendarEvent, Course, CourseDetail, LearningUnit, CourseAssessment, Submission } from '@app-types';
import { TrainingProviderProfile } from '@app-types/profile';
import { courseService } from '@lib/services/courseService';
import { authService, User } from '@lib/services/authService';
import { resetTutorChat } from '@lib/services/geminiService';
import { initializeColorScheme } from '@utils/colorUtils';

// Function to fetch training provider info for all users
const fetchTrainingProviderInfo = async (userId?: string): Promise<{ companyLogoUrl: string; companyName: string; companyShortname?: string; referenceLinks?: any }> => {
  try {
    // If userId is provided, fetch specific organization info
    const url = userId 
      ? `/api/training-provider/info?userId=${encodeURIComponent(userId)}`
      : '/api/training-provider/info';
    
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch training provider info');
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Training provider info not found');
    }

    // Initialize color scheme if available
    if (result.data.colorScheme) {
      // The colorScheme might be a JSON string from database, pass it directly to initializeColorScheme
      initializeColorScheme({ colorScheme: result.data.colorScheme });
    }

    return {
      companyLogoUrl: result.data.companyLogoUrl || '/images/default-company-logo.png',
      companyName: result.data.companyName || 'Training Provider',
      companyShortname: result.data.companyShortname,
      referenceLinks: result.data.referenceLinks,
    };
  } catch (error) {
    console.error('Error fetching training provider info:', error);
    // Return fallback data
    return {
      companyLogoUrl: '/images/default-company-logo.png',
      companyName: 'Training Provider'
    };
  }
};

// Function to get current user ID based on authentication
const getCurrentUserId = (): string => {
  const userData = authService.getUserData();
  if (!userData?.id) {
    throw new Error('No authenticated user found');
  }
  return userData.id;
};

// Helper to convert role string to UserRole enum
const convertToUserRole = (roleString: string): UserRole => {
  const normalized = roleString.toLowerCase().replace(/\s+/g, '_');
  switch (normalized) {
    case 'learner':
      return UserRole.Learner;
    case 'trainer':
      return UserRole.Trainer;
    case 'admin':
      return UserRole.Admin;
    case 'developer':
      return UserRole.Developer;
    case 'finance':
      return UserRole.Finance;
    case 'training_provider':
    case 'trainingprovider':
      return UserRole.TrainingProvider;
    default:
      console.warn(`Unknown role: ${roleString}, defaulting to Learner`);
      return UserRole.Learner;
  }
};

// Function to fetch user's roles from database (returns all roles)
const fetchUserRoles = async (userId: string): Promise<{ primaryRole: UserRole; allRoles: UserRole[] }> => {
  try {
    const response = await fetch(`/api/users/role?userId=${userId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch user roles');
    }
    const result = await response.json();

    if (!result.success || !result.data?.role) {
      throw new Error(result.error || 'Roles not found');
    }

    const primaryRole = convertToUserRole(result.data.role);
    const allRoles = (result.data.roles || [result.data.role]).map(convertToUserRole);

    return { primaryRole, allRoles };
  } catch (error) {
    console.error('Error fetching user roles:', error);
    throw error;
  }
};

// Legacy function for backwards compatibility
const fetchUserRole = async (userId: string): Promise<UserRole> => {
  const { primaryRole } = await fetchUserRoles(userId);
  return primaryRole;
};

// Function to fetch user profile based on role
const fetchUserProfileByRole = async (role: UserRole): Promise<CurrentUserProfile> => {
  try {
    const userId = getCurrentUserId();

    // Use role-specific API endpoints
    let response;
    if (role === UserRole.Trainer) {
      response = await fetch(`/api/profile/trainer?userId=${userId}`);
    } else if (role === UserRole.Developer) {
      response = await fetch(`/api/profile/developer?userId=${userId}`);
    } else if (role === UserRole.Learner) {
      response = await fetch(`/api/profile-new?userId=${userId}&role=${role.toLowerCase()}`);
    } else if (role === UserRole.TrainingProvider) {
      response = await fetch(`/api/profile-new?userId=${userId}&role=training_provider`);
    } else {
      response = await fetch(`/api/profile-new?userId=${userId}&role=${role.toLowerCase()}`);
    }

    if (!response.ok) {
      console.warn(`Failed to fetch ${role} profile (Status: ${response.status}). Using fallback.`);
      // Return fallback immediately instead of throwing to avoid fast refresh/runtime error overlay issues
      return {
        profilePictureUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K',
        name: `${role} User (Fallback)`
      };
    }
    const result = await response.json();

    if (!result.success || !result.data?.profile) {
      console.warn(`Profile API returned error for ${role}: ${result.error || 'No profile data'}`);
      return {
        profilePictureUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K',
        name: `${role} User (Fallback)`
      };
    }

    const profileData = result.data.profile;

    return {
      profilePictureUrl: profileData.profilePictureUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K',
      name: profileData.name || profileData.fullName || 'Unknown User'
    };
  } catch (error) {
    console.error(`Error fetching ${role} profile:`, error);
    // Return fallback profile
    return {
      profilePictureUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K',
      name: `${role} User`
    };
  }
};



// Function to fetch calendar events/assessments for the current user
const fetchCalendarEvents = async (userRole: UserRole): Promise<CalendarEvent[]> => {
  try {
    const userId = getCurrentUserId();

    let apiUrl: string;
    if (userRole === UserRole.Trainer) {
      apiUrl = `/api/calendar/trainer?trainerId=${userId}`;
    } else {
      // Default to assessments for learners and other roles
      apiUrl = `/api/assessments?userId=${userId}`;
    }

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch calendar events');
    }
    const result = await response.json();

    if (!result.success || !Array.isArray(result.data)) {
      return [];
    }

    return result.data.map((item: any) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      date: item.date,
      courseTitle: item.course_title,
      category: item.category || item.assessment_category,
      status: item.status || item.assessment_status
    }));
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    return [];
  }
};

interface LmsContextType {
  // Core State
  role: UserRole;
  userRoles: UserRole[]; // All roles the user has
  setRole: (role: UserRole) => void;
  switchRole: (role: UserRole) => Promise<void>; // Switch to a different role
  currentView: View;
  setCurrentView: (view: View) => void;
  adminPage: AdminPage;
  setAdminPage: (page: AdminPage) => void;
  trainerPage: TrainerPage;
  setTrainerPage: (page: TrainerPage) => void;
  selectedCourseRunId: string | null;
  setSelectedCourseRunId: (courseRunId: string | null) => void;
  pendingAttendanceCourseRunId: string | null;
  setPendingAttendanceCourseRunId: (id: string | null) => void;
  pendingGradingCourseRunId: string | null;
  setPendingGradingCourseRunId: (id: string | null) => void;

  // Authentication
  isAuthenticated: boolean;
  isLoading: boolean;
  currentUser: User | null;
  login: (role: UserRole, user: User) => void;
  logout: () => void;

  // Data
  trainingProviderProfile: TrainingProviderProfile | null;
  updateTrainingProviderProfile: (updates: Partial<TrainingProviderProfile>) => void;
  currentUserProfile: CurrentUserProfile | null;
  updateCurrentUserProfile: (updates: Partial<CurrentUserProfile>) => void;
  calendarEvents: CalendarEvent[];
  selectedCourse: Course | null;
  setSelectedCourse: (course: Course | null) => void;
  editingCourse: Course | null;
  setEditingCourse: (course: Course | null) => void;
  courseEditMode: 'create' | 'edit' | 'view' | null;
  setCourseEditMode: (mode: 'create' | 'edit' | 'view' | null) => void;
  editingCourseRun: any | null;
  setEditingCourseRun: (courseRun: any | null) => void;
  courseListPage: number;
  setCourseListPage: (page: number) => void;
  courseDetail: CourseDetail | null;
  resourceLinks: { id: string; topicId: string; type: string; title: string; url: string }[];
  learningUnits: LearningUnit[];
  courseAssessments: CourseAssessment[];
  bookmarkedSubtopics: string[];
  completedSubtopics: string[];
  completedTopics: string[];
  submissions: Submission[];
  certificate: any | null;

  // Navigation
  handleNavigation: (view: View) => void;

  // Actions
  resetCreateView: () => void;
  resetAdminView: () => void;
  refreshUserProfile: () => Promise<void>;
  refreshCalendarEvents: () => Promise<void>;
  loadCourseData: (course: Course) => Promise<void>;
  toggleBookmark: (subtopicId: string) => Promise<void>;
  toggleCompletion: (subtopicId: string) => Promise<void>;
  toggleTopicCompletion: (topicId: string) => Promise<void>;
  submitAssessment: (assessmentId: string, fileName: string, fileUrl?: string) => Promise<void>;
  publishAssessment: (assessmentId: string, published: boolean) => Promise<void>;
  loadSubmissions: () => Promise<void>;
  loadCertificate: () => Promise<void>;

  // Chat functionality
  isChatOpen: boolean;
  toggleChat: () => void;
  resetInAppChat: () => void;
  courses: Course[];
}

const LmsContext = createContext<LmsContextType | undefined>(undefined);

export const LmsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();

  // Core state
  const [role, setRole] = useState<UserRole>(UserRole.Learner);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]); // All roles the user has
  const [currentView, setCurrentView] = useState<View>(View.Dashboard);
  const [adminPage, setAdminPage] = useState<AdminPage>(AdminPage.Dashboard);
  const [trainerPage, setTrainerPage] = useState<TrainerPage>(TrainerPage.EAttendance);
  const [selectedCourseRunId, setSelectedCourseRunId] = useState<string | null>(null);
  const [pendingAttendanceCourseRunId, setPendingAttendanceCourseRunId] = useState<string | null>(null);
  const [pendingGradingCourseRunId, setPendingGradingCourseRunId] = useState<string | null>(null);

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Data state
  const [currentUserProfile, setCurrentUserProfile] = useState<CurrentUserProfile | null>(null);
  const [trainingProviderProfile, setTrainingProviderProfile] = useState<TrainingProviderProfile | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseEditMode, setCourseEditMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [editingCourseRun, setEditingCourseRun] = useState<any | null>(null);
  const [courseListPage, setCourseListPage] = useState(1);
  const [courseDetail, setCourseDetail] = useState<CourseDetail | null>(null);
  const [resourceLinks, setResourceLinks] = useState<{ id: string; topicId: string; type: string; title: string; url: string }[]>([]);
  const [learningUnits, setLearningUnits] = useState<LearningUnit[]>([]);
  const [courseAssessments, setCourseAssessments] = useState<CourseAssessment[]>([]);
  const [bookmarkedSubtopics, setBookmarkedSubtopics] = useState<string[]>([]);
  const [completedSubtopics, setCompletedSubtopics] = useState<string[]>([]);
  const [completedTopics, setCompletedTopics] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [certificate, setCertificate] = useState<any | null>(null);

  // Chat state
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [courses, setCourses] = useState<Course[]>([]);

  // Load training provider color scheme on mount (before authentication)
  useEffect(() => {
    console.log('🎨 LmsContext: Loading training provider color scheme...');

    const loadColorScheme = async () => {
      try {
        const response = await fetch('/api/training-provider/info');

        if (response.ok) {
          const result = await response.json();

          if (result.success && result.data?.colorScheme) {
            console.log('🎨 LmsContext: Applying color scheme:', result.data.colorScheme);
            // The colorScheme might be a JSON string from database, pass it directly to initializeColorScheme
            initializeColorScheme({ colorScheme: result.data.colorScheme });
          } else {
            console.log('🎨 LmsContext: No color scheme found, loading from localStorage...');
            // Fallback to localStorage if no database color found
            initializeColorScheme();
          }
        } else {
          console.log('🎨 LmsContext: Failed to fetch training provider info, loading from localStorage...');
          // Fallback to localStorage if API call fails
          initializeColorScheme();
        }
      } catch (error) {
        console.error('🎨 LmsContext: Error loading color scheme, using fallback:', error);
        // Fallback to localStorage if error occurs
        initializeColorScheme();
      }
    };

    loadColorScheme();
  }, []);

  // Check for existing authentication on mount
  useEffect(() => {
    console.log('🔄 LmsContext: Checking for existing authentication...');

    const checkAuth = async () => {
      setIsLoading(true);

      try {
        // Check if we have a token
        const token = authService.getAuthToken();

        if (!token) {
          console.log('ℹ️ LmsContext: No token found, showing login screen');
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }

        console.log('🔍 LmsContext: Token found, verifying with server...');

        // Verify token with server
        const verificationResult = await authService.verifyToken();

        if (verificationResult.valid && verificationResult.user) {
          console.log('✅ LmsContext: Token verified, user authenticated:', verificationResult.user);

          // Set user data
          setCurrentUser(verificationResult.user);
          setIsAuthenticated(true);

          // Load training provider info for the logged-in user's organization
          try {
            const providerInfo = await fetchTrainingProviderInfo(verificationResult.user.id);
            setTrainingProviderProfile({
              companyLogoUrl: providerInfo.companyLogoUrl,
              companyName: providerInfo.companyName,
              companyShortname: providerInfo.companyShortname,
              integrations: providerInfo.referenceLinks || {},
            } as TrainingProviderProfile);
          } catch (error) {
            console.error('❌ LmsContext: Failed to load training provider info:', error);
          }

          // Fetch user's roles from database
          try {
            // First check if user object has roles (from localStorage)
            const cachedRoles = verificationResult.user.roles;
            let primaryRole: UserRole;
            let allRoles: UserRole[];

            if (cachedRoles && cachedRoles.length > 0) {
              // Use cached roles from localStorage
              allRoles = cachedRoles;
              primaryRole = verificationResult.user.role;
              console.log('✅ LmsContext: Using cached roles:', allRoles);
            } else {
              // Fetch roles from database
              const rolesData = await fetchUserRoles(verificationResult.user.id);
              primaryRole = rolesData.primaryRole;
              allRoles = rolesData.allRoles;
              console.log('✅ LmsContext: Fetched roles from database:', allRoles);
            }

            setRole(primaryRole);
            setUserRoles(allRoles);

            // Load user profile based on fetched role
            try {
              const profile = await fetchUserProfileByRole(primaryRole);
              setCurrentUserProfile(profile);
            } catch (error) {
              console.error('❌ LmsContext: Failed to load profile:', error);
            }

            // Training provider info is already loaded for all users above

            // Load calendar events
            try {
              const events = await fetchCalendarEvents(primaryRole);
              setCalendarEvents(events);
            } catch (error) {
              console.error('❌ LmsContext: Failed to load calendar events:', error);
            }

            // Restore state from URL parameters
            await restoreStateFromURL();

          } catch (error) {
            console.error('❌ LmsContext: Failed to fetch user roles:', error);
            // If role fetch fails, logout the user
            await logout();
          }
        } else {
          console.log('❌ LmsContext: Token verification failed');
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('❌ LmsContext: Auth check failed:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    // Safety timeout — never hang on "Checking your session..." for more than 10s
    const timeout = setTimeout(() => {
      console.warn('⚠️ LmsContext: Auth check timed out after 10s');
      const cachedUser = authService.getUserData();
      if (cachedUser?.role) {
        // Has a cached session — restore it and show their dashboard
        console.warn('⚠️ Restoring from cache:', cachedUser.role);
        setCurrentUser(cachedUser);
        setRole(cachedUser.role);
        setIsAuthenticated(true);
      } else {
        // No cached session — redirect to login
        setIsAuthenticated(false);
      }
      setIsLoading(false);
    }, 10000);

    checkAuth().finally(() => clearTimeout(timeout));
  }, []);

  // Function to restore state from URL parameters
  const restoreStateFromURL = useCallback(async () => {
    console.log('🔄 LmsContext: Restoring state from URL...', { query: router.query, isReady: router.isReady });

    // Wait for router to be ready (query params are empty on first SSR render)
    if (!router.isReady) {
      console.log('⏳ LmsContext: Router not ready yet, skipping URL restore');
      return;
    }

    const { view, courseId, adminPage, trainerPage } = router.query;

    // Restore current view - View enum values are lowercase, URL values are lowercase
    if (view && typeof view === 'string') {
      const matchedView = Object.values(View).find(v => v.toLowerCase() === view.toLowerCase());

      if (matchedView) {
        console.log(`📍 LmsContext: Restored view from URL: ${matchedView}`);
        setCurrentView(matchedView);
      }
    }

    if (adminPage && typeof adminPage === 'string') {
      const matchedAdminPage = Object.values(AdminPage).find(v => v.toLowerCase() === adminPage.toLowerCase());
      if (matchedAdminPage) {
        console.log(`📍 LmsContext: Restored adminPage from URL: ${matchedAdminPage}`);
        setAdminPage(matchedAdminPage);
      }
    }

    if (trainerPage && typeof trainerPage === 'string') {
      const matchedTrainerPage = Object.values(TrainerPage).find(v => v.toLowerCase() === trainerPage.toLowerCase());
      if (matchedTrainerPage) {
        console.log(`📍 LmsContext: Restored trainerPage from URL: ${matchedTrainerPage}`);
        setTrainerPage(matchedTrainerPage);
      }
    }

    // Restore selected course
    if (courseId && typeof courseId === 'string') {
      try {
        // Get enrolled courses to find the course data
        const userId = getCurrentUserId();
        const response = await fetch(`/api/courses/enrolled?userId=${userId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && Array.isArray(result.data)) {
            const course = result.data.find((c: Course) => c.id === courseId);
            if (course) {
              await loadCourseData(course);
            }
          }
        }
      } catch (error) {
        console.error('❌ LmsContext: Failed to restore course from URL:', error);
      }
    }
  }, [router.query]);

  // Re-run URL restoration when router becomes ready (handles timing where checkAuth runs before query params are available)
  useEffect(() => {
    if (router.isReady && isAuthenticated) {
      console.log('🔄 LmsContext: Router is ready and user is authenticated, restoring state from URL...');
      restoreStateFromURL();
    }
  }, [router.isReady, isAuthenticated]);

  // Function to update URL when state changes
  const updateURL = useCallback((view?: View, courseId?: string) => {
    const newQuery: any = { ...router.query };

    // Update view in URL
    if (view) {
      newQuery.view = view.toLowerCase();
    } else {
      delete newQuery.view;
    }

    // Update course in URL
    if (courseId) {
      newQuery.courseId = courseId;
    } else {
      delete newQuery.courseId;
    }

    // Update URL with a new history entry so browser back/forward works
    router.push({
      pathname: router.pathname,
      query: newQuery
    }, undefined, { shallow: true });
  }, [router]);

  // Listen for route changes (browser back/forward) and sync React state from URL
  useEffect(() => {
    const handleRouteChange = (url: string) => {
      try {
        const urlObj = new URL(url, window.location.origin);
        const viewParam = urlObj.searchParams.get('view');
        const courseIdParam = urlObj.searchParams.get('courseId');
        const adminPageParam = urlObj.searchParams.get('adminPage');
        const trainerPageParam = urlObj.searchParams.get('trainerPage');

        console.log(`🔙 LmsContext: Route changed (back/forward) - view=${viewParam}, courseId=${courseIdParam}, adminPage=${adminPageParam}, trainerPage=${trainerPageParam}`);

        // Sync the view state - View enum values are lowercase
        if (viewParam) {
          const matchedView = Object.values(View).find(v => v.toLowerCase() === viewParam.toLowerCase());
          if (matchedView) {
            setCurrentView(matchedView);
          } else {
            setCurrentView(View.Dashboard);
          }
        } else {
          setCurrentView(View.Dashboard);
        }

        if (adminPageParam) {
          const matchedAdminPage = Object.values(AdminPage).find(v => v.toLowerCase() === adminPageParam.toLowerCase());
          if (matchedAdminPage) {
            setAdminPage(matchedAdminPage);
          } else {
            setAdminPage(AdminPage.Dashboard);
          }
        } else {
          setAdminPage(AdminPage.Dashboard);
        }

        if (trainerPageParam) {
          const matchedTrainerPage = Object.values(TrainerPage).find(v => v.toLowerCase() === trainerPageParam.toLowerCase());
          if (matchedTrainerPage) {
            setTrainerPage(matchedTrainerPage);
          } else {
            setTrainerPage(TrainerPage.EAttendance);
          }
        } else {
          setTrainerPage(TrainerPage.EAttendance);
        }

        // Sync the selected course state
        if (!courseIdParam) {
          // No courseId in URL — clear selected course (user went back to a non-course page)
          setSelectedCourse(null);
        }
        // If courseIdParam is present, loadCourseData will be triggered separately
        // We only need to restore it if the user navigated back TO a course page
        if (courseIdParam && (!selectedCourse || selectedCourse.id !== courseIdParam)) {
          // Fetch the course and reload it
          const restoreCourse = async () => {
            try {
              const userId = getCurrentUserId();
              const response = await fetch(`/api/courses/enrolled?userId=${userId}`);
              if (response.ok) {
                const result = await response.json();
                if (result.success && Array.isArray(result.data)) {
                  const course = result.data.find((c: Course) => c.id === courseIdParam);
                  if (course) {
                    // Load course data WITHOUT updating URL again (avoid infinite loop)
                    setSelectedCourse(course);
                  }
                }
              }
            } catch (error) {
              console.error('❌ LmsContext: Failed to restore course from back/forward:', error);
            }
          };
          restoreCourse();
        }
      } catch (error) {
        console.error('❌ LmsContext: Failed to parse route change URL:', error);
      }
    };

    router.events.on('routeChangeComplete', handleRouteChange);
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router, selectedCourse]);

  // Wrapped setAdminPage that clears courseId from URL and resets selected course
  const navigateAdminPage = useCallback((page: AdminPage) => {
    setAdminPage(page);
    setSelectedCourse(null);
    const newQuery: any = { ...router.query, adminPage: page };
    delete newQuery.courseId;
    delete newQuery.view;
    router.push({ pathname: router.pathname, query: newQuery }, undefined, { shallow: true });
  }, [router]);

  // Wrapped setTrainerPage to sync with URL
  const navigateTrainerPage = useCallback((page: TrainerPage) => {
    setTrainerPage(page);
    const newQuery: any = { ...router.query, trainerPage: page };
    // Clear stale view param so profile view doesn't persist
    delete newQuery.view;
    router.push({ pathname: router.pathname, query: newQuery }, undefined, { shallow: true });
  }, [router]);


  // Login function
  const login = useCallback(async (userRole: UserRole, user: User) => {
    console.log('🔐 LmsContext: Login called with user:', user);
    setIsAuthenticated(true);
    setCurrentUser(user);

    // Use roles from user object if available, otherwise fetch from database
    const userRolesFromLogin = user.roles || [];
    const selectedRole = userRole;

    if (userRolesFromLogin.length > 0) {
      // Roles provided from login - use them directly
      console.log('✅ LmsContext: Using roles from login:', userRolesFromLogin);
      setUserRoles(userRolesFromLogin);
      setRole(selectedRole);

      // Load user data based on selected role
      const loadUserData = async () => {
        try {
          const profile = await fetchUserProfileByRole(selectedRole);
          setCurrentUserProfile(profile);
          console.log('✅ LmsContext: Profile loaded after login');
        } catch (error) {
          console.error('❌ LmsContext: Failed to load profile after login:', error);
        }

        try {
          const providerInfo = await fetchTrainingProviderInfo(user.id);
          setTrainingProviderProfile({
            companyLogoUrl: providerInfo.companyLogoUrl,
            companyName: providerInfo.companyName,
            integrations: providerInfo.referenceLinks || {},
          } as TrainingProviderProfile);
          console.log('✅ LmsContext: Training provider info loaded after login');
        } catch (error) {
          console.error('❌ LmsContext: Failed to load training provider info after login:', error);
        }

        try {
          const events = await fetchCalendarEvents(selectedRole);
          setCalendarEvents(events);
          console.log('✅ LmsContext: Calendar events loaded after login');
        } catch (error) {
          console.error('❌ LmsContext: Failed to load calendar events after login:', error);
        }
      };

      loadUserData();
    } else {
      // Fallback: fetch roles from database
      try {
        console.log('🔍 LmsContext: Fetching user roles from database...');
        const { primaryRole, allRoles } = await fetchUserRoles(user.id);
        console.log('✅ LmsContext: User roles:', allRoles);
        setUserRoles(allRoles);
        setRole(primaryRole);

        const loadUserData = async () => {
          try {
            const profile = await fetchUserProfileByRole(primaryRole);
            setCurrentUserProfile(profile);
            console.log('✅ LmsContext: Profile loaded after login');
          } catch (error) {
            console.error('❌ LmsContext: Failed to load profile after login:', error);
          }

          try {
            const providerInfo = await fetchTrainingProviderInfo(user.id);
            setTrainingProviderProfile({
              companyLogoUrl: providerInfo.companyLogoUrl,
              companyName: providerInfo.companyName,
              companyShortname: providerInfo.companyShortname,
              integrations: providerInfo.referenceLinks || {},
            } as TrainingProviderProfile);
            console.log('✅ LmsContext: Training provider info loaded after login');
          } catch (error) {
            console.error('❌ LmsContext: Failed to load training provider info after login:', error);
          }

          try {
            const events = await fetchCalendarEvents(primaryRole);
            setCalendarEvents(events);
            console.log('✅ LmsContext: Calendar events loaded after login');
          } catch (error) {
            console.error('❌ LmsContext: Failed to load calendar events after login:', error);
          }
        };

        loadUserData();
      } catch (error) {
        console.error('❌ LmsContext: Failed to fetch user roles after login:', error);
        setUserRoles([userRole]);
        setRole(userRole);
      }
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    console.log('🚪 LmsContext: Logout called');

    try {
      await authService.logout();
    } catch (error) {
      console.error('❌ LmsContext: Logout API call failed:', error);
    }

    // Clear all state
    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentUserProfile(null);
    setRole(UserRole.Learner);
    setUserRoles([]); // Clear all roles on logout
    setCurrentView(View.Dashboard);
    setSelectedCourse(null);
    setCourseDetail(null);
    setResourceLinks([]);
    setLearningUnits([]);
    setCourseAssessments([]);
    setBookmarkedSubtopics([]);
    setCompletedSubtopics([]);
    setSubmissions([]);
    setCertificate(null);
    setCalendarEvents([]);

    // Clear URL parameters
    router.replace('/', undefined, { shallow: true });

    console.log('✅ LmsContext: Logout completed');
  }, [router]);

  // Navigation handler
  const handleNavigation = useCallback((view: View) => {
    console.log(`🧭 LmsContext: Navigation requested from ${currentView} to ${view}`);

    // Clear selected course when navigating to prevent "sticky" course detail view
    if (selectedCourse) {
      console.log(`🗑️ LmsContext: Clearing selectedCourse to allow navigation`);
      setSelectedCourse(null);
    }

    // Clear editing course when navigating to prevent "sticky" course editor view
    if (editingCourse) {
      console.log(`🗑️ LmsContext: Clearing editingCourse to allow navigation`);
      setEditingCourse(null);
      setCourseEditMode(null); // Also clear the edit mode
    }

    setCurrentView(view);
    updateURL(view); // Update URL with new view
    console.log(`✅ LmsContext: Navigation completed to ${view}`);
  }, [currentView, selectedCourse, editingCourse, updateURL]);

  // Switch to a different role (must be one the user has)
  const switchRole = useCallback(async (newRole: UserRole) => {
    console.log(`👤 LmsContext: Role switch requested to ${newRole}`);

    // Validate that user has this role
    if (!userRoles.includes(newRole)) {
      console.error(`❌ LmsContext: User does not have role ${newRole}. Available roles:`, userRoles);
      throw new Error(`You do not have access to the ${newRole} role`);
    }

    setRole(newRole);

    // Update authService with new role
    authService.setCurrentRole(newRole);

    // Reset view to dashboard when switching roles
    setCurrentView(View.Dashboard);
    setSelectedCourse(null);

    // Trigger profile refresh after role change
    try {
      const profile = await fetchUserProfileByRole(newRole);
      setCurrentUserProfile(profile);

      // Refresh calendar events for new role
      const events = await fetchCalendarEvents(newRole);
      setCalendarEvents(events);

      console.log(`✅ LmsContext: Successfully switched to ${newRole} role`);
    } catch (error) {
      console.error('❌ LmsContext: Failed to refresh data after role change:', error);
    }
  }, [userRoles]);

  // Legacy handler for setRole (used internally)
  const handleRoleChange = useCallback(async (newRole: UserRole) => {
    await switchRole(newRole);
  }, [switchRole]);

  const resetCreateView = useCallback(() => {
    console.log('🔄 LmsContext: Resetting create view');
    // Reset any create view specific state
  }, []);

  const resetAdminView = useCallback(() => {
    console.log('🔄 LmsContext: Resetting admin view');
    setAdminPage(AdminPage.Dashboard);
  }, []);

  // Function to refresh current user profile
  const refreshUserProfile = useCallback(async () => {
    if (role) {
      try {
        console.log(`🔄 LmsContext: Refreshing profile for ${role}...`);
        const updatedProfile = await fetchUserProfileByRole(role);
        setCurrentUserProfile(updatedProfile);

        // Training provider info is already loaded globally and doesn't need refresh based on role

        console.log(`✅ LmsContext: Profile refreshed for ${role}`);
      } catch (error) {
        console.error('❌ LmsContext: Failed to refresh user profile:', error);
      }
    }
  }, [role]);

  // Function to refresh calendar events
  const refreshCalendarEvents = useCallback(async () => {
    if (role) {
      try {
        console.log(`🔄 LmsContext: Refreshing calendar events for ${role}...`);
        const events = await fetchCalendarEvents(role);
        setCalendarEvents(events);
        console.log(`✅ LmsContext: Calendar events refreshed for ${role}`);
      } catch (error) {
        console.error('❌ LmsContext: Failed to refresh calendar events:', error);
      }
    }
  }, [role]);

  // Simplified implementations for now (can be enhanced later)
  const loadCourseData = useCallback(async (course: Course) => {
    console.log('🔄 LmsContext: Loading course data for:', {
      id: course.id,
      title: course.title,
      courseCode: course.courseCode,
      tscTitle: course.tscTitle,
      tscCode: course.tscCode,
      courseRunId: course.courseRunId,
      courseRunCode: course.courseRunCode
    });
    console.log('🔄 Full course object:', course);
    setSelectedCourse(course);
    updateURL(currentView || View.Courses, course.id); // Update URL with both view and course ID

    if (!currentUser?.id) {
      console.error('❌ No authenticated user found for course data loading');
      return;
    }

    try {
      const userId = currentUser.id; // Use currentUser from context instead of localStorage

      // Set the selected course first
      setSelectedCourse(course);

      // Clear previous data
      console.log('🧹 Clearing previous course data before loading new course');
      setCourseDetail(null);
      setResourceLinks([]);
      setLearningUnits([]);
      setCourseAssessments([]);
      console.log('🧹 Clearing bookmarked subtopics - was:', bookmarkedSubtopics);
      setBookmarkedSubtopics([]);
      setCompletedSubtopics([]);
      setSubmissions([]);
      setCertificate(null);

      // Check if user is a trainer and course has courseRunId
      if (role === UserRole.Trainer && course.courseRunId) {
        // Use trainer-specific API for course details
        const trainerResponse = await fetch(`/api/courses/trainer-detail?trainerUserId=${userId}&courseRunId=${course.courseRunId}`);

        if (!trainerResponse.ok) {
          throw new Error(`Trainer API failed: ${trainerResponse.status} ${trainerResponse.statusText}`);
        }

        const trainerData = await trainerResponse.json();

        if (!trainerData.success || !trainerData.data) {
          throw new Error(`Trainer API response invalid: ${trainerData.error || 'No data returned'}`);
        }

        // Set course detail from trainer API response
        setCourseDetail({
          title: trainerData.data.courseDetail.courseTitle,
          tgsRef: trainerData.data.courseDetail.tgsRef,
          tscTitle: trainerData.data.courseDetail.tscTitle,
          tscCode: trainerData.data.courseDetail.tscCode,
          courseRunId: trainerData.data.courseDetail.courseRunId, // String format for display
          courseRunUuid: trainerData.data.courseDetail.courseRunUuid, // UUID format for API calls
          digitalAttendanceId: trainerData.data.courseDetail.digitalAttendanceId,
          trainingHours: trainerData.data.courseDetail.trainingHours,
          assessmentHours: trainerData.data.courseDetail.assessmentHours,
          lessonPlanUrl: trainerData.data.courseDetail.lessonPlanUrl,
          learnerGuideUrl: trainerData.data.courseDetail.learnerGuideUrl,
          slidesUrl: trainerData.data.courseDetail.slidesUrl,
          facilitatorGuideUrl: trainerData.data.courseDetail.facilitatorGuideUrl,
          trainerSlidesUrl: trainerData.data.courseDetail.trainerSlidesUrl,
          assessmentPlanUrl: trainerData.data.courseDetail.assessmentPlanUrl,
          courseLink: trainerData.data.courseDetail.courseLink,
          assessmentRecordLink: trainerData.data.courseDetail.assessmentRecordLink,
          writtenAssessmentLink: trainerData.data.courseDetail.writtenAssessmentLink,
          practicalPerformanceAssessmentLink: trainerData.data.courseDetail.practicalPerformanceAssessmentLink,
          writtenAssessmentPublished: trainerData.data.courseDetail.writtenAssessmentPublished ?? false,
          practicalAssessmentPublished: trainerData.data.courseDetail.practicalAssessmentPublished ?? false,
          assessmentMethods: trainerData.data.courseDetail.assessmentMethods || null,
          publishedAssessmentMethods: trainerData.data.courseDetail.publishedAssessmentMethods || {},
          startDate: trainerData.data.courseDetail.startDate || null,
          endDate: trainerData.data.courseDetail.endDate || null,
          fundingValidity: trainerData.data.courseDetail.fundingValidity || null,
          certificate: ''
        } as any);

        console.log('✅ LmsContext: Course detail set with courseRunUuid:', trainerData.data.courseDetail.courseRunUuid);
        console.log('✅ LmsContext: Original course.courseRunId was:', course.courseRunId);

        // Set resource links, learning units and bookmarks from trainer API
        setResourceLinks(trainerData.data.courseDetail.resourceLinks || []);
        setLearningUnits(trainerData.data.learningUnits);
        setBookmarkedSubtopics(trainerData.data.bookmarkedSubtopics);

        console.log('✅ LmsContext: Trainer course detail loaded:', trainerData.data.courseDetail);
        console.log('✅ LmsContext: Trainer learning units loaded:', trainerData.data.learningUnits);
        console.log('✅ LmsContext: Trainer bookmarks loaded for courseRunUuid:', trainerData.data.courseDetail.courseRunUuid);
        console.log('✅ LmsContext: Trainer bookmarked subtopics:', trainerData.data.bookmarkedSubtopics);

        // Load trainer assessments with publish status
        if (course.courseRunId) {
          try {
            const response = await fetch(`/api/assessments/trainer?courseRunId=${course.courseRunId}&trainerId=${userId}`);
            if (response.ok) {
              const result = await response.json();
              if (result.success) {
                const mappedAssessments = result.data.map((assessment: any) => ({
                  id: assessment.assessment_id,
                  title: assessment.assessment_title,
                  category: assessment.category,
                  file_url: '', // Trainer assessments don't have file URLs in this API
                  deadline: assessment.deadline,
                  status: assessment.status,
                  accessCode: undefined,
                  published: assessment.published
                }));
                setCourseAssessments(mappedAssessments);
                console.log('✅ LmsContext: Trainer assessments loaded:', result.data);
              }
            }
          } catch (error) {
            console.error('❌ LmsContext: Failed to load trainer assessments:', error);
            setCourseAssessments([]);
          }
        }
      } else if (role === UserRole.Developer && course.id) {
        // Use developer-specific API for course details (using course ID, not course run ID)
        try {
          const detailResponse = await fetch(`/api/courses/developer-course-detail?courseId=${course.id}&_t=${Date.now()}`);
          const detailResult = await detailResponse.json();

          if (detailResult.success) {
            setCourseDetail(detailResult.data);
            setResourceLinks(detailResult.data.resourceLinks || []);
            console.log('✅ LmsContext: Developer course detail loaded:', detailResult.data);
          }

          // Load learning units for developers using course ID
          const unitsResponse = await fetch(`/api/courses/developer-learning-units?courseId=${course.id}`);
          const unitsResult = await unitsResponse.json();

          if (unitsResult.success) {
            setLearningUnits(unitsResult.data);
            console.log('✅ LmsContext: Developer learning units loaded:', unitsResult.data);
          }

          // Developers don't need bookmarks, completions, or submissions for viewing courses
          setBookmarkedSubtopics([]);
          setCompletedSubtopics([]);
          setSubmissions([]);
          setCourseAssessments([]); // Developers don't need assessments for viewing
          setCertificate(null);
        } catch (error) {
          console.error('❌ LmsContext: Failed to load developer course data:', error);
        }
      } else {
        // Use learner-specific API for course details (existing logic)
        if (course.id) {
          try {
            // Include courseRunId if available to get specific course run details
            const detailUrl = course.courseRunId
              ? `/api/courses/detail?userId=${userId}&courseId=${course.id}&courseRunId=${course.courseRunId}`
              : `/api/courses/detail?userId=${userId}&courseId=${course.id}`;

            console.log('🔍 LmsContext: Fetching learner course detail from:', detailUrl);
            const detailResponse = await fetch(detailUrl);
            const detailResult = await detailResponse.json();

            if (detailResult.success) {
              const detail = detailResult.data;
              setCourseDetail(detail);
              setResourceLinks(detail.resourceLinks || []);
              console.log(`✅ LmsContext: Learner course detail loaded:`, detail);
              console.log(`🔍 LmsContext: courseRunId (string):`, detail.courseRunId);
              console.log(`🔍 LmsContext: courseRunUuid (UUID):`, detail.courseRunUuid);

              // If we have a course run UUID, load learning units and assessments
              if (detail.courseRunUuid) {
                // Load learning units
                const unitsResponse = await fetch(`/api/courses/learning-units?userId=${userId}&courseRunId=${detail.courseRunUuid}`);
                const unitsResult = await unitsResponse.json();

                // Load bookmarks - now using courseRunId instead of courseId
                console.log('🔍 Loading bookmarks for courseRunUuid:', detail.courseRunUuid);
                console.log('🔍 User role:', role);
                console.log('🔍 Course details:', detail);
                console.log('🔍 Selected course:', course);
                const bookmarksResponse = await fetch(`/api/bookmarks?userId=${userId}&courseRunId=${detail.courseRunUuid}`);
                const bookmarksResult = await bookmarksResponse.json();
                console.log('🔍 Bookmarks API response:', bookmarksResult);

                // Load completions using courseRunUuid (UUID format)
                const completionsResponse = await fetch(`/api/completions?userId=${userId}&courseRunId=${detail.courseRunUuid}`);
                const completionsResult = await completionsResponse.json();
                console.log('🔍 Completions API response:', completionsResult);

                // Load topic-level completions (for topics without subtopics)
                const topicCompletionsResponse = await fetch(`/api/completions/topics?userId=${userId}&courseRunId=${detail.courseRunUuid}`);
                const topicCompletionsResult = await topicCompletionsResponse.json();
                if (topicCompletionsResult.success) {
                  setCompletedTopics(topicCompletionsResult.data.map((r: any) => r.topic_id));
                }

                if (unitsResult.success) {
                  setLearningUnits(unitsResult.data);
                  console.log(`✅ LmsContext: Learning units loaded:`, unitsResult.data);
                }

                if (bookmarksResult.success) {
                  // Transform bookmarks data to get only subtopic IDs
                  const bookmarkedSubtopicIds = bookmarksResult.data.map((bookmark: any) => bookmark.subtopic_id);
                  setBookmarkedSubtopics(bookmarkedSubtopicIds);
                  console.log(`✅ LmsContext: Learner bookmarks loaded for courseRunUuid ${detail.courseRunUuid}:`, bookmarkedSubtopicIds);
                }

                if (completionsResult.success) {
                  // Transform completions data to get only subtopic IDs
                  const completedSubtopicIds = completionsResult.data.map((completion: any) => completion.subtopic_id);
                  setCompletedSubtopics(completedSubtopicIds);
                  console.log(`✅ LmsContext: Completions loaded:`, completedSubtopicIds);
                }

                // Load assessments with publish status for learners
                try {
                  const response = await fetch(`/api/assessments/learner?courseRunId=${detail.courseRunUuid}&learnerId=${userId}`);
                  if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                      // Map the learner assessment response to CourseAssessment format
                      const mappedAssessments = result.data.map((assessment: any) => ({
                        id: assessment.assessment_id,
                        title: assessment.assessment_title,
                        category: assessment.category || 'Assessment',
                        file_url: assessment.file_url,
                        deadline: assessment.deadline,
                        status: assessment.status || 'active',
                        accessCode: undefined,
                        published: assessment.published // Include publish status
                      }));
                      setCourseAssessments(mappedAssessments);
                      console.log(`✅ LmsContext: Course assessments loaded with publish status:`, result.data);
                    } else {
                      console.error('❌ LmsContext: Failed to load assessments:', result.error);
                      setCourseAssessments([]);
                    }
                  } else {
                    console.error('❌ LmsContext: Assessment API request failed');
                    setCourseAssessments([]);
                  }
                } catch (error) {
                  console.error('❌ LmsContext: Failed to load assessments:', error);
                  setCourseAssessments([]);
                }

                // Load submissions for the course
                try {
                  const response = await fetch(`/api/submissions?userId=${userId}&courseId=${course.id}`);
                  if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                      setSubmissions(result.data);
                      console.log(`✅ LmsContext: Submissions loaded:`, result.data);
                    }
                  }
                } catch (error) {
                  console.error('❌ LmsContext: Failed to load submissions:', error);
                }

                // Load certificate for the course
                try {
                  const response = await fetch(`/api/certificates?userId=${userId}&courseId=${course.id}`);
                  if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                      setCertificate(result.data);
                      console.log(`✅ LmsContext: Certificate loaded:`, result.data);
                    }
                  }
                } catch (error) {
                  console.error('❌ LmsContext: Failed to load certificate:', error);
                }
              }
            }
          } catch (error) {
            console.error('❌ LmsContext: Failed to load learner course data:', error);
          }
        }
      }
    } catch (error) {
      console.error('❌ LmsContext: Failed to load course data:', error);
    }
  }, [role, updateURL, currentUser, bookmarkedSubtopics, currentView]);

  const toggleBookmark = useCallback(async (subtopicId: string) => {
    if (!selectedCourse?.id || !currentUser?.id) {
      console.error('❌ No selectedCourse or currentUser available for bookmark operation');
      return;
    }

    try {
      const isCurrentlyBookmarked = bookmarkedSubtopics.includes(subtopicId);
      const newBookmarkState = !isCurrentlyBookmarked;
      const userId = currentUser.id; // Use currentUser from context instead of localStorage

      // Get courseRunId - prefer courseDetail.courseRunUuid (UUID), fallback to selectedCourse.courseRunId 
      // Note: selectedCourse.courseRunId should be UUID but might be string in some cases
      let courseRunId = courseDetail?.courseRunUuid || selectedCourse?.courseRunId;

      // Additional safety check: if courseRunId looks like a string format (no hyphens), log warning
      if (courseRunId && !courseRunId.includes('-')) {
        console.warn('⚠️ courseRunId appears to be string format, not UUID:', courseRunId);
        console.warn('⚠️ CourseDetail:', courseDetail);
        console.warn('⚠️ SelectedCourse:', selectedCourse);
      }

      if (!courseRunId) {
        console.error('❌ No courseRunId available for bookmark operation. CourseDetail:', courseDetail, 'SelectedCourse:', selectedCourse);
        return;
      }

      console.log('🔖 Toggling bookmark:', {
        subtopicId,
        courseRunId,
        newBookmarkState,
        userRole: role,
        userId: userId,
        userEmail: currentUser.email,
        userFullName: currentUser.fullName,
        courseDetailUuid: courseDetail?.courseRunUuid,
        selectedCourseRunId: selectedCourse?.courseRunId,
        selectedCourseTitle: selectedCourse?.title
      });

      // Validate user ID consistency
      const localStorageUserId = getCurrentUserId();
      if (userId !== localStorageUserId) {
        console.warn('⚠️ User ID mismatch detected!', {
          contextUserId: userId,
          localStorageUserId: localStorageUserId,
          contextUserEmail: currentUser.email
        });
      }

      // Optimistic update
      setBookmarkedSubtopics(prev =>
        newBookmarkState
          ? [...prev, subtopicId]
          : prev.filter(id => id !== subtopicId)
      );

      // Call API with the required parameters including courseRunId
      const response = await fetch('/api/bookmarks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          subtopicId,
          courseRunId,
          isBookmarked: newBookmarkState
        })
      });

      if (!response.ok) {
        throw new Error('Failed to toggle bookmark');
      }

    } catch (error) {
      console.error('❌ LmsContext: Failed to toggle bookmark:', error);
      const userId = currentUser?.id;
      let courseRunId = courseDetail?.courseRunUuid || selectedCourse?.courseRunId;

      // Additional safety check for revert logic
      if (courseRunId && !courseRunId.includes('-')) {
        console.warn('⚠️ courseRunId in error handler appears to be string format:', courseRunId);
      }

      // Revert optimistic update on error
      if (courseRunId && userId) {
        const bookmarksResponse = await fetch(`/api/bookmarks?userId=${userId}&courseRunId=${courseRunId}`);
        const bookmarksResult = await bookmarksResponse.json();
        if (bookmarksResult.success) {
          // Transform bookmarks data to get only subtopic IDs
          const bookmarkedSubtopicIds = bookmarksResult.data.map((bookmark: any) => bookmark.subtopic_id);
          setBookmarkedSubtopics(bookmarkedSubtopicIds);
        }
      }
    }
  }, [selectedCourse?.id, selectedCourse?.courseRunId, courseDetail?.courseRunUuid, bookmarkedSubtopics, currentUser]);

  const toggleCompletion = useCallback(async (subtopicId: string) => {
    if (!selectedCourse?.id || !currentUser?.id || !courseDetail?.courseRunUuid) {
      console.error('❌ No selectedCourse, currentUser, or courseRunUuid available for completion operation');
      return;
    }

    try {
      const isCurrentlyCompleted = completedSubtopics.includes(subtopicId);
      const newCompletionState = !isCurrentlyCompleted;
      const userId = currentUser.id; // Use currentUser from context instead of localStorage
      const courseRunId = courseDetail.courseRunUuid; // Use UUID format

      console.log(`🔍 LmsContext: Toggling completion for subtopicId: ${subtopicId}, courseRunId: ${courseRunId}, newState: ${newCompletionState}`);

      // Optimistic update
      setCompletedSubtopics(prev =>
        newCompletionState
          ? [...prev, subtopicId]
          : prev.filter(id => id !== subtopicId)
      );

      // Call API with the required parameters (using courseRunId instead of courseId)
      const response = await fetch('/api/completions/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          subtopicId,
          courseRunId, // Changed from courseId to courseRunId
          isCompleted: newCompletionState
        })
      });

      if (!response.ok) {
        throw new Error('Failed to toggle completion');
      }

    } catch (error) {
      console.error('❌ LmsContext: Failed to toggle completion:', error);
      const userId = currentUser?.id;
      const courseRunId = courseDetail?.courseRunUuid;
      // Revert optimistic update on error
      if (userId && courseRunId) {
        const completionsResponse = await fetch(`/api/completions?userId=${userId}&courseRunId=${courseRunId}`);
        const completionsResult = await completionsResponse.json();
        if (completionsResult.success) {
          // Transform completions data to get only subtopic IDs
          const completedSubtopicIds = completionsResult.data.map((completion: any) => completion.subtopic_id);
          setCompletedSubtopics(completedSubtopicIds);
        }
      }
    }
  }, [selectedCourse?.id, selectedCourse?.courseRunId, courseDetail?.courseRunUuid, completedSubtopics, currentUser]);

  const toggleTopicCompletion = useCallback(async (topicId: string) => {
    if (!currentUser?.id || !courseDetail?.courseRunUuid) return;
    const isCurrentlyCompleted = completedTopics.includes(topicId);
    const newState = !isCurrentlyCompleted;

    // Optimistic update — topics list
    const newCompletedTopics = newState
      ? [...completedTopics, topicId]
      : completedTopics.filter(id => id !== topicId);
    setCompletedTopics(newCompletedTopics);

    // Optimistic update — overall progress on course card
    const totalItems = learningUnits.reduce((sum, unit) =>
      sum + (unit.subtopics.length > 0 ? unit.subtopics.length : 1), 0);
    const completedItems =
      completedSubtopics.length +
      learningUnits.filter(u => u.subtopics.length === 0 && newCompletedTopics.includes(u.id)).length;
    const newProgress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    setSelectedCourse(prev => prev ? { ...prev, progressPercent: newProgress } : prev);

    try {
      const response = await fetch('/api/completions/topic-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, topicId, courseRunId: courseDetail.courseRunUuid, isCompleted: newState })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('❌ LmsContext: Failed to toggle topic completion:', error);
      // Revert on error
      setCompletedTopics(prev => !newState ? [...prev, topicId] : prev.filter(id => id !== topicId));
      setSelectedCourse(prev => prev ? { ...prev, progressPercent: selectedCourse?.progressPercent ?? 0 } : prev);
    }
  }, [currentUser, courseDetail?.courseRunUuid, completedTopics, completedSubtopics, learningUnits, selectedCourse]);

  const loadSubmissions = useCallback(async () => {
    if (!selectedCourse?.id || !currentUser?.id) return;

    try {
      const userId = currentUser.id; // Use currentUser from context

      const response = await fetch(`/api/submissions?userId=${userId}&courseId=${selectedCourse.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch submissions');
      }

      const result = await response.json();
      if (result.success) {
        setSubmissions(result.data);
        console.log(`✅ LmsContext: Submissions loaded:`, result.data);
      }
    } catch (error) {
      console.error('❌ LmsContext: Failed to load submissions:', error);
    }
  }, [selectedCourse?.id, currentUser]);

  const loadCertificate = useCallback(async () => {
    if (!selectedCourse?.id || !currentUser?.id) return;

    try {
      const userId = currentUser.id; // Use currentUser from context

      const response = await fetch(`/api/certificates?userId=${userId}&courseId=${selectedCourse.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch certificate');
      }

      const result = await response.json();
      if (result.success) {
        setCertificate(result.data);
        console.log(`✅ LmsContext: Certificate loaded:`, result.data);
      }
    } catch (error) {
      console.error('❌ LmsContext: Failed to load certificate:', error);
    }
  }, [selectedCourse?.id, currentUser]);

  const submitAssessment = useCallback(async (assessmentId: string, fileName: string, fileUrl?: string) => {
    if (!selectedCourse?.id || !courseDetail?.courseRunUuid || !currentUser?.id) return;

    try {
      const userId = currentUser.id; // Use currentUser from context

      // First get the enrollment ID for the current user and course
      const enrollmentResponse = await fetch(`/api/enrollments?userId=${userId}&courseRunId=${courseDetail.courseRunUuid}`);
      if (!enrollmentResponse.ok) {
        throw new Error('Failed to get enrollment information');
      }

      const enrollmentResult = await enrollmentResponse.json();
      if (!enrollmentResult.success || !enrollmentResult.data.length) {
        throw new Error('No enrollment found for this course');
      }

      const enrollmentId = enrollmentResult.data[0].id;

      // Submit the assessment
      const response = await fetch('/api/submissions/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enrollmentId,
          assessmentId,
          fileName,
          fileUrl
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit assessment');
      }

      const result = await response.json();
      if (result.success) {
        console.log(`✅ LmsContext: Assessment submitted:`, result.data);
        // Reload submissions to show the new submission
        await loadSubmissions();
      }
    } catch (error) {
      console.error('❌ LmsContext: Failed to submit assessment:', error);
      throw error;
    }
  }, [selectedCourse?.id, courseDetail?.courseRunUuid, loadSubmissions, currentUser]);

  const publishAssessment = useCallback(async (assessmentId: string, published: boolean) => {
    if (!courseDetail?.courseRunUuid) {
      throw new Error('No course run ID available');
    }

    try {
      const response = await fetch('/api/assessments/publish', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseRunId: courseDetail.courseRunUuid,
          assessmentId,
          published
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to publish assessment');
      }

      const result = await response.json();
      if (result.success) {
        console.log(`✅ LmsContext: Assessment publish status updated:`, result.message);

        // Update the local courseAssessments state to reflect the change
        setCourseAssessments(prev =>
          prev.map(assessment =>
            assessment.id === assessmentId
              ? { ...assessment, published }
              : assessment
          )
        );
      }
    } catch (error) {
      console.error('❌ LmsContext: Failed to publish assessment:', error);
      throw error;
    }
  }, [courseDetail?.courseRunUuid]);

  // Profile functions
  const updateTrainingProviderProfile = useCallback((updates: Partial<TrainingProviderProfile>) => {
    setTrainingProviderProfile(prev => {
      if (!prev) return null;

      const updated = { ...prev, ...updates };

      // Apply color scheme if it was updated
      if (updates.colorScheme) {
        initializeColorScheme(updated as TrainingProviderProfile);
      }

      return updated;
    });
  }, []);

  const updateCurrentUserProfile = useCallback((updates: Partial<CurrentUserProfile>) => {
    setCurrentUserProfile(prev => prev ? ({ ...prev, ...updates }) : null);
  }, []);

  // Chat functions
  const toggleChat = useCallback(() => {
    setIsChatOpen(prev => !prev);
  }, []);

  const resetInAppChat = useCallback(() => {
    resetTutorChat();
  }, []);

  const value: LmsContextType = {
    role,
    userRoles,
    setRole: handleRoleChange,
    switchRole,
    currentView,
    setCurrentView,
    adminPage,
    setAdminPage: navigateAdminPage,
    trainerPage,
    setTrainerPage: navigateTrainerPage,
    selectedCourseRunId,
    setSelectedCourseRunId,
    pendingAttendanceCourseRunId,
    setPendingAttendanceCourseRunId,
    pendingGradingCourseRunId,
    setPendingGradingCourseRunId,
    isAuthenticated,
    isLoading,
    currentUser,
    login,
    logout,
    trainingProviderProfile,
    updateTrainingProviderProfile,
    currentUserProfile,
    updateCurrentUserProfile,
    calendarEvents,
    selectedCourse,
    setSelectedCourse,
    editingCourse,
    setEditingCourse,
    courseEditMode,
    setCourseEditMode,
    editingCourseRun,
    setEditingCourseRun,
    courseListPage,
    setCourseListPage,
    courseDetail,
    resourceLinks,
    learningUnits,
    courseAssessments,
    bookmarkedSubtopics,
    completedSubtopics,
    completedTopics,
    submissions,
    certificate,
    handleNavigation,
    resetCreateView,
    resetAdminView,
    refreshUserProfile,
    refreshCalendarEvents,
    loadCourseData,
    toggleBookmark,
    toggleCompletion,
    toggleTopicCompletion,
    submitAssessment,
    publishAssessment,
    loadSubmissions,
    loadCertificate,

    // Chat functionality
    isChatOpen,
    toggleChat,
    resetInAppChat,
    courses,
  };

  return <LmsContext.Provider value={value}>{children}</LmsContext.Provider>;
};

export const useLms = (): LmsContextType => {
  const context = useContext(LmsContext);
  if (context === undefined) {
    throw new Error('useLms must be used within an LmsProvider');
  }
  return context;
};
