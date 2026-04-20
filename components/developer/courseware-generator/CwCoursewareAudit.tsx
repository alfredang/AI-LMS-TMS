import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw, AUDIT_DOCUMENT_TYPES } from './CwContext';

const CwCoursewareAudit: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDocChange = (key: string, value: string) => {
    cw.setAuditDocuments({ ...cw.auditDocuments, [key]: value });
  };

  const handleAudit = async () => {
    const filledDocs = Object.entries(cw.auditDocuments).filter(([, v]) => v.trim());
    if (filledDocs.length < 2) {
      setError('Please paste content for at least 2 documents (CP + at least one courseware document).');
      return;
    }
    if (!cw.auditDocuments.cp?.trim()) {
      setError('The Course Proposal (CP) content is required for the audit.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/developer/cw-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'courseware_audit',
          auditDocuments: cw.auditDocuments,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audit failed');
      cw.setAuditResult(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Courseware Audit</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Cross-check courseware documents against the Course Proposal for consistency (title, hours, topics, K/A statements, methods).
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Upload Document Content</h3>
        <p className="text-xs text-gray-400">Paste the text content of each document. The CP is required; add at least one more document to audit against it.</p>

        {AUDIT_DOCUMENT_TYPES.map(dt => (
          <div key={dt.key}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {dt.label} {dt.key === 'cp' && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={cw.auditDocuments[dt.key] || ''}
              onChange={e => handleDocChange(dt.key, e.target.value)}
              placeholder={`Paste ${dt.label} content here...`}
              rows={6}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            />
          </div>
        ))}

        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-1">Fields Checked:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs">
            <li>Course Title, TGS Ref, TSC Code/Title</li>
            <li>Training Hours, Assessment Hours</li>
            <li>Topics, Learning Outcomes</li>
            <li>K Statements, A Statements</li>
            <li>Assessment Methods, Instructional Methods</li>
            <li>Company Name, UEN</li>
          </ul>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <Button onClick={handleAudit} disabled={loading} className="w-full">
          {loading ? 'Running Audit...' : 'Run Courseware Audit'}
        </Button>
      </Card>

      {loading && (
        <Card className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Running cross-document audit with Claude AI...</p>
        </Card>
      )}

      {cw.auditResult && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Audit Report</h4>
            <button onClick={() => handleCopy(cw.auditResult)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Copy</button>
          </div>
          <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
            {cw.auditResult}
          </pre>
        </Card>
      )}

      {!loading && !cw.auditResult && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Courseware Audit</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Paste your CP and courseware documents above to check for consistency across all fields.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwCoursewareAudit;
