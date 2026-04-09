import React, { useEffect, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import {
  DEFAULT_TRAINER_INVITATION_BODY,
  DEFAULT_TRAINER_INVITATION_SUBJECT,
  renderInvitationTemplate,
  renderInvitationHtmlEmail
} from '@/lib/trainerInvitations';

const TrainerInvitationEmailTemplateView: React.FC = () => {
  const { trainingProviderProfile } = useLms();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/trainer-invitation-email-template'));
      const data = await response.json();
      const nextSubject = data?.data?.trainerInvitationEmailSubject || DEFAULT_TRAINER_INVITATION_SUBJECT;
      const nextBody = data?.data?.trainerInvitationEmailBody || DEFAULT_TRAINER_INVITATION_BODY;
      setSubject(nextSubject);
      setBody(nextBody);
      setOriginalSubject(data?.data?.trainerInvitationEmailSubject || '');
      setOriginalBody(data?.data?.trainerInvitationEmailBody || '');
    } catch (error) {
      console.error('Error fetching trainer invitation email template:', error);
      setSubject(DEFAULT_TRAINER_INVITATION_SUBJECT);
      setBody(DEFAULT_TRAINER_INVITATION_BODY);
      setOriginalSubject('');
      setOriginalBody('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/trainer-invitation-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainerInvitationEmailSubject: subject,
          trainerInvitationEmailBody: body,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to save template.');
      }
      setOriginalSubject(subject);
      setOriginalBody(body);
      setSaveMessage({ type: 'success', text: 'Trainer invitation email template saved successfully.' });
    } catch (error) {
      console.error('Error saving trainer invitation email template:', error);
      setSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save template.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const variables = [
    '{TRAINER_NAME}',
    '{COURSE_TITLE}',
    '{COURSE_CODE}',
    '{COURSE_RUN_ID}',
    '{START_DATE}',
    '{END_DATE}',
    '{TPG_TRAINER}',
    '{COMPANY_SHORT_NAME}',
    '{ACCEPT_BUTTON}',
    '{DECLINE_BUTTON}',
  ];

  const previewSubject = renderInvitationTemplate(subject || DEFAULT_TRAINER_INVITATION_SUBJECT, {
    COMPANY_SHORT_NAME: trainingProviderProfile?.companyShortname || 'Training Provider',
    TRAINER_NAME: 'Tan Woei Ming',
    COURSE_TITLE: 'Generative AI for Business',
    COURSE_CODE: 'TGS-2023036653',
    COURSE_RUN_ID: '1131876',
    START_DATE: '06/04/2026',
    END_DATE: '09/04/2026',
    TPG_TRAINER: 'Dr Alvin Ang Wei Hern',
  });

  const previewBody = renderInvitationTemplate(body || DEFAULT_TRAINER_INVITATION_BODY, {
    COMPANY_SHORT_NAME: trainingProviderProfile?.companyShortname || 'Training Provider',
    TRAINER_NAME: 'Tan Woei Ming',
    COURSE_TITLE: 'Generative AI for Business',
    COURSE_CODE: 'TGS-2023036653',
    COURSE_RUN_ID: '1131876',
    START_DATE: '06/04/2026',
    END_DATE: '09/04/2026',
    TPG_TRAINER: 'Dr Alvin Ang Wei Hern',
  });

  const previewHtmlBody = renderInvitationHtmlEmail(
    body || DEFAULT_TRAINER_INVITATION_BODY,
    {
      COMPANY_SHORT_NAME: trainingProviderProfile?.companyShortname || 'Training Provider',
      TRAINER_NAME: 'Tan Woei Ming',
      COURSE_TITLE: 'Generative AI for Business',
      COURSE_CODE: 'TGS-2023036653',
      COURSE_RUN_ID: '1131876',
      START_DATE: '06/04/2026',
      END_DATE: '09/04/2026',
      TPG_TRAINER: 'Dr Alvin Ang Wei Hern',
    },
    '#',
    '#'
  );

  const handleSendTestEmail = async () => {
    if (!testEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) { setTestMessage({ type: 'error', text: 'Please enter a valid email address.' }); return; }
    setIsSendingTest(true); setTestMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/training-provider/send-test-email'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testEmail: testEmail.trim(), subject, body, templateType: 'trainer-invitation' }) });
      const data = await res.json();
      setTestMessage(data.success ? { type: 'success', text: `Test email sent to ${testEmail.trim()}` } : { type: 'error', text: data.error || 'Failed to send test email.' });
    } catch { setTestMessage({ type: 'error', text: 'Failed to send test email.' }); }
    finally { setIsSendingTest(false); setTimeout(() => setTestMessage(null), 5000); }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Send} className="w-7 h-7" />
              Trainer Invitation Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Configure the email admins send to the next available trainer from Upcoming Classes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => { setSubject(DEFAULT_TRAINER_INVITATION_SUBJECT); setBody(DEFAULT_TRAINER_INVITATION_BODY); }} disabled={isSaving}>
              Reset to Default
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {saveMessage && (
        <div className={`p-3 rounded-md text-sm ${saveMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
          {saveMessage.text}
        </div>
      )}

      <Card>
        <div className="p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Available Variables</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {variables.map((variable) => (
              <code key={variable} className="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                {variable}
              </code>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500">Loading template...</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono leading-relaxed resize-y"
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Send Test Email</h4>
          <div className="flex gap-3 items-start">
            <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Enter test email address..." className="flex-1 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Button variant="secondary" onClick={handleSendTestEmail} disabled={isSendingTest || !testEmail.trim()}>{isSendingTest ? 'Sending...' : 'Send Test'}</Button>
          </div>
          {testMessage && <div className={`mt-3 p-2 rounded-md text-xs ${testMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>{testMessage.text}</div>}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview</h4>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 text-sm"><span className="font-medium text-gray-500 dark:text-gray-400">Subject:</span><span className="text-gray-900 dark:text-white font-medium">{previewSubject}</span></div>
            </div>
            <div className="px-6 py-5 text-sm max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{ __html: previewHtmlBody }} />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default TrainerInvitationEmailTemplateView;
