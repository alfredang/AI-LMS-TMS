import React, { useMemo } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import SearchPalette, { SearchPaletteItem } from '../SearchPalette';

type TpItem = SearchPaletteItem & {
  view: View;
  adminPage?: AdminPage;
};

const TP_ITEMS: TpItem[] = [
  // Main
  { id: 'training-dashboard', label: 'Training Dashboard', section: 'Main', view: View.Dashboard },
  { id: 'course-management', label: 'Course Management', section: 'Main', view: View.Courses, keywords: ['courses'] },
  { id: 'user-management', label: 'User Management', section: 'Main', view: View.UserManagement, keywords: ['users'] },
  { id: 'role-management', label: 'Role Management', section: 'Main', view: View.AdminManagement, keywords: ['admin', 'roles'] },
  { id: 'finance-management', label: 'Finance Management', section: 'Main', view: View.FinanceManagement },
  { id: 'company-setting', label: 'Company Setting', section: 'Main', view: View.Profile, keywords: ['profile', 'settings', 'admin setting', 'gst', 'funding', 'api keys'] },

  // Integrations
  { id: 'ssg-api-summary', label: 'SSG API Summary', section: 'Integrations', view: View.SsgApiSummary },
  { id: 'api-endpoints', label: 'API Endpoints', section: 'Integrations', view: View.ApiEndpoints },
  { id: 'webhooks', label: 'Webhooks', section: 'Integrations', view: View.Webhooks },

  // Cron Jobs
  { id: 'task-scheduler', label: 'Task Scheduler', section: 'Cron Jobs', view: View.Scheduler, keywords: ['cron', 'jobs', 'tasks'] },
  { id: 'schedule-summary', label: 'Schedule Summary', section: 'Cron Jobs', view: View.SchedulerSummary },

  // Logs (rendered inside the Scheduler view via adminPage)
  { id: 'log-automation', label: 'Auto Create Learner Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.AutomationLogs },
  { id: 'log-trainer-folder', label: 'Auto Create Assessment Records Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.TrainerFolderLogs },
  { id: 'log-auto-cert', label: 'Auto Create Certificates Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.AutoCreateCertificatesLog },
  { id: 'log-run-date-sync', label: 'Course Run Date Sync Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.CourseRunDateSyncLogs },
  { id: 'log-upcoming-runs', label: 'TGS Enrolments & Assign Trainers Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.UpcomingCourseRunsLog },
  { id: 'log-sync-trainer-tpg', label: 'Sync Trainer to TPG Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.SyncTrainerTpgLogs },
  { id: 'log-trainer-invite', label: 'Auto Send Trainer Invitation Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.AutoSendTrainerInvitationLog },
  { id: 'log-courseware-attendance', label: 'Auto Send Courseware & Attendance Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.AutoSendCoursewareAttendanceLog },
  { id: 'log-course-completion', label: 'Auto Send Course Completion Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.AutoSendCourseCompletionLog },
  { id: 'log-sanitise', label: 'Auto Sanitise Data Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.AutoSanitiseDataLog },
  { id: 'log-course-confirm-email', label: 'Course Confirmation Email Log', section: 'Logs', view: View.Scheduler, adminPage: AdminPage.CourseConfirmationEmailLogs },

  // Email Templates
  { id: 'email-otp', label: 'OTP Email', section: 'Email Templates', view: View.OtpEmailTemplate },
  { id: 'email-certificate', label: 'Certificate Email', section: 'Email Templates', view: View.CertificateEmailTemplate },
  { id: 'email-feedback', label: 'Feedback Email', section: 'Email Templates', view: View.FeedbackEmailTemplate },
  { id: 'email-password-reset', label: 'Password Reset Email', section: 'Email Templates', view: View.PasswordResetEmailTemplate },
  { id: 'briefing-on-assessment', label: 'Briefing on Assessment', section: 'Email Templates', view: View.BriefingOnAssessmentTemplate },
  { id: 'email-trainer-invite', label: 'Trainer Invitation Email', section: 'Email Templates', view: View.TrainerInvitationEmailTemplate },
  { id: 'email-trainer-response', label: 'Trainer Accept/Decline Email', section: 'Email Templates', view: View.TrainerResponseEmailTemplates },
  { id: 'email-final-confirm', label: 'Final Class Confirm Email', section: 'Email Templates', view: View.FinalCourseConfirmationEmailTemplate },
  { id: 'email-class-confirm', label: 'Class Confirm Email', section: 'Email Templates', view: View.CourseConfirmationEmailTemplate },
  { id: 'email-courseware', label: 'Courseware and Attendance Taking', section: 'Email Templates', view: View.CoursewareAttendanceEmailTemplate },
  { id: 'email-completion', label: 'Course Completion and Thank You', section: 'Email Templates', view: View.CourseCompletionEmailTemplate },
  { id: 'email-proforma', label: 'Proforma Invoice Email', section: 'Email Templates', view: View.ProformaInvoiceEmailTemplate },

  // Policies
  { id: 'privacy-policy', label: 'Privacy Policy', section: 'Policies', view: View.PrivacyPolicy },
  { id: 'acceptable-use-policy', label: 'Acceptable Use Policy', section: 'Policies', view: View.AcceptableUsePolicy },

  // Workflow Guides
  { id: 'workflow-guides', label: 'Workflow Guides', section: 'Workflows', view: View.WorkflowGuides, keywords: ['guides'] },
];

interface TrainingProviderSearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const TrainingProviderSearchPalette: React.FC<TrainingProviderSearchPaletteProps> = ({ isOpen, onClose }) => {
  const { handleNavigation, setAdminPage } = useLms();
  const items = useMemo(() => TP_ITEMS, []);

  return (
    <SearchPalette
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      placeholder="Search functions, e.g. company setting"
      onSelect={(item) => {
        const tp = item as TpItem;
        if (tp.adminPage) setAdminPage(tp.adminPage);
        handleNavigation(tp.view);
      }}
    />
  );
};

export default TrainingProviderSearchPalette;
