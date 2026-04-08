import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

const DEFAULT_SUBJECT = 'Final Course Confirmation of {COURSE_NAME} Training on {COURSE_START_DATE}';

const DEFAULT_BODY = `Dear Participants,

This is the final reminder of your course enrollment below:

Course Title: {COURSE_NAME}

Course Start Date/Time: {COURSE_START_DATE}

If you are not able to attend the course, please kindly let us know immediately before the class.

Training Venue:
For physical classes, the venue is 12 Woodlands Square #07-85/86/87 Woods Square Tower 1, Singapore 737715 Map https://g.page/tertiarycourses-sg?share

Nearest MRT station: Walk 3 mins from Woodlands MRT (NS9) Exit 2
Parking rate at Woods Square: Car - $1.20/hour , Motorcycle- $0.8/hour (Hourly charge)
Please get an entry pass from the lobby reception at Level 1.

For corporate on-site training, the venue is at the company premise as arranged.

Attendance Taking
Trainees who are attending SkillsFuture Singapore (SSG) funded courses must take their attendance digitally via the Singpass App for attendance-taking for both physical classroom and synchronous e-learning courses.

To ensure seamless attendance-taking, trainees are required to download the Singpass App on their mobile phones (with a camera) or tablets (with a camera) and set up their Singpass accounts (if this was not done previously) before their respective courses start. Trainees are to bring their devices with the installed Singpass App for each session. Please refer to the attachment: https://drive.google.com/file/d/1712IBM-ATDthzV0zv8n_qi6g4hj3pD8N/view?usp=drive_link

If trainees do not have the Singpass app on their devices, it will result in their attendance not being captured and potentially result in SSG funding subsidies being revoked.

If you do not have a Singpass account and need to register for one, please visit: https://www.singpass.gov.sg/ for details.

SkillsFuture Credits Claim (for self-sponsored)
If you are paying the course fee using your SkillsFuture Credits (SFC), please upload the invoice as your supporting document when you submit your SFC claim at MySkillsFuture portal (https://www.myskillsfuture.gov.sg/content/portal/en/index.html) before the class starts.

Course Material and LMS
We will send the course material in softcopy ONLY and LMS access on the course day to those confirmed participants.

Support
If you have other enquiries, please contact us.

Tel: 6100 0613
Email: enquiry@tertiaryinfotech.com

Thank you very much for signing up the course and choosing us as your learning partner.

from Tertiary Courses SG Team`;

const DEFAULT_CC = '';

const FinalCourseConfirmationEmailTemplateView: React.FC = () => {
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
      const response = await fetch(getApiUrl('/api/training-provider/final-course-confirmation-email-template'));
      const data = await response.json();
      if (data.success && data.data) {
        const s = data.data.finalCourseConfirmationEmailSubject || '';
        const b = data.data.finalCourseConfirmationEmailBody || '';
        const c = data.data.finalCourseConfirmationEmailCc || '';
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
      console.error('Error fetching final course confirmation email template:', error);
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
      const response = await fetch(getApiUrl('/api/training-provider/final-course-confirmation-email-template'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalCourseConfirmationEmailSubject: subject,
          finalCourseConfirmationEmailBody: body,
          finalCourseConfirmationEmailCc: cc,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalSubject(subject);
        setOriginalBody(body);
        setOriginalCc(cc);
        setSaveMessage({ type: 'success', text: 'Final course confirmation email template saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save template.' });
      }
    } catch (error) {
      console.error('Error saving final course confirmation email template:', error);
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

  const hasChanges = subject !== originalSubject || body !== originalBody || cc !== originalCc;

  const variables = [
    { name: '{COURSE_NAME}', desc: 'The course title' },
    { name: '{COURSE_START_DATE}', desc: 'The course start date and time' },
  ];

  const replaceVars = (text: string) =>
    text
      .replace(/\{COURSE_NAME\}/g, 'WSQ - Kubernetes and Cloud Native Associate (KCNA) Training')
      .replace(/\{COURSE_START_DATE\}/g, 'Wed Apr 08 2026 09:30:00');

  const previewSubject = replaceVars(subject);
  const previewBody = replaceVars(body);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Send} className="w-7 h-7" />
              Final Class Confirm Email Template
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Customise the final confirmation email sent to learners before the course starts.
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
                  rows={16}
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
                <p className="mt-1 text-xs text-gray-400">Comma-separated email addresses to CC on all final course confirmation emails.</p>
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
            {/* Email body */}
            <div className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300 max-h-72 overflow-y-auto">
              {previewBody.split('\n').map((line, i) => {
                if (!line.trim()) return <br key={i} />;
                return <p key={i} className="mb-1">{line}</p>;
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default FinalCourseConfirmationEmailTemplateView;
