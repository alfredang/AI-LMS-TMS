// User role types
export enum UserRole {
  Learner = 'Learner',
  Trainer = 'Trainer',
  Admin = 'Admin',
  Developer = 'Developer',
  TrainingProvider = 'Training Provider',
}

// Enums for form options
export enum Gender {
    Male = 'Male',
    Female = 'Female',
    Other = 'Prefer not to say',
}

export enum EmploymentStatus {
    Employed = 'Employed',
    Unemployed = 'Unemployed',
    LookingForJob = 'Looking for Job',
}

export enum Nationality {
    Singaporean = 'Singaporean',
    SingaporePR = 'Singapore PR',
    NonCitizen = 'Non Citizen',
}

export enum Ethnicity {
    Chinese = 'Chinese',
    Malay = 'Malay',
    Indian = 'Indian',
    Others = 'Others',
}

export enum TrainerType {
    ACLP = 'ACLP',
    NonACLP = 'non-ACLP',
    DACE = 'DACE',
}

export enum CourseSponsorship {
    SelfSponsored = 'Self-Sponsored',
    EmployerSponsored = 'Employer-Sponsored',
    NA = 'N/A',
}

export enum DeveloperType {
    DACE = 'DACE',
    DDDPL = 'DDDPL',
    NA = 'N/A',
}

export enum TrainerStatus {
    Active = 'Active',
    Inactive = 'Inactive',
}

// Skills Future Industries
export const SKILLS_FUTURE_INDUSTRIES = [
    'Advanced Manufacturing', 'Aerospace', 'Air Transport', 'Biopharmaceuticals Manufacturing', 
    'Built Environment', 'Bus', 'Design', 'Early Childhood', 'Electronics', 'Energy and Power', 
    'Environmental Services', 'Financial Services', 'Food Manufacturing', 'Food Services', 'Healthcare', 
    'Hotel and Accommodation Services', 'Human Resource', 'Infocomm Technology', 'Intellectual Property', 
    'Land Transport', 'Landscape', 'Legal', 'Logistics', 'Marine and Offshore', 'Media', 'MICE', 
    'Precision Engineering', 'Private Education', 'Process Construction and Maintenance', 'Public Transport (Rail)', 
    'Retail', 'Sea Transport', 'Security', 'Social Service', 'Tourism', 'Training and Adult Education', 
    'Waste Management', 'Water', 'Wholesale Trade'
];

// Trainer Qualification options
export enum TrainerQualification {
    ACLP = 'ACLP',
    DACE = 'DACE',
}

// Trainer Education options  
export enum TrainerEducation {
    Diploma = 'Diploma',
    Degree = 'Degree',
    Master = 'Master',
    PhD = 'PhD',
}

// Developer Education options  
export enum DeveloperEducation {
    Diploma = 'Diploma',
    Degree = 'Degree',
    Master = 'Master',
    PhD = 'PhD',
}

// Utility function to calculate age group
export const calculateAgeGroup = (dob: string): string => {
  const today = new Date();
  const birthDate = new Date(dob);
  const age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    return (age - 1).toString();
  }
  
  return age.toString();
};

