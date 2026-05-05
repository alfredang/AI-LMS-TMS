// Minimal types needed for AdminLayout - extracted from types_ref.ts

export enum View {
  Dashboard = 'dashboard',
  Courses = 'courses',
  Calendar = 'calendar',
  JobSearch = 'jobSearch',
  Create = 'create',
  Admin = 'admin',
  Profile = 'profile',
  HelpAndSupport = 'helpAndSupport'
}

export enum UserRole {
  Learner = 'learner',
  Trainer = 'trainer',
  Developer = 'developer',
  Admin = 'admin',
  Finance = 'finance',
  Payroll = 'payroll',
  TrainingProvider = 'trainingProvider'
}

// Admin-specific types for profile
export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  loginId: string;
  profilePictureUrl?: string;
  tel?: string;
  adminLevel?: string;
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
}