import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

// ── All session columns (matches DB schema) ───────────────────────────────────

const DAY_SESSIONS = Array.from({ length: 11 }, (_, i) => i + 1);
const EVENING_SESSIONS = Array.from({ length: 3 }, (_, i) => i + 1);

type ResultEntry = {
  course_code: string;
  action: 'upserted' | 'failed';
  message: string;
};

type ViewState = 'upload' | 'processing' | 'results';

const BATCH_SIZE = 20;
const RESULTS_PER_PAGE = 10;

// ── Parse helpers ─────────────────────────────────────────────────────────────

/** Normalise a time value from Excel: "9:15", "09:15:00", 0.385416… → "09:15" */
function parseTime(raw: any): string {
  if (raw === null || raw === undefined || String(raw).trim() === '') return '';
  // Excel serial fraction → HH:MM
  const n = Number(raw);
  if (!isNaN(n) && n > 0 && n < 1) {
    const totalMins = Math.round(n * 24 * 60);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  // Already a string like "9:15" or "09:15:00"
  const s = String(raw).trim();
  const match = s.match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  return s;
}

function parseRow(row: Record<string, any>) {
  const str = (key: string) => {
    const v = row[key];
    return v !== undefined && String(v).trim() !== '' ? String(v).trim() : null;
  };

  const result: Record<string, any> = {
    courseCode: String(row['course_code'] || row['Course Code'] || '').trim().toUpperCase(),
  };

  for (const n of DAY_SESSIONS) {
    result[`session_${n}_start_time`]       = parseTime(row[`session_${n}_start_time`]       ?? row[`Session ${n} Start Time`])       || null;
    result[`session_${n}_end_time`]         = parseTime(row[`session_${n}_end_time`]         ?? row[`Session ${n} End Time`])         || null;
    result[`session_${n}_mode_of_training`] = str(`session_${n}_mode_of_training`)           ?? str(`Session ${n} Mode of Training`) ?? null;
  }

  for (const n of EVENING_SESSIONS) {
    result[`session_${n}_evening_start_time`]       = parseTime(row[`session_${n}_evening_start_time`]       ?? row[`Session ${n} Evening Start Time`])       || null;
    result[`session_${n}_evening_end_time`]         = parseTime(row[`session_${n}_evening_end_time`]         ?? row[`Session ${n} Evening End Time`])         || null;
    result[`session_${n}_evening_mode_of_training`] = str(`session_${n}_evening_mode_of_training`)           ?? str(`Session ${n} Evening Mode of Training`) ?? null;
  }

  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

const CourseSessionTimingView: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  const [allResults, setAllResults] = useState<ResultEntry[]>([]);
  const [summary, setSummary] = useState({ upserted: 0, failed: 0 });
  const [resultsPage, setResultsPage] = useState(1);
  const [filterCategory, setFilterCategory] = useState<'all' | 'upserted' | 'failed'>('all');

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFileChange = (f: File | undefined | null) => {
    if (!f) return;
    const valid =
      f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      f.type === 'application/vnd.ms-excel' ||
      f.name.endsWith('.xlsx') || f.name.endsWith('.xls') ||
      f.type === 'text/csv' || f.name.endsWith('.csv');
    if (valid) { setFile(f); setError(null); }
    else { setError('Please upload an Excel (.xlsx, .xls) or CSV file.'); setFile(null); }
  };

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, over: boolean) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(over);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    handleFileChange(e.dataTransfer.files?.[0]);
  };

  // ── Parse Excel ───────────────────────────────────────────────────────────

  const parseFile = (f: File): Promise<ReturnType<typeof parseRow>[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          const parsed = rows.map(parseRow).filter(r => r.courseCode);
          resolve(parsed);
        } catch {
          reject(new Error('Failed to parse file. Please check the format.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsArrayBuffer(f);
    });

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!file) return;
    setViewState('processing');
    setProgressCurrent(0);
    setProgressTotal(0);
    setAllResults([]);
    setSummary({ upserted: 0, failed: 0 });

    let rows: ReturnType<typeof parseRow>[];
    try {
      rows = await parseFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse error');
      setViewState('upload');
      return;
    }

    if (rows.length === 0) {
      setError('No valid rows found. Ensure the file has a "course_code" column.');
      setViewState('upload');
      return;
    }

    setProgressTotal(rows.length);
    const results: ResultEntry[] = [];
    let upserted = 0, failed = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (row) => {
        try {
          const { courseCode, ...fields } = row;
          const res = await fetch('/api/admin/course-session-timing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseCode, ...fields }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
          results.push({ course_code: courseCode, action: 'upserted', message: 'Saved successfully' });
          upserted++;
        } catch (err) {
          results.push({
            course_code: row.courseCode,
            action: 'failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
          failed++;
        }
        setProgressCurrent(prev => prev + 1);
      }));
    }

    setAllResults(results);
    setSummary({ upserted, failed });
    setViewState('results');
  };

  // ── Download template ─────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const headers: Record<string, string> = { course_code: '' };
    for (const n of DAY_SESSIONS) {
      headers[`session_${n}_start_time`] = '';
      headers[`session_${n}_end_time`] = '';
      headers[`session_${n}_mode_of_training`] = '';
    }
    for (const n of EVENING_SESSIONS) {
      headers[`session_${n}_evening_start_time`] = '';
      headers[`session_${n}_evening_end_time`] = '';
      headers[`session_${n}_evening_mode_of_training`] = '';
    }
    const ws = XLSX.utils.json_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Session Timing');
    XLSX.writeFile(wb, 'course_session_timing_template.xlsx');
  };

  // ── Filtered results ──────────────────────────────────────────────────────

  const filteredResults = filterCategory === 'all'
    ? allResults
    : allResults.filter(r => r.action === filterCategory);
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / RESULTS_PER_PAGE));
  const pagedResults = filteredResults.slice((resultsPage - 1) * RESULTS_PER_PAGE, resultsPage * RESULTS_PER_PAGE);

  const resetFilter = (cat: typeof filterCategory) => {
    setFilterCategory(cat);
    setResultsPage(1);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const inputClasses = 'block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold dark:text-white">Course Session Timing</h2>
        <Button variant="outline" onClick={downloadTemplate}>
          <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
          Download Template
        </Button>
      </div>

      {/* ── Bulk upload temporarily disabled ── */}
      <Card className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">
        Bulk upload is currently disabled.
      </Card>

      {/* ── Upload state (commented out) ── */}
      {/* {viewState === 'upload' && ( ... )} */}
      {/* {viewState === 'processing' && ( ... )} */}
      {/* {viewState === 'results' && ( ... )} */}
    </div>
  );
};

export default CourseSessionTimingView;
