import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import { COURSEWARE_CONDITIONS, COURSEWARE_SCENARIOS, COURSEWARE_VARIABLES, coursewareSample,
  isConditionalCoursewareTemplate, renderCoursewareEmail, type CoursewareScenario, type CoursewareValues } from '@lib/learner/coursewareEmailTemplate';

const DEFAULT_SUBJECT = 'Courseware and Attendance Taking for {COURSE_NAME}';

const DEFAULT_BODY = `Dear Learners,<br><br>
<strong>Course Material</strong><br>
You can access the platform at the following link: {SITE_URL}<br><br>
To log in, please use your email address and request a one-time password (OTP) from the login page. If you have been issued a temporary password, please change it immediately after your first login.<br><br>
<strong>E-Attendance Taking (for SSG-funded courses only)</strong><br>
Please click on the link below to take e-attendance for trainer (SingPass app) and trainee (Mobile Camera) in separate option provided.<br><br>
Course Run Code : {DIGITAL_ATTENDANCE_ID}<br><br>
QR Code link: https://www.myskillsfuture.gov.sg/api/take-attendance/{DIGITAL_ATTENDANCE_ID}<br><br>
<strong>Support</strong><br>
If you need further support, please contact us.<br><br>
Tel: {COMPANY_PHONE}<br>
Email: {COMPANY_EMAIL}<br><br>
from {COMPANY_SHORT_NAME} Team`;

const DEFAULT_CC = '';

