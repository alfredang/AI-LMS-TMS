import React, { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import {
  DEFAULT_TRAINER_ACCEPT_SUBJECT,
  DEFAULT_TRAINER_ACCEPT_BODY,
  DEFAULT_TRAINER_DECLINE_SUBJECT,
  DEFAULT_TRAINER_DECLINE_BODY,
  renderInvitationTemplate,
} from '@/lib/trainerInvitations';

const VARIABLES = [
  { key: 'TRAINER_NAME', desc: 'Trainer full name' },
  { key: 'COURSE_TITLE', desc: 'Course title' },
  { key: 'COURSE_CODE', desc: 'TGS reference code' },
  { key: 'COURSE_RUN_ID', desc: 'Course run ID' },
  { key: 'START_DATE', desc: 'Class start date' },
  { key: 'END_DATE', desc: 'Class end date' },
  { key: 'COMPANY_SHORT_NAME', desc: 'Company short name' },
];

const SAMPLE_DATA: Record<string, string> = {
  TRAINER_NAME: 'Jane Smith',
  COURSE_TITLE: 'Cyber Security Awareness Course',
  COURSE_CODE: 'TGS-2020503626',
  COURSE_RUN_ID: '1234567',
  START_DATE: '26/05/2026',
  END_DATE: '27/05/2026',
  COMPANY_SHORT_NAME: 'Tertiary Courses Singapore',
};

const TrainerResponseEmailTemplatesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'accept' | 'decline'>('accept');
  const [acceptSubject, setAcceptSubject] = useState('');
  const [acceptBody, setAcceptBody] = useState('');
  const [acceptCc, setAcceptCc] = useState('');
  const [declineSubject, setDeclineSubject] = useState('');
  const [declineBody, setDeclineBody] = useState('');
  const [declineCc, setDeclineCc] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/training-provider/trainer-response-email-templates'));
      const data = await res.json();
      if (data.success) {
        setAcceptSubject(data.data.acceptSubject);
        setAcceptBody(data.data.acceptBody);
        setAcceptCc(data.data.acceptCc || '');
        setDeclineSubject(data.data.declineSubject);
        setDeclineBody(data.data.declineBody);
        setDeclineCc(data.data.declineCc || '');
      }
    } catch { /* silent */ } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(getApiUrl('/api/training-provider/trainer-response-email-templates'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptSubject,
          acceptBody,
          acceptCc,
          declineSubject,
          declineBody,
          declineCc,
        }),
      });
      const data = await res.json();
      setSaveMessage(data.success
        ? { type: 'success', text: 'Templates saved successfully.' }
        : { type: 'error', text: data.error || 'Failed to save.' });
    } catch {
      setSaveMessage({ type: 'error', text: 'Failed to save templates.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 5000);
    }
  };

  const handleReset = () => {
    if (activeTab === 'accept') {
      setAcceptSubject(DEFAULT_TRAINER_ACCEPT_SUBJECT);
      setAcceptBody(DEFAULT_TRAINER_ACCEPT_BODY);
    } else {
      setDeclineSubject(DEFAULT_TRAINER_DECLINE_SUBJECT);
      setDeclineBody(DEFAULT_TRAINER_DECLINE_BODY);
    }
  };

  const currentSubject = activeTab === 'accept' ? acceptSubject : declineSubject;
  const currentBody = activeTab === 'accept' ? acceptBody : declineBody;
  const currentCc = activeTab === 'accept' ? acceptCc : declineCc;
  const setCurrentSubject = activeTab === 'accept' ? setAcceptSubject : setDeclineSubject;
  const setCurrentBody = activeTab === 'accept' ? setAcceptBody : setDeclineBody;
  const setCurrentCc = activeTab === 'accept' ? setAcceptCc : setDeclineCc;

  const previewSubject = renderInvitationTemplate(currentSubject, SAMPLE_DATA);
  const previewBody = renderInvitationTemplate(currentBody, SAMPLE_DATA);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Trainer Response Email Templates</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure the follow-up emails sent when a trainer accepts or declines an invitation.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('accept')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'accept'
              ? 'bg-green-600 text-white'
              : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Accept Email
        </button>
        <button
          onClick={() => setActiveTab('decline')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'decline'
              ? 'bg-red-600 text-white'
              : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Decline Email
        </button>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div className={`px-4 py-2 rounded-md text-sm ${saveMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300' : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300'}`}>
          {saveMessage.text}
        </div>
      )}

      {/* Available Variables */}
      <Card className="p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Available Variables</p>
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map(v => (
            <span key={v.key} className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300" title={v.desc}>
              {`{${v.key}}`}
            </span>
          ))}
        </div>
      </Card>

      {/* Template Editor */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold dark:text-white">
            {activeTab === 'accept' ? 'Accept Confirmation Email' : 'Decline Acknowledgement Email'}
          </h3>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleReset}>Reset to Default</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
            <input
              type="text"
              value={currentSubject}
              onChange={(e) => setCurrentSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body</label>
            <textarea
              value={currentBody}
              onChange={(e) => setCurrentBody(e.target.value)}
              rows={14}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              CC List <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={currentCc}
              onChange={(e) => setCurrentCc(e.target.value)}
              rows={2}
              placeholder="ops@example.com, finance@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Comma- or newline-separated. These addresses are CC'd whenever the {activeTab === 'accept' ? 'accept' : 'decline'} acknowledgement email is sent. Invalid entries are silently dropped.
            </p>
          </div>
        </div>
      </Card>

      {/* Preview */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold dark:text-white mb-4">Preview</h3>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-4">Subject: {previewSubject}</p>
          <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
            {previewBody}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default TrainerResponseEmailTemplatesView;
