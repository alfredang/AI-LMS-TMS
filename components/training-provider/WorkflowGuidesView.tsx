import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const WORKFLOWS = [
  {
    id: 'trainer-invitation',
    title: 'Trainer Invitation Workflow',
    description: 'Automated trainer assignment via email invitation with accept/decline webhooks.',
    steps: [
      {
        title: '1. Admin Sends Invitation',
        detail: 'From Upcoming Classes, admin clicks "Send Invitation" for a course run. The system identifies the next available trainer from the approved trainers list (set in the Course record).',
        type: 'action' as const,
      },
      {
        title: '2. System Determines Next Available Trainer',
        detail: 'The system scans the approved trainers list in order and skips: (a) trainers already assigned locally, (b) trainers who have declined, (c) trainers with pending invitations. The first available trainer is selected. Admin can also manually override and select a specific trainer.',
        type: 'logic' as const,
      },
      {
        title: '3. Invitation Email Sent',
        detail: 'An HTML email is sent to the trainer with course details (title, code, dates, TPG trainer), and two buttons: Accept Invitation (green) and Decline Invitation (red). The email includes a link to the TMS portal and a do-not-reply notice.',
        type: 'email' as const,
      },
      {
        title: '4a. Trainer Clicks "Accept"',
        detail: 'The accept webhook fires:\n• Invitation status updated to "accepted"\n• Trainer is automatically assigned to the class (inserted into course_run_trainer)\n• Accept confirmation email sent to the trainer with course schedule details\n• Trainer can view the class in the TMS portal under My Classes',
        type: 'success' as const,
      },
      {
        title: '4b. Trainer Clicks "Decline"',
        detail: 'The decline webhook fires:\n• Invitation status updated to "declined"\n• Decline acknowledgement email sent to the trainer\n• System automatically sends a new invitation to the next available trainer in the approved list (cascading invitation)\n• The cycle repeats from Step 2 for the next trainer',
        type: 'error' as const,
      },
      {
        title: '5. Already Responded',
        detail: 'If a trainer clicks an invitation link that was already responded to, the system shows: "Already Responded — This invitation has already been accepted/The class may have been assigned to another trainer."',
        type: 'logic' as const,
      },
      {
        title: '6. No More Available Trainers',
        detail: 'If all trainers in the approved list have declined or are already assigned, the system logs "No more available trainers" and stops cascading. Admin can then manually assign a trainer or update the approved list.',
        type: 'warning' as const,
      },
    ],
    endpoints: [
      { method: 'POST', url: '/api/admin/send-trainer-invitation', description: 'Send invitation to next available trainer' },
      { method: 'GET', url: '/api/public/trainer-invitation/respond?token={TOKEN}&action=accept', description: 'Accept webhook — assigns trainer to class' },
      { method: 'GET', url: '/api/public/trainer-invitation/respond?token={TOKEN}&action=decline', description: 'Decline webhook — sends next invitation' },
    ],
    emailTemplates: [
      { name: 'Trainer Invitation Email', path: 'Sidebar → Trainer Invitation Email', description: 'The initial invitation email with Accept/Decline buttons' },
      { name: 'Trainer Accept Email', path: 'Sidebar → Trainer Accept/Decline Email → Accept tab', description: 'Confirmation email sent after trainer accepts' },
      { name: 'Trainer Decline Email', path: 'Sidebar → Trainer Accept/Decline Email → Decline tab', description: 'Acknowledgement email sent after trainer declines' },
    ],
    dbTables: [
      { name: 'trainer_invitation', description: 'Tracks each invitation: trainer name, email, token, status (pending/accepted/declined), timestamps' },
      { name: 'course_run_trainer', description: 'Junction table linking trainers to course runs (populated on accept)' },
    ],
  },
];

const stepColors = {
  action: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', icon: '🚀', label: 'Action' },
  logic: { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800', icon: '⚙️', label: 'Logic' },
  email: { bg: 'bg-cyan-50 dark:bg-cyan-900/20', border: 'border-cyan-200 dark:border-cyan-800', icon: '📧', label: 'Email' },
  success: { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', icon: '✅', label: 'Accept Path' },
  error: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', icon: '❌', label: 'Decline Path' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', icon: '⚠️', label: 'Edge Case' },
};

const WorkflowGuidesView: React.FC = () => {
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>('trainer-invitation');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Workflow Guides</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          System workflow documentation with step-by-step logic, API endpoints, and email templates.
        </p>
      </div>

      {WORKFLOWS.map(workflow => (
        <Card key={workflow.id} className="overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpandedWorkflow(expandedWorkflow === workflow.id ? null : workflow.id)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="text-left">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{workflow.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{workflow.description}</p>
            </div>
            <Icon name={IconName.ChevronDown} className={`w-5 h-5 text-gray-400 transition-transform ${expandedWorkflow === workflow.id ? 'rotate-180' : ''}`} />
          </button>

          {expandedWorkflow === workflow.id && (
            <div className="px-6 pb-6 space-y-6">
              {/* Flow Steps */}
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

              {/* Email Templates */}
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

              {/* Database Tables */}
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
            </div>
          )}
        </Card>
      ))}
    </div>
  );
};

export default WorkflowGuidesView;