const CoursewareAttendanceEmailTemplateView: React.FC = () => {
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
  const [scenario, setScenario] = useState<CoursewareScenario>('funded');
  const [previewCompany, setPreviewCompany] = useState<Partial<CoursewareValues>>({});

  useEffect(() => {
    fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/courseware-attendance-email-template'));
      const data = await response.json();
      if (data.success && data.data) {
        const s = data.data.coursewareAttendanceEmailSubject || '';
        const b = data.data.coursewareAttendanceEmailBody || '';
        const c = data.data.coursewareAttendanceEmailCc || '';
        setPreviewCompany(data.data.previewCompany || {});
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
      console.error('Error fetching courseware and attendance email template:', error);
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
      const response = await fetch(getApiUrl('/api/training-provider/courseware-attendance-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coursewareAttendanceEmailSubject: subject,
          coursewareAttendanceEmailBody: body,
          coursewareAttendanceEmailCc: cc,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalSubject(subject);
        setOriginalBody(body);
        setOriginalCc(cc);
        setSaveMessage({ type: 'success', text: 'Courseware and attendance email template saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save template.' });
      }
    } catch (error) {
      console.error('Error saving courseware and attendance email template:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save template.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setSubject(originalSubject || DEFAULT_SUBJECT);
    setBody(originalBody || DEFAULT_BODY);
    setCc(originalCc);
  };

  const handleSendTestEmail = async () => {
    if (!testEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) { setTestMessage({ type: 'error', text: 'Please enter a valid email address.' }); return; }
    setIsSendingTest(true); setTestMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/training-provider/send-test-email'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testEmail: testEmail.trim(), subject, body, templateType: 'courseware-attendance', coursewareScenario: scenario }) });
      const data = await res.json();
      setTestMessage(data.success ? { type: 'success', text: `Test email sent to ${testEmail.trim()}` } : { type: 'error', text: data.error || 'Failed to send test email.' });
    } catch { setTestMessage({ type: 'error', text: 'Failed to send test email.' }); }
    finally { setIsSendingTest(false); setTimeout(() => setTestMessage(null), 5000); }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody || cc !== originalCc;

  const variables = COURSEWARE_VARIABLES.map(name => ({ name: `{${name}}`, desc: name.replace(/_/g, ' ').toLowerCase() }));
  const scenarioLabels: Record<CoursewareScenario, string> = {
    funded: 'WSQ-SWDA funded', 'non-funded': 'Non-funded', unrecognised: 'Unrecognised code (combined guidance)',
  };
  let previewSubject = '', previewBody = '', previewError = '';
  try {
    const rendered = renderCoursewareEmail(subject, body, coursewareSample(scenario, previewCompany));
    previewSubject = rendered.subject; previewBody = rendered.html;
  } catch (error) { previewError = error instanceof Error ? error.message : 'Invalid courseware template.'; }

  return (
    <div className="space-y-6">
      <div className="border-b border-default pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-on-surface flex items-center gap-2">
              <Icon name={IconName.Send} className="w-7 h-7" />
              Courseware and Attendance Taking Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-muted">
              Edit one template. Course codes automatically select the relevant portal, attendance and assessment sections.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleResetToDefault} disabled={isSaving}>
              Reset to Saved
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !hasChanges || !!previewError}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>

      {saveMessage && (
        <div className={`p-3 rounded-md text-sm ${saveMessage.type === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
          {saveMessage.text}
        </div>
      )}

      {/* Available Variables */}
      <Card>
        <div className="p-6 space-y-3">
          <label htmlFor="courseware-scenario" className="block text-sm font-semibold text-on-surface-secondary">Preview and test scenario</label>
          <select id="courseware-scenario" value={scenario} onChange={e => setScenario(e.target.value as CoursewareScenario)} className="w-full rounded-lg border border-strong bg-surface text-on-surface p-2 text-sm">
            {COURSEWARE_SCENARIOS.map(value => <option key={value} value={value}>{scenarioLabels[value]}</option>)}
          </select>
          <p className="text-xs text-muted">This changes sample preview/test data only. Live emails use the learner&apos;s registered class code.</p>
          {!isConditionalCoursewareTemplate(body) && <p className="text-xs text-amber-700">The saved body has no scenario blocks; its existing content is preserved.</p>}
          <details className="text-xs text-muted">
            <summary className="cursor-pointer font-medium">Conditional sections</summary>
            <p className="mt-2">Wrap a section with <code>{'<!-- cw:if SHOW_FUNDED -->'}</code> and <code>{'<!-- cw:end -->'}</code>. Blocks may be nested. Shared wording belongs outside the blocks.</p>
            <p className="mt-2">Available conditions: {COURSEWARE_CONDITIONS.join(', ')}. SHOW_FUNDED and SHOW_NON_FUNDED also appear in combined guidance. HAS_ATTENDANCE_LINK requires a verified attendance code.</p>
          </details>
          {previewError && <p role="alert" className="text-sm text-red-600">{previewError}</p>}
        </div>
      </Card>
      <Card>
        <div className="p-4">
          <h4 className="text-sm font-semibold text-on-surface-secondary mb-3">Available Variables</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {variables.map((v) => (
              <div key={v.name} className="flex items-start gap-2 text-xs">
                <code className="px-1.5 py-0.5 bg-info-bg text-primary rounded font-mono shrink-0">{v.name}</code>
                <span className="text-muted">{v.desc}</span>
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
                <label className="block text-sm font-medium text-on-surface-secondary">Email Template</label>
                <span className="text-xs text-gray-400">{hasChanges ? 'Unsaved changes' : 'Up to date'}</span>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-on-surface bg-surface border border-strong rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="Email subject line..."
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={16}
                  className="block w-full px-4 py-3 text-sm text-on-surface bg-surface border border-strong rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono leading-relaxed resize-y"
                  placeholder="Email body content..."
                />
              </div>

              {/* CC Recipients */}
              <div>
                <label className="block text-sm font-medium text-on-surface-secondary mb-1">Default CC Recipients</label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-on-surface bg-surface border border-strong rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="email1@example.com, email2@example.com"
                />
                <p className="mt-1 text-xs text-gray-400">Comma-separated email addresses to CC on all courseware and attendance emails.</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-on-surface-secondary mb-3">Send Test Email</h4>
          <div className="flex gap-3 items-start">
            <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Enter test email address..." className="flex-1 px-4 py-2.5 text-sm text-on-surface bg-surface border border-strong rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Button variant="secondary" onClick={handleSendTestEmail} disabled={isSendingTest || !testEmail.trim() || !!previewError}>{isSendingTest ? 'Sending...' : 'Send Test'}</Button>
          </div>
          {testMessage && <div className={`mt-3 p-2 rounded-md text-xs ${testMessage.type === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>{testMessage.text}</div>}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-on-surface-secondary mb-3">Preview</h4>
          <div className="border border-default rounded-lg bg-surface overflow-hidden">
            <div className="px-6 py-3 bg-surface-elevated border-b border-default">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-muted">Subject:</span>
                <span className="text-on-surface font-medium">{previewSubject}</span>
              </div>
              {cc && <div className="flex items-center gap-2 text-sm mt-1"><span className="font-medium text-muted">CC:</span><span className="text-on-surface-secondary text-xs">{cc}</span></div>}
            </div>
            {/* design-tokens-allow: email preview is always white paper. */}
            <iframe title="Courseware email preview" sandbox="" srcDoc={previewBody} className="w-full border-0" style={{ height: 720, background: '#fff' }} />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CoursewareAttendanceEmailTemplateView;
