import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import { useLms } from '@contexts/LmsContext';

const DEFAULT_SUBJECT = 'Certificate for Completing {COURSE_NAME}';

const DEFAULT_BODY = `<p>Hello {STUDENT_NAME},</p>

<p>Congratulations on successfully completing the course <i>{COURSE_NAME}</i>! We are truly proud of your perseverance, dedication, and motivation throughout the program.</p>

<p>Please find attached your Certificate of Achievement in recognition of your accomplishment.</p>

<p>You can also download your certificate here: <a href="{CERTIFICATE_URL}">{CERTIFICATE_URL}</a></p>

<p>You may also view and download your certificate anytime from your Profile in the LMS portal.</p>

<p>Your commitment to learning and professional growth is commendable, and we wish you continued success in applying your new skills.</p>

<p>For learners who have achieved at least 75% attendance and passed their assessment for WSQ courses, they can view and download their WSQ SOA (Statement of Attainment) through <a href="http://www.MySkillsFuture.gov.sg">http://www.MySkillsFuture.gov.sg</a>.</p>

<p>Please note that SkillsFuture Singapore uses OpenCerts certificates to issue the WSQ Statements of Attainment (SOA). The OpenCerts will be ready for viewing/downloading 4-5 weeks upon completion of WSQ courses.</p>

<p>Feel free to let me know if you need anything else. Thank you.</p>

<p>Best regards,<br/>
<strong>Support Team</strong><br/>
<strong>{COMPANY_SHORT_NAME}</strong><br/>
Tel: 61000613 | Email: <a href="mailto:support@tertiaryinfotech.com">support@tertiaryinfotech.com</a> | WhatsApp: <a href="https://wa.me/6561000613">https://wa.me/6561000613</a></p>`;

const DEFAULT_CC = '';

const CertificateEmailTemplateView: React.FC = () => {
  const { trainingProviderProfile } = useLms();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [originalCc, setOriginalCc] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Test email state
  const [testEmail, setTestEmail] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/certificate-email-template'));
      const data = await response.json();
      if (data.success && data.data) {
        const s = data.data.certificateEmailSubject || '';
        const b = data.data.certificateEmailBody || '';
        const c = data.data.certificateEmailCc || '';
        setSubject(s || DEFAULT_SUBJECT);
        setBody(b || DEFAULT_BODY);
        setCc(c || DEFAULT_CC);
        setOriginalSubject(s);
        setOriginalBody(b);
        setOriginalCc(c);
      } else {
        setSubject(DEFAULT_SUBJECT);
        setBody(DEFAULT_BODY);
        setCc(DEFAULT_CC);
        setOriginalSubject('');
        setOriginalBody('');
        setOriginalCc('');
      }
    } catch (error) {
      console.error('Error fetching certificate email template:', error);
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY);
      setCc(DEFAULT_CC);
      setOriginalSubject('');
      setOriginalBody('');
      setOriginalCc('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/certificate-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificateEmailSubject: subject,
          certificateEmailBody: body,
          certificateEmailCc: cc,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalSubject(subject);
        setOriginalBody(body);
        setOriginalCc(cc);
        setSaveMessage({ type: 'success', text: 'Certificate email template saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save template.' });
      }
    } catch (error) {
      console.error('Error saving certificate email template:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save template.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setSubject(DEFAULT_SUBJECT);
    setBody(DEFAULT_BODY);
    setCc(DEFAULT_CC);
  };

  const handleSendTestEmail = async () => {
    if (!testEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) {
      setTestMessage({ type: 'error', text: 'Please enter a valid email address.' });
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
          templateType: 'certificate',
        }),
      });
      const data = await response.json();
      if (data.success) {
        setTestMessage({ type: 'success', text: `Test email sent to ${testEmail.trim()}` });
      } else {
        setTestMessage({ type: 'error', text: data.error || 'Failed to send test email.' });
      }
    } catch (error) {
      setTestMessage({ type: 'error', text: 'Failed to send test email.' });
    } finally {
      setIsSendingTest(false);
      setTimeout(() => setTestMessage(null), 5000);
    }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody || cc !== originalCc;

  const variables = [
    { name: '{STUDENT_NAME}', desc: "The learner's full name" },
    { name: '{COURSE_NAME}', desc: 'The course title' },
    { name: '{COMPANY_NAME}', desc: 'Your company name from Company Settings' },
    { name: '{COMPANY_SHORT_NAME}', desc: 'Your short company name' },
    { name: '{COMPANY_WEBSITE}', desc: 'Your company website URL' },
    { name: '{CERTIFICATE_URL}', desc: 'Google Drive download link for the certificate' },
  ];

  const companyName = trainingProviderProfile?.companyName || 'Training Provider';
  const companyShortName = trainingProviderProfile?.companyShortname || companyName;
  const companyWebsite = trainingProviderProfile?.companyWebsite || '';

  const replaceVars = (text: string) =>
    text
      .replace(/\{STUDENT_NAME\}/g, 'John Doe')
      .replace(/\{COURSE_NAME\}/g, 'WSQ Advanced Certificate in AI')
      .replace(/\{COMPANY_NAME\}/g, companyName)
      .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
      .replace(/\{COMPANY_WEBSITE\}/g, companyWebsite)
      .replace(/\{CERTIFICATE_URL\}/g, 'https://drive.google.com/file/d/example/view');

  const previewSubject = replaceVars(subject);
  const previewBody = replaceVars(body);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Award} className="w-7 h-7" />
              Certificate Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Customise the email sent to learners when they receive their Certificate of Achievement.
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

              {/* CC Recipients */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default CC Recipients</label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="email1@example.com, email2@example.com"
                />
                <p className="mt-1 text-xs text-gray-400">Comma-separated email addresses to CC on all certificate emails.</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Send Test Email */}
      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Send Test Email</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Send a test email using the current template with sample data to verify formatting.
          </p>
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Enter test email address..."
                className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <Button
              variant="secondary"
              onClick={handleSendTestEmail}
              disabled={isSendingTest || !testEmail.trim()}
            >
              {isSendingTest ? 'Sending...' : 'Send Test'}
            </Button>
          </div>
          {testMessage && (
            <div className={`mt-3 p-2 rounded-md text-xs ${testMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
              {testMessage.text}
            </div>
          )}
        </div>
      </Card>

      {/* Preview */}
      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview</h4>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            {/* Email header */}
            <div className="px-6 py-3 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-500 dark:text-gray-400">Subject:</span>
                <span className="text-gray-900 dark:text-white font-medium">{previewSubject}</span>
              </div>
              {cc && (
                <div className="flex items-center gap-2 text-sm mt-1">
                  <span className="font-medium text-gray-500 dark:text-gray-400">CC:</span>
                  <span className="text-gray-600 dark:text-gray-300 text-xs">{cc}</span>
                </div>
              )}
            </div>
            {/* Email body */}
            <div
              className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300 max-h-96 overflow-y-auto [&_p]:mb-3 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: previewBody }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CertificateEmailTemplateView;
