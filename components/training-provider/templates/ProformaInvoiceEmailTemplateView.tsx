import React, { useEffect, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Icon, IconName } from '../../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

const DEFAULT_SUBJECT = 'Proforma Invoice for {COURSE_NAME}';

const DEFAULT_BODY = `Dear {LEARNER_NAME},

Thank you for your interest in the following course:

Course Title: {COURSE_NAME}
Course Code: {COURSE_CODE}
Course Run ID: {COURSE_RUN_ID}
Start Date: {START_DATE}
End Date: {END_DATE}

Please find attached your ProForma Invoice with the following fee breakdown:

Course Fee (excl. GST): {FEES_EXCL_GST}
GST (9%): {GST_AMOUNT}
Total Course Fee: {TOTAL_COURSE_FEE}
Applicable Funding: {FUNDING_TYPE}
Estimated Net Fee After SkillsFuture Credit: {NET_FEE}

Important: This is a PROFORMA INVOICE only. It is not a tax invoice and is not a demand for payment. It is issued solely for the purpose of SkillsFuture Credit claim submission or employer sponsorship approval.

Next Steps

Option 1 - SkillsFuture Credit Claim (Self-Sponsored)
1. Log in to MySkillsFuture portal at https://www.myskillsfuture.gov.sg
2. Navigate to "SkillsFuture Credit" and click "Submit a Claim"
3. Upload this ProForma Invoice as your supporting document
4. Once your claim is approved, please contact us to confirm your enrollment

Option 2 - Employer Sponsorship
1. Submit this ProForma Invoice to your HR or finance department for approval
2. Once approval is obtained, please contact us to proceed with enrollment

Please note that this ProForma Invoice does not confirm your seat in the course. Enrollment will only be confirmed once your SkillsFuture Credit claim or employer sponsorship is approved and we have received your confirmation.

Support
If you have any questions, please contact us:

Tel: 6100 0613 (9am to 6pm, Mon-Sun excluding Public Holidays)
Email: enquiry@tertiaryinfotech.com

Thank you for choosing Tertiary Infotech Academy as your learning partner.

From Tertiary Infotech Team`;

const DEFAULT_CC = '';

const ProformaInvoiceEmailTemplateView: React.FC = () => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [originalCc, setOriginalCc] = useState('');
  const [originalAttachmentUrl, setOriginalAttachmentUrl] = useState('');
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
      const response = await fetch(getApiUrl('/api/finance/invoice/proforma-invoice-email-template'));
      const data = await response.json();
      const nextSubject = data?.data?.proformaInvoiceEmailSubject || DEFAULT_SUBJECT;
      const nextBody = data?.data?.proformaInvoiceEmailBody || DEFAULT_BODY;
      const nextCc = data?.data?.proformaInvoiceEmailCc || DEFAULT_CC;
      const nextAttachmentUrl = data?.data?.proformaInvoiceEmailAttachmentUrl || '';
      setSubject(nextSubject);
      setBody(nextBody);
      setCc(nextCc);
      setOriginalSubject(data?.data?.proformaInvoiceEmailSubject || '');
      setOriginalBody(data?.data?.proformaInvoiceEmailBody || '');
      setAttachmentUrl(nextAttachmentUrl);
      setOriginalCc(nextCc);
      setOriginalAttachmentUrl(nextAttachmentUrl);
    } catch (error) {
      console.error('Error fetching proforma invoice email template:', error);
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY);
      setCc(DEFAULT_CC);
    setAttachmentUrl('');
      setOriginalSubject('');
      setOriginalBody('');
      setOriginalCc('');
      setOriginalAttachmentUrl('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/finance/invoice/proforma-invoice-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proformaInvoiceEmailSubject: subject,
          proformaInvoiceEmailBody: body,
          proformaInvoiceEmailCc: cc,
          proformaInvoiceEmailAttachmentUrl: attachmentUrl,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to save template.');
      }
      setOriginalSubject(subject);
      setOriginalBody(body);
      setOriginalCc(cc);
      setOriginalAttachmentUrl(attachmentUrl);
      setSaveMessage({ type: 'success', text: 'Proforma invoice email template saved successfully.' });
    } catch (error) {
      console.error('Error saving proforma invoice email template:', error);
      setSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save template.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setSubject(DEFAULT_SUBJECT);
    setBody(DEFAULT_BODY);
    setCc(DEFAULT_CC);
    setAttachmentUrl('');
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
          templateType: 'proforma-invoice',
          attachmentUrl: attachmentUrl.trim() || undefined,
        }),
      });
      const data = await response.json();
      setTestMessage(
        data.success
          ? { type: 'success', text: `Test email sent to ${testEmail.trim()}` }
          : { type: 'error', text: data.error || 'Failed to send test email.' }
      );
    } catch {
      setTestMessage({ type: 'error', text: 'Failed to send test email.' });
    } finally {
      setIsSendingTest(false);
      setTimeout(() => setTestMessage(null), 5000);
    }
  };

  const hasChanges = subject !== originalSubject || body !== originalBody || cc !== originalCc || attachmentUrl !== originalAttachmentUrl;

  const variables = [
    { name: '{LEARNER_NAME}', desc: "The learner's full name" },
    { name: '{COURSE_NAME}', desc: 'The course title' },
    { name: '{COURSE_CODE}', desc: 'The course code' },
    { name: '{COURSE_RUN_ID}', desc: 'The course run ID' },
    { name: '{START_DATE}', desc: 'The course start date' },
    { name: '{END_DATE}', desc: 'The course end date' },
    { name: '{FEES_EXCL_GST}', desc: 'Course fee excluding GST' },
    { name: '{GST_AMOUNT}', desc: 'GST amount (9%)' },
    { name: '{TOTAL_COURSE_FEE}', desc: 'Total course fee including GST' },
    { name: '{FUNDING_TYPE}', desc: 'Applicable funding type' },
    { name: '{NET_FEE}', desc: 'Estimated net fee after subsidy' },
  ];

  const replaceVars = (text: string) =>
    text
      .replace(/\{LEARNER_NAME\}/g, 'John Tan')
      .replace(/\{COURSE_NAME\}/g, 'WSQ - R Fundamental and Statistical Analysis for Beginners')
      .replace(/\{COURSE_CODE\}/g, 'TGS-2024045798')
      .replace(/\{COURSE_RUN_ID\}/g, '1273628')
      .replace(/\{START_DATE\}/g, '11 Apr 2026')
      .replace(/\{END_DATE\}/g, '12 Apr 2026')
      .replace(/\{FEES_EXCL_GST\}/g, 'SGD 800.00')
      .replace(/\{GST_AMOUNT\}/g, 'SGD 72.00')
      .replace(/\{TOTAL_COURSE_FEE\}/g, 'SGD 872.00')
      .replace(/\{FUNDING_TYPE\}/g, 'Self-Sponsored (SkillsFuture Funding)')
      .replace(/\{NET_FEE\}/g, 'SGD 472.00');

  const previewSubject = replaceVars(subject || DEFAULT_SUBJECT);
  const previewBody = replaceVars(body || DEFAULT_BODY);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.FileText} className="w-7 h-7" />
              Proforma Invoice Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Customize the email sent to learners when a proforma invoice is issued.
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
        <div
          className={`p-3 rounded-md text-sm ${
            saveMessage.type === 'success'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      <Card>
        <div className="p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Available Variables</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {variables.map((variable) => (
              <div key={variable.name} className="flex items-start gap-2 text-xs">
                <code className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-mono shrink-0">
                  {variable.name}
                </code>
                <span className="text-gray-500 dark:text-gray-400">{variable.desc}</span>
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
                  rows={16}
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
                <p className="mt-1 text-xs text-gray-400">Comma-separated email addresses to CC on all proforma invoice emails.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Invoice Attachment URL
                </label>
                <input
                  type="url"
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  className="block w-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  placeholder="https://drive.google.com/file/d/... or https://example.com/invoice.pdf"
                />
                <p className="mt-1 text-xs text-gray-400">Google Drive or PDF link included as a clickable attachment button in the email.</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Send Test Email</h4>
          <div className="flex gap-3 items-start">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Enter test email address..."
              className="flex-1 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button variant="secondary" onClick={handleSendTestEmail} disabled={isSendingTest || !testEmail.trim()}>
              {isSendingTest ? 'Sending...' : 'Send Test'}
            </Button>
          </div>
          {testMessage && (
            <div
              className={`mt-3 p-2 rounded-md text-xs ${
                testMessage.type === 'success'
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}
            >
              {testMessage.text}
            </div>
          )}
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
              {cc && (
                <div className="flex items-center gap-2 text-sm mt-1">
                  <span className="font-medium text-gray-500 dark:text-gray-400">CC:</span>
                  <span className="text-gray-600 dark:text-gray-300 text-xs">{cc}</span>
                </div>
              )}
            </div>
            <div
              className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300 max-h-96 overflow-y-auto [&_p]:mb-3 [&_p:last-child]:mb-0 [&_a]:text-blue-600 [&_a]:underline"
              dangerouslySetInnerHTML={{
                __html: /<[a-z][\s\S]*>/i.test(previewBody)
                  ? previewBody
                  : previewBody.split('\n').map((l) => (l.trim() ? `<p>${l}</p>` : '<br/>')).join(''),
              }}
            />
            {attachmentUrl && (
              <div className="mx-6 mb-5 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-3">
                <span className="text-blue-500 text-lg">📎</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">Proforma Invoice Attached</p>
                  <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 dark:text-blue-400 underline break-all">{attachmentUrl}</a>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ProformaInvoiceEmailTemplateView;