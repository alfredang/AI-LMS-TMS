import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

interface GeneratedDoc { name: string; data: string; }

const CwGenerateAssessment: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);

  const hasContext = !!cw.extractedResult;
  const courseData: any = cw.courseData;

  // Auto-detect assessment types from Assessment_Methods_Details
  const detectedTypes: string[] = [];
  if (courseData?.Assessment_Methods_Details) {
    for (const m of courseData.Assessment_Methods_Details) {
      const abbr = m.Method_Abbreviation || '';
      const name = m.Assessment_Method || '';
      if (abbr === 'WA-SAQ') detectedTypes.push('WA (SAQ)');
      else if (abbr) detectedTypes.push(abbr);
      else if (name) detectedTypes.push(name);
    }
  }

  const handleDownload = (doc: GeneratedDoc) => {
    const byteChars = atob(doc.data);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    if (!hasContext) {
      setError('Please extract course info first.');
      return;
    }
    setError('');
    setLoading(true);
    setGeneratedDocs([]);
    const startTime = Date.now();

    try {
      const res = await fetch('/api/developer/cw-generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: 'assessment',
          courseData: cw.courseData,
          extractedResult: cw.extractedResult,
          cpFileBase64: cw.cpText,
          cpFileName: 'cp.docx',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate assessments');
      if (data.documents) setGeneratedDocs(data.documents);
      setElapsedTime(Math.round((Date.now() - startTime) / 1000));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Generate Assessment</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Auto-generates assessment questions and answer keys based on the CP's Assessment Methods.
        </p>
      </div>

      {hasContext && detectedTypes.length > 0 ? (
        <Card className="p-4 bg-green-900/20 border border-green-700">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-400">Detected Assessment Types</p>
              <p className="text-xs text-gray-400 mt-1">Auto-detected from CP: <span className="font-medium text-gray-300">{detectedTypes.join(', ')}</span></p>
            </div>
          </div>
        </Card>
      ) : hasContext ? (
        <Card className="p-4 bg-yellow-900/20 border border-yellow-700">
          <p className="text-sm font-semibold text-yellow-400">No assessment methods detected in CP.</p>
        </Card>
      ) : (
        <Card className="p-4 bg-yellow-900/20 border border-yellow-700">
          <p className="text-sm font-semibold text-yellow-400">Please extract course info first.</p>
        </Card>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <Button onClick={handleGenerate} disabled={loading || !hasContext || detectedTypes.length === 0} className="bg-red-500 hover:bg-red-600">
        {loading ? 'Generating Assessments...' : 'Generate Assessment'}
      </Button>

      {loading && (
        <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-700">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-300">AI Agent generating assessments... (approximately 40-60 seconds)</p>
          </div>
          <p className="text-xs text-gray-400 mt-1">You can navigate to other pages. Results will be ready when you return.</p>
        </div>
      )}

      {!loading && generatedDocs.length > 0 && elapsedTime > 0 && (
        <div className="p-4 rounded-lg bg-green-900/20 border border-green-700">
          <p className="text-sm text-green-400 font-medium">Generated {generatedDocs.length} assessment document(s) in {elapsedTime} seconds!</p>
        </div>
      )}

      {!loading && generatedDocs.length > 0 && (
        <Card className="p-5 space-y-3">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Download Assessment Documents</h3>
          <div className="space-y-2">
            {generatedDocs.map((doc, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{doc.name}</p>
                    <p className="text-xs text-gray-400">DOCX Document</p>
                  </div>
                </div>
                <button onClick={() => handleDownload(doc)}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  Download
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default CwGenerateAssessment;
