import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

const CwConvertDocuments: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [convertType, setConvertType] = useState<'assessment' | 'courseware' | 'lesson_plan'>('assessment');

  const handleConvert = async () => {
    if (!cw.convertSourceText.trim()) {
      setError('Please paste the source document content to convert.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/developer/cw-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'convert_documents',
          sourceText: cw.convertSourceText,
          convertType,
          courseData: cw.courseData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed');
      cw.setConvertResult(data.result);
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
        <h2 className="text-3xl font-bold dark:text-white">Convert Documents</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Convert existing assessment, courseware, or lesson plan documents into WSQ-standard format.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Conversion Type</h3>
        <div className="flex gap-3">
          {[
            { key: 'assessment' as const, label: 'Convert Assessment' },
            { key: 'courseware' as const, label: 'Convert Courseware' },
            { key: 'lesson_plan' as const, label: 'Convert Lesson Plan' },
          ].map(ct => (
            <button
              key={ct.key}
              onClick={() => setConvertType(ct.key)}
              className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all ${
                convertType === ct.key
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Document Content</label>
          <textarea
            value={cw.convertSourceText}
            onChange={e => cw.setConvertSourceText(e.target.value)}
            placeholder="Paste the content of the document you want to convert to WSQ format..."
            rows={12}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <Button onClick={handleConvert} disabled={loading} className="w-full">
          {loading ? 'Converting...' : 'Convert to WSQ Format'}
        </Button>
      </Card>

      {loading && (
        <Card className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Converting document with Claude AI...</p>
        </Card>
      )}

      {cw.convertResult && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Converted Document</h4>
            <button onClick={() => handleCopy(cw.convertResult)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Copy</button>
          </div>
          <textarea
            value={cw.convertResult}
            onChange={e => cw.setConvertResult(e.target.value)}
            rows={Math.max(10, cw.convertResult.split('\n').length + 2)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-sans leading-relaxed"
          />
        </Card>
      )}

      {!loading && !cw.convertResult && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">🔄</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Document Converter</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Paste existing document content and convert it into WSQ-standard format using AI extraction and restructuring.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwConvertDocuments;
