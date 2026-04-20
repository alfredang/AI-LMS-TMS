import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

interface GeneratedDoc {
  name: string;
  data: string; // base64
}

const CwGenerateApFgLg: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [generateLG, setGenerateLG] = useState(true);
  const [generateAP, setGenerateAP] = useState(true);
  const [generateFG, setGenerateFG] = useState(true);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);

  const hasContext = !!cw.extractedResult;
  const courseTitle = cw.courseData?.courseTitle || 'Not extracted yet';
  const numLUs = cw.courseData?.learningUnits?.length || 0;

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
      setError('Please extract course info first using the "Extract Course Info" page.');
      return;
    }
    const selectedDocs: string[] = [];
    if (generateLG) selectedDocs.push('lg');
    if (generateAP) selectedDocs.push('ap');
    if (generateFG) selectedDocs.push('fg');
    if (selectedDocs.length === 0) {
      setError('Please select at least one document type.');
      return;
    }

    setError('');
    setLoading(true);
    setGeneratedDocs([]);
    const startTime = Date.now();

    try {
      const allDocs: GeneratedDoc[] = [];

      for (const docType of selectedDocs) {
        // AP also generates ASR
        const requestType = docType === 'ap' ? 'ap_asr' : docType;

        const res = await fetch('/api/developer/cw-generate-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docType: requestType,
            courseData: cw.courseData,
            extractedResult: cw.extractedResult,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to generate ${docType.toUpperCase()}`);
        if (data.documents) allDocs.push(...data.documents);
      }

      setGeneratedDocs(allDocs);
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
        <h2 className="text-3xl font-bold dark:text-white">Generate AP/FG/LG</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Generate Assessment Plan, Facilitator Guide, and Learner Guide from extracted course info using WSQ templates.
        </p>
      </div>

      {/* Course Info Status */}
      {hasContext ? (
        <Card className="p-4 bg-green-900/20 border border-green-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-400">Course Info Loaded</p>
              <p className="text-xs text-gray-400">{courseTitle} | {numLUs} Learning Units</p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4 bg-yellow-900/20 border border-yellow-700">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-yellow-400">No Course Info Found</p>
              <p className="text-xs text-gray-400">Please go to "Extract Course Info" first.</p>
            </div>
          </div>
        </Card>
      )}

      {/* Document Selection */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Select Document(s) to Generate</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={generateLG} onChange={e => setGenerateLG(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Learning Guide (LG)</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={generateAP} onChange={e => setGenerateAP(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Assessment Plan (AP) + Assessment Summary Record (ASR)</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={generateFG} onChange={e => setGenerateFG(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Facilitator's Guide (FG)</span>
          </label>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <Button onClick={handleGenerate} disabled={loading || !hasContext} className="w-full bg-red-500 hover:bg-red-600">
          {loading ? 'Generating Documents...' : 'Generate Documents'}
        </Button>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-700">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-300">Generating courseware documents from WSQ templates...</p>
          </div>
        </div>
      )}

      {/* Success */}
      {!loading && generatedDocs.length > 0 && elapsedTime > 0 && (
        <div className="p-4 rounded-lg bg-green-900/20 border border-green-700">
          <p className="text-sm text-green-400 font-medium">
            Generated {generatedDocs.length} document(s) in {elapsedTime} seconds!
          </p>
        </div>
      )}

      {/* Download Section */}
      {!loading && generatedDocs.length > 0 && (
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Download Generated Documents</h3>
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

      {!loading && generatedDocs.length === 0 && !error && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Generate Courseware Documents</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Select the document types above and click generate. Documents will be created from WSQ DOCX templates and available for download.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwGenerateApFgLg;
