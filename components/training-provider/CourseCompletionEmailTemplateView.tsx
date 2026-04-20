import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

const DEFAULT_SUBJECT = 'Course Completion for WSQ - Quickbooks Accounting System for Small and Medium Enterprises';

const DEFAULT_BODY = `Tertiary Courses SG <sales@tertiarycourses.com.sg><br>
Apr 19, 2026, 5:24 PM (22 hours ago)<br>
to support, bcc: iris, bcc: leepeng, bcc: shi.jinmei, bcc: thengshiyun, bcc: kityan_kam, bcc: woansan.tan<br><br>
Dear participants,<br><br>
Thank you for attending WSQ - Quickbooks Accounting System for Small and Medium Enterprises with Tertiary Courses! We hope you found the information and skills valuable for your personal and professional growth.<br><br>
<strong>Certificates</strong><br>
The digital certificate of achievement has been sent to you at the end of the course.<br><br>
For WSQ certification, please follow the steps below to download your SOA e-cert:<br><br>
Go to MySkillsFuture.gov.sg<br>
Click Access E-Services<br>
Select Download Certificates<br>
Log in with Singpass<br>
Go to the Careers &amp; Skills Passport page<br>
Find the certificate you want to download and click Download<br>
Select the Certificate file<br>
A new tab will open with your OpenCert<br>
Click Print<br>
Select Save as PDF or Microsoft Print to PDF<br>
Choose a file location to save the PDF<br><br>
<em>Note:</em><br>
The SOA e-cert is available 3-4 weeks after course completion.<br>
The SOA certificate title reflects the TSC title, not the course title, and indicates the competencies attained after passing the WSQ course assessment.<br><br>
<strong>Course Feedback</strong><br>
Your feedback is important to us! If you haven't sent it already, please take a moment to share your thoughts on your overall experience:<br><br>
TRAQOM survey form<br>
Course feedback form<br><br>
<strong>Post-Course Support</strong><br>
Feel free to reach out to us:<br><br>
Tel: 6100 0613 (9am to 6pm, Mon-Sun excluding Public Holidays)<br>
Email: enquiry@tertiaryinfotech.com<br><br>
<strong>Google Review Promotion</strong><br>
We would appreciate it if you could share a review on Google: Google Review Link.<br><br>
As a token of appreciation, you will receive a 10% discount offer for your next Non-WSQ course sign-up. Request your promo code after submitting your Google review.<br><br>
Note: The promo code is not applicable to WSQ and IBF courses.<br><br>
Thank you very much once again. We look forward to seeing you again in our future courses.<br><br>
From the Tertiary Courses Team`;

const DEFAULT_CC = '';

const CourseCompletionEmailTemplateView: React.FC = () => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [originalCc, setOriginalCc] = useState('');
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
      const response = await fetch(getApiUrl('/api/training-provider/course-completion-email-template'));
      const data = await response.json();
      if (data.success && data.data) {
        const s = data.data.courseCompletionEmailSubject || '';
        const b = data.data.courseCompletionEmailBody || '';
        const c = data.data.courseCompletionEmailCc || '';
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
      console.error('Error fetching course completion email template:', error);
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
      const response = await fetch(getApiUrl('/api/training-provider/course-completion-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseCompletionEmailSubject: subject,
          courseCompletionEmailBody: body,
          courseCompletionEmailCc: cc,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalSubject(subject);
        setOriginalBody(body);
        setOriginalCc(cc);
        setSaveMessage({ type: 'success', text: 'Course completion email template saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save template.' });
      }
    } catch (error) {
      console.error('Error saving course completion email template:', error);
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
    if (!testEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) { setTestMessage({ type: 'error', text: 'Please enter a valid email address.' }); return; }
    setIsSendingTest(true); setTestMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/training-provider/send-test-email'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testEmail: testEmail.trim(), subject, body, templateType: 'course-completion' }) });
      const data = await res.json();
      setTestMessage(data.success ? { type: 'success', text: `Test email sent to ${testEmail.trim()}` } : { type: 'error', text: data.error || 'Failed to send test email.' });
    } catch { setTestMessage({ type: 'error', text: 'Failed to send test email.' }); }
    finally { setIsSendingTest(false); setTimeout(() => setTestMessage(null), 5000); }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody || cc !== originalCc;

  const variables = [
    { name: '{STUDENT_NAME}', desc: 'The learner\'s full name' },
    { name: '{COURSE_NAME}', desc: 'The course title' },
    { name: '{COURSE_CODE}', desc: 'The course code' },
  ];

  const replaceVars = (text: string) =>
    text
      .replace(/\{STUDENT_NAME\}/g, 'John Tan')
      .replace(/\{COURSE_NAME\}/g, 'WSQ - Quickbooks Accounting System for Small and Medium Enterprises')
      .replace(/\{COURSE_CODE\}/g, 'TGS-2024000001');

  const previewSubject = replaceVars(subject);
  const previewBody = replaceVars(body);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Send} className="w-7 h-7" />
              Course Completion and Thank You Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Customise the course completion and thank you email sent to learners after a course ends.
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

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={20}
                  className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono leading-relaxed resize-y"
                  placeholder="Email body content..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default CC Recipients</label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="email1@example.com, email2@example.com"
                />
                <p className="mt-1 text-xs text-gray-400">Comma-separated email addresses to CC on all course completion emails.</p>
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
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-500 dark:text-gray-400">Subject:</span>
                <span className="text-gray-900 dark:text-white font-medium">{previewSubject}</span>
              </div>
              {cc && <div className="flex items-center gap-2 text-sm mt-1"><span className="font-medium text-gray-500 dark:text-gray-400">CC:</span><span className="text-gray-600 dark:text-gray-300 text-xs">{cc}</span></div>}
            </div>
            <div className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300 max-h-96 overflow-y-auto [&_p]:mb-3 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline" dangerouslySetInnerHTML={{ __html: /<[a-z][\s\S]*>/i.test(previewBody) ? previewBody : previewBody.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '<br/>').join('') }} />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CourseCompletionEmailTemplateView;
