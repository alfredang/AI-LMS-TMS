/**
 * Adds custom menus to the Google Sheets UI.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Start Processing')
    .addItem('Update Grant Status & Total Grant','updategrantstatusandtotalgrant')
    .addItem('Update Assessment','updateManualAssessment')
    .addItem('Create Enrolments For Error Status','createEnrolmentsForErrorStatus')
    .addItem('Manual Enrolment','manualEnrolmentTrigger')
    .addItem('Update Claim ID In All Course Run','updateClaimIDInAllCourseRun')
    .addSeparator()
    .addItem('Check Duplicates for DA','check_duplicates_for_da')
    .addItem('For Direct Application','direct_application_enrolment')
    .addItem('For Grant Query','grantquery')
    .addSeparator()
    .addItem('Process Enrolments & Grant (Marcus Backup)','processEnrolmentGrants')
    .addItem('Process Enrolments', 'processEnrolments')
    .addItem('Process Grants', 'processGrants')
    // .addItem('Cancel Enrolments', 'processCancellations')
    // .addItem('Search Enrolments', 'searchEnrolments')
    // .addItem('Update Fee Collection', 'updateFeeCollections')
    // .addItem('Update Calendar Data', 'appendNewRows')
    // .addItem('Append Concluded Events', 'updateEventStatuses')
    // .addItem('Process Assessments', 'processAssessmentData')
    // .addItem('Get Attendance', 'processAllRuns')   
    // .addItem('Map Order Reg. No.', 'mapOrderRegistrationNumber')
    .addItem('Create Invoices', 'processGroupedInvoices')
    .addItem('Send Invoice Email', 'processInvoiceEmails')
    .addSeparator()
    .addItem('Create Employer Enrolment','company_sponsored_application_enrolment')
    .addSeparator()
    .addItem('Append Cancelled Class Trainees (Enrolment & Invoice)',
  'append_cancelled_class_trainees_enrolment_and_invoice_data')
    // .addItem('Create Invoice V2', 'createQBInvoiceV2')            
    .addToUi();
}