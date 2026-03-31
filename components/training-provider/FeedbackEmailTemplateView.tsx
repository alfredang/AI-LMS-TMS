import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import { useLms } from '@contexts/LmsContext';

const DEFAULT_SUBJECT = 'Feedback from {SENDER_NAME} - {COMPANY_NAME}';

const DEFAULT_BODY = `<h2 style="color: #1e40af;">New Feedback Received</h2>

<table>
<tr><td><strong>Name:</strong></td><td>{SENDER_NAME}</td></tr>
<tr><td><strong>Email:</strong></td><td>{SENDER_EMAIL}</td></tr>
<tr><td><strong>Tel:</strong></td><td>{SENDER_TEL}</td></tr>
<tr><td><strong>Message:</strong></td><td>{MESSAGE}</td></tr>
</table>

<p style="font-size: 12px; color: #9ca3af;">This feedback was submitted via the {COMPANY_NAME} login page.</p>`;

const FeedbackEmailTemplateView: React.FC = () => {
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

  useEffect(() => {
    fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/feedback-email-template'));
      const data = await response.json();
      if (data.success && data.data) {
        const s = data.data.feedbackEmailSubject || '';
        const b = data.data.feedbackEmailBody || '';
        const c = data.data.feedbackEmailCc || '';
        setSubject(s || DEFAULT_SUBJECT);
        setBody(b || DEFAULT_BODY);
        setCc(c);
        setOriginalSubject(s);
        setOriginalBody(b);
        setOriginalCc(c);
      } else {
        setSubject(DEFAULT_SUBJECT);
        setBody(DEFAULT_BODY);
        setCc('');
        setOriginalSubject('');
        setOriginalBody('');
        setOriginalCc('');
      }
    } catch (error) {
      console.error('Error fetching feedback email template:', error);
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY);
      setCc('');
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
      const response = await fetch(getApiUrl('/api/training-provider/feedback-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedbackEmailSubject: subject, feedbackEmailBody: body, feedbackEmailCc: cc }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalSubject(subject);
        setOriginalBody(body);
        setOriginalCc(cc);
        setSaveMessage({ type: 'success', text: 'Feedback email template saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save template.' });
      }
    } catch (error) {
      console.error('Error saving feedback email template:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save template.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setSubject(DEFAULT_SUBJECT);
    setBody(DEFAULT_BODY);
    setCc('');
  };

  const hasChanges = subject !== originalSubject || body !== originalBody || cc !== originalCc;

  const variables = [
    { name: '{SENDER_NAME}', desc: 'Name of the person submitting feedback' },
    { name: '{SENDER_EMAIL}', desc: 'Email of the person submitting feedback' },
    { name: '{SENDER_TEL}', desc: 'Phone number of the person submitting feedback' },
    { name: '{MESSAGE}', desc: 'The feedback message content' },
    { name: '{COMPANY_NAME}', desc: 'Your company name from Company Settings' },
  ];

  const companyName = trainingProviderProfile?.companyName || 'Training Provider';

  const replaceVars = (text: string) =>
    text
      .replace(/\{SENDER_NAME\}/g, 'Jane Smith')
      .replace(/\{SENDER_EMAIL\}/g, 'jane@example.com')
      .replace(/\{SENDER_TEL\}/g, '+65 9123 4567')
      .replace(/\{MESSAGE\}/g, 'Great learning experience! The course materials were very helpful.')
      .replace(/\{COMPANY_NAME\}/g, companyName);

  const previewSubject = replaceVars(subject);
  const previewBody = replaceVars(body);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Chat} className="w-7 h-7" />
              Feedback Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Customise the email sent to you when someone submits feedback from the login page.
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body (HTML supported)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={16}
                  className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono leading-relaxed resize-y"
                  placeholder="Email body content (HTML)..."
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
                <p className="mt-1 text-xs text-gray-400">Comma-separated email addresses to CC on all feedback emails.</p>
              </div>
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
            {/* Email body - render HTML */}
            <div
              className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300 max-h-72 overflow-y-auto prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: previewBody }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default FeedbackEmailTemplateView;
