import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

type StepType = 'action' | 'logic' | 'email' | 'success' | 'error' | 'warning' | 'storage';

interface WorkflowStep {
  title: string;
  detail: string;
  type: StepType;
  url?: string;
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
  externalUrl?: string;
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
    id: 'certificate',
    title: 'Certificate Workflow',
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
    id: 'personal-invoice',
    title: 'Personal Invoice Workflow',
    icon: '📄',
    color: 'border-blue-500 bg-blue-50 dark:bg-blue-900/10',
    description: 'End-to-end personal invoice flow: create enrollment & grant on SSG, generate QuickBooks invoice, store in Google Drive, and record in billing history.',
    steps: [
      { title: '1. Create Enrollment and Grant', detail: 'Admin creates the enrollment and grant application on the SSG portal for the individual learner. The enrollment links the learner to the specific course run with their NRIC, sponsorship type, and fee details.', type: 'action' },
      { title: '2. Get Enrolment ID and Grant ID from SSG', detail: 'If the enrollment and grant submission is successful, SSG returns the Enrolment ID (e.g. ENR-XXXX-XXXXXX) and Grant ID (e.g. GRN-XXXX-XXXXXX). These IDs are saved to the enrollment record in the system for tracking.', type: 'success' },
      { title: '3. Trigger QuickBooks to Generate Invoice', detail: 'The system triggers QuickBooks Online to generate a tax invoice for the learner. The invoice includes: course title, fee breakdown, GST, funding applied, and net amount payable. QuickBooks sends the invoice directly to the learner\'s email.', type: 'action' },
      { title: '4. Download Invoice PDF to Google Drive', detail: 'The invoice PDF is downloaded from QuickBooks and uploaded to the Google Drive billing folder. The file is named with the invoice number, learner name, and course run ID for easy identification.', type: 'storage' },
      { title: '5. Record in Learner Billing History', detail: 'The invoice PDF URL is saved to the learner\'s billing history with type "Invoice" and status "Sent". The learner can view and download the invoice from their Billing History page in the TMS portal.', type: 'storage' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Stores invoice records with type "Invoice": number, net amount, date, enrollment, Drive URL, status (Sent/Paid)' },
      { name: 'enrollment', description: 'Enrollment record with SSG enrolment_id and grant_id' },
    ],
  },
  {
    id: 'company-invoice',
    title: 'Company Invoice Workflow',
    icon: '🏢',
    color: 'border-violet-500 bg-violet-50 dark:bg-violet-900/10',
    description: 'Bulk company invoice flow: receive Excel from company, create enrollments & grants on SSG, generate consolidated QuickBooks invoice, and store in billing history.',
    steps: [
      { title: '1. Send Excel Template to Company', detail: 'Admin sends the company contact person an Excel template to fill in with learner details: names, NRIC, email, course selection, sponsorship type, and any other required enrollment information.', type: 'email' },
      { title: '2. Receive Completed Excel File', detail: 'The company contact person fills in the Excel file with all learner details and returns it to the admin. Admin reviews the data for completeness and accuracy before processing.', type: 'action' },
      { title: '3. Upload Excel File to TMS', detail: 'Admin uploads the completed Excel file to the TMS system. The system parses the file and validates each record — checking for required fields, valid NRIC format, and course availability.', type: 'action' },
      { title: '4. Create Enrollment and Grant for Each Record', detail: 'The system creates enrollment and grant applications on the SSG portal for each learner in the Excel file. Each enrollment links the learner to the specified course run with their details.', type: 'action' },
      { title: '5. Get Enrolment ID and Grant ID from SSG', detail: 'For each successful enrollment, SSG returns the Enrolment ID and Grant ID. These IDs are saved to each enrollment record in the system. Any failures are logged and reported to the admin for manual follow-up.', type: 'success' },
      { title: '6. Trigger QuickBooks Consolidated Invoice', detail: 'The system triggers QuickBooks Online to generate a single consolidated invoice for the company. The invoice lists all enrolled learners with individual fee breakdowns, GST, funding applied, and the total net amount payable by the company. QuickBooks sends the invoice to the company contact person\'s email.', type: 'action' },
      { title: '7. Download Invoice PDF to Google Drive', detail: 'The consolidated invoice PDF is downloaded from QuickBooks and uploaded to the Google Drive billing folder. The file is named with the invoice number and company name.', type: 'storage' },
      { title: '8. Record in Company Contact Billing History', detail: 'The invoice PDF URL is saved to the company contact person\'s billing history with type "Invoice" and status "Sent". The company contact can view and download the consolidated invoice from the TMS portal.', type: 'storage' },
    ],
    dbTables: [
      { name: 'billing_history', description: 'Stores consolidated invoice records with type "Invoice": number, total amount, date, company name, Drive URL, status (Sent/Paid)' },
      { name: 'enrollment', description: 'Individual enrollment records with SSG enrolment_id and grant_id for each learner' },
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
  {
    id: 'support-ticketing',
    title: 'Support Ticketing Workflow',
    icon: '🎫',
    color: 'border-pink-500 bg-pink-50 dark:bg-pink-900/10',
    description: 'Provide learners with a channel to report queries and administrators a centralized way to resolve them efficiently.',
    steps: [
      { title: '1. Learner Raises Ticket', detail: 'From the Help & Support page, a learner clicks "Raise a New Ticket". The learner fills out a form containing the subject, category (General, Course, Payment, Technical, LMS, TMS, Courseware, Certificate, Claim, Other), and details of their query.', type: 'action' },
      { title: '2. System Processes Ticket', detail: 'A unique ticket number (e.g. TKT-000001) is automatically generated. The ticket is immediately saved to the database with a default status of "Open".', type: 'logic' },
      { title: '3. Notifications Sent', detail: 'An email is dispatched to the admin (via the support email configured in Company Settings) to notify them of the new ticket, and an acknowledgement email is sent to the learner directly.', type: 'email' },
      { title: '4. Admin Reviews and Responds', detail: 'From the Support Tickets admin sidebar, the admin views the central list of tickets. Clicking the ticket opens the detail view where the admin can type a response to the learner.', type: 'action' },
      { title: '5. Ticket Status Updates', detail: 'Upon an admin submitting a reply, the ticket status automatically transitions from "Open" to "In Progress". The admin can manually change the status to "Resolved" or "Closed" via the dropdown menu.', type: 'logic' },
      { title: '6. Learner Receives Support', detail: 'The learner gets the response directly within the same Help & Support interface. A threaded conversation is built allowing continuous communication until the ticket is marked Closed.', type: 'success' },
    ],
    endpoints: [
      { method: 'POST', url: '/api/tickets/create', description: 'Learner raises a new ticket and sends initial emails' },
      { method: 'GET', url: '/api/tickets/list', description: 'Fetch all tickets (admins see all, learners see their own)' },
      { method: 'GET', url: '/api/tickets/detail', description: 'Retrieve ticket info and conversation thread' },
      { method: 'POST', url: '/api/tickets/reply', description: 'Post responses and auto-updates status' },
      { method: 'PUT', url: '/api/tickets/update-status', description: 'Manually change ticket status' }
    ],
    dbTables: [
      { name: 'support_ticket', description: 'Main ticket entry with generated ticket_number and status' },
      { name: 'support_ticket_reply', description: 'Threaded conversation logs attached to a ticket.' },
    ],
  },
  {
    id: 'ssg-process-steps',
    title: 'SSG Process Steps',
    icon: '🏛️',
    color: 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/10',
    description: 'Complete SSG WSQ process from Course Dashboards to Certificates — all 13 stages of the WSQ workflow.',
    externalUrl: 'https://alfredang.github.io/ssgwsqprocess/index.html',
    steps: [
      { title: '1. Course Dashboards', detail: 'Overview of course management dashboards and key metrics. Access the SSG portal to view course listings, approval statuses, and training provider performance indicators.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#course-dashboards' },
      { title: '2. Course Applications', detail: 'Managing and processing course applications. Submit new course applications to SSG for approval, track application status, and manage required documentation.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#course-applications' },
      { title: '3. Course Runs', detail: 'Setting up and administering course runs. Create course runs on the TPGateway portal with session dates, venues, trainers, and vacancy information.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#course-runs' },
      { title: '4. Grant Calculator', detail: 'Calculating eligible training grants. Use the SSG grant calculator to determine funding amounts for different learner categories (SC, PR, MCES-eligible).', type: 'logic', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#grant-calculator' },
      { title: '5. Trainee Enrolment', detail: 'Enrolling trainees into approved courses. Process enrolment through the SSG portal, verify learner eligibility, and submit enrolment records.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#trainee-enrolment' },
      { title: '6. Attendance', detail: 'Recording and managing trainee attendance. Submit digital attendance records to SSG, track attendance rates, and manage makeup sessions.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#attendance' },
      { title: '7. Assessments', detail: 'Conducting assessments and recording results. Manage WSQ assessments, record competency outcomes (C/NYC), and submit results to SSG.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#assessments' },
      { title: '8. Grants', detail: 'Applying for and managing training grants. Submit grant applications to SSG, track approval status, and manage grant disbursement.', type: 'logic', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#grants' },
      { title: '9. Claims', detail: 'Submitting and tracking grant claims. File claims for approved grants, upload supporting documents, and monitor claim processing status.', type: 'action', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#claims' },
      { title: '10. Outcome Submission', detail: 'Submitting training outcomes and competency results. Submit final training outcomes to SSG including assessment results and completion status.', type: 'success', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#outcome-submission' },
      { title: '11. Financial Transactions', detail: 'Viewing and managing financial transactions. Track grant disbursements, reconcile payments, and monitor financial records on the SSG portal.', type: 'logic', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#financial-transactions' },
      { title: '12. Refunds', detail: 'Processing refund requests and adjustments. Handle grant refunds, process overpayment returns, and manage financial adjustments with SSG.', type: 'warning', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#refunds' },
      { title: '13. Certificates', detail: 'Generating and issuing training certificates. Issue WSQ certificates to competent learners, manage certificate records, and handle re-issuance requests.', type: 'success', url: 'https://alfredang.github.io/ssgwsqprocess/steps.html#certificates' },
    ],
  },
  {
    id: 'company-application',
    title: 'Company Application Workflow',
    icon: '🏢',
    color: 'border-violet-500 bg-violet-50 dark:bg-violet-900/10',
    description: 'End-to-end company-sponsored application: Excel upload → automated enrolment → document verification → invoice delivery.',
    steps: [
      { title: '1. Receive Excel from Employer', detail: 'Send the employer the company application Excel template. On return, verify the required columns are filled: NRIC, course, start date, UEN, and consent fields.', type: 'action' },
      { title: '2. Upload the Excel', detail: 'Sidebar → COMPANY APPLICATION → Upload Company Application. Drop the file to begin. Duplicate rows are automatically skipped, so re-uploading is safe.', type: 'action' },
      { title: '3. Automated Pipeline (Enrolment → Grant → Calendar → Invoice)', detail: 'Runs end-to-end with no admin input. Per row:\n\n• Matches the SSG course run\n• Submits enrolment (sponsorship = EMPLOYER) and saves the Enrolment ID\n• SSG auto-creates the grant; system polls and stores Grant ID + amount\n• Creates the LMS learner and enrollment record\n• Silently adds the learner to the course run\'s Google Calendar sessions — no email invite is sent, and the calendar event must already exist\n• Once every learner in an (employer × course run) group is enrolled, QuickBooks issues a consolidated invoice. PDF is saved to Drive and the Invoice Doc Number is stamped on each row.\n\nLive progress is visible in View Company Application. The invoice email remains on hold until documents are verified.', type: 'logic' },
      { title: '4. Verify Supporting Documents', detail: 'A verification popup opens automatically once the pipeline completes. You may also return at any time via Check Supporting Document.\n\n— AI Auto-Check (recommended)\n• Use "Upload all docs" to drop the full batch at once\n• AI reads each file, assigns it to the matching learner, and pre-fills the four field verdicts (name / NRIC / employer / UEN)\n• Click "Approve all AI-confirmed" to bulk-verify clean matches\n• Files that AI cannot match are flagged for manual review\n\n— Manual Check\n• Upload the document per learner (e.g. NRIC scan) — saved to Drive\n• Confirm name / NRIC / employer / UEN match the document\n• Select Verified or Mismatch (Mismatch clears the file and requires re-upload)\n\nBoth modes can be combined: process AI matches first, then handle exceptions manually.', type: 'action' },
      { title: '5. Send Invoice Email to Employer', detail: 'Once every learner in a group is verified, the consolidated invoice email is delivered to the employer. Already-sent invoices are skipped — safe to re-trigger.', type: 'email' },
      { title: '6. Monitor in View Company Application', detail: 'View Company Application serves as your operations dashboard. Each row displays Enrolment ID, Grant ID, Amount, Invoice Doc Number, Doc Verified status, and Email status. The red sidebar badge counts rows still requiring attention.', type: 'success' },
    ],
    endpoints: [
      { method: 'POST', url: '/api/admin/upload-company-applications', description: 'Upload Excel rows and queue them for the auto-enrol pipeline' },
      { method: 'POST', url: '/api/admin/ca-upload-supporting-doc', description: 'Upload a supporting document for a learner to Google Drive' },
      { method: 'POST', url: '/api/admin/ca-verify-and-send', description: 'Mark a row verified/mismatch — auto-sends invoice email when the group is fully verified' },
      { method: 'POST', url: '/api/admin/ca-generate-invoice', description: 'Generate the consolidated QuickBooks invoice for an employer + course-run group' },
      { method: 'POST', url: '/api/admin/ca-run-pipeline', description: 'Run the full pipeline (SSG enrol → grant lookup + course-run sweep → Google Calendar add) for the given applicationIds' },
    ],
    emailTemplates: [
      { name: 'Company Application Invoice Email', path: 'Templates → Company Application Invoice Email', description: 'Consolidated invoice email sent to the employer contact once all supporting docs are verified' },
    ],
    dbTables: [
      { name: 'company_application', description: 'One row per (trainee × course run). Tracks enrolment ID, grant ID, invoice doc number, supporting doc Drive link & verification status, and the auto_enrol_status pipeline state.' },
      { name: 'enrollment', description: 'Native LMS enrollment record created once SSG enrolment succeeds.' },
    ],
  },
  {
    id: 'direct-application',
    title: 'Direct Application Workflow',
    icon: '📋',
    color: 'border-sky-500 bg-sky-50 dark:bg-sky-900/10',
    description: 'End-to-end automation for direct applications: TPG Excel upload, auto-enrolment, calendar synchronization, invoice generation, and master list updates.',
    steps: [
      { title: '1. Admin Uploads TPG Excel', detail: 'Admin downloads the Direct Application Excel from the TPGateway portal and uploads it to the TMS under "Upload Direct Application". The system parses the file and validates NRICs, course codes, and run IDs.', type: 'action' },
      { title: '2. Auto Enrolment in SSG', detail: 'The system automatically triggers the SSG enrolment API for each valid record. If "Auto-Enrol" is enabled, the system submits the enrolment to SSG and retrieves the Enrolment ID (ENR-XXXX) in real-time.', type: 'logic' },
      { title: '3. Calendar Event Synchronization', detail: 'The system checks for an existing Google Calendar event matching the course run. If no event exists, it creates one automatically. It then adds the learner\'s email address as a "needsAction" attendee to all sessions.', type: 'action' },
      { title: '4. Invoice Generation & Delivery', detail: 'The system triggers QuickBooks Online to generate a tax invoice for the net fee. The invoice is automatically sent to the learner\'s email and a copy is stored in Google Drive for audit tracking.', type: 'email' },
      { title: '5. Automatic Master List Update', detail: 'Once enrolled and synced, the learner is automatically added to the course run\'s Master List. This ensures the trainer and administrator have an up-to-date learner list for attendance and assessment.', type: 'success' },
      { title: '6. Status Tracking (ENROL/CAL)', detail: 'The Direct Application dashboard updates the ENROL and CAL columns with green checkmarks to confirm that the SSG enrolment and Calendar synchronization are complete.', type: 'success' },
    ],
    endpoints: [
      { method: 'POST', url: '/api/admin/upload-da-applications', description: 'Upload Excel and trigger initial processing' },
      { method: 'POST', url: '/api/admin/da-add-to-calendar', description: 'Add specific learner to Google Calendar' },
      { method: 'POST', url: '/api/admin/da-enrol', description: 'Manually trigger SSG enrolment' },
    ],
    dbTables: [
      { name: 'da_application', description: 'Primary table for direct applications, tracking status and automation flags' },
      { name: 'enrollment', description: 'Native enrollment table where successful DA records are linked' },
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
  visibleWorkflows?: string[];
}

const WorkflowGuidesView: React.FC<WorkflowGuidesViewProps> = ({ initialWorkflowId, visibleWorkflows }) => {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(initialWorkflowId || null);

  useEffect(() => {
    if (initialWorkflowId !== undefined) {
      setSelectedWorkflow(initialWorkflowId || null);
    }
  }, [initialWorkflowId]);

  const filteredWorkflows = visibleWorkflows
    ? WORKFLOWS.filter(w => visibleWorkflows.includes(w.id))
    : WORKFLOWS;

  const workflow = filteredWorkflows.find(w => w.id === selectedWorkflow);

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
          {filteredWorkflows.map(w => w.externalUrl ? (
            <a
              key={w.id}
              href={w.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-left p-5 rounded-xl border-l-4 ${w.color} border border-gray-200 dark:border-gray-700 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 block`}
            >
              <div className="text-3xl mb-3">{w.icon}</div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-1">{w.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{w.description}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 font-medium">{w.steps.length} steps — Opens in new tab ↗</p>
            </a>
          ) : (
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
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold dark:text-white">{workflow.title}</h2>
            {workflow.externalUrl && (
              <a href={workflow.externalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium">
                ↗
              </a>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{workflow.description}</p>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Workflow Steps</h4>
        <div className="space-y-3">
          {workflow.steps.map((step, i) => {
            const color = stepColors[step.type];
            const Wrapper = step.url ? 'a' : 'div';
            const wrapperProps = step.url ? { href: step.url, target: '_blank', rel: 'noopener noreferrer' } : {};
            return (
              <Wrapper key={i} {...wrapperProps} className={`${color.bg} border ${color.border} rounded-lg p-4 block ${step.url ? 'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0 mt-0.5">{color.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h5 className="font-bold text-gray-900 dark:text-white text-sm">{step.title}</h5>
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/20 text-gray-600 dark:text-gray-400">{color.label}</span>
                      {step.url && <span className="text-xs text-blue-600 dark:text-blue-400 ml-auto">↗</span>}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">{step.detail}</p>
                  </div>
                </div>
              </Wrapper>
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
