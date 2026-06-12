import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

type SeoType = 'wsq' | 'non-wsq';

interface SeoSection {
  label: string;
  content: string;
}

function parseSections(text: string): SeoSection[] {
  const sections: SeoSection[] = [];
  const lines = text.split('\n');
  let currentLabel = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^\d+\.\s*\*\*(.+?)\*\*:?\s*(.*)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const boldMatch = line.match(/^\*\*(.+?)\*\*:?\s*(.*)/);

    if (headerMatch || h2Match || boldMatch) {
      if (currentLabel) {
        sections.push({ label: currentLabel, content: currentContent.join('\n').trim() });
      }
      if (headerMatch) {
        currentLabel = headerMatch[1].replace(/:\s*$/, '');
        currentContent = headerMatch[2] ? [headerMatch[2]] : [];
      } else if (h2Match) {
        currentLabel = h2Match[1];
        currentContent = [];
      } else if (boldMatch) {
        currentLabel = boldMatch[1].replace(/:\s*$/, '');
        currentContent = boldMatch[2] ? [boldMatch[2]] : [];
      }
    } else {
      currentContent.push(line);
    }
  }
  if (currentLabel) {
    sections.push({ label: currentLabel, content: currentContent.join('\n').trim() });
  }
  return sections.map(s => ({
    ...s,
    content: s.content.replace(/\n*-{3,}\s*$/g, '').trimEnd(),
  }));
}

