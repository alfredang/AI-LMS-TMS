// Enum definitions for the LMS system
export enum View {
  Dashboard = 'dashboard',
  Courses = 'courses',
  Calendar = 'calendar',
  JobSearch = 'jobSearch',
  Create = 'create',
  Admin = 'admin',
  Profile = 'profile',
  HelpAndSupport = 'helpAndSupport',
  UserManagement = 'userManagement',
  ApiEndpoints = 'apiEndpoints',
  AdminManagement = 'adminManagement',
  Scheduler = 'scheduler',
  Documents = 'documents',
  PrivacyPolicy = 'privacyPolicy',
  AcceptableUsePolicy = 'acceptableUsePolicy',
  OtpEmailTemplate = 'otpEmailTemplate',
  CertificateEmailTemplate = 'certificateEmailTemplate',
  FeedbackEmailTemplate = 'feedbackEmailTemplate',
  PasswordResetEmailTemplate = 'passwordResetEmailTemplate',
  FinanceManagement = 'financeManagement',
  BillingHistory = 'billingHistory',
  CertificateHistory = 'certificateHistory'
}

export enum UserRole {
  Learner = 'learner',
  Trainer = 'trainer',
  Developer = 'developer',
  Admin = 'admin',
  Finance = 'finance',
  TrainingProvider = 'trainingProvider'
}

export enum AdminPage {
  Dashboard = 'dashboard',
  ClassDetail = 'classDetail',
  ClassManagement = 'classManagement',
  TpgManagement = 'tpgManagement',
  TpgDirectApplication = 'tpgDirectApplication',
  TpgCourseRun = 'tpgCourseRun',
  TpgCourseSession = 'tpgCourseSession',
  TpgEnrollment = 'tpgEnrollment',
  TpgGrant = 'tpgGrant',
  TpgAttendance = 'tpgAttendance',
  TpgAssessment = 'tpgAssessment',
  TpgClaims = 'tpgClaims',
  FundingValidity = 'fundingValidity',
  ViewCourses = 'viewCourses',
  ViewTrainers = 'viewTrainers',
  ViewLearners = 'viewLearners',
  UpcomingClasses = 'upcomingClasses',
  OngoingClasses = 'ongoingClasses',
  CompletedClasses = 'completedClasses',
  CreateNewClass = 'createNewClass',
  EditClass = 'editClass',
  EnrollLearners = 'enrollLearners',
  AssignTrainer = 'assignTrainer',
  AddCourse = 'addCourse',
  AddCourseRun = 'addCourseRun',
  ApplyNewGrant = 'applyNewGrant',
  ViewGrantStatus = 'viewGrantStatus',
  SubmitAssessment = 'submitAssessment',
  UpdateAssessment = 'updateAssessment',
  ApplyNewClaim = 'applyNewClaim',
  UploadCourseRuns = 'uploadCourseRuns',
  SearchGrant = 'searchGrant',
  SearchEnrolment = 'searchEnrolment',
  ViewEnrolment = 'viewEnrolment',
  UploadDirectApplication = 'uploadDirectApplication',
  ViewDirectApplication = 'viewDirectApplication',
  UpdateDirectApplication = 'updateDirectApplication',
  UploadEnrolments = 'uploadEnrolments',
  SearchCourseRuns = 'searchCourseRuns',
  ViewCourseRun = 'viewCourseRun',
  EditCourseRun = 'editCourseRun',
  SearchAssessments = 'searchAssessments',
  ViewAssessment = 'viewAssessment',
  CancelEnrolment = 'cancelEnrolment',
  UpdateEnrolment = 'updateEnrolment',
  DeleteCourseRun = 'deleteCourseRun',
  UpdateEnrolmentFees = 'updateEnrolmentFees',
  CourseSessionAttendance = 'courseSessionAttendance',
  CourseSessions = 'courseSessions',
  AddSessions = 'addSessions',
  CourseSessionTiming = 'courseSessionTiming',
  AssignStudent = 'assignStudent',
  SearchPastLearners = 'searchPastLearners',
  CheckAttendance = 'checkAttendance',
  AutomationLogs = 'automationLogs',
  AssignTrainerLogs = 'assignTrainerLogs',
  TrainerFolderLogs = 'trainerFolderLogs',
  AutoCreateCertificatesLog = 'autoCreateCertificatesLog',
  CourseRunDateSyncLogs = 'courseRunDateSyncLogs',
  BackfillEnrollments = 'backfillEnrollments',
  FetchUpcomingEnrolments = 'fetchUpcomingEnrolments',
  CreateCertificate = 'createCertificate',
  DeleteCertificate = 'deleteCertificate',
  SendCertificateSG = 'sendCertificateSG',
  SendCertificateGH = 'sendCertificateGH',
  Calendar = 'calendar',
  Scheduler = 'scheduler',
}

