import React, { useMemo } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types';
import SearchPalette, { SearchPaletteItem } from '../SearchPalette';

const FINANCE_ITEMS: SearchPaletteItem[] = [
  { id: 'dashboard', label: 'Financial Dashboard', section: 'Finance' },
  { id: 'allCourseRuns', label: 'Consolidated Finance Data', section: 'Finance' },

  // FMS (n8n)
  { id: 'autoProcessEnrolments', label: 'Process Enrolments', section: 'FMS (n8n)' },
  { id: 'autoManualEnrolment', label: 'Manual Enrolment', section: 'FMS (n8n)' },
  { id: 'autoCreateEnrolmentsErrorStatus', label: 'Create Enrolments For Error Status', section: 'FMS (n8n)' },
  { id: 'autoCreateEmployerEnrolment', label: 'Create Employer Enrolment', section: 'FMS (n8n)' },
  { id: 'autoAppendCancelledClassTrainees', label: 'Append Cancelled Class Trainees', section: 'FMS (n8n)' },
  { id: 'autoUpdateAssessment', label: 'Update Assessment (n8n)', section: 'FMS (n8n)' },
  { id: 'autoProcessGrants', label: 'Process Grants', section: 'FMS (n8n)' },
  { id: 'autoUpdateGrantStatusTotal', label: 'Update Grant Status & Total Grant', section: 'FMS (n8n)' },
  { id: 'autoGrantQuery', label: 'For Grant Query', section: 'FMS (n8n)' },
  { id: 'autoDirectApplication', label: 'For Direct Application', section: 'FMS (n8n)' },
  { id: 'autoCheckDuplicatesDA', label: 'Check Duplicates for DA', section: 'FMS (n8n)' },
  { id: 'autoUpdateClaimIdAllCourseRun', label: 'Update Claim ID In All Course Run', section: 'FMS (n8n)' },

  // TPG Management — Course Run
  { id: 'tpgCreateClass', label: 'Create New Class', section: 'TPG Management → Course Run' },
  { id: 'tpgSearchCourseRuns', label: 'Search Course Runs', section: 'TPG Management → Course Run' },
  { id: 'tpgViewCourseRun', label: 'View Course Run', section: 'TPG Management → Course Run' },
  { id: 'tpgEditCourseRun', label: 'Edit Course Run', section: 'TPG Management → Course Run' },
  { id: 'tpgUploadCourseRuns', label: 'Upload Course Runs', section: 'TPG Management → Course Run' },
  { id: 'tpgDeleteCourseRun', label: 'Delete Course Run', section: 'TPG Management → Course Run' },

  // TPG Management — Session
  { id: 'tpgAddSessions', label: 'Add Sessions', section: 'TPG Management → Session' },
  { id: 'tpgSessionTiming', label: 'Session Timing', section: 'TPG Management → Session' },
  { id: 'tpgCourseSessions', label: 'Course Sessions', section: 'TPG Management → Session' },

  // TPG Management — Enrolment
  { id: 'tpgEnrollLearners', label: 'Enroll Learners', section: 'TPG Management → Enrolment' },
  { id: 'tpgUploadEnrolments', label: 'Upload Enrolments', section: 'TPG Management → Enrolment' },
  { id: 'tpgSearchEnrolment', label: 'Search Enrolment', section: 'TPG Management → Enrolment' },
  { id: 'tpgViewEnrolment', label: 'View Enrolment', section: 'TPG Management → Enrolment' },
  { id: 'tpgUpdateEnrolment', label: 'Update Enrolment', section: 'TPG Management → Enrolment' },
  { id: 'tpgCancelEnrolment', label: 'Cancel Enrolment', section: 'TPG Management → Enrolment', keywords: ['unenrol', 'unenroll', 'withdraw', 'remove'] },
  { id: 'tpgUpdateEnrolmentFees', label: 'Update Enrolment Fees', section: 'TPG Management → Enrolment' },

  // TPG Management — Attendance
  { id: 'tpgSessionAttendance', label: 'Session Attendance', section: 'TPG Management → Attendance' },
  { id: 'tpgCheckAttendance', label: 'Check Attendance', section: 'TPG Management → Attendance' },

  // TPG Management — Assessment
  { id: 'tpgSubmitAssessment', label: 'Submit Assessment', section: 'TPG Management → Assessment' },
  { id: 'tpgUpdateAssessment', label: 'Update Assessment', section: 'TPG Management → Assessment' },
  { id: 'tpgSearchAssessments', label: 'Search Assessments', section: 'TPG Management → Assessment' },
  { id: 'tpgViewAssessment', label: 'View Assessment', section: 'TPG Management → Assessment' },

  // TPG Management — Grant
  { id: 'grantCalculator', label: 'Grant Calculator', section: 'TPG Management → Grant' },
  { id: 'tpgSearchGrant', label: 'Search Grant', section: 'TPG Management → Grant' },
  { id: 'tpgViewGrantStatus', label: 'View Grant Status', section: 'TPG Management → Grant' },

  // Claim Management
  { id: 'claimCheck', label: 'Check / Add Claim', section: 'Claim Management → Claim' },
  { id: 'viewClaim', label: 'View Claim', section: 'Claim Management → Claim' },
  { id: 'cancelClaim', label: 'Cancel Claim', section: 'Claim Management → Claim' },
  { id: 'uploadDocument', label: 'Supporting Document', section: 'Claim Management → Claim' },
  { id: 'grantImport', label: 'Bulk Grant Payment Sync', section: 'Claim Management → Grant Payment' },
  { id: 'sfcPaymentSync', label: 'SFC Payment Sync', section: 'Claim Management → Grant Payment' },
  { id: 'proformaInvoice', label: 'ProForma Invoice', section: 'Claim Management → Invoices' },
  { id: 'taxInvoice', label: 'Tax Invoice', section: 'Claim Management → Invoices' },
  { id: 'receipt', label: 'Receipt', section: 'Claim Management → Invoices' },

  // Quickbooks
  { id: 'qbCustomer', label: 'Customers', section: 'Quickbooks' },
  { id: 'qbEstimate', label: 'Quotes (Estimates)', section: 'Quickbooks' },
  { id: 'qbInvoice', label: 'Invoices', section: 'Quickbooks' },
  { id: 'qbPayment', label: 'Payments', section: 'Quickbooks' },

  // Bizfile
  { id: 'bizfile', label: 'Business Profile', section: 'Bizfile' },
  { id: 'bizfileDirectorySearch', label: 'Entity Directory Search', section: 'Bizfile' },
  { id: 'bizfileNameSearch', label: 'Entity Name Search', section: 'Bizfile' },
  { id: 'bizfileVerification', label: 'Entity Verification', section: 'Bizfile' },
  { id: 'bizfileKeyDates', label: 'Entity Reg Key Dates', section: 'Bizfile' },
  { id: 'bizfileAddress', label: 'Entity Reg Address', section: 'Bizfile' },
  { id: 'bizfileSsic', label: 'Entity SSIC', section: 'Bizfile' },
  { id: 'bizfileCapital', label: 'Company Capital', section: 'Bizfile' },
  { id: 'bizfileShareholders', label: 'Company Shareholders', section: 'Bizfile' },
];

interface FinanceSearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const FinanceSearchPalette: React.FC<FinanceSearchPaletteProps> = ({ isOpen, onClose }) => {
  const { handleNavigation, setFinancePage } = useLms();
  const items = useMemo(() => FINANCE_ITEMS, []);

  return (
    <SearchPalette
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      placeholder="Search functions, e.g. cancel claim"
      onSelect={(item) => {
        handleNavigation(View.Finance);
        setFinancePage(item.id);
      }}
    />
  );
};

export default FinanceSearchPalette;
