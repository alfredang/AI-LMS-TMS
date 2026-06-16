import React, { useMemo } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import SearchPalette, { SearchPaletteItem } from '../SearchPalette';

type AdminItem = SearchPaletteItem & { page: AdminPage };

const ADMIN_ITEMS: AdminItem[] = [
  { id: AdminPage.Dashboard, page: AdminPage.Dashboard, label: 'Admin Dashboard', section: 'Admin' },
  { id: AdminPage.MasterList, page: AdminPage.MasterList, label: 'Master List', section: 'Class Management' },

  { id: AdminPage.RescheduleCancel, page: AdminPage.RescheduleCancel, label: 'Reschedule & Cancel', section: 'Class Management → Classes', keywords: ['reschedule', 'cancel', 'session', 'postpone'] },
  { id: AdminPage.OngoingClasses, page: AdminPage.OngoingClasses, label: 'Ongoing Classes', section: 'Class Management → Classes' },
  { id: AdminPage.UpcomingClasses, page: AdminPage.UpcomingClasses, label: 'Upcoming Classes', section: 'Class Management → Classes' },
  { id: AdminPage.CompletedClasses, page: AdminPage.CompletedClasses, label: 'Completed Classes', section: 'Class Management → Classes' },

  { id: AdminPage.AssignTrainer, page: AdminPage.AssignTrainer, label: 'Assign Trainer', section: 'Class Management → Trainers' },
  { id: AdminPage.ViewLearners, page: AdminPage.ViewLearners, label: 'View Learners', section: 'Class Management → Learners' },
  { id: AdminPage.AssignStudent, page: AdminPage.AssignStudent, label: 'Assign Learners', section: 'Class Management → Learners', keywords: ['students', 'enroll'] },
  { id: AdminPage.SearchPastLearners, page: AdminPage.SearchPastLearners, label: 'Search Past Learners', section: 'Class Management → Learners' },

  { id: AdminPage.ViewCourses, page: AdminPage.ViewCourses, label: 'View Courses', section: 'Class Management' },
  { id: AdminPage.ViewTrainers, page: AdminPage.ViewTrainers, label: 'View Trainers', section: 'Class Management' },
  { id: AdminPage.FundingValidity, page: AdminPage.FundingValidity, label: 'Funding Validity', section: 'Class Management' },

  { id: AdminPage.UploadDirectApplication, page: AdminPage.UploadDirectApplication, label: 'Upload Direct Application', section: 'TPG Management → Direct Application' },
  { id: AdminPage.ViewDirectApplication, page: AdminPage.ViewDirectApplication, label: 'View Direct Application', section: 'TPG Management → Direct Application' },
  { id: AdminPage.UpdateDirectApplication, page: AdminPage.UpdateDirectApplication, label: 'Update Direct Application', section: 'TPG Management → Direct Application' },
  { id: AdminPage.UploadCompanyApplication, page: AdminPage.UploadCompanyApplication, label: 'Upload Company Application', section: 'TPG Management → COMPANY APPLICATION', keywords: ['sponsorship', 'corporate'] },
  { id: AdminPage.ViewCompanyApplication, page: AdminPage.ViewCompanyApplication, label: 'View Company Application', section: 'TPG Management → COMPANY APPLICATION', keywords: ['sponsorship', 'corporate'] },

  { id: AdminPage.UpcomingEnrolment, page: AdminPage.UpcomingEnrolment, label: 'Upcoming Enrolment', section: 'TPG Management → Enrolment' },
  { id: AdminPage.NewEnrolment, page: AdminPage.NewEnrolment, label: 'New Enrolment', section: 'TPG Management → Enrolment' },

  { id: AdminPage.ViewClassByDate, page: AdminPage.ViewClassByDate, label: 'View Class By Date', section: 'TPG Management → Course Run' },
  { id: AdminPage.CreateNewClass, page: AdminPage.CreateNewClass, label: 'Create New Class', section: 'TPG Management → Course Run' },
  { id: AdminPage.SearchCourseRuns, page: AdminPage.SearchCourseRuns, label: 'Search Course Runs', section: 'TPG Management → Course Run' },
  { id: AdminPage.ViewCourseRun, page: AdminPage.ViewCourseRun, label: 'View Course Run', section: 'TPG Management → Course Run' },
  { id: AdminPage.EditCourseRun, page: AdminPage.EditCourseRun, label: 'Edit Course Run', section: 'TPG Management → Course Run' },
  { id: AdminPage.UploadCourseRuns, page: AdminPage.UploadCourseRuns, label: 'Upload Course Runs', section: 'TPG Management → Course Run' },
  { id: AdminPage.DeleteCourseRun, page: AdminPage.DeleteCourseRun, label: 'Delete Course Run', section: 'TPG Management → Course Run' },

  { id: AdminPage.AddSessions, page: AdminPage.AddSessions, label: 'Add Sessions', section: 'TPG Management → Session' },
  { id: AdminPage.CourseSessions, page: AdminPage.CourseSessions, label: 'Course Sessions', section: 'TPG Management → Session' },

  { id: AdminPage.EnrollLearners, page: AdminPage.EnrollLearners, label: 'Enroll Learners', section: 'TPG Management → Enrolment' },
  { id: AdminPage.UploadEnrolments, page: AdminPage.UploadEnrolments, label: 'Upload Enrolments', section: 'TPG Management → Enrolment' },
  { id: AdminPage.SearchEnrolment, page: AdminPage.SearchEnrolment, label: 'Search Enrolment', section: 'TPG Management → Enrolment' },
  { id: AdminPage.ViewEnrolment, page: AdminPage.ViewEnrolment, label: 'View Enrolment', section: 'TPG Management → Enrolment' },
  { id: AdminPage.UpdateEnrolment, page: AdminPage.UpdateEnrolment, label: 'Update Enrolment', section: 'TPG Management → Enrolment' },
  { id: AdminPage.CancelEnrolment, page: AdminPage.CancelEnrolment, label: 'Cancel Enrolment', section: 'TPG Management → Enrolment', keywords: ['unenrol', 'unenroll', 'remove', 'withdraw'] },
  { id: AdminPage.UpdateEnrolmentFees, page: AdminPage.UpdateEnrolmentFees, label: 'Update Enrolment Fees', section: 'TPG Management → Enrolment' },

  { id: AdminPage.CourseSessionAttendance, page: AdminPage.CourseSessionAttendance, label: 'Session Attendance', section: 'TPG Management → Attendance' },
  { id: AdminPage.CheckAttendance, page: AdminPage.CheckAttendance, label: 'Check Attendance', section: 'TPG Management → Attendance' },

  { id: AdminPage.SubmitAssessment, page: AdminPage.SubmitAssessment, label: 'Submit Assessment', section: 'TPG Management → Assessment' },
  { id: AdminPage.UpdateAssessment, page: AdminPage.UpdateAssessment, label: 'Update Assessment', section: 'TPG Management → Assessment' },
  { id: AdminPage.BulkUpdateAssessment, page: AdminPage.BulkUpdateAssessment, label: 'Bulk Update Assessment', section: 'TPG Management → Assessment' },
  { id: AdminPage.SearchAssessments, page: AdminPage.SearchAssessments, label: 'Search Assessments', section: 'TPG Management → Assessment' },
  { id: AdminPage.ViewAssessment, page: AdminPage.ViewAssessment, label: 'View Assessment', section: 'TPG Management → Assessment' },

  { id: AdminPage.GrantCalculator, page: AdminPage.GrantCalculator, label: 'Grant Calculator', section: 'TPG Management → Grant' },
  { id: AdminPage.SearchGrant, page: AdminPage.SearchGrant, label: 'Search Grant', section: 'TPG Management → Grant' },
  { id: AdminPage.ViewGrantStatus, page: AdminPage.ViewGrantStatus, label: 'View Grant Status', section: 'TPG Management → Grant' },

  { id: AdminPage.Calendar, page: AdminPage.Calendar, label: 'View Calendar', section: 'Tools' },
  { id: AdminPage.Scheduler, page: AdminPage.Scheduler, label: 'Task Scheduler', section: 'Tools' },
  { id: AdminPage.SchedulerSummary, page: AdminPage.SchedulerSummary, label: 'Schedule Summary', section: 'Tools' },

  { id: AdminPage.CreateCertificate, page: AdminPage.CreateCertificate, label: 'Create Certificate', section: 'Certificates' },
  { id: AdminPage.DeleteCertificate, page: AdminPage.DeleteCertificate, label: 'Delete Certificate', section: 'Certificates' },
  { id: AdminPage.SendCertificateSG, page: AdminPage.SendCertificateSG, label: 'Send Certificate (SG)', section: 'Certificates' },
  { id: AdminPage.SendCertificateGH, page: AdminPage.SendCertificateGH, label: 'Send Certificate (GH)', section: 'Certificates' },

  { id: AdminPage.SupportTickets, page: AdminPage.SupportTickets, label: 'View All Tickets', section: 'Support' },
];

interface AdminSearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdminSearchPalette: React.FC<AdminSearchPaletteProps> = ({ isOpen, onClose }) => {
  const { handleNavigation, setAdminPage } = useLms();
  const items = useMemo(() => ADMIN_ITEMS, []);

  return (
    <SearchPalette
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      placeholder="Search functions, e.g. cancel enrolment"
      onSelect={(item) => {
        handleNavigation(View.Admin);
        setAdminPage((item as AdminItem).page);
      }}
    />
  );
};

export default AdminSearchPalette;
