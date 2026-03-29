import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

const DEFAULT_ACCEPTABLE_USE_POLICY = `1. Purpose

This Acceptable Use Policy ("AUP") governs the use of the Learning Management System (LMS) and Training Management System (TMS) operated by {COMPANY_NAME}. By accessing or using the system, you agree to comply with this policy.

2. Authorised Use

The system is provided for the following purposes:
- Accessing course materials, schedules, and learning resources
- Completing assessments, quizzes, and assignments
- Viewing attendance records and course progress
- Communicating with trainers and administrators regarding course matters
- Managing training operations (for authorised staff only)

3. Prohibited Conduct

Users must not:
- Share login credentials with any other person
- Attempt to access accounts, data, or system areas not authorised to them
- Upload, transmit, or store any malicious software, viruses, or harmful code
- Use the system to harass, intimidate, or discriminate against any person
- Copy, distribute, or reproduce course materials without prior written consent
- Attempt to reverse-engineer, decompile, or tamper with the system
- Use the system for any commercial purpose unrelated to the training programmes
- Deliberately overload or disrupt system performance
- Misrepresent identity or impersonate another user

4. Account Security

Users are responsible for:
- Maintaining the confidentiality of their login credentials
- Logging out after each session, especially on shared devices
- Notifying the administrator immediately if they suspect unauthorised access to their account
- Changing their password promptly if instructed to do so

5. Intellectual Property

All course materials, content, assessments, and resources available on the system are the intellectual property of {COMPANY_NAME} or its licensors. Users may not reproduce, distribute, or create derivative works from these materials without explicit permission.

6. Data Integrity

Users must:
- Provide accurate and truthful information when required
- Not alter, delete, or tamper with records, attendance data, or assessment submissions
- Report any data discrepancies to the system administrator promptly

7. Monitoring and Enforcement

{COMPANY_NAME} reserves the right to:
- Monitor system usage to ensure compliance with this policy
- Investigate suspected violations of this policy
- Suspend or terminate access for users who violate this policy
- Report illegal activities to the relevant authorities

8. Consequences of Violation

Violations of this AUP may result in:
- Temporary suspension of system access
- Permanent termination of user account
- Removal from enrolled courses
- Reporting to SkillsFuture Singapore (SSG) where applicable
- Legal action where warranted

9. System Availability

While we strive to maintain system availability, {COMPANY_NAME} does not guarantee uninterrupted access. Scheduled maintenance will be communicated in advance where possible. We are not liable for any loss arising from system downtime.

10. Amendments

{COMPANY_NAME} reserves the right to amend this Acceptable Use Policy at any time. Users will be notified of significant changes. Continued use of the system after amendments constitutes acceptance of the updated policy.

11. Contact

If you have questions about this policy or need to report a violation, please contact:

{COMPANY_NAME}
Email: admin@company.com`;

const AcceptableUsePolicyView: React.FC = () => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchPolicy();
  }, []);

  const fetchPolicy = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/acceptable-use-policy'));
      const data = await response.json();
      if (data.success && data.data?.acceptableUsePolicy) {
        setContent(data.data.acceptableUsePolicy);
        setOriginalContent(data.data.acceptableUsePolicy);
      } else {
        setContent(DEFAULT_ACCEPTABLE_USE_POLICY);
        setOriginalContent('');
      }
    } catch (error) {
      console.error('Error fetching acceptable use policy:', error);
      setContent(DEFAULT_ACCEPTABLE_USE_POLICY);
      setOriginalContent('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/acceptable-use-policy'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptableUsePolicy: content }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalContent(content);
        setSaveMessage({ type: 'success', text: 'Acceptable use policy saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save acceptable use policy.' });
      }
    } catch (error) {
      console.error('Error saving acceptable use policy:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save acceptable use policy.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setContent(DEFAULT_ACCEPTABLE_USE_POLICY);
  };

  const hasChanges = content !== originalContent;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.ClipboardCheck} className="w-7 h-7" />
              Acceptable Use Policy
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Edit the acceptable use policy displayed on the login page. This policy is shown when users click &quot;Acceptable Use Policy&quot;.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleResetToDefault}
              disabled={isSaving}
            >
              Reset to Default
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
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
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500">Loading acceptable use policy...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Acceptable Use Policy Content
                </label>
                <span className="text-xs text-gray-400">
                  {hasChanges ? 'Unsaved changes' : 'Up to date'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Use {'{COMPANY_NAME}'} as a placeholder — it will be automatically replaced with your company name when displayed to users.
              </p>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={30}
                className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono leading-relaxed resize-y"
                placeholder="Enter your acceptable use policy here..."
              />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview</h4>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-gray-50 dark:bg-slate-900 max-h-96 overflow-y-auto">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {content.split('\n').map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return <br key={i} />;
                if (/^\d+\.\s+/.test(trimmed)) {
                  return <h4 key={i} className="font-semibold text-gray-900 dark:text-white mt-4 mb-2">{trimmed}</h4>;
                }
                if (trimmed.startsWith('- ')) {
                  return <li key={i} className="ml-4 text-gray-700 dark:text-gray-300">{trimmed.substring(2)}</li>;
                }
                return <p key={i} className="text-gray-700 dark:text-gray-300 mb-1">{trimmed}</p>;
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AcceptableUsePolicyView;
