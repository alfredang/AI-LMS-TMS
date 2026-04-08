import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

type StepType = 'action' | 'logic' | 'email' | 'success' | 'error' | 'warning' | 'storage';

interface WorkflowStep {
  title: string;
  detail: string;
  type: StepType;
}

interface Workflow {
  id: string;
  title: string;
  icon: string;
  color: string;
  description: string;
  steps: WorkflowStep[];
  endpoints?: { method: string; url: string; description: string }[];
  emailTemplates?: { name: string; path: string; description: string }[];
  dbTables?: { name: string; description: string }[];
}

const WORKFLOWS: Workflow[] = [
  {
    id: 'trainer-invitation',
    title: 'Trainer Invitation Workflow',
    icon: '📨',
    color: 'border-blue-500 bg-blue-50 dark:bg-blue-900/10',
    description: 'Automated trainer assignment via email invitation with accept/decline webhooks.',
    steps: [
      { title: '1. Admin Sends Invitation', detail: 'From Upcoming Classes, admin clicks "Send Invitation" for a course run. The system identifies the next available trainer from the approved trainers list (set in the Course record).', type: 'action' },
      { title: '2. System Determines Next Available Trainer', detail: 'The system scans the approved trainers list in order and skips: (a) trainers already assigned locally, (b) trainers who have declined, (c) trainers with pending invitations. The first available trainer is selected. Admin can also manually override and select a specific trainer.', type: 'logic' },
      { title: '3. Invitation Email Sent', detail: 'An HTML email is sent to the trainer with course details (title, code, dates, TPG trainer), and two buttons: Accept Invitation (green) and Decline Invitation (red). The email includes a link to the TMS portal and a do-not-reply notice.', type: 'email' },
      { title: '4a. Trainer Clicks "Accept"', detail: 'The accept webhook fires:\n• Invitation status updated to "accepted"\n• Trainer is automatically assigned to the class (inserted into course_run_trainer)\n• Accept confirmation email sent to the trainer with course schedule details\n• Trainer can view the class in the TMS portal under My Classes', type: 'success' },
      { title: '4b. Trainer Clicks "Decline"', detail: 'The decline webhook fires:\n• Invitation status updated to "declined"\n• Decline acknowledgement email sent to the trainer\n• System automatically sends a new invitation to the next available trainer in the approved list (cascading invitation)\n• The cycle repeats from Step 2 for the next trainer', type: 'error' },
      { title: '5. Already Responded', detail: 'If a trainer clicks an invitation link that was already responded to, the system shows: "Already Responded — This invitation has already been accepted/The class may have been assigned to another trainer."', type: 'logic' },
      { title: '6. No More Available Trainers', detail: 'If all trainers in the approved list have declined or are already assigned, the system logs "No more available trainers" and stops cascading. Admin can then manually assign a trainer or update the approved list.', type: 'warning' },
    ],
    endpoints: [
      { method: 'POST', url: '/api/admin/send-trainer-invitation', description: 'Send invitation to next available trainer' },
      { method: 'GET', url: '/api/public/trainer-invitation/respond?token={TOKEN}&action=accept', description: 'Accept webhook — assigns trainer to class' },
      { method: 'GET', url: '/api/public/trainer-invitation/respond?token={TOKEN}&action=decline', description: 'Decline webhook — sends next invitation' },
    ],
    emailTemplates: [
      { name: 'Trainer Invitation Email', path: 'Templates → Trainer Invitation Email', description: 'The initial invitation email with Accept/Decline buttons' },
      { name: 'Trainer Accept Email', path: 'Templates → Trainer Accept/Decline Email → Accept tab', description: 'Confirmation email sent after trainer accepts' },
      { name: 'Trainer Decline Email', path: 'Templates → Trainer Accept/Decline Email → Decline tab', description: 'Acknowledgement email sent after trainer declines' },
    ],
    dbTables: [
      { name: 'trainer_invitation', description: 'Tracks each invitation: trainer name, email, token, status (pending/accepted/declined), timestamps' },
      { name: 'course_run_trainer', description: 'Junction table linking trainers to course runs (populated on accept)' },
    ],
  },
  {
    id: 'certification',
    title: 'Certification Workflow',
    icon: '🎓',
    color: 'border-green-500 bg-green-50 dark:bg-green-900/10',
    description: 'Auto-generate certificates after class completion, store in Google Drive, and email to learners.',
    steps: [
      { title: '1. Class Ends', detail: 'When a course run end date passes and the class status is "Confirmed", the class becomes eligible for certificate generation.', type: 'logic' },
      { title: '2. Trigger Certificate Generation', detail: 'The scheduler task "Auto Create Certificates" runs daily (or admin triggers manually from Task Scheduler). It identifies completed classes where certificates have not yet been generated.', type: 'action' },
      { title: '3. Generate Certificate PDF', detail: 'For each enrolled learner who passed the assessment, the system generates a certificate PDF using the configured template. The certificate includes: learner name, course title, course code, completion date, and training provider details.', type: 'logic' },
      { title: '4. Upload to Google Drive', detail: 'The generated certificate PDF is uploaded to the Google Drive certificate folder (configured in Company Settings). Files are named with the learner name and course title for easy identification.', type: 'storage' },
      { title: '5. Save Certificate URL', detail: 'The Google Drive URL is saved to the enrollment record (enrollment.certificate field) so it can be accessed from the learner\'s profile and course detail pages.', type: 'storage' },
      { title: '6. Send Certificate Email', detail: 'A certificate email is sent to the learner with the certificate attached or linked. The email template is configurable from Templates → Certificate Email.', type: 'email' },
      { title: '7. Learner Views Certificate', detail: 'The learner can view and download their certificate from the TMS portal under their course detail page. Admins can also view it from the class management views.', type: 'success' },
    ],
    emailTemplates: [
      { name: 'Certificate Email', path: 'Templates → Certificate Email', description: 'Email sent to learners with their certificate after class completion' },
    ],
    dbTables: [
      { name: 'enrollment', description: 'Stores certificate URL in the certificate column for each enrolled learner' },
    ],
  },
  {
    id: 'proforma-invoice',
    title: 'Proforma Invoice Workflow',
    icon: '🧾',
    color: 'border-amber-500 bg-amber-50 dark:bg-amber-900/10',
    description: 'Generate proforma invoices, save to Google Drive, and record in billing history.',
    steps: [
      { title: '1. Course Run Created', detail: 'When a new course run is created with enrolled learners, the system has the data needed to generate a proforma invoice: course fees, GST, funding amounts, and learner details.', type: 'logic' },
      { title: '2. Admin Generates Invoice', detail: 'From the Finance Management section, admin selects a course run and clicks "Generate Proforma Invoice". The system calculates: course fees (excl. GST), GST amount, total payable, funding deductions (normal, MCES), and net amount.', type: 'action' },
      { title: '3. Generate Invoice PDF', detail: 'The system generates a proforma invoice PDF with: company details, invoice number, date, course details, itemised fees per learner, GST breakdown, funding deductions, and total amount payable.', type: 'logic' },
      { title: '4. Upload to Google Drive', detail: 'The invoice PDF is uploaded to the Google Drive billing folder (configured in Company Settings). The file is named with the invoice number and course run ID.', type: 'storage' },
      { title: '5. Record in Billing History', detail: 'The invoice details are saved to the billing history table with: invoice number, amount, date, course run reference, Google Drive URL, and status (Draft/Sent/Paid).', type: 'storage' },
      { title: '6. Admin Reviews & Sends', detail: 'Admin can review the invoice from Billing History, download the PDF from Google Drive, and send it to the learner or employer. The invoice status is updated accordingly.', type: 'action' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Stores invoice records: number, amount, date, course run, Drive URL, status' },
    ],
  },
  {
    id: 'lesson-delivery',
    title: 'Lesson Delivery Workflow',
    icon: '📚',
    color: 'border-purple-500 bg-purple-50 dark:bg-purple-900/10',
    description: 'Trainer-led lesson delivery flow from class preparation to completion.',
    steps: [
      { title: '1. Trainer Receives Class Assignment', detail: 'After accepting the trainer invitation (or being manually assigned), the trainer can see the class under "My Classes" in the TMS portal. The class card shows course title, dates, class type (Physical/Virtual/Hybrid), and Google Meet link if virtual.', type: 'action' },
      { title: '2. Access Courseware & Resources', detail: 'Trainer clicks "View Class" to access the Course Detail page. This includes: Courseware Link, Lesson Plan, Learner Guide, Facilitator Guide, Trainer Slides, and Assessment materials. All resources are linked from Google Drive.', type: 'action' },
      { title: '3. Review Lesson Delivery Guide', detail: 'From the sidebar, trainer opens the Lesson Delivery Guide which provides structured guidance on: learning objectives, teaching methodology, time allocation per topic, and facilitation tips.', type: 'logic' },
      { title: '4. Track Learning Units & Subtopics', detail: 'During delivery, the trainer can bookmark completed subtopics using the learning unit tracker. This helps track progress through the curriculum and resume from the right place on multi-day courses.', type: 'action' },
      { title: '5. Take E-Attendance', detail: 'For each session, the trainer takes digital attendance via the E-Attendance feature. This records: date, time, learner presence, and generates a digital attendance record linked to the SSG Digital Attendance ID.', type: 'action' },
      { title: '6. Virtual Class Delivery', detail: 'For Virtual or Hybrid classes, the Google Meet link is displayed in the Course Detail page under the Google Meet section. Trainer and learners can join directly from the portal.', type: 'logic' },
      { title: '7. Class Completion', detail: 'After the last session, the class end date passes and the status moves to "Completed". The trainer can then proceed to assessment grading. Training hours are automatically tracked in the Training Hours page.', type: 'success' },
    ],
  },
  {
    id: 'assessment',
    title: 'Assessment Workflow',
    icon: '📝',
    color: 'border-red-500 bg-red-50 dark:bg-red-900/10',
    description: 'Assessment creation, grading, and result management for trainers.',
    steps: [
      { title: '1. Assessment Setup', detail: 'Course developer creates assessments for each course with: title, category (Written/Practical/Portfolio), method, passing criteria, and rubric. Assessments are linked to the course record.', type: 'action' },
      { title: '2. Publish Assessments', detail: 'Admin or developer publishes assessments for a specific course run. This makes the assessments visible to the assigned trainer. Published assessment methods are stored per course run.', type: 'action' },
      { title: '3. Review Assessment Guide', detail: 'Trainer opens the Assessment Guide from the sidebar to review: assessment criteria, marking rubrics, grading scales, and submission requirements before conducting assessments.', type: 'logic' },
      { title: '4. Conduct Assessment', detail: 'During or after the class, the trainer conducts assessments. For written assessments, learners submit via the portal. For practical assessments, the trainer evaluates in-person and records results.', type: 'action' },
      { title: '5. Grade Submissions', detail: 'From "Assessment Grading" in the sidebar, the trainer views all learner submissions for their assigned classes. The trainer marks each submission as: Competent (C), Not Yet Competent (NYC), or Absent.', type: 'action' },
      { title: '6. Record Results', detail: 'Grading results are saved to the submission table. The system tracks: grade, comments, graded date, and grader. Results are visible to both the trainer and admin.', type: 'storage' },
      { title: '7. View Past Assessments', detail: 'Trainer can review past assessment results from "Past Assessment" in the sidebar. Admin can view all assessment results from the class detail view and generate assessment summary reports.', type: 'success' },
      { title: '8. Assessment Records in Google Drive', detail: 'The auto-create assessment records scheduler task creates Google Drive folders for each course run, organized by trainer. This provides a central repository for assessment documentation.', type: 'storage' },
    ],
    dbTables: [
      { name: 'assessment', description: 'Assessment definitions: title, category, method, criteria per course' },
      { name: 'submission', description: 'Learner submissions and grades: assessment_id, user_id, grade, comments' },
    ],
  },
];

const stepColors: Record<StepType, { bg: string; border: string; icon: string; label: string }> = {
  action: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', icon: '🚀', label: 'Action' },
  logic: { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800', icon: '⚙️', label: 'Logic' },
  email: { bg: 'bg-cyan-50 dark:bg-cyan-900/20', border: 'border-cyan-200 dark:border-cyan-800', icon: '📧', label: 'Email' },
  success: { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', icon: '✅', label: 'Complete' },
  error: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', icon: '❌', label: 'Decline Path' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', icon: '⚠️', label: 'Edge Case' },
  storage: { bg: 'bg-teal-50 dark:bg-teal-900/20', border: 'border-teal-200 dark:border-teal-800', icon: '💾', label: 'Storage' },
};

interface WorkflowGuidesViewProps {
  initialWorkflowId?: string;
}

const WorkflowGuidesView: React.FC<WorkflowGuidesViewProps> = ({ initialWorkflowId }) => {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(initialWorkflowId || null);

  const workflow = WORKFLOWS.find(w => w.id === selectedWorkflow);

  // Card grid view
  if (!workflow) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold dark:text-white">Workflow Guides</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            System workflow documentation with step-by-step logic, API endpoints, and email templates.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {WORKFLOWS.map(w => (
            <button
              key={w.id}
              onClick={() => setSelectedWorkflow(w.id)}
              className={`text-left p-5 rounded-xl border-l-4 ${w.color} border border-gray-200 dark:border-gray-700 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200`}
            >
              <div className="text-3xl mb-3">{w.icon}</div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-1">{w.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{w.description}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 font-medium">{w.steps.length} steps →</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Detail view
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setSelectedWorkflow(null)} className="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
          ← Back to Workflows
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-3xl">{workflow.icon}</span>
        <div>
          <h2 className="text-2xl font-bold dark:text-white">{workflow.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{workflow.description}</p>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Workflow Steps</h4>
        <div className="space-y-3">
          {workflow.steps.map((step, i) => {
            const color = stepColors[step.type];
            return (
              <div key={i} className={`${color.bg} border ${color.border} rounded-lg p-4`}>
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0 mt-0.5">{color.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h5 className="font-bold text-gray-900 dark:text-white text-sm">{step.title}</h5>
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/20 text-gray-600 dark:text-gray-400">{color.label}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">{step.detail}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* API Endpoints */}
      {workflow.endpoints && workflow.endpoints.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">API Endpoints</h4>
          <div className="space-y-2">
            {workflow.endpoints.map((ep, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${ep.method === 'GET' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'}`}>{ep.method}</span>
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all">{ep.url}</code>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{ep.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Email Templates */}
      {workflow.emailTemplates && workflow.emailTemplates.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Email Templates</h4>
          <div className="space-y-2">
            {workflow.emailTemplates.map((t, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <Icon name={IconName.Mail} className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{t.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t.description}</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Configure: {t.path}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Database Tables */}
      {workflow.dbTables && workflow.dbTables.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Database Tables</h4>
          <div className="space-y-2">
            {workflow.dbTables.map((t, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <Icon name={IconName.FileText} className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold font-mono text-gray-900 dark:text-white">{t.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowGuidesView;
