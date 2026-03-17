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
  UserManagement = 'userManagement'
}

export enum UserRole {
  Learner = 'learner',
  Trainer = 'trainer',
  Developer = 'developer',
  Admin = 'admin',
  TrainingProvider = 'trainingProvider'
}

export enum AdminPage {
  Dashboard = 'dashboard',
  ClassDetail = 'classDetail',
  ClassManagement = 'classManagement',
  TpgManagement = 'tpgManagement',
  ViewCourses = 'viewCourses',
  ViewTrainers = 'viewTrainers',
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
  CourseRun = 'courseRun',
  UploadDirectApplication = 'uploadDirectApplication',
  ViewDirectApplication = 'viewDirectApplication',
  UpdateDirectApplication = 'updateDirectApplication',
  UploadEnrolments = 'uploadEnrolments',
  SearchCourseRuns = 'searchCourseRuns',
  ViewCourseRun = 'viewCourseRun',
  SearchAssessments = 'searchAssessments',
  ViewAssessment = 'viewAssessment',
  CancelEnrolment = 'cancelEnrolment',
  UpdateEnrolment = 'updateEnrolment',
  DeleteCourseRun = 'deleteCourseRun',
  UpdateEnrolmentFees = 'updateEnrolmentFees',
  CourseSessionAttendance = 'courseSessionAttendance',
  CourseSessions = 'courseSessions',
  AssignStudent = 'assignStudent',
  CheckAttendance = 'checkAttendance'
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
  courseFee?: number;
  taxPercent?: number;
  isLeaderboardEnabled?: boolean;
  topics: Topic[];
  assessments?: Assessment[];
  learners?: any[];
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
  assessmentRecordLink?: string;
  writtenAssessmentLink?: string;
  practicalPerformanceAssessmentLink?: string;
  writtenAssessmentPublished?: boolean;
  practicalAssessmentPublished?: boolean;
  certificate: string;
}

export interface LearningUnit {
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
  companyLogoUrl: string;
  companyName: string;
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
