import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

const CwGenerateSlides: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!cw.cpText.trim()) {
      setError('Please paste the Course Proposal content in "Extract Course Info" first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/developer/cw-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'generate_slides',
          cpText: cw.extractedResult,
          courseData: cw.courseData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      cw.setSlidesResult(data.result);
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
        <h2 className="text-3xl font-bold dark:text-white">Generate Slides</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Generate slide content using a 4-phase AI pipeline: Research, Content Generation, Editing, and Infographic creation.
        </p>
      </div>

      {cw.courseData && (
        <Card className="p-4 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Course Context</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{cw.courseData.courseTitle}</p>
          <p className="text-xs text-gray-500">{cw.courseData.totalTrainingHours}h training</p>
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Slide Generation</h3>

        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-1">Slide Targets by Duration:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs">
            <li>1-day (8 hrs): ~100 slides</li>
            <li>2-day (16 hrs): ~160 slides</li>
            <li>3-day (24 hrs): ~210 slides</li>
            <li>4-day (32 hrs): ~250 slides</li>
            <li>5-day (40 hrs): ~320 slides</li>
          </ul>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <Button onClick={handleGenerate} disabled={loading} className="w-full">
          {loading ? 'Generating Slides...' : 'Generate Slide Content'}
        </Button>
      </Card>

      {loading && (
        <Card className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Running 4-phase slide pipeline with Claude AI...</p>
          <p className="text-xs text-gray-400 mt-1">Research → Content → Editor → Infographic</p>
        </Card>
      )}

      {cw.slidesResult && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Generated Slide Content</h4>
            <button onClick={() => handleCopy(cw.slidesResult)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Copy</button>
          </div>
          <textarea
            value={cw.slidesResult}
            onChange={e => cw.setSlidesResult(e.target.value)}
            rows={Math.max(10, cw.slidesResult.split('\n').length + 2)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-sans leading-relaxed"
          />
        </Card>
      )}

      {!loading && !cw.slidesResult && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">🖥️</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Slide Content Generator</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Generate comprehensive slide content with research-backed data, infographic specifications, and structured topic breakdowns.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwGenerateSlides;
