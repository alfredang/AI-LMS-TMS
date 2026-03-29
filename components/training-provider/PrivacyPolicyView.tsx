import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

const DEFAULT_PRIVACY_POLICY = `1. Introduction

{COMPANY_NAME} ("we", "our", or "us") is committed to protecting your personal data in accordance with the Personal Data Protection Act 2012 (PDPA) of Singapore. This Privacy Policy explains how we collect, use, disclose, and protect your personal data when you use our Learning Management System (LMS) and Training Management System (TMS).

2. Personal Data We Collect

We may collect the following types of personal data:
- Full name, email address, and contact number
- NRIC/FIN (last 4 characters) for SSG-funded course enrolment
- Date of birth, gender, and nationality
- Educational qualifications and employment details
- Course enrolment, attendance, and assessment records
- Login credentials and system usage logs
- Payment and billing information (where applicable)

3. Purposes of Data Collection

Your personal data is collected and used for the following purposes:
- Processing course enrolment and registration
- Managing training schedules, attendance, and assessments
- Issuing certificates of completion
- Submitting enrolment and attendance data to SkillsFuture Singapore (SSG)
- Communicating course updates, schedules, and administrative matters
- Improving our training programmes and system functionality
- Complying with legal and regulatory requirements

4. Disclosure of Personal Data

We may disclose your personal data to:
- SkillsFuture Singapore (SSG) for grant claims and course reporting
- Government agencies as required by law
- Authorised trainers and assessors involved in your course
- Third-party service providers who assist in system hosting and maintenance

We do not sell or rent your personal data to any third party.

5. Data Protection and Security

We implement reasonable security measures to protect your personal data from unauthorised access, collection, use, disclosure, or similar risks. These include:
- Encrypted password storage using industry-standard hashing
- Role-based access controls to limit data access
- Secure HTTPS connections for all data transmissions
- Regular security reviews and system updates

6. Retention of Personal Data

We retain your personal data only for as long as necessary to fulfil the purposes for which it was collected, or as required by applicable laws and regulations. When data is no longer needed, it will be securely disposed of.

7. Your Rights

Under the PDPA, you have the right to:
- Access your personal data held by us
- Request corrections to inaccurate or incomplete data
- Withdraw consent for the collection, use, or disclosure of your data

To exercise any of these rights, please contact our Data Protection Officer.

8. Cookies and Usage Data

Our system may use cookies and similar technologies to maintain your login session and improve user experience. These do not collect personally identifiable information beyond what is necessary for system functionality.

9. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected on this page with an updated revision date. Continued use of the system constitutes acceptance of the revised policy.

10. Contact Us

If you have any questions about this Privacy Policy or wish to make a data access or correction request, please contact us at:

{COMPANY_NAME}
Email: dpo@company.com`;

const PrivacyPolicyView: React.FC = () => {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchPrivacyPolicy();
  }, []);

  const fetchPrivacyPolicy = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/privacy-policy'));
      const data = await response.json();
      if (data.success && data.data?.privacyPolicy) {
        setContent(data.data.privacyPolicy);
        setOriginalContent(data.data.privacyPolicy);
      } else {
        // Use default content if none saved
        setContent(DEFAULT_PRIVACY_POLICY);
        setOriginalContent('');
      }
    } catch (error) {
      console.error('Error fetching privacy policy:', error);
      setContent(DEFAULT_PRIVACY_POLICY);
      setOriginalContent('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/privacy-policy'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacyPolicy: content }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalContent(content);
        setSaveMessage({ type: 'success', text: 'Privacy policy saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save privacy policy.' });
      }
    } catch (error) {
      console.error('Error saving privacy policy:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save privacy policy.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => {
    setContent(DEFAULT_PRIVACY_POLICY);
  };

  const hasChanges = content !== originalContent;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.Shield} className="w-7 h-7" />
              Privacy Policy
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Edit the privacy policy displayed on the login page. This policy is shown when users click &quot;Privacy Policy&quot;.
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
              <span className="ml-3 text-gray-500">Loading privacy policy...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Privacy Policy Content
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
                placeholder="Enter your privacy policy here..."
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
                // Section headers (lines like "1. Introduction" or "10. Contact Us")
                if (/^\d+\.\s+/.test(trimmed)) {
                  return <h4 key={i} className="font-semibold text-gray-900 dark:text-white mt-4 mb-2">{trimmed}</h4>;
                }
                // Bullet points
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

export default PrivacyPolicyView;
