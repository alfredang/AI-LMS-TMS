import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';

interface FormData {
  studentName: string;
  studentEmail: string;
  courseName: string;
  courseDates: string;
  ccEmails: string;
}

const DEFAULT_CC = 'angch@tertiaryinfotech.com, iris@tertiaryinfotech.com, marcus@tertiaryinfotech.com, sylvia@tertiaryinfotech.com';
const STORAGE_KEY = 'send-cert-sg-form';

export const SendCertificateSGView: React.FC = () => {
  const { currentUser } = useLms();
  const [form, setForm] = useState<FormData>({ studentName: '', studentEmail: '', courseName: '', courseDates: '', ccEmails: DEFAULT_CC });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Restore course fields from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setForm(prev => ({ ...prev, courseName: parsed.courseName || '', courseDates: parsed.courseDates || '' }));
      }
    } catch {}
  }, []);

  const handleChange = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.id) {
      setResult({ success: false, message: 'User not authenticated' });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/send-certificate-sg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: form.studentName,
          studentEmail: form.studentEmail,
          courseName: form.courseName,
          courseDates: form.courseDates,
          userId: currentUser.id,
          ccEmails: form.ccEmails,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResult({ success: true, message: data.message });
        // Persist course fields for batch sending
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ courseName: form.courseName, courseDates: form.courseDates }));
        // Clear student fields only
        setForm(prev => ({ ...prev, studentName: '', studentEmail: '' }));
      } else {
        setResult({ success: false, message: data.error || 'Failed to send certificate' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || 'Network error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Send Certificate (SG)</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Generate a certificate from Google Slides template and email it to the student.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Student Name</label>
            <input
              type="text"
              value={form.studentName}
              onChange={e => handleChange('studentName', e.target.value)}
              required
              placeholder="e.g. John Doe"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Student Email</label>
            <input
              type="email"
              value={form.studentEmail}
              onChange={e => handleChange('studentEmail', e.target.value)}
              required
              placeholder="e.g. john@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Name</label>
            <input
              type="text"
              value={form.courseName}
              onChange={e => handleChange('courseName', e.target.value)}
              required
              placeholder="e.g. Applied AI with Python"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Dates</label>
            <input
              type="text"
              value={form.courseDates}
              onChange={e => handleChange('courseDates', e.target.value)}
              required
              placeholder="e.g. 25 - 27 Mar 2026"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CC Email List</label>
            <input
              type="text"
              value={form.ccEmails}
              onChange={e => handleChange('ccEmails', e.target.value)}
              placeholder="Comma-separated email addresses"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Comma-separated. Leave empty for no CC.</p>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-md transition-colors flex items-center justify-center gap-2"
          >
            {sending ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Generating & Sending...
              </>
            ) : (
              'Generate & Send Certificate'
            )}
          </button>
        </form>

        {result && (
          <div className={`mt-4 p-3 rounded-md text-sm ${result.success ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'}`}>
            {result.message}
          </div>
        )}

        <div className="mt-6 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-md">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <strong>Note:</strong> This uses your Google Slides template and Gmail settings from the Google Integration section in Company Settings.
            The template must contain placeholders: <code className="bg-gray-200 dark:bg-slate-600 px-1 rounded">[Student Name]</code>, <code className="bg-gray-200 dark:bg-slate-600 px-1 rounded">[Course Name]</code>, <code className="bg-gray-200 dark:bg-slate-600 px-1 rounded">[Course Dates]</code>.
            Course name and dates are remembered for batch sending.
          </p>
        </div>
      </div>
    </div>
  );
};