const SeoGeneratorView: React.FC = () => {
  const [seoType, setSeoType] = useState<SeoType>('wsq');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [sections, setSections] = useState<SeoSection[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'html'>('rendered');

  // WSQ fields
  const [courseTitle, setCourseTitle] = useState('');
  const [learningOutcomes, setLearningOutcomes] = useState('');
  const [topics, setTopics] = useState('');

  // Non-WSQ fields
  const [courseName, setCourseName] = useState('');
  const [keyTopics, setKeyTopics] = useState('');
  const [courseHighlights, setCourseHighlights] = useState('');

  const handleGenerate = async () => {
    setError('');
    setResult('');
    setSections([]);

    const fields = seoType === 'wsq'
      ? { course_title: courseTitle, learning_outcomes: learningOutcomes, topics }
      : { course_name: courseName, key_topics: keyTopics, course_highlights: courseHighlights };

    const hasInput = Object.values(fields).some(v => v.trim());
    if (!hasInput) {
      setError('Please fill in at least one field.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/developer/seo-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: seoType, fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setResult(data.result);
      setSections(parseSections(data.result));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const sectionToHtml = (content: string): string => {
    const rawLines = content.split('\n');
    const trimmed = rawLines.map(l => l.trim()).filter(Boolean);
    const isList = trimmed.length > 1 && trimmed.every(l => /^[-*]\s+/.test(l));
    if (isList) {
      const items = trimmed.map(l => `  <li>${escapeHtml(l.replace(/^[-*]\s+/, ''))}</li>`).join('\n');
      return `<ul>\n${items}\n</ul>`;
    }
    // Split on blank lines into paragraphs
    const paragraphs: string[] = [];
    let buf: string[] = [];
    for (const line of rawLines) {
      if (line.trim() === '') {
        if (buf.length) { paragraphs.push(buf.join(' ').trim()); buf = []; }
      } else {
        buf.push(line.trim());
      }
    }
    if (buf.length) paragraphs.push(buf.join(' ').trim());
    return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n');
  };

  const handleCopySection = (section: SeoSection, idx: number) => {
    const text = viewMode === 'html' ? sectionToHtml(section.content) : section.content;
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(prev => (prev === idx ? null : prev)), 1500);
  };

  const handleCopyAll = () => {
    const text = viewMode === 'html'
      ? sections.map(s => `<h3>${escapeHtml(s.label)}</h3>\n${sectionToHtml(s.content)}`).join('\n\n')
      : result;
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  const CopyIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );

  const CheckIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">SEO Metadata Generator</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Generate SEO-optimized meta titles, descriptions, keywords, course descriptions, and job roles using AI.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-4">
          {/* Type Selector */}
          <Card className="p-5">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">Select Course Type</h3>
            <div className="flex gap-3">
              <button
                onClick={() => { setSeoType('wsq'); setResult(''); setSections([]); setError(''); }}
                className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all ${
                  seoType === 'wsq'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                WSQ Course
              </button>
              <button
                onClick={() => { setSeoType('non-wsq'); setResult(''); setSections([]); setError(''); }}
                className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all ${
                  seoType === 'non-wsq'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Non-WSQ Course
              </button>
            </div>
          </Card>

          {/* Input Fields */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              {seoType === 'wsq' ? 'WSQ Course Details' : 'Course Details'}
            </h3>

            {seoType === 'wsq' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                  <input
                    type="text"
                    value={courseTitle}
                    onChange={(e) => setCourseTitle(e.target.value)}
                    placeholder="e.g. Innovative Problem Solving with Generative AI"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Learning Outcomes</label>
                  <textarea
                    value={learningOutcomes}
                    onChange={(e) => setLearningOutcomes(e.target.value)}
                    placeholder="List the learning outcomes..."
                    rows={5}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Topics</label>
                  <textarea
                    value={topics}
                    onChange={(e) => setTopics(e.target.value)}
                    placeholder="List the course topics and outline..."
                    rows={5}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                  <input
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="e.g. Data Analytics with Python"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Topics and Outline</label>
                  <textarea
                    value={keyTopics}
                    onChange={(e) => setKeyTopics(e.target.value)}
                    placeholder="List the course topics and outline..."
                    rows={5}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Highlights</label>
                  <textarea
                    value={courseHighlights}
                    onChange={(e) => setCourseHighlights(e.target.value)}
                    placeholder="Key features, benefits, or selling points..."
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <Button onClick={handleGenerate} disabled={loading} className="w-full">
              {loading ? 'Generating...' : 'Generate SEO Metadata'}
            </Button>
          </Card>
        </div>

        {/* Output Panel */}
        <div className="space-y-4">
          {loading && (
            <Card className="p-8 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Generating SEO metadata with Claude AI...</p>
            </Card>
          )}

          {sections.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Generated Results</h3>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
                    <button
                      onClick={() => setViewMode('rendered')}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        viewMode === 'rendered'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      Rendered
                    </button>
                    <button
                      onClick={() => setViewMode('html')}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        viewMode === 'html'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      HTML
                    </button>
                  </div>
                <button
                  onClick={handleCopyAll}
                  title={copiedAll ? 'Copied' : 'Copy all'}
                  aria-label={copiedAll ? 'Copied' : 'Copy all'}
                  className={`p-1.5 rounded-md transition-colors ${
                    copiedAll
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}
                >
                  {copiedAll ? CheckIcon : CopyIcon}
                </button>
                </div>
              </div>
              {sections.map((section, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">{section.label}</h4>
                    <button
                      onClick={() => handleCopySection(section, i)}
                      title={copiedIdx === i ? 'Copied' : 'Copy'}
                      aria-label={copiedIdx === i ? 'Copied' : 'Copy'}
                      className={`p-1.5 rounded-md transition-colors ${
                        copiedIdx === i
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                      }`}
                    >
                      {copiedIdx === i ? CheckIcon : CopyIcon}
                    </button>
                  </div>
                  {viewMode === 'html' ? (
                    <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      {sectionToHtml(section.content)}
                    </pre>
                  ) : (() => {
                    const lines = section.content.split('\n').map(l => l.trim()).filter(Boolean);
                    const isBulletList = lines.length > 1 && lines.every(l => /^[-*]\s+/.test(l));
                    if (isBulletList) {
                      return (
                        <ul className="list-disc pl-6 text-sm text-gray-700 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1">
                          {lines.map((l, j) => (
                            <li key={j}>{l.replace(/^[-*]\s+/, '')}</li>
                          ))}
                        </ul>
                      );
                    }
                    return (
                      <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                        {section.content}
                      </pre>
                    );
                  })()}
                </Card>
              ))}
            </>
          )}

          {!loading && sections.length === 0 && (
            <Card className="p-8 text-center">
              <div className="text-4xl mb-3">{seoType === 'wsq' ? '🏛️' : '🌐'}</div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                {seoType === 'wsq' ? 'SEO for WSQ Course' : 'SEO for Non-WSQ Course'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                {seoType === 'wsq'
                  ? 'Fill in the WSQ course details and generate SEO-optimized metadata including meta title with WSQ prefix, keywords, description with funding info, course description, and job roles.'
                  : 'Fill in the course details and generate SEO metadata with region-specific meta titles (Singapore, Malaysia, International), keywords, description, course description, and job roles.'}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default SeoGeneratorView;
