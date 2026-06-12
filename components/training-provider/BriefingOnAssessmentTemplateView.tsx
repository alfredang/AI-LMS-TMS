import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

// Standard briefing used as the starting template and as the fallback shown on
// the course page when this is left blank. Keep in sync with
// DEFAULT_ASSESSMENT_BRIEFING in components/CourseDetail.tsx.
const DEFAULT_BRIEFING = [
  'Place phones & other materials under the table or on the floor',
  'No photos or recording of assessment scripts',
  'No discussion during assessment',
  'Use black/blue pen for assessment [hard copies]',
  'No usage of liquid paper or correction tape',
  'Assessment scripts will be collected when the time is up',
].join('\n');

const BriefingOnAssessmentTemplateView: React.FC = () => {
  const [text, setText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchBriefing();
  }, []);

  const fetchBriefing = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/briefing-on-assessment'));
      const data = await response.json();
      const b = (data.success && data.data && data.data.briefingOnAssessment) || '';
      setText(b || DEFAULT_BRIEFING);
      setOriginalText(b);
    } catch (error) {
      console.error('Error fetching briefing on assessment:', error);
      setText(DEFAULT_BRIEFING);
      setOriginalText('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/training-provider/briefing-on-assessment'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingOnAssessment: text }),
      });
      const data = await response.json();
      if (data.success) {
        setOriginalText(text);
        setSaveMessage({ type: 'success', text: 'Briefing on Assessment saved successfully.' });
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save briefing.' });
      }
    } catch (error) {
      console.error('Error saving briefing on assessment:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save briefing.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleResetToDefault = () => setText(DEFAULT_BRIEFING);

  const hasChanges = text !== originalText;
  const previewPoints = (text || DEFAULT_BRIEFING).split('\n').map(l => l.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
              <Icon name={IconName.ClipboardCheck} className="w-7 h-7" />
              Briefing on Assessment
            </h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
              Shown to learners and trainers in the Assessment area of every course page. Enter one point per line. Leave blank to use the standard briefing.
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
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500">Loading briefing...</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Briefing points (one per line)</label>
                <span className="text-xs text-gray-400">{hasChanges ? 'Unsaved changes' : 'Up to date'}</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                className="block w-full px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed resize-y"
                placeholder={DEFAULT_BRIEFING}
              />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview (learner &amp; trainer view)</h4>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-900 px-6 py-5">
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
              {previewPoints.map((point, idx) => (
                <li key={idx}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default BriefingOnAssessmentTemplateView;
