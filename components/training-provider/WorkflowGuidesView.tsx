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
    description: 'Generate proforma invoices BEFORE enrollment for learners to claim SkillsFuture Credit.',
    steps: [
      { title: '1. Learner Enquires About Course', detail: 'A learner expresses interest in a course. Before formal enrollment, the learner needs a proforma invoice to submit a SkillsFuture Credit claim or for employer sponsorship approval.', type: 'logic' },
      { title: '2. Admin Generates Proforma Invoice', detail: 'From Finance Management, admin selects the course and learner details, then clicks "Generate Proforma Invoice". The proforma includes: course title, course code, course fees (excl. GST), GST amount, total payable, applicable funding (normal, MCES), and estimated net fee after SkillsFuture claim.', type: 'action' },
      { title: '3. Generate Proforma PDF', detail: 'The system generates a proforma invoice PDF clearly marked as "PROFORMA INVOICE" (not a tax invoice). It includes: company details, proforma number, date, course details, fee breakdown, and a note that this is not a demand for payment.', type: 'logic' },
      { title: '4. Upload to Google Drive', detail: 'The proforma PDF is uploaded to the Google Drive billing folder. The file is named with the proforma number and learner name.', type: 'storage' },
      { title: '5. Record in Billing History', detail: 'The proforma is saved to the billing history with type "Proforma" and status "Issued". It is linked to the learner and course for tracking.', type: 'storage' },
      { title: '6. Send to Learner', detail: 'Admin sends the proforma invoice to the learner via email. The learner uses it to submit their SkillsFuture Credit claim on the MySkillsFuture portal, or submit to their employer for sponsorship approval.', type: 'email' },
      { title: '7. Learner Claims SkillsFuture Credit', detail: 'The learner submits the SkillsFuture Credit claim using the proforma invoice details. Once approved, the learner proceeds with enrollment. The proforma status is updated to "Claimed".', type: 'success' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Stores proforma records with type "Proforma": number, amount, date, learner, course, Drive URL, status (Issued/Claimed)' },
    ],
  },
  {
    id: 'invoice',
    title: 'Invoice Workflow',
    icon: '📄',
    color: 'border-blue-500 bg-blue-50 dark:bg-blue-900/10',
    description: 'Generate tax invoices after enrollment and SkillsFuture claim for learners to pay the net fee.',
    steps: [
      { title: '1. Learner Enrolls in Course', detail: 'After the SkillsFuture Credit claim is approved (or employer sponsorship confirmed), the learner is formally enrolled in the course run. The enrollment record is created in the system.', type: 'logic' },
      { title: '2. Calculate Net Fee', detail: 'The system calculates the net fee payable by the learner: Course Fee + GST - SkillsFuture Credit - Normal Funding - MCES Funding = Net Fee. This is the amount the learner needs to pay out of pocket.', type: 'logic' },
      { title: '3. Admin Generates Invoice', detail: 'From Finance Management, admin selects the enrolled course run and clicks "Generate Invoice". The invoice includes: full fee breakdown, SkillsFuture Credit applied, funding deductions, and the net amount payable by the learner.', type: 'action' },
      { title: '4. Generate Invoice PDF', detail: 'The system generates a tax invoice PDF with: company details (including GST registration number), invoice number, date, learner details, course details, itemised fees, GST breakdown, funding applied, and net amount due.', type: 'logic' },
      { title: '5. Upload to Google Drive', detail: 'The invoice PDF is uploaded to the Google Drive billing folder. The file is named with the invoice number, learner name, and course run ID.', type: 'storage' },
      { title: '6. Record in Billing History', detail: 'The invoice is saved to billing history with type "Invoice" and status "Sent". It is linked to the enrollment, learner, and course run.', type: 'storage' },
      { title: '7. Send Invoice to Learner', detail: 'Admin sends the invoice to the learner via email with payment instructions. The learner pays the net fee via the specified payment method (bank transfer, PayNow, etc.).', type: 'email' },
      { title: '8. Track Payment', detail: 'Once payment is received, admin updates the invoice status to "Paid" in billing history. This completes the billing cycle for the learner.', type: 'success' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Stores invoice records with type "Invoice": number, net amount, date, enrollment, Drive URL, status (Sent/Paid)' },
    ],
  },
  {
    id: 'receipt',
    title: 'Receipt Workflow',
    icon: '🧾',
    color: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10',
    description: 'Generate receipts for learners who have paid the net fee, store in Google Drive and billing history.',
    steps: [
      { title: '1. Payment Received', detail: 'The learner has paid the net fee (after SkillsFuture Credit and funding deductions). The payment is confirmed via bank transfer, PayNow, or other payment method.', type: 'logic' },
      { title: '2. Admin Confirms Payment', detail: 'Admin verifies the payment in Finance Management and marks the invoice status as "Paid". This triggers the receipt generation process.', type: 'action' },
      { title: '3. Admin Generates Receipt', detail: 'From Finance Management, admin clicks "Generate Receipt" for the paid invoice. The receipt references the original invoice number and confirms the payment amount received.', type: 'action' },
      { title: '4. Generate Receipt PDF', detail: 'The system generates a receipt PDF with: company details, receipt number, date, original invoice reference, learner details, course details, amount paid, payment method, and payment date.', type: 'logic' },
      { title: '5. Upload to Google Drive', detail: 'The receipt PDF is uploaded to the Google Drive billing folder. The file is named with the receipt number and learner name.', type: 'storage' },
      { title: '6. Record in Billing History', detail: 'The receipt is saved to billing history with type "Receipt" and status "Issued". It is linked to the original invoice and enrollment record.', type: 'storage' },
      { title: '7. Send Receipt to Learner', detail: 'Admin sends the receipt to the learner via email as proof of payment. The learner can also view and download the receipt from their Billing History in the TMS portal.', type: 'email' },
      { title: '8. Billing Cycle Complete', detail: 'The full billing cycle is now complete: Proforma → Invoice → Receipt. All documents are stored in Google Drive and tracked in Billing History for audit and reference.', type: 'success' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Stores receipt records with type "Receipt": number, amount, date, invoice reference, Drive URL, status (Issued)' },
    ],
  },
  {
    id: 'billing-history',
    title: 'Billing History Workflow',
    icon: '💰',
    color: 'border-orange-500 bg-orange-50 dark:bg-orange-900/10',
    description: 'End-to-end billing journey from course enquiry to class-ready, covering proforma, enrollment, SkillsFuture, invoice, and receipt.',
    steps: [
      { title: '1. Learner Enquires About Course Fee', detail: 'Learner contacts the training provider to enquire about a course. Admin provides the course fee details: course fee (excl. GST), GST, total fee, applicable funding (SkillsFuture, MCES), and estimated net fee payable after subsidies.', type: 'action' },
      { title: '2. Create Proforma Invoice', detail: 'Admin generates a proforma invoice from Finance Management. The proforma shows the full fee breakdown and estimated net fee. This document is sent to the learner for SkillsFuture Credit claim submission or employer sponsorship approval. The proforma is uploaded to Google Drive and recorded in Billing History.', type: 'logic' },
      { title: '3. Enrollment', detail: 'Once the learner confirms participation, admin creates the enrollment in the system. The enrollment record links the learner to the specific course run with their enrolment details, NRIC, and payment status.', type: 'action' },
      { title: '4. Apply SkillsFuture Credit', detail: 'The learner submits their SkillsFuture Credit claim on the MySkillsFuture portal using the proforma invoice details. SSG processes the claim and approves the funding amount. The claim amount is deducted from the total course fee.', type: 'logic' },
      { title: '5. Create Invoice for Net Fee', detail: 'After SkillsFuture Credit is approved, admin generates a tax invoice for the net fee payable: Total Fee - SkillsFuture Credit - Funding = Net Fee. The invoice is uploaded to Google Drive and recorded in Billing History. Admin sends the invoice to the learner with payment instructions.', type: 'action' },
      { title: '6. Net Fee Paid', detail: 'The learner pays the net fee via bank transfer, PayNow, or other payment method. Admin verifies the payment and updates the invoice status to "Paid" in Billing History. The enrollment payment status is also updated.', type: 'success' },
      { title: '7. Generate Receipt', detail: 'Admin generates a receipt for the payment received. The receipt references the original invoice and confirms the payment amount, method, and date. The receipt is uploaded to Google Drive and recorded in Billing History. A copy is sent to the learner as proof of payment.', type: 'storage' },
      { title: '8. Ready to Take the Class', detail: 'With payment complete, the learner is fully enrolled and ready to attend the class. They can access the course details, Google Meet link (for virtual classes), and learning materials through the TMS portal. The billing cycle is complete: Enquiry → Proforma → Enrollment → SkillsFuture → Invoice → Payment → Receipt → Class Ready.', type: 'success' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Tracks all billing documents: proforma invoices, invoices, and receipts with type, status, amounts, and Drive URLs' },
      { name: 'enrollment', description: 'Learner enrollment record with payment_status tracking (pending/paid)' },
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
