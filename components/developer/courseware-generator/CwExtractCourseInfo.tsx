import React, { useState, useRef, useEffect } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useCw, clearPersistedExtraction } from './CwContext';

// ─── Data Table (matches Streamlit's st.dataframe) ───
const DataTable: React.FC<{ headers: string[]; rows: string[][] }> = ({ headers, rows }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 dark:bg-gray-800">
          {headers.map((h, i) => (
            <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
            {row.map((cell, j) => (
              <td key={j} className="px-4 py-3 text-gray-700 dark:text-gray-300">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Accordion (matches Streamlit's st.expander) ───
const Expander: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
      >
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {isOpen && <div className="px-4 pb-4 pt-2">{children}</div>}
    </div>
  );
};

// ─── Parse markdown sections from Claude's response ───
function parseSections(text: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const lines = text.split('\n');
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(?:\d+\.\s+)?(.+)/);
    const h1Match = line.match(/^#\s+(.+)/);
    if (h2Match || h1Match) {
      if (currentTitle) sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
      currentTitle = (h2Match?.[1] || h1Match?.[1] || '').trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentTitle) sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
  return sections;
}

// ─── Parse markdown table ───
function parseMarkdownTable(content: string): { headers: string[]; rows: string[][] } | null {
  const tableLines = content.split('\n').filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
  if (tableLines.length < 2) return null;

  let headerIdx = 0;
  let dataStartIdx = 1;
  for (let i = 0; i < tableLines.length; i++) {
    if (tableLines[i].match(/\|[\s-:]+\|/)) {
      headerIdx = Math.max(0, i - 1);
      dataStartIdx = i + 1;
      break;
    }
  }

  const parseLine = (line: string) => line.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
  const headers = parseLine(tableLines[headerIdx]);
  const rows = tableLines.slice(dataStartIdx).filter(l => !l.match(/^\|[\s-:]+\|$/)).map(parseLine);

  if (headers.length === 0 || rows.length === 0) return null;
  return { headers, rows };
}

// ─── Main Component ───
const CwExtractCourseInfo: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [tgsRefCode, setTgsRefCode] = useState('');
  const [courseUrl, setCourseUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Auto-select the first company (Tertiary) on mount
  useEffect(() => {
    fetch('/api/developer/cw-companies')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.companies?.length > 0 && !cw.selectedCompanyId) {
          cw.setSelectedCompanyId(data.companies[0].id);
          cw.setSelectedCompanyName(data.companies[0].company_name);
        }
      })
      .catch(() => {});
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.name.match(/\.(docx|xlsx|xls|doc)$/i)) {
      setError('Please upload a DOCX or XLSX file.');
      return;
    }
    setFileName(file.name);
    setFileSize(`${(file.size / (1024 * 1024)).toFixed(1)}MB`);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1] || '';
      cw.setCpText(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleRemoveFile = () => {
    setFileName('');
    setFileSize('');
    cw.setCpText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExtract = async () => {
    if (!fileName && !tgsRefCode.trim()) {
      setError('Please upload a Course Proposal document or enter a TGS Reference Code.');
      return;
    }
    setError('');
    setLoading(true);
    const startTime = Date.now();
    try {
      const res = await fetch('/api/developer/cw-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'extract_course_info',
          cpText: cw.cpText,
          fileName,
          tgsRefCode,
          courseUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed');
      setElapsedTime(Math.round((Date.now() - startTime) / 1000));
      cw.setExtractedResult(data.result);
      if (data.courseData) cw.setCourseData(data.courseData);
      // Store raw parsed CP text for LP and other generators
      if (data.parsedCpText) (cw as any).parsedCpText = data.parsedCpText;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Render structured results (matching Streamlit exactly) ───
  const renderResults = () => {
    if (!cw.extractedResult) return null;

    const sections = parseSections(cw.extractedResult);

    return (
      <div className="space-y-8">
        {sections.map((section, idx) => {
          const titleLower = section.title.toLowerCase();

          // ── Course Overview → Table ──
          if (titleLower.includes('course overview') && !titleLower.includes('description')) {
            const table = parseMarkdownTable(section.content);
            if (table) {
              return (
                <div key={idx}>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Course Overview</h3>
                  <DataTable headers={table.headers} rows={table.rows} />
                  <hr className="mt-6 border-gray-200 dark:border-gray-700" />
                </div>
              );
            }
            // Fallback: parse as Field: Value lines
            const lines = section.content.split('\n').filter(l => l.trim() && !l.match(/^\|[-\s:]+\|$/));
            const rows = lines
              .map(l => {
                const cleaned = l.replace(/\*\*/g, '').replace(/^\|?\s*/, '').replace(/\s*\|?\s*$/, '');
                const parts = cleaned.split('|').map(p => p.trim()).filter(Boolean);
                if (parts.length >= 2) return parts;
                const colonIdx = cleaned.indexOf(':');
                if (colonIdx > 0) return [cleaned.substring(0, colonIdx).trim(), cleaned.substring(colonIdx + 1).trim()];
                return null;
              })
              .filter((r): r is string[] => r !== null && r.length >= 2);

            return (
              <div key={idx}>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Course Overview</h3>
                <DataTable headers={['Field', 'Value']} rows={rows} />
                <hr className="mt-6 border-gray-200 dark:border-gray-700" />
              </div>
            );
          }

          // ── What This Course Is About → Text ──
          if (titleLower.includes('what this course is about') || titleLower.includes('course is about')) {
            return (
              <div key={idx}>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">What This Course Is About</h3>
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{section.content.replace(/\*\*/g, '')}</p>
                <hr className="mt-6 border-gray-200 dark:border-gray-700" />
              </div>
            );
          }

          // ── What You'll Learn → Bullet List ──
          if (titleLower.includes("what you'll learn") || titleLower.includes('what you will learn')) {
            const items = section.content.split('\n')
              .filter(l => l.trim())
              .map(l => l.replace(/^[-•*]\s*/, '').replace(/\*\*/g, '').trim());
            return (
              <div key={idx}>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">What You'll Learn</h3>
                <ul className="space-y-2">
                  {items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <hr className="mt-6 border-gray-200 dark:border-gray-700" />
              </div>
            );
          }

          // ── Topics / Knowledge & Ability → Accordion per LU ──
          if (titleLower.includes('topic') || titleLower.includes('knowledge') || titleLower.includes('ability')) {
            // Split content by LU headers (### or bold LU titles)
            const luBlocks: { title: string; content: string }[] = [];
            const contentLines = section.content.split('\n');
            let currentLU = '';
            let currentContent: string[] = [];

            for (const line of contentLines) {
              // Only match LU headers (### LU... or starting with LU number)
              const luMatch = line.match(/^###\s+(LU\d+.*)/i) || line.match(/^##\s+(LU\d+.*)/i);
              if (luMatch) {
                if (currentLU) luBlocks.push({ title: currentLU, content: currentContent.join('\n').trim() });
                currentLU = luMatch[1].replace(/\*\*/g, '').trim();
                currentContent = [];
              } else {
                currentContent.push(line);
              }
            }
            if (currentLU) luBlocks.push({ title: currentLU, content: currentContent.join('\n').trim() });

            if (luBlocks.length > 0) {
              return (
                <div key={idx}>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">{section.title}</h3>
                  <div className="space-y-2">
                    {luBlocks.map((lu, i) => (
                      <Expander key={i} title={lu.title} defaultOpen={false}>
                        {lu.content.split('\n').map((line, li) => {
                          const cleaned = line.replace(/\*\*/g, '');
                          if (line.match(/^\*\*[^*]+\*\*/)) return <p key={li} className="font-semibold text-gray-900 dark:text-white mt-3 mb-1">{cleaned}</p>;
                          if (line.match(/^[-•]\s/)) return <p key={li} className="text-gray-700 dark:text-gray-300 pl-4 py-0.5">• {cleaned.replace(/^[-•]\s*/, '')}</p>;
                          if (line.match(/^\s+[-•]\s/)) return <p key={li} className="text-gray-600 dark:text-gray-400 pl-8 py-0.5">• {cleaned.replace(/^\s+[-•]\s*/, '')}</p>;
                          if (line.trim()) return <p key={li} className="text-gray-700 dark:text-gray-300 py-0.5">{cleaned}</p>;
                          return null;
                        })}
                      </Expander>
                    ))}
                  </div>
                  <hr className="mt-6 border-gray-200 dark:border-gray-700" />
                </div>
              );
            }

            // No sub-blocks, render as formatted text
            return (
              <div key={idx}>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">{section.title}</h3>
                <Expander title={section.title} defaultOpen={true}>
                  {section.content.split('\n').map((line, i) => {
                    const cleaned = line.replace(/\*\*/g, '');
                    if (line.match(/^[-•]\s/)) return <p key={i} className="text-gray-700 dark:text-gray-300 pl-4 py-0.5">• {cleaned.replace(/^[-•]\s*/, '')}</p>;
                    if (line.trim()) return <p key={i} className="text-gray-700 dark:text-gray-300 py-0.5">{cleaned}</p>;
                    return null;
                  })}
                </Expander>
                <hr className="mt-6 border-gray-200 dark:border-gray-700" />
              </div>
            );
          }

          // ── Instructional Methods & Duration → Table ──
          if (titleLower.includes('instructional method')) {
            const table = parseMarkdownTable(section.content);
            if (table) {
              return (
                <div key={idx}>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Instructional Methods & Duration</h3>
                  <DataTable headers={table.headers} rows={table.rows} />
                  <hr className="mt-6 border-gray-200 dark:border-gray-700" />
                </div>
              );
            }
          }

          // ── Assessment Methods & Duration → Table ──
          if (titleLower.includes('assessment method')) {
            const table = parseMarkdownTable(section.content);
            if (table) {
              return (
                <div key={idx}>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Assessment Methods & Duration</h3>
                  <DataTable headers={table.headers} rows={table.rows} />
                  <hr className="mt-6 border-gray-200 dark:border-gray-700" />
                </div>
              );
            }
          }

          // ── Course Overview Description → Text paragraphs ──
          if (titleLower.includes('course overview description') || titleLower.includes('description')) {
            return (
              <div key={idx}>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{section.title}</h3>
                {section.content.split('\n\n').map((para, i) => (
                  <p key={i} className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3">{para.replace(/\*\*/g, '').trim()}</p>
                ))}
                <hr className="mt-6 border-gray-200 dark:border-gray-700" />
              </div>
            );
          }

          // ── Default: any section with a markdown table ──
          const table = parseMarkdownTable(section.content);
          if (table) {
            return (
              <div key={idx}>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">{section.title}</h3>
                <DataTable headers={table.headers} rows={table.rows} />
                <hr className="mt-6 border-gray-200 dark:border-gray-700" />
              </div>
            );
          }

          // ── Default: formatted text ──
          return (
            <div key={idx}>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{section.title}</h3>
              {section.content.split('\n').map((line, i) => {
                const cleaned = line.replace(/\*\*/g, '');
                if (line.match(/^[-•]\s/)) return <p key={i} className="text-gray-700 dark:text-gray-300 pl-4 py-0.5">• {cleaned.replace(/^[-•]\s*/, '')}</p>;
                if (line.trim()) return <p key={i} className="text-gray-700 dark:text-gray-300 py-0.5">{cleaned}</p>;
                return <div key={i} className="h-2" />;
              })}
              <hr className="mt-6 border-gray-200 dark:border-gray-700" />
            </div>
          );
        })}

        {/* Course Context JSON (collapsible, bottom) */}
        <Expander title="Course Context JSON" defaultOpen={false}>
          <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
            {cw.extractedResult}
          </pre>
        </Expander>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Extract Course Info</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload an approved Course Proposal to extract key course information.
        </p>
      </div>

      {/* ── Input Card ── */}
      <Card className="p-5 space-y-5">
        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Upload Course Proposal</label>
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`flex items-center justify-between px-4 py-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : fileName ? 'border-green-400 bg-green-50/10 dark:border-green-600'
                : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                {fileName ? (
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">{fileName}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drag and drop file here</p>
                    <p className="text-xs text-gray-400">Limit 200MB per file - DOCX, XLSX</p>
                  </>
                )}
              </div>
            </div>
            <button type="button"
              className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-500 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
            >
              Browse files
            </button>
            <input ref={fileInputRef} type="file" accept=".docx,.xlsx,.xls,.doc" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            />
          </div>
          {fileName && (
            <div className="flex items-center justify-between mt-2 px-1">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {fileName} <span className="text-xs text-gray-400">{fileSize}</span>
              </div>
              <button onClick={handleRemoveFile} className="text-gray-400 hover:text-red-500 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* TGS + URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Course Ref Code (TGS) <span className="text-red-500">*</span>
            </label>
            <input type="text" value={tgsRefCode} onChange={e => setTgsRefCode(e.target.value)}
              placeholder="e.g. TGS-2024001234"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course URL (Optional)</label>
            <input type="text" value={courseUrl} onChange={e => setCourseUrl(e.target.value)}
              placeholder="e.g. https://www.myskillsfuture.gov.sg/..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <Button onClick={handleExtract} disabled={loading} className="bg-red-500 hover:bg-red-600">
          {loading ? 'Extracting...' : 'Extract Course Info'}
        </Button>
      </Card>

      {/* ── Loading State ── */}
      {loading && (
        <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-700">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-sm text-blue-300">AI Agent extracting course information... (approximately 40-60 seconds)</p>
          </div>
          <p className="text-xs text-gray-400 mt-1">You can navigate to other pages. Results will be ready when you return.</p>
        </div>
      )}

      {/* ── Success Banner ── */}
      {!loading && cw.extractedResult && elapsedTime > 0 && (
        <div className="p-4 rounded-lg bg-green-900/20 border border-green-700">
          <p className="text-sm text-green-400 font-medium">Extract Course Info completed in {elapsedTime} seconds!</p>
        </div>
      )}

      {/* ── Saved-extraction notice + Clear button ──
          Extraction state is persisted in localStorage so it survives
          navigation between Generator pages AND browser refresh. The Clear
          button removes the saved data so the user can start fresh. */}
      {!loading && cw.extractedResult && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Extraction is saved — it will stay available across pages and browser refreshes for 7 days.
          </p>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Clear the saved extraction? You will need to re-upload the CP and re-run extraction.')) return;
              cw.setExtractedResult('');
              cw.setCourseData(null);
              cw.setCpText('');
              clearPersistedExtraction();
              setFileName('');
              setFileSize('');
              setElapsedTime(0);
              setError('');
            }}
            className="px-3 py-1.5 rounded-md text-xs font-semibold border border-red-300 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            Clear Extraction
          </button>
        </div>
      )}

      {/* ── Structured Results ── */}
      {!loading && renderResults()}
    </div>
  );
};

export default CwExtractCourseInfo;
