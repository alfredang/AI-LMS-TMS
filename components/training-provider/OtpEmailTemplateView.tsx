import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import { useLms } from '@contexts/LmsContext';

const DEFAULT_SUBJECT = '{COMPANY_SHORT_NAME} LMS - Verification Code';

const DEFAULT_BODY = `Hi,

Your OTP is {OTP}.

Please use this to login to your account on the {COMPANY_SHORT_NAME} AI LMS TMS {SITE_URL} within {EXPIRY_MINUTES} minutes.

If your OTP does not work, please request for a new OTP on the login page.

If you did not make this request, you may ignore this email. Do not share this OTP with anyone. This is strictly confidential and to be used by you only.

Warm regards
{COMPANY_SHORT_NAME}`;

const OtpEmailTemplateView: React.FC = () => {
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
    fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/otp-email-template'));
      const data = await response.json();
      if (data.success && data.data) {
        const s = data.data.otpEmailSubject || '';
        const b = data.data.otpEmailBody || '';
        setSubject(s || DEFAULT_SUBJECT);
        setBody(b || DEFAULT_BODY);
        setOriginalSubject(s);
        setOriginalBody(b);
      } else {
        setSubject(DEFAULT_SUBJECT);
        setBody(DEFAULT_BODY);
        setOriginalSubject('');
        setOriginalBody('');
      }
    } catch (error) {
      console.error('Error fetching OTP email template:', error);
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY);
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
      const response = await fetch(getApiUrl('/api/training-provider/otp-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpEmailSubject: subject, otpEmailBody: body }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalSubject(subject);
        setOriginalBody(body);
        setSaveMessage({ type: 'success', text: 'OTP email template saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save template.' });
      }
    } catch (error) {
      console.error('Error saving OTP email template:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save template.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setSubject(DEFAULT_SUBJECT);
    setBody(DEFAULT_BODY);
  };

  const handleSendTestEmail = async () => {
    if (!testEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) { setTestMessage({ type: 'error', text: 'Please enter a valid email address.' }); return; }
    setIsSendingTest(true); setTestMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/training-provider/send-test-email'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testEmail: testEmail.trim(), subject, body, templateType: 'otp' }) });
      const data = await res.json();
      setTestMessage(data.success ? { type: 'success', text: `Test email sent to ${testEmail.trim()}` } : { type: 'error', text: data.error || 'Failed to send test email.' });
    } catch { setTestMessage({ type: 'error', text: 'Failed to send test email.' }); }
    finally { setIsSendingTest(false); setTimeout(() => setTestMessage(null), 5000); }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody;

  const variables = [
    { name: '{OTP}', desc: 'The 6-digit verification code' },
    { name: '{COMPANY_SHORT_NAME}', desc: 'Your short company name from Company Settings' },
    { name: '{SITE_URL}', desc: 'Your LMS/TMS site URL' },
    { name: '{EXPIRY_MINUTES}', desc: 'OTP expiry time in minutes' },
    { name: '{USER_EMAIL}', desc: 'The recipient\'s email address' },
  ];

  // Preview: replace variables with sample values
  const companyShortName = trainingProviderProfile?.companyShortname || 'Training Provider';

  const siteUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/';

  const previewSubject = subject
    .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
    .replace(/\{OTP\}/g, '123456')
    .replace(/\{SITE_URL\}/g, siteUrl)
    .replace(/\{EXPIRY_MINUTES\}/g, '30')
    .replace(/\{USER_EMAIL\}/g, 'user@example.com');

  const previewBody = body
    .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
    .replace(/\{OTP\}/g, '123456')
    .replace(/\{SITE_URL\}/g, siteUrl)
    .replace(/\{EXPIRY_MINUTES\}/g, '30')
    .replace(/\{USER_EMAIL\}/g, 'user@example.com');

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Mail} className="w-7 h-7" />
              OTP Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Customise the email sent to users when they request an OTP for login.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleResetToDefault} disabled={isSaving}>
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

      {/* Available Variables */}
      <Card>
        <div className="p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Available Variables</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {variables.map((v) => (
              <div key={v.name} className="flex items-start gap-2 text-xs">
                <code className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-mono shrink-0">{v.name}</code>
                <span className="text-gray-500 dark:text-gray-400">{v.desc}</span>
              </div>
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
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Template</label>
                <span className="text-xs text-gray-400">{hasChanges ? 'Unsaved changes' : 'Up to date'}</span>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="Email subject line..."
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono leading-relaxed resize-y"
                  placeholder="Email body content..."
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
            <div className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300 max-h-96 overflow-y-auto [&_p]:mb-3 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline" dangerouslySetInnerHTML={{ __html: /<[a-z][\s\S]*>/i.test(previewBody) ? previewBody : previewBody.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '<br/>').join('') }} />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default OtpEmailTemplateView;