export enum TrainerPage {
  EAttendance = 'eAttendance',
  AssessmentGrading = 'assessmentGrading',
  MyClasses = 'myClasses',
  PastAttendance = 'pastAttendance',
  PastAssessment = 'pastAssessment',
  TaskList = 'taskList',
  GenAIAuthoring = 'genAIAuthoring',
  EdTools = 'edTools',
  DataAnalyticsTools = 'dataAnalyticsTools',
  FinanceTools = 'financeTools',
  StatTools = 'statTools',
  DoeTools = 'doeTools',
  SpcTools = 'spcTools',
  SustainabilityTools = 'sustainabilityTools',
  VirtualTools = 'virtualTools',
  AssessmentGuide = 'assessmentGuide',
}

// Course related interfaces
export interface Course {
  id: string;
  title: string;
  courseCode: string;
  courseDuration: number;
  trainingHours: number;
  assessmentHours: number;
  totalAssessments?: number;
  courseType: 'WSQ' | 'IBF' | 'Non-WSQ';
  tscTitle?: string;
  tscCode?: string;
  imageUrl?: string;
  modeOfLearning: string[];
  progressPercent?: number;
  paymentStatus?: string;
  assessmentStatus?: string;
  enrollmentDate?: string;
  startDate?: string;
  endDate?: string;
  classStatus?: string;
  enrollmentStatus?: string;
  courseRunId?: string; // Add this for course detail navigation
  courseRunCode?: string; // The actual course run identifier from database
  assignedTrainerName?: string; // Trainer name stored on the course run
  digitalAttendanceId?: string; // RA###### code from course_run.digital_attendance_id
  // Course Editor specific properties
  learningOutcomes?: string;
  description?: string;
  difficulty?: string;
  prerequisite?: string;
  learnerGuideUrl?: string;
  slidesUrl?: string;
  lessonPlanUrl?: string;
  facilitatorGuideUrl?: string;
  assessmentPlanUrl?: string;
  trainerSlidesUrl?: string;
  writtenAssessmentLink?: string;
  practicalPerformanceAssessmentLink?: string;
  writtenAssessmentPublished?: boolean;
  practicalAssessmentPublished?: boolean;
  assessmentMethods?: AssessmentMethods;
  courseFee?: number;
  taxPercent?: number;
  scheduleId?: string;
  courseFeesExcludeGst?: string | number;
  courseFeesIncludeGst?: string | number;
  afterNormalFunding?: string | number;
  afterMcesFunding?: string | number;
  isUtapEligible?: boolean;
  fundingValidity?: string;
  renewedStatus?: string;
  isLeaderboardEnabled?: boolean;
  courseLink?: string;
  brochureLink?: string;
  skillsfutureLink?: string;
  assessmentRecordLink?: string;
  assessmentSummaryRecordUrl?: string;
  topics: Topic[];
  assessments?: Assessment[];
  learners?: any[];
  numOfTrainers?: number;
  trainersList?: string;
  approvedTrainers?: string[];
}

export interface CourseDetail {
  title: string;
  tgsRef: string;
  tscTitle: string;
  tscCode: string;
  courseRunId: string;
  courseRunUuid: string;
  digitalAttendanceId: string;
  trainingHours: number;
  assessmentHours: number;
  lessonPlanUrl: string;
  learnerGuideUrl: string;
  slidesUrl: string;
  facilitatorGuideUrl?: string;
  trainerSlidesUrl?: string;
  assessmentPlanUrl?: string;
  courseLink?: string;
  brochureLink?: string;
  skillsfutureLink?: string;
  assessmentRecordLink?: string;
  assessmentSummaryRecordUrl?: string;
  writtenAssessmentLink?: string;
  practicalPerformanceAssessmentLink?: string;
  writtenAssessmentPublished?: boolean;
  practicalAssessmentPublished?: boolean;
  assessmentMethods?: Record<string, { enabled: boolean; link: string }>;
  publishedAssessmentMethods?: Record<string, boolean>;
  startDate?: string;
  endDate?: string;
  fundingValidity?: string;
  certificate: string;
}

