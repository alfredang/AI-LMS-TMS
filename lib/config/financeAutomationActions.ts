/**
 * Registry for finance automation migrated from Google Sheets "Start Processing".
 * Webhook actions read URL from env: process.env[action.webhookEnvKey].
 */

export type FinanceAutomationKind = 'ssg_grant_refresh' | 'n8n_webhook';

export interface FinanceAutomationActionDef {
  id: string;
  menuLabel: string;
  appsScriptFunction: string;
  kind: FinanceAutomationKind;
  /** For n8n_webhook: name of env var holding the full webhook URL */
  webhookEnvKey?: string;
  httpMethod?: 'POST' | 'GET';
  description: string;
}

export const FINANCE_AUTOMATION_ACTIONS: FinanceAutomationActionDef[] = [
  {
    id: 'process-grants',
    menuLabel: 'Process Grants',
    appsScriptFunction: 'processGrants',
    kind: 'ssg_grant_refresh',
    description: 'Fetch grant details from SSG for selected enrolment IDs and upsert into ssg_grants.',
  },
  {
    id: 'update-grant-status-total',
    menuLabel: 'Update Grant Status & Total Grant',
    appsScriptFunction: 'updategrantstatusandtotalgrant',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_UPDATE_GRANT_STATUS_TOTAL',
    description: 'Triggers n8n workflow (legacy sheet automation).',
  },
  {
    id: 'update-assessment',
    menuLabel: 'Update Assessment',
    appsScriptFunction: 'updateManualAssessment',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_UPDATE_ASSESSMENT',
    httpMethod: 'GET',
    description: 'Triggers n8n assessment sync (GET webhook).',
  },
  {
    id: 'create-enrolments-error-status',
    menuLabel: 'Create Enrolments For Error Status',
    appsScriptFunction: 'createEnrolmentsForErrorStatus',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_CREATE_ENROLMENTS_ERROR_STATUS',
    description: 'Triggers n8n workflow for error-status enrolments.',
  },
  {
    id: 'manual-enrolment',
    menuLabel: 'Manual Enrolment',
    appsScriptFunction: 'manualEnrolmentTrigger',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_MANUAL_ENROLMENT',
    description: 'Triggers n8n manual enrolment workflow.',
  },
  {
    id: 'update-claim-id-all-course-run',
    menuLabel: 'Update Claim ID In All Course Run',
    appsScriptFunction: 'updateClaimIDInAllCourseRun',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_UPDATE_CLAIM_ID_ALL_COURSE_RUN',
    description: 'Triggers n8n claim ID update across course runs.',
  },
  {
    id: 'check-duplicates-da',
    menuLabel: 'Check Duplicates for DA',
    appsScriptFunction: 'check_duplicates_for_da',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_CHECK_DUPLICATES_DA',
    description: 'Triggers n8n direct-application duplicate check.',
  },
  {
    id: 'direct-application-enrolment',
    menuLabel: 'For Direct Application',
    appsScriptFunction: 'direct_application_enrolment',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_DIRECT_APPLICATION_ENROLMENT',
    description: 'Triggers n8n direct application enrolment workflow.',
  },
  {
    id: 'grant-query',
    menuLabel: 'For Grant Query',
    appsScriptFunction: 'grantquery',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_GRANT_QUERY',
    description: 'Triggers n8n grant query workflow.',
  },
  {
    id: 'process-enrolment-grants-backup',
    menuLabel: 'Process Enrolments & Grant (Marcus Backup)',
    appsScriptFunction: 'processEnrolmentGrants',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_PROCESS_ENROLMENT_GRANTS',
    description: 'Triggers n8n backup workflow.',
  },
  {
    id: 'company-sponsored-enrolment',
    menuLabel: 'Create Employer Enrolment',
    appsScriptFunction: 'company_sponsored_application_enrolment',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_COMPANY_SPONSORED_ENROLMENT',
    description: 'Triggers n8n company-sponsored / employer enrolment workflow.',
  },
  {
    id: 'append-cancelled-class-trainees',
    menuLabel: 'Append Cancelled Class Trainees (Enrolment & Invoice)',
    appsScriptFunction: 'append_cancelled_class_trainees_enrolment_and_invoice_data',
    kind: 'n8n_webhook',
    webhookEnvKey: 'N8N_WEBHOOK_APPEND_CANCELLED_CLASS_TRAINEES',
    description: 'Triggers n8n workflow for cancelled class trainees data.',
  },
];

export function getFinanceAutomationAction(actionId: string): FinanceAutomationActionDef | undefined {
  return FINANCE_AUTOMATION_ACTIONS.find((a) => a.id === actionId);
}
