import React, { useState, useEffect } from 'react';
import { useAppVersion } from '@hooks/useAppVersion';
import Header from '../components/Header';
import Footer from '../components/Footer';
import AiChatbot from '../components/AiChatbot';
import { Icon, IconName } from '../components/ui/Icon';
import { Card } from '../components/ui/Card';
import FinanceManagementView from '../components/training-provider/FinanceManagementView';
import WorkflowGuidesView from '../components/training-provider/WorkflowGuidesView';
import HelpAndSupportView from '../components/HelpAndSupportView';
import AllCourseRunsView from '../components/finance/AllCourseRunsView';
import {
  SearchGrantView,
  ViewGrantStatusView,
  SubmitAssessmentView,
  UpdateAssessmentView,
  UploadCourseRunsView,
  SearchCourseRunsView,
  SearchEnrolmentView,
  ViewEnrolmentView,
  ViewCourseRunView,
  SearchAssessmentsView,
  ViewAssessmentView,
  CancelEnrolmentView,
  UpdateEnrolmentView,
  DeleteCourseRunView,
  UpdateEnrolmentFeesView,
  CourseSessionAttendanceView,
  CourseSessionsView,
} from '../components/admin/GrantManagementViews';
import { CreateNewClassView } from '../components/admin/CreateNewClassView';
import EditCourseRunView from '../components/admin/EditCourseRunView';
import AddSessionsView from '../components/admin/AddSessionsView';
import CourseSessionTimingView from '../components/admin/CourseSessionTimingView';
import EnrollLearners from '../components/admin/EnrollLearners';
import { BulkUploadEnrolmentView } from '../components/admin/BulkEnrolmentViews';
import TrainerAttendanceDashboard from '../components/trainer/TrainerAttendanceDashboard';

import ClaimCheckView from '../components/training-provider/ClaimCheckView';
import GrantCalculatorView from '../components/finance/GrantCalculatorView';
import ViewClaimView from '../components/finance/ViewClaimView';
import CancelClaimView from '../components/finance/CancelClaimView';
import UploadDocumentView from '../components/finance/UploadDocumentView';
import ProcessGrantsView from '../components/finance/automation/ProcessGrantsView';
import SimpleWebhookActionView from '../components/finance/automation/SimpleWebhookActionView';
import SsgAppSelector from '../components/finance/SsgAppSelector';
import BizfileView from '../components/finance/BizfileView';
import BizfileDirectorySearchView from '../components/finance/BizfileDirectorySearchView';
import BizfileNameSearchView from '../components/finance/BizfileNameSearchView';
import BizfileVerificationView from '../components/finance/BizfileVerificationView';
import BizfileKeyDatesView from '../components/finance/BizfileKeyDatesView';
import BizfileAddressView from '../components/finance/BizfileAddressView';
import BizfileSsicView from '../components/finance/BizfileSsicView';
import BizfileCapitalView from '../components/finance/BizfileCapitalView';
import BizfileShareholdersView from '../components/finance/BizfileShareholdersView';
import QBCustomerView from '../components/finance/QBCustomerView';
import QBEstimateView from '../components/finance/QBEstimateView';
import QBInvoiceView from '../components/finance/QBInvoiceView';
import QBPaymentView from '../components/finance/QBPaymentView';
import ProFormaInvoiceView from '../components/finance/ProFormaInvoiceView';

import { ProfilePage } from '../components/ProfilePage';
import { useLms } from '@contexts/LmsContext';
import { View } from '@app-types/index';

type FinancePage =
  | 'dashboard' | 'allCourseRuns'
  | 'grantCalculator' | 'searchGrant' | 'viewGrant'
  | 'claimManagement' | 'claimCheck' | 'viewClaim' | 'cancelClaim' | 'uploadDocument'
  | 'proformaInvoice' | 'taxInvoice' | 'receipt'
  // Finance automation (migrated from Google Sheets "Start Processing")
  | 'autoProcessEnrolments' | 'autoManualEnrolment' | 'autoCreateEnrolmentsErrorStatus' | 'autoCreateEmployerEnrolment' | 'autoAppendCancelledClassTrainees'
  | 'autoUpdateAssessment'
  | 'autoProcessGrants' | 'autoUpdateGrantStatusTotal' | 'autoGrantQuery' | 'autoDirectApplication' | 'autoCheckDuplicatesDA'
  | 'autoUpdateClaimIdAllCourseRun'
  | 'bizfile' | 'bizfileDirectorySearch' | 'bizfileNameSearch'
  | 'bizfileVerification' | 'bizfileKeyDates' | 'bizfileAddress' | 'bizfileSsic' | 'bizfileCapital' | 'bizfileShareholders'
  | 'qbCustomer' | 'qbEstimate' | 'qbInvoice' | 'qbPayment'
  // TPG Management
  | 'tpgManagement' | 'tpgCourseRun' | 'tpgSession' | 'tpgEnrolment' | 'tpgAttendance' | 'tpgAssessment' | 'tpgGrant'
  | 'tpgCreateClass' | 'tpgSearchCourseRuns' | 'tpgViewCourseRun' | 'tpgEditCourseRun' | 'tpgUploadCourseRuns' | 'tpgDeleteCourseRun'
  | 'tpgAddSessions' | 'tpgSessionTiming' | 'tpgCourseSessions'
  | 'tpgEnrollLearners' | 'tpgUploadEnrolments' | 'tpgSearchEnrolment' | 'tpgViewEnrolment' | 'tpgUpdateEnrolment' | 'tpgCancelEnrolment' | 'tpgUpdateEnrolmentFees'
  | 'tpgSessionAttendance' | 'tpgCheckAttendance'
  | 'tpgSubmitAssessment' | 'tpgUpdateAssessment' | 'tpgSearchAssessments' | 'tpgViewAssessment'
  | 'tpgSearchGrant' | 'tpgViewGrantStatus'
  | 'workflowGuides';

