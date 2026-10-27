import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import {
  DEFAULT_MMS_ACCESS_EMAIL_BODY,
  DEFAULT_MMS_ACCESS_EMAIL_SUBJECT,
  renderMmsAccessEmail,
  type MmsAccessEmailValues,
} from '@/lib/mmsSync/accessEmailTemplate';

type PreviewRole = 'learner' | 'trainer';

const VARIABLES = [
  '{PURPOSE}',
  '{RECIPIENT_NAME}',
  '{ACTION}',
  '{ROLE}',
  '{COURSE_TITLE}',
  '{COURSE_CODE}',
  '{CLASS_ID}',
  '{SESSIONS}',
  '{MMS_CLASS_URL}',
  '{MMS_LOGIN_URL}',
  '{FEEDBACK_URL}',
  '{FEEDBACK_LINE}',
  '{SUPPORT}',
];

const sampleValues = (role: PreviewRole): MmsAccessEmailValues => ({
  PURPOSE: 'Class access',
  RECIPIENT_NAME: role === 'trainer' ? 'Danny Trainer' : 'Alex Learner',
  ACTION: role === 'trainer' ? 'conduct' : 'attend',
  ROLE: role === 'trainer' ? 'Trainer' : 'Learner',
  COURSE_TITLE: 'Statistical Process Control (SPC) Training',
  COURSE_CODE: 'C769',
  CLASS_ID: 'C004129',
  SESSIONS: '2026-11-09, 09:30–17:30 SGT — Virtual Classroom — https://meet.google.com/example',
  MMS_CLASS_URL: 'https://www.tertiarycourses.com.sg/lmslogin/index/class/?run_id=5206',
  MMS_LOGIN_URL: 'https://www.tertiarycourses.com.sg/lmslogin/',
  FEEDBACK_URL: 'https://lms-tms.tertiaryinfotech.com/feedback/example',
  FEEDBACK_LINE: '\nClass feedback: https://lms-tms.tertiaryinfotech.com/feedback/example',
  SUPPORT: 'support@tertiaryinfotech.com',
});

const MmsAccessEmailTemplateView: React.FC = () => {
  const [subject, setSubject] = useState(DEFAULT_MMS_ACCESS_EMAIL_SUBJECT);
  const [body, setBody] = useState(DEFAULT_MMS_ACCESS_EMAIL_BODY);
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [previewRole, setPreviewRole] = useState<PreviewRole>('learner');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchTemplate = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(getApiUrl('/api/training-provider/mms-access-email-template'));
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load template.');
        const nextSubject = data.data?.mmsAccessEmailSubject || DEFAULT_MMS_ACCESS_EMAIL_SUBJECT;
        const nextBody = data.data?.mmsAccessEmailBody || DEFAULT_MMS_ACCESS_EMAIL_BODY;
        setSubject(nextSubject);
        setBody(nextBody);
        setOriginalSubject(nextSubject);
        setOriginalBody(nextBody);
      } catch (error) {
        setSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load template.' });
      } finally {
        setIsLoading(false);
      }
    };
    void fetchTemplate();
  }, []);

  const preview = useMemo(
    () => renderMmsAccessEmail({ subject, body }, sampleValues(previewRole)),
    [subject, body, previewRole],
  );

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/mms-access-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mmsAccessEmailSubject: subject, mmsAccessEmailBody: body }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to save template.');
      setOriginalSubject(subject);
      setOriginalBody(body);
      setSaveMessage({ type: 'success', text: 'MMS access email template saved successfully.' });
    } catch (error) {
      setSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save template.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) {
      setTestMessage({ type: 'error', text: 'Enter a valid email address.' });
      return;
    }
    setIsSendingTest(true);
    setTestMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/send-test-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testEmail: testEmail.trim(),
          subject,
          body,
          templateType: previewRole === 'trainer' ? 'mms-access-trainer' : 'mms-access-learner',
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to send test email.');
      setTestMessage({ type: 'success', text: `Test ${previewRole} email sent to ${testEmail.trim()}.` });
    } catch (error) {
      setTestMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to send test email.' });
    } finally {
      setIsSendingTest(false);
    }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Mail} className="w-7 h-7" />
              MMS Class Access Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Sent by TMS to trainers and learners after an approved C-series class is ready in MMS. This does not change the trainer invitation email.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => { setSubject(DEFAULT_MMS_ACCESS_EMAIL_SUBJECT); setBody(DEFAULT_MMS_ACCESS_EMAIL_BODY); }}
              disabled={isSaving}
            >
              Reset to Default
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isLoading || !hasChanges || !subject.trim() || !body.trim()}>
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
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Available Variables</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            ACTION and ROLE automatically change between trainer and learner. FEEDBACK_LINE includes a leading line break and its label, and disappears when no feedback link is available.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {VARIABLES.map(variable => (
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <span className="ml-3 text-gray-500">Loading template...</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  maxLength={500}
                  onChange={event => setSubject(event.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body</label>
                <textarea
                  value={body}
                  maxLength={20000}
                  onChange={event => setBody(event.target.value)}
                  rows={18}
                  className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono leading-relaxed resize-y"
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Preview and Test</h4>
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              {(['learner', 'trainer'] as PreviewRole[]).map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setPreviewRole(role)}
                  className={`px-4 py-2 text-sm capitalize ${previewRole === role ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-gray-300'}`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Subject: </span>
              <span className="text-sm text-gray-900 dark:text-white font-medium">{preview.subject}</span>
            </div>
            <div className="px-6 py-5 text-sm max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
          <div className="flex flex-wrap gap-3 items-start">
            <input
              type="email"
              value={testEmail}
              onChange={event => setTestEmail(event.target.value)}
              placeholder="Enter test email address..."
              className="flex-1 min-w-64 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button variant="secondary" onClick={handleSendTest} disabled={isSendingTest || !testEmail.trim()}>
              {isSendingTest ? 'Sending...' : `Send ${previewRole} Test`}
            </Button>
          </div>
          {testMessage && (
            <div className={`p-2 rounded-md text-xs ${testMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
              {testMessage.text}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default MmsAccessEmailTemplateView;