// Base interfaces
export interface BaseProfile {
  id: string;
  name: string;
  email: string;
  loginId: string;
  profilePictureUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContactInfo {
  tel?: string;
}

export interface PersonalInfo {
  gender?: Gender;
  dob?: string;
  nationality?: Nationality;
  ethnicity?: Ethnicity;
}

export interface WorkExperienceItem {
  id?: string;
  jobTitle: string;
  company: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface Certification {
  id?: string;
  name: string;
  fileUrl: string;
  originalFilename?: string;
}

export interface Education {
  id: string;
  level: string;
  institution: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
}

export interface Qualification {
  id: string;
  name: string;
  issuingOrganization: string;
  issueDate: string;
  expiryDate?: string;
  credentialId?: string;
  credentialUrl?: string;
}

// Specific profile interfaces
export interface LearnerProfile extends BaseProfile, ContactInfo, PersonalInfo {
  nric?: string;
  company?: string;
  employmentStatus?: EmploymentStatus;
  employment_status?: string
  password?: string;
  pro_formal_url?: string;
  invoice_url?: string;
  receipt_url?: string;
  secondaryEmail?: string;
}

export interface TrainerProfile extends BaseProfile, ContactInfo, PersonalInfo {
  trainerType?: TrainerType;
  status?: TrainerStatus;
  linkedinUrl?: string;
  cvUrl?: string;
  cvOriginalFilename?: string;
  areasOfExpertise?: string[];
  workExperience?: WorkExperienceItem[];
  certifications?: Certification[];
  qualifications?: string[]; // Array of qualification strings
  education?: string; // Single education string (highest education)
  password?: string;
  commonName?: string;
  country?: string;
  cnPlusEmail?: string;
  nric?: string;
  secondaryEmail?: string;
}

export interface DeveloperProfile extends BaseProfile, ContactInfo, PersonalInfo {
  developerType?: DeveloperType;
  githubUrl?: string;
  linkedinUrl?: string;
  password?: string;
  cvUrl?: string;
  cvOriginalFilename?: string;
  bio?: string;
  areasOfSpecialty?: string[];
  workExperience?: WorkExperienceItem[];
  certifications?: Certification[];
  qualifications?: string[]; // Array of qualification strings to match backend
  education?: string; // Single education string (highest education) using DeveloperEducation enum values
  nric?: string;
  secondaryEmail?: string;
}

export interface AdminProfile extends BaseProfile, ContactInfo {
  adminLevel?: string;
  permissions?: string[];
  password?: string;
}

// API Key with model selection
export interface ApiKeyWithModel {
  value: string;
  selectedModel?: string;
}

export interface TrainingProviderProfile extends BaseProfile {
  password?: string;
  companyName: string;
  companyShortname: string;
  uen: string;
  companyAddress: string;
  companyEmail: string;
  companyTel: string;
  companyWebsite: string;
  companyLogoUrl?: string;
  loginId: string;
  contactPerson: {
    name: string;
    email: string;
    tel: string;
  };
  apiKeys: Record<string, string>;
  apiKeyModels?: Record<string, string>; // Maps API key name to selected model
  invoiceTemplateUrl?: string;
  receiptTemplateUrl?: string;
  certificateTemplateUrl?: string;
  proFormaInvoiceTemplateUrl?: string;
  ssgCertFile?: string;
  ssgPrivateKeyFile?: string;
  ssgEncryptionKey?: string;
  ssgApp1CertFile?: string;
  ssgApp1PrivateKeyFile?: string;
  ssgApp1EncryptionKey?: string;
  ssgApp3CertFile?: string;
  ssgApp3PrivateKeyFile?: string;
  ssgApp3EncryptionKey?: string;
  ssgApp4ClientId?: string;
  ssgApp4ClientSecret?: string;
  ssgDefaultApp?: string;
  integrations: {
    syncGoogleCalendar: boolean;
    googleCalendarUrl?: string;
    googleDrive: boolean;
    microsoftOneDrive: boolean;
    emailUser?: string;
    googleClientId?: string;
    googleClientSecret?: string;
    googleRefreshToken?: string;
    googleSlidesTemplateId?: string;
    trainerProfileImageUrl?: string;
    certificateFolderUrl?: string;
    masterListUrl?: string;
    tertiaryTmsUrl?: string;
    tertiaryFmsUrl?: string;
    tertiaryMmsUrl?: string;
    tertiaryTpmsUrl?: string;
    n8nHost1Url?: string;
    n8nHost2Url?: string;
    magentoBackendUrl?: string;
    openClawMode?: 'live' | 'local';
    openClawGatewayUrl?: string;
    openClawLocalGatewayUrl?: string;
    openClawHooksPath?: string;
    openClawAgentId?: string;
    openClawCallbackUrl?: string;
  };
  adminSettings: {
    autoSendProFormaInvoice: boolean;
    autoSendConfirmationEmail: boolean;
    autoSendInvoiceOnGrantSuccess: boolean;
    autoSendReceiptOnPayment: boolean;
    autoSendCertificateOnCompletion: boolean;
    autoSendThankYouEmail: boolean;
    autoEnrolDirectApplications: boolean;
    autoGenerateQbInvoice: boolean;
    upcomingClassesThresholdDays: number;
  };
  securitySettings: {
    autoMaskSensitiveData: boolean;
    sanitiseAfterMonths: number;
    autoDeleteAfter6Months: boolean;
    enableOtpLogin: boolean;
    enableDefaultOtp: boolean;
    defaultOtpValue?: string;
    forceFirstPasswordChange: boolean;
    defaultPassword?: string;
  };
  gamingSettings: {
    enableLeaderboard: boolean;
    enablePoints: boolean;
  };
  fundingSettings: {
    normalFunding: 50 | 70;
    enhancedFunding: number;
    gstRate: number;
    isGstRegistered: boolean;
  };
  colorScheme?: string; // Stored as text/hex color in database
}

// Union type for all profiles
export type UserProfile = 
  | LearnerProfile 
  | TrainerProfile 
  | DeveloperProfile 
  | AdminProfile 
  | TrainingProviderProfile;