export interface LearningUnit {
  id: string;
  title: string;
  position: number;
  subtopics: {
    id: string;
    title: string;
    position: number;
  }[];
}

export interface CourseAssessment {
  id: string;
  title: string;
  category: string;
  file_url: string;
  deadline: string;
  status: string;
  accessCode?: string;
  published?: boolean; // Add this for trainer assessments
}

export interface TrainerAssessment {
  assessment_id: string;
  assessment_title: string;
  category: string;
  status: string;
  deadline: string | null;
  published: boolean;
  published_at: string | null;
  course_run_id: string;
  course_title: string;
  trainer_id: string;
}

export interface Submission {
  submission_id: string;
  file_name: string;
  submitted_at: string;
  file_url: string;
  assessment_id: string;
  assessment_title: string;
  assessment_category: string;
  assessment_status: string;
  assessment_file_url: string;
  enrollment_id: string;
  course_run_id: string;
  course_id: string;
  course_title: string;
}

// Interface definitions
export interface TrainingProviderProfile {
  uen?: string;
  companyLogoUrl: string;
  companyName: string;
  companyShortname?: string;
  companyWebsite?: string;
  companyEmail?: string;
}

export interface CurrentUserProfile {
  profilePictureUrl?: string;
  name: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
}

export interface Quiz {
  topic: string;
  questions: QuizQuestion[];
}

// Course Editor Types
export interface Topic {
  id: string;
  title: string;
  subtopics: Subtopic[];
}

export interface Subtopic {
  id: string;
  title: string;
  content?: string;
}

export interface Assessment {
  id: string;
  title: string;
  category: AssessmentCategory;
  status: string;
  fileUrl?: string;
}

export enum AssessmentCategory {
  WrittenExam = 'Written Exam',
  OnlineExam = 'Online Exam',
  Project = 'Project',
  Assignments = 'Assignments',
  OralInterview = 'Oral Interview',
  Demonstration = 'Demonstration',
  PracticalExam = 'Practical Exam',
  RolePlay = 'Role Play',
  OralQuestioning = 'Oral Questioning',
}

// Assessment method keys used in assessmentMethods JSON field
export type AssessmentMethodKey =
  | 'writtenAssessment'
  | 'practicalExam'
  | 'caseStudy'
  | 'rolePlay'
  | 'oralQuestioning'
  | 'project'
  | 'assignment';

export interface AssessmentMethodConfig {
  enabled: boolean;
  link: string;
}

export type AssessmentMethods = Record<AssessmentMethodKey, AssessmentMethodConfig>;

export const ASSESSMENT_METHOD_LABELS: Record<AssessmentMethodKey, string> = {
  writtenAssessment: 'Written Exam',
  practicalExam: 'Practical Exam',
  caseStudy: 'Case Study',
  rolePlay: 'Role Play',
  oralQuestioning: 'Oral Questioning',
  project: 'Project',
  assignment: 'Assignment',
};

export const DEFAULT_ASSESSMENT_METHODS: AssessmentMethods = {
  writtenAssessment: { enabled: true, link: '' },
  practicalExam: { enabled: true, link: '' },
  caseStudy: { enabled: false, link: '' },
  rolePlay: { enabled: false, link: '' },
  oralQuestioning: { enabled: false, link: '' },
  project: { enabled: false, link: '' },
  assignment: { enabled: false, link: '' },
};

export enum ModeOfLearning {
  Physical = 'Physical',
  Virtual = 'Virtual',
  Hybrid = 'Hybrid',
}

export interface CalendarEvent {
  id: string;
  title: string;
  type: 'quiz' | 'assignment' | 'lecture' | 'grading' | 'class';
  date: string;
  courseTitle?: string;
  category?: string;
  status?: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
}

// Chat Message interface
export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}