const FinanceLayout: React.FC = () => {
  const { currentView, financePage: ctxFinancePage, setFinancePage: ctxSetFinancePage } = useLms();
  const appVersion = useAppVersion();
  const page = ctxFinancePage as FinancePage;
  const setPage = (p: FinancePage) => ctxSetFinancePage(p);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    courseRunAutomations: true,
    claimManagement: true,
    tpgManagement: false,
    tpgCourseRun: false,
    tpgSession: false,
    tpgEnrolment: false,
    tpgAttendance: false,
    tpgAssessment: false,
    tpgGrant: false,
    bizfile: false,
    quickbooks: false,
    workflowGuides: false,
    wfTraining: false,
    wfAdmin: false,
    wfFinance: false,
    usefulLinks: false,
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Auto-open sections when navigating from header
  useEffect(() => {
    if (page.startsWith('tpg')) {
      setOpenSections(prev => ({ ...prev, tpgManagement: true }));
    }
    if (page.startsWith('auto') || page === 'allCourseRuns') {
      setOpenSections(prev => ({ ...prev, courseRunAutomations: true }));
    }
    if (['claimCheck', 'viewClaim', 'cancelClaim', 'uploadDocument'].includes(page)) {
      setOpenSections(prev => ({ ...prev, claimManagement: true, claimSub: true }));
    }
    if (['proformaInvoice', 'taxInvoice', 'receipt'].includes(page)) {
      setOpenSections(prev => ({ ...prev, claimManagement: true, invoiceSub: true }));
    }
  }, [page]);

  const navigateTo = (p: FinancePage) => {
    setPage(p);
  };

  const renderContent = () => {
    switch (page) {
      case 'allCourseRuns':
        return <AllCourseRunsView />;
      // Finance automation pages
      case 'autoProcessEnrolments':
        return (
          <SimpleWebhookActionView
            title="Process Enrolments"
            description="Run the enrolment processing automation (legacy sheet workflow migrated to n8n)."
            actionId="process-enrolment-grants-backup"
          />
        );
      case 'autoManualEnrolment':
        return (
          <SimpleWebhookActionView
            title="Manual Enrolment"
            description="Trigger the manual enrolment automation workflow in n8n."
            actionId="manual-enrolment"
          />
        );
      case 'autoCreateEnrolmentsErrorStatus':
        return (
          <SimpleWebhookActionView
            title="Create Enrolments For Error Status"
            description="Trigger the n8n workflow that creates enrolments for error-status records."
            actionId="create-enrolments-error-status"
          />
        );
      case 'autoCreateEmployerEnrolment':
        return (
          <SimpleWebhookActionView
            title="Create Employer Enrolment"
            description="Trigger the employer/company-sponsored enrolment workflow in n8n."
            actionId="company-sponsored-enrolment"
          />
        );
      case 'autoAppendCancelledClassTrainees':
        return (
          <SimpleWebhookActionView
            title="Append Cancelled Class Trainees"
            description="Trigger the workflow that appends cancelled class trainees data (enrolment & invoice related)."
            actionId="append-cancelled-class-trainees"
          />
        );
      case 'autoUpdateAssessment':
        return (
          <SimpleWebhookActionView
            title="Update Assessment"
            description="Trigger the assessment update/sync workflow (legacy sheet automation)."
            actionId="update-assessment"
          />
        );
      case 'autoProcessGrants':
        return <ProcessGrantsView />;
      case 'autoUpdateGrantStatusTotal':
        return (
          <SimpleWebhookActionView
            title="Update Grant Status & Total Grant"
            description="Trigger the workflow that recalculates and updates grant status and totals."
            actionId="update-grant-status-total"
          />
        );
      case 'autoGrantQuery':
        return (
          <SimpleWebhookActionView
            title="For Grant Query"
            description="Trigger the workflow used for grant query follow-ups."
            actionId="grant-query"
          />
        );
      case 'autoDirectApplication':
        return (
          <SimpleWebhookActionView
            title="For Direct Application"
            description="Trigger the direct application enrolment workflow."
            actionId="direct-application-enrolment"
          />
        );
      case 'autoCheckDuplicatesDA':
        return (
          <SimpleWebhookActionView
            title="Check Duplicates for DA"
            description="Trigger the direct application duplicate check workflow."
            actionId="check-duplicates-da"
          />
        );
      case 'autoUpdateClaimIdAllCourseRun':
        return (
          <SimpleWebhookActionView
            title="Update Claim ID In All Course Run"
            description="Trigger the workflow that updates claim IDs across course runs."
            actionId="update-claim-id-all-course-run"
          />
        );
      case 'grantCalculator':
        return <GrantCalculatorView />;
      case 'searchGrant':
        return <SearchGrantView />;
      case 'viewGrant':
        return <ViewGrantStatusView />;
      case 'claimManagement': return (
        <div>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Claim Management</h2>

          {/* Claim */}
          <h3 className="text-xl font-semibold mb-4 dark:text-white">Claim</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[
              { key: 'claimCheck', label: 'Check / Add Claim', icon: IconName.ClipboardCheck, description: 'Check existing claims and add new ones' },
              { key: 'viewClaim', label: 'View Claim', icon: IconName.InfoCircle, description: 'View claim details and status' },
              { key: 'cancelClaim', label: 'Cancel Claim', icon: IconName.Close, description: 'Cancel an existing claim' },
              { key: 'uploadDocument', label: 'Supporting Document', icon: IconName.Upload, description: 'Upload supporting documents' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>

          {/* Invoices */}
          <h3 className="text-xl font-semibold mb-4 dark:text-white">Invoices</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'proformaInvoice', label: 'ProForma Invoice', icon: IconName.FileText, description: 'Generate and manage pro forma invoices' },
              { key: 'taxInvoice', label: 'Tax Invoice', icon: IconName.DollarSign, description: 'Generate and manage tax invoices' },
              { key: 'receipt', label: 'Receipt', icon: IconName.ClipboardCheck, description: 'Generate and manage payment receipts' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'claimCheck':
        return <ClaimCheckView />;
      case 'viewClaim':
        return <ViewClaimView />;
      case 'cancelClaim':
        return <CancelClaimView />;
      case 'uploadDocument':
        return <UploadDocumentView />;
      case 'proformaInvoice':
        return <ProFormaInvoiceView />;
      case 'taxInvoice':
        return (
          <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Tax Invoice</h2>
            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-300">Tax Invoice management coming soon.</p>
            </Card>
          </div>
        );
      case 'receipt':
        return (
          <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Receipt</h2>
            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-300">Receipt management coming soon.</p>
            </Card>
          </div>
        );
      case 'bizfile':
        return <BizfileView />;
      case 'bizfileDirectorySearch':
        return <BizfileDirectorySearchView />;
      case 'bizfileNameSearch':
        return <BizfileNameSearchView />;
      case 'bizfileVerification':
        return <BizfileVerificationView />;
      case 'bizfileKeyDates':
        return <BizfileKeyDatesView />;
      case 'bizfileAddress':
        return <BizfileAddressView />;
      case 'bizfileSsic':
        return <BizfileSsicView />;
      case 'bizfileCapital':
        return <BizfileCapitalView />;
      case 'bizfileShareholders':
        return <BizfileShareholdersView />;
      case 'qbCustomer':
        return <QBCustomerView />;
      case 'qbEstimate':
        return <QBEstimateView />;
      case 'qbInvoice':
        return <QBInvoiceView />;
      case 'qbPayment':
        return <QBPaymentView />;
      // TPG Management — Landing Pages
      case 'tpgManagement': return (
        <div>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">TPG Management</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'tpgCourseRun', label: 'Course Run', icon: IconName.Courses, description: 'Create, search, and manage course runs' },
              { key: 'tpgSession', label: 'Session', icon: IconName.Calendar, description: 'Add and manage course sessions' },
              { key: 'tpgEnrolment', label: 'Enrolment', icon: IconName.MyAccount, description: 'Enrol learners and manage enrolments' },
              { key: 'tpgAttendance', label: 'Attendance', icon: IconName.ClipboardCheck, description: 'Track and check session attendance' },
              { key: 'tpgAssessment', label: 'Assessment', icon: IconName.Award, description: 'Submit, update, and view assessments' },
              { key: 'tpgGrant', label: 'Grant', icon: IconName.DollarSign, description: 'Search and view grant status' },
            ].map(cat => (
              <button key={cat.key} onClick={() => setPage(cat.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={cat.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{cat.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{cat.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'tpgCourseRun': return (
        <div>
          <button onClick={() => setPage('tpgManagement')} className="text-sm text-primary hover:underline mb-4 inline-flex items-center gap-1">&larr; Back to TPG Management</button>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Course Run</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'tpgCreateClass', label: 'Create New Class', icon: IconName.Create, description: 'Create a new course run class' },
              { key: 'tpgSearchCourseRuns', label: 'Search Course Runs', icon: IconName.Search, description: 'Search for existing course runs' },
              { key: 'tpgViewCourseRun', label: 'View Course Run', icon: IconName.InfoCircle, description: 'View course run details' },
              { key: 'tpgEditCourseRun', label: 'Edit Course Run', icon: IconName.Edit, description: 'Edit an existing course run' },
              { key: 'tpgUploadCourseRuns', label: 'Upload Course Runs', icon: IconName.Upload, description: 'Bulk upload course runs' },
              { key: 'tpgDeleteCourseRun', label: 'Delete Course Run', icon: IconName.Delete, description: 'Delete a course run' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'tpgSession': return (
        <div>
          <button onClick={() => setPage('tpgManagement')} className="text-sm text-primary hover:underline mb-4 inline-flex items-center gap-1">&larr; Back to TPG Management</button>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Session</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'tpgAddSessions', label: 'Add Sessions', icon: IconName.Create, description: 'Add new sessions to a course run' },
              { key: 'tpgSessionTiming', label: 'Session Timing', icon: IconName.Clock, description: 'Configure session timing details' },
              { key: 'tpgCourseSessions', label: 'Course Sessions', icon: IconName.Calendar, description: 'View and manage course sessions' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'tpgEnrolment': return (
        <div>
          <button onClick={() => setPage('tpgManagement')} className="text-sm text-primary hover:underline mb-4 inline-flex items-center gap-1">&larr; Back to TPG Management</button>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Enrolment</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { key: 'tpgEnrollLearners', label: 'Enrol Learners', icon: IconName.MyAccount, description: 'Enrol learners into a course run' },
              { key: 'tpgUploadEnrolments', label: 'Upload Enrolments', icon: IconName.Upload, description: 'Bulk upload enrolment data' },
              { key: 'tpgSearchEnrolment', label: 'Search Enrolment', icon: IconName.Search, description: 'Search for enrolment records' },
              { key: 'tpgViewEnrolment', label: 'View Enrolment', icon: IconName.InfoCircle, description: 'View enrolment details' },
              { key: 'tpgUpdateEnrolment', label: 'Update Enrolment', icon: IconName.Edit, description: 'Update enrolment information' },
              { key: 'tpgCancelEnrolment', label: 'Cancel Enrolment', icon: IconName.Close, description: 'Cancel an existing enrolment' },
              { key: 'tpgUpdateEnrolmentFees', label: 'Update Fees', icon: IconName.DollarSign, description: 'Update enrolment fee details' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'tpgAttendance': return (
        <div>
          <button onClick={() => setPage('tpgManagement')} className="text-sm text-primary hover:underline mb-4 inline-flex items-center gap-1">&larr; Back to TPG Management</button>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Attendance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'tpgSessionAttendance', label: 'Session Attendance', icon: IconName.ClipboardCheck, description: 'Record session attendance' },
              { key: 'tpgCheckAttendance', label: 'Check Attendance', icon: IconName.Search, description: 'Check attendance records' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'tpgAssessment': return (
        <div>
          <button onClick={() => setPage('tpgManagement')} className="text-sm text-primary hover:underline mb-4 inline-flex items-center gap-1">&larr; Back to TPG Management</button>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Assessment</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { key: 'tpgSubmitAssessment', label: 'Submit Assessment', icon: IconName.Upload, description: 'Submit a new assessment' },
              { key: 'tpgUpdateAssessment', label: 'Update Assessment', icon: IconName.Edit, description: 'Update an existing assessment' },
              { key: 'tpgSearchAssessments', label: 'Search Assessments', icon: IconName.Search, description: 'Search for assessment records' },
              { key: 'tpgViewAssessment', label: 'View Assessment', icon: IconName.InfoCircle, description: 'View assessment details' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      case 'tpgGrant': return (
        <div>
          <button onClick={() => setPage('tpgManagement')} className="text-sm text-primary hover:underline mb-4 inline-flex items-center gap-1">&larr; Back to TPG Management</button>
          <h2 className="text-3xl font-bold mb-6 dark:text-white">Grant</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'tpgSearchGrant', label: 'Search Grant', icon: IconName.Search, description: 'Search for grant records' },
              { key: 'tpgViewGrantStatus', label: 'View Grant Status', icon: IconName.InfoCircle, description: 'View grant status details' },
              { key: 'grantCalculator', label: 'Grant Calculator', icon: IconName.Calculator, description: 'Calculate grant amounts' },
            ].map(item => (
              <button key={item.key} onClick={() => setPage(item.key as FinancePage)} className="block w-full">
                <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Icon name={item.icon} className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 dark:text-white">{item.label}</h3>
                  <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{item.description}</p>
                </Card>
              </button>
            ))}
          </div>
        </div>
      );
      // TPG Management — Course Run
      case 'tpgCreateClass': return <CreateNewClassView />;
      case 'tpgSearchCourseRuns': return <SearchCourseRunsView />;
      case 'tpgViewCourseRun': return <ViewCourseRunView />;
      case 'tpgEditCourseRun': return <EditCourseRunView />;
      case 'tpgUploadCourseRuns': return <UploadCourseRunsView />;
      case 'tpgDeleteCourseRun': return <DeleteCourseRunView />;
      // TPG Management — Session
      case 'tpgAddSessions': return <AddSessionsView />;
      case 'tpgSessionTiming': return <CourseSessionTimingView />;
      case 'tpgCourseSessions': return <CourseSessionsView />;
      // TPG Management — Enrolment
      case 'tpgEnrollLearners': return <EnrollLearners />;
      case 'tpgUploadEnrolments': return <BulkUploadEnrolmentView />;
      case 'tpgSearchEnrolment': return <SearchEnrolmentView />;
      case 'tpgViewEnrolment': return <ViewEnrolmentView />;
      case 'tpgUpdateEnrolment': return <UpdateEnrolmentView />;
      case 'tpgCancelEnrolment': return <CancelEnrolmentView />;
      case 'tpgUpdateEnrolmentFees': return <UpdateEnrolmentFeesView />;
      // TPG Management — Attendance
      case 'tpgSessionAttendance': return <CourseSessionAttendanceView />;
      case 'tpgCheckAttendance': return <div className="max-w-6xl mx-auto"><TrainerAttendanceDashboard /></div>;
      // TPG Management — Assessment
      case 'tpgSubmitAssessment': return <SubmitAssessmentView />;
      case 'tpgUpdateAssessment': return <UpdateAssessmentView />;
      case 'tpgSearchAssessments': return <SearchAssessmentsView />;
      case 'tpgViewAssessment': return <ViewAssessmentView />;
      // TPG Management — Grant
      case 'tpgSearchGrant': return <SearchGrantView />;
      case 'tpgViewGrantStatus': return <ViewGrantStatusView />;
      case 'workflowGuides': return <WorkflowGuidesView initialWorkflowId={selectedWorkflowId || undefined} />;
      default:
        return <FinanceManagementView />;
    }
  };

  const activeClass = 'bg-blue-50 text-blue-600 border-l-3 border-blue-500 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-500';
  const inactiveClass = 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white';

  const NavItem = ({ target, label, isSubItem = false }: { target: FinancePage; label: string; isSubItem?: boolean }) => (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); navigateTo(target); }}
      className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${isSubItem ? 'pl-8' : ''} ${
        page === target ? activeClass : inactiveClass
      }`}
    >
      {label}
    </a>
  );

  const NavSection = ({ title, sectionKey, children }: { title: string; sectionKey: string; children: React.ReactNode }) => (
    <div>
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between px-3 py-1 group cursor-pointer"
      >
        <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">{title}</h3>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${openSections[sectionKey] ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {openSections[sectionKey] && (
        <div className="mt-2 space-y-1">
          {children}
        </div>
      )}
    </div>
  );

  const SubSection = ({ title, sectionKey, children }: { title: string; sectionKey: string; children: React.ReactNode }) => (
    <div>
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between pl-8 pr-3 py-1.5 group cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md"
      >
        <span className="text-xs font-semibold uppercase text-gray-400 dark:text-gray-500 tracking-wider">{title}</span>
        <svg
          className={`w-3 h-3 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${openSections[sectionKey] ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {openSections[sectionKey] && <div className="space-y-1">{children}</div>}
    </div>
  );

  const sidebarContent = (
    <nav className="space-y-6 p-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-white h-full">
      <NavItem target="dashboard" label="Financial Dashboard" />
      <NavItem target="allCourseRuns" label="Consolidated Finance Data" />

      <NavSection title="Workflow Guides" sectionKey="workflowGuides">
        <SubSection title="Training" sectionKey="wfTraining">
          {[
            { id: 'lesson-delivery', label: 'Lesson Delivery', icon: '📚' },
            { id: 'assessment', label: 'Assessment', icon: '📝' },
          ].map(item => (
            <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); navigateTo('workflowGuides'); setSelectedWorkflowId(item.id); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
              <span className="text-sm">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </SubSection>
        <SubSection title="Admin" sectionKey="wfAdmin">
          {[
            { id: 'ssg-process-steps', label: 'SSG Process Steps', icon: '🏛️' },
            { id: 'certificate', label: 'Certificate', icon: '🎓' },
            { id: 'trainer-invitation', label: 'Trainer Invitation', icon: '📨' },
          ].map(item => (
            <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); navigateTo('workflowGuides'); setSelectedWorkflowId(item.id); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
              <span className="text-sm">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </SubSection>
        <SubSection title="Finance" sectionKey="wfFinance">
          {[
            { id: 'billing-history', label: 'Billing History', icon: '💰' },
            { id: 'proforma-invoice', label: 'Proforma Invoice', icon: '🧾' },
            { id: 'personal-invoice', label: 'Personal Invoice', icon: '📄' },
            { id: 'company-invoice', label: 'Company Invoice', icon: '🏢' },
            { id: 'receipt', label: 'Receipt', icon: '🧾' },
          ].map(item => (
            <a key={item.id} href="#" onClick={(e) => { e.preventDefault(); navigateTo('workflowGuides'); setSelectedWorkflowId(item.id); }} className="flex items-center gap-2 rounded-md px-3 py-2 ml-4 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-white transition-colors">
              <span className="text-sm">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </SubSection>
      </NavSection>

      <NavSection title="FMS (n8n)" sectionKey="courseRunAutomations">
        <NavItem target="autoProcessEnrolments" label="Process Enrolments" isSubItem />
        <NavItem target="autoManualEnrolment" label="Manual Enrolment" isSubItem />
        <NavItem target="autoCreateEnrolmentsErrorStatus" label="Create Enrolments For Error Status" isSubItem />
        <NavItem target="autoCreateEmployerEnrolment" label="Create Employer Enrolment" isSubItem />
        <NavItem target="autoAppendCancelledClassTrainees" label="Append Cancelled Class Trainees" isSubItem />
        <NavItem target="autoUpdateAssessment" label="Update Assessment" isSubItem />
        <NavItem target="autoProcessGrants" label="Process Grants" isSubItem />
        <NavItem target="autoUpdateGrantStatusTotal" label="Update Grant Status & Total Grant" isSubItem />
        <NavItem target="autoGrantQuery" label="For Grant Query" isSubItem />
        <NavItem target="autoDirectApplication" label="For Direct Application" isSubItem />
        <NavItem target="autoCheckDuplicatesDA" label="Check Duplicates for DA" isSubItem />
        <NavItem target="autoUpdateClaimIdAllCourseRun" label="Update Claim ID In All Course Run" isSubItem />
      </NavSection>

      <NavSection title="TPG Management" sectionKey="tpgManagement">
        <SubSection title="Course Run" sectionKey="tpgCourseRun">
          <NavItem target="tpgCreateClass" label="Create New Class" isSubItem />
          <NavItem target="tpgSearchCourseRuns" label="Search Course Runs" isSubItem />
          <NavItem target="tpgViewCourseRun" label="View Course Run" isSubItem />
          <NavItem target="tpgEditCourseRun" label="Edit Course Run" isSubItem />
          <NavItem target="tpgUploadCourseRuns" label="Upload Course Runs" isSubItem />
          <NavItem target="tpgDeleteCourseRun" label="Delete Course Run" isSubItem />
        </SubSection>

        <SubSection title="Session" sectionKey="tpgSession">
          <NavItem target="tpgAddSessions" label="Add Sessions" isSubItem />
          <NavItem target="tpgSessionTiming" label="Session Timing" isSubItem />
          <NavItem target="tpgCourseSessions" label="Course Sessions" isSubItem />
        </SubSection>

        <SubSection title="Enrolment" sectionKey="tpgEnrolment">
          <NavItem target="tpgEnrollLearners" label="Enroll Learners" isSubItem />
          <NavItem target="tpgUploadEnrolments" label="Upload Enrolments" isSubItem />
          <NavItem target="tpgSearchEnrolment" label="Search Enrolment" isSubItem />
          <NavItem target="tpgViewEnrolment" label="View Enrolment" isSubItem />
          <NavItem target="tpgUpdateEnrolment" label="Update Enrolment" isSubItem />
          <NavItem target="tpgCancelEnrolment" label="Cancel Enrolment" isSubItem />
          <NavItem target="tpgUpdateEnrolmentFees" label="Update Enrolment Fees" isSubItem />
        </SubSection>

        <SubSection title="Attendance" sectionKey="tpgAttendance">
          <NavItem target="tpgSessionAttendance" label="Session Attendance" isSubItem />
          <NavItem target="tpgCheckAttendance" label="Check Attendance" isSubItem />
        </SubSection>

        <SubSection title="Assessment" sectionKey="tpgAssessment">
          <NavItem target="tpgSubmitAssessment" label="Submit Assessment" isSubItem />
          <NavItem target="tpgUpdateAssessment" label="Update Assessment" isSubItem />
          <NavItem target="tpgSearchAssessments" label="Search Assessments" isSubItem />
          <NavItem target="tpgViewAssessment" label="View Assessment" isSubItem />
        </SubSection>

        <SubSection title="Grant" sectionKey="tpgGrant">
          <NavItem target="grantCalculator" label="Grant Calculator" isSubItem />
          <NavItem target="tpgSearchGrant" label="Search Grant" isSubItem />
          <NavItem target="tpgViewGrantStatus" label="View Grant Status" isSubItem />
        </SubSection>
      </NavSection>

      <NavSection title="Claim Management" sectionKey="claimManagement">
        <SubSection title="Claim" sectionKey="claimSub">
          <NavItem target="claimCheck" label="Check / Add Claim" isSubItem />
          <NavItem target="viewClaim" label="View Claim" isSubItem />
          <NavItem target="cancelClaim" label="Cancel Claim" isSubItem />
          <NavItem target="uploadDocument" label="Supporting Document" isSubItem />
        </SubSection>
        <SubSection title="Invoices" sectionKey="invoiceSub">
          <NavItem target="proformaInvoice" label="ProForma Invoice" isSubItem />
          <NavItem target="taxInvoice" label="Tax Invoice" isSubItem />
          <NavItem target="receipt" label="Receipt" isSubItem />
        </SubSection>
      </NavSection>

      <NavSection title="Quickbooks" sectionKey="quickbooks">
        <NavItem target="qbCustomer" label="Customers" isSubItem />
        <NavItem target="qbEstimate" label="Quotes (Estimates)" isSubItem />
        <NavItem target="qbInvoice" label="Invoices" isSubItem />
        <NavItem target="qbPayment" label="Payments" isSubItem />
      </NavSection>

      <NavSection title="Bizfile" sectionKey="bizfile">
        <NavItem target="bizfile" label="Business Profile" isSubItem />
        <NavItem target="bizfileDirectorySearch" label="Entity Directory Search" isSubItem />
        <NavItem target="bizfileNameSearch" label="Entity Name Search" isSubItem />
        <NavItem target="bizfileVerification" label="Entity Verification" isSubItem />
        <NavItem target="bizfileKeyDates" label="Entity Reg Key Dates" isSubItem />
        <NavItem target="bizfileAddress" label="Entity Reg Address" isSubItem />
        <NavItem target="bizfileSsic" label="Entity SSIC" isSubItem />
        <NavItem target="bizfileCapital" label="Company Capital" isSubItem />
        <NavItem target="bizfileShareholders" label="Company Shareholders" isSubItem />
      </NavSection>

      <NavSection title="Useful Links" sectionKey="usefulLinks">
        {[
          { label: 'Quickbooks', href: 'https://quickbooks.intuit.com/sg/' },
          { label: 'Vendors@gov', href: 'https://www.vendors.gov.sg/' },
          { label: 'GeBiz', href: 'https://www.gebiz.gov.sg/' },
          { label: 'Bizfile', href: 'https://www.bizfile.gov.sg/' },
          { label: 'CPF', href: 'https://www.cpf.gov.sg/member' },
        ].map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center rounded-md pl-8 py-2 text-sm font-medium transition-colors ${inactiveClass}`}
          >
            {label}
            <svg className="w-3 h-3 ml-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
      </NavSection>

    </nav>
  );

  // Profile / Help & Support view — full width, no sidebar
  if (currentView === View.Profile || currentView === View.HelpAndSupport) {
    return (
      <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
        <Header />
        <main className="flex-1">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {currentView === View.Profile ? <ProfilePage /> : <HelpAndSupportView />}
          </div>
        </main>
        <Footer />
        <AiChatbot />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans text-on-surface">
      <Header />

      {/* Main Layout Container */}
      <div className="flex flex-1">
        {/* Sidebar: icon rail when collapsed, full panel when expanded */}
        <div className="flex flex-shrink-0">
          <aside className={`${isSidebarOpen ? 'w-64' : 'w-14'} bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col h-[calc(100vh-64px)] sticky top-[64px] transition-all duration-200`}>
            {/* Toggle arrow at top */}
            <div className={`flex ${isSidebarOpen ? 'justify-end' : 'justify-center'} px-2 py-2 border-b border-gray-200 dark:border-gray-700`}>
              <button
                onClick={() => setIsSidebarOpen(prev => !prev)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                <svg className={`w-5 h-5 transition-transform ${isSidebarOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            {isSidebarOpen && (
              <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                {sidebarContent}
              </div>
            )}
            {isSidebarOpen && <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-300 font-mono border-t border-gray-200 dark:border-gray-700">version {appVersion}</p>}
          </aside>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {(page.startsWith('tpg') ||
              page === 'allCourseRuns' ||
              page === 'autoProcessGrants' ||
              page === 'searchGrant' ||
              page === 'viewGrant') && <SsgAppSelector />}
            {renderContent()}
          </div>
        </main>
      </div>

      <Footer />
      <AiChatbot />
    </div>
  );
};

export default FinanceLayout;
