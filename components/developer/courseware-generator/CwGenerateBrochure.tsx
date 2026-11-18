import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw } from './CwContext';

const CwGenerateBrochure: React.FC = () => {
  const cw = useCw();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfInfo, setPdfInfo] = useState<{
    name: string;
    data: string;
    courseTitle?: string;
    tgsRef?: string;
    courseData?: any;
  } | null>(null);

  const handleGeneratePdf = async () => {
    if (!cw.courseUrl.trim()) {
      setError('Please enter a course URL to generate the PDF brochure.');
      return;
    }
    setError('');
    setPdfLoading(true);
    setPdfInfo(null);
    try {
      const res = await fetch('/api/developer/cw-generate-brochure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseUrl: cw.courseUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF generation failed');
      setPdfInfo({
        name: data.document.name,
        data: data.document.data,
        courseTitle: data.courseTitle,
        tgsRef: data.tgsRef,
        courseData: data.courseData,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!pdfInfo) return;
    const byteChars = atob(pdfInfo.data);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfInfo.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Generate Brochure</h2>
        <p className="text-sm text-muted mt-1">
          Generate a WSQ course brochure PDF by scraping a course URL.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-bold text-on-surface-secondary uppercase tracking-wider">Brochure Source</h3>

        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Course URL</label>
          <input
            type="text"
            value={cw.courseUrl}
            onChange={e => cw.setCourseUrl(e.target.value)}
            placeholder="https://www.tertiarycourses.com.sg/course-page.html"
            className="w-full px-3 py-2 rounded-lg border border-strong bg-surface text-on-surface text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-muted mt-1">
            Required for PDF Brochure — the page is scraped for title, outcomes, topics, fees, and TSC info.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-sm text-danger">
            {error}
          </div>
        )}

        <Button onClick={handleGeneratePdf} disabled={pdfLoading} className="w-full">
          {pdfLoading ? 'Scraping & Generating PDF...' : 'Generate Brochure PDF'}
        </Button>
      </Card>

      {pdfLoading && (
        <Card className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-muted">Generating Brochure from the URL...</p>
        </Card>
      )}

      {pdfInfo && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-on-surface">Brochure PDF Ready</h4>
              <p className="text-xs text-muted mt-0.5">
                {pdfInfo.courseTitle} {pdfInfo.tgsRef ? `· ${pdfInfo.tgsRef}` : ''}
              </p>
            </div>
            <Button onClick={handleDownloadPdf}>Download PDF</Button>
          </div>

          {pdfInfo.courseData && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-on-surface-secondary pt-2 border-t border-default">
              <div><span className="font-semibold">TSC Code:</span> {pdfInfo.courseData.tsc_code || 'N/A'}</div>
              <div><span className="font-semibold">Framework:</span> {pdfInfo.courseData.tsc_framework || 'N/A'}</div>
              <div><span className="font-semibold">Duration:</span> {pdfInfo.courseData.duration_hrs}hrs ({pdfInfo.courseData.session_days} days)</div>
              <div><span className="font-semibold">Fee (Bef/Incl GST):</span> {pdfInfo.courseData.gst_exclusive_price} / {pdfInfo.courseData.gst_inclusive_price}</div>
              <div><span className="font-semibold">Topics Extracted:</span> {pdfInfo.courseData.num_topics}</div>
              <div><span className="font-semibold">Outcomes Extracted:</span> {pdfInfo.courseData.num_outcomes}</div>
            </div>
          )}
        </Card>
      )}

      {!pdfLoading && !pdfInfo && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">📰</div>
          <h3 className="text-lg font-bold text-on-surface mb-1">Brochure Generator</h3>
          <p className="text-sm text-muted max-w-md mx-auto">
            Paste a course URL and click <strong>Generate Brochure PDF</strong> to scrape the page and render a WSQ-standard brochure.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwGenerateBrochure;
