import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

type JobStatus = 'pending' | 'running' | 'done' | 'failed';

type StatusResp = {
  id: string;
  status: JobStatus;
  progress: { message: string; percent: number };
  slideCount?: number;
  fileName?: string;
  stats?: Record<string, unknown>;
  message?: string;
  error?: string;
};

const CwGenerateSlides: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ message: string; percent: number }>({ message: '', percent: 0 });
  const [result, setResult] = useState<StatusResp | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimer.current != null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const pollOnce = async (id: string) => {
    try {
      const r = await fetch(`/api/developer/cw-slides-status?jobId=${encodeURIComponent(id)}`);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `Status poll failed (${r.status})`);
      }
      const data = (await r.json()) as StatusResp;
      setProgress(data.progress || { message: '', percent: 0 });
      if (data.status === 'done') {
        stopPolling();
        setResult(data);
        setLoading(false);
        if (typeof data.message === 'string') {
          cw.setSlidesResult(`${data.message}${data.slideCount ? ` · ${data.slideCount} slides` : ''}`);
        }
        return;
      }
      if (data.status === 'failed') {
        stopPolling();
        setError(data.error || 'Generation failed');
        setLoading(false);
        return;
      }
      pollTimer.current = window.setTimeout(() => pollOnce(id), 2500);
    } catch (e: any) {
      // Transient network error — keep polling, the job is still running server-side.
      console.warn('[cw-slides] status poll error:', e.message);
      pollTimer.current = window.setTimeout(() => pollOnce(id), 5000);
    }
  };

  const handleGenerate = async () => {
    if (!cw.courseData && !cw.extractedResult.trim()) {
      setError('Please run "Extract Course Info" first — the slide pipeline needs parsed CP data.');
      return;
    }
    setError('');
    setResult(null);
    setJobId(null);
    setProgress({ message: 'Starting...', percent: 0 });
    setLoading(true);
    try {
      const res = await fetch('/api/developer/cw-generate-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseData: cw.courseData,
          cpText: cw.extractedResult,
          extractedResult: cw.extractedResult,
          // Send the original CP base64 too so the backend can re-parse the
          // raw file and find duration even when courseData is stale (e.g.
          // user generated slides without re-extracting after a deploy).
          // The backend auto-detects DOCX vs XLSX from the buffer.
          cpBase64: cw.cpText,
          config: {},
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || 'Failed to start slide generation');
      }
      setJobId(data.jobId);
      pollOnce(data.jobId);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!jobId) return;
    // Trigger browser download via direct link (streams the file)
    const a = document.createElement('a');
    a.href = `/api/developer/cw-slides-download?jobId=${encodeURIComponent(jobId)}`;
    a.download = result?.fileName || 'Slides.pptx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Generate Slides</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Run the 5-phase multi-agent pipeline (Research &rarr; Content &rarr; Editor &rarr; Infographic &rarr; Assembly)
          to produce a WSQ training PPTX deck with AntV infographics.
        </p>
      </div>

      {cw.courseData && (() => {
        const cd = cw.courseData as any;
        const title = cd.courseTitle || cd.Course_Title || 'Course';
        const hoursRaw = cd.totalTrainingHours
          || cd.Total_Training_Hours
          || cd.Total_Course_Duration_Hours
          || cd.Total_Course_Duration
          || '';
        const hoursDisplay = hoursRaw ? `${hoursRaw}` : '(no duration extracted)';
        return (
          <Card className="p-4 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Course Context</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
            <p className="text-xs text-gray-500">{hoursDisplay}</p>
          </Card>
        );
      })()}

      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          Slide Generation
        </h3>

        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-1">Slide Targets by Duration:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs">
            <li>1-day (8 hrs): ~100 slides</li>
            <li>2-day (16 hrs): ~160 slides</li>
            <li>3-day (24 hrs): ~210 slides</li>
            <li>4-day (32 hrs): ~250 slides</li>
            <li>5-day (40 hrs): ~320 slides</li>
          </ul>
          <p className="text-xs mt-2 italic">Generation takes 10–25 minutes. Safe to keep this tab open — the job runs on the server.</p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">
            {error}
          </div>
        )}

        <Button onClick={handleGenerate} disabled={loading} className="w-full">
          {loading ? 'Generating Slides (this may take several minutes)…' : 'Generate Slide Deck (.pptx)'}
        </Button>
      </Card>

      {loading && (
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {progress.message || 'Running pipeline...'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {progress.percent}% — Research &rarr; Content &rarr; Editor &rarr; Infographic &rarr; Assembly
              </p>
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-2 transition-all duration-500"
              style={{ width: `${Math.max(2, progress.percent || 0)}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">
            Safe to keep this tab open &mdash; generation continues on the server even if your connection blips.
          </p>
        </Card>
      )}

      {result?.fileName && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">Slide Deck Ready</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {result.message}
                {result.slideCount ? ` · ${result.slideCount} slides` : ''}
              </p>
            </div>
            <Button onClick={handleDownload}>Download .pptx</Button>
          </div>
        </Card>
      )}

      {!loading && !result?.fileName && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">🖥️</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Slide Deck Generator</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Run <strong>Extract Course Info</strong> first, then click <strong>Generate Slide Deck</strong>.
            Output is a WSQ-standard PPTX with infographic content slides, fixed intro (10) and closing (7) slides.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwGenerateSlides;
