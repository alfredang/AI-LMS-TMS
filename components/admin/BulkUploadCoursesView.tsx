import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

interface CourseRow {
  course_code: string;
  title: string;
  course_type?: string;
  tsc_title?: string;
  tsc_code?: string;
  training_hours?: number | string;
  assessment_hours?: number | string;
  domain?: string;
  schedule_id?: string;
  funding_validity?: string;
  course_fees_exclude_gst?: string;
  tax_percent?: number | string;
  course_fees_include_gst?: string;
  renewed_status?: string;
  after_normal_funding?: number | string;
  after_mces_funding?: number | string;
  num_of_days?: number | string;
  num_of_trainers?: number | string;
  course_link?: string;
  assessment_record_link?: string;
  courseware_link?: string;
  brochure_link?: string;
  google_classroom?: string;
  google_classroom_code?: string;
  learner_guide_url?: string;
  skillsfuture_link?: string;
  sf_for_business_link?: string;
  skills_framework?: string;
  da?: boolean | string | number;
  average_score?: number | string;
  star_rating?: number | string;
  num_responders?: number | string;
  description?: string;
  course_outline?: string;
  is_utap_eligible?: boolean | string | number;
}

type ResultEntry = {
  course_code: string;
  title: string;
  action: 'created' | 'updated' | 'failed';
  message: string;
};

type ViewState = 'upload' | 'processing' | 'results';
type FilterCategory = 'all' | 'created' | 'updated' | 'failed';

const BATCH_SIZE = 20;
const RESULTS_PER_PAGE = 10;

interface BulkUploadCoursesViewProps {
  onBack: () => void;
}

export const BulkUploadCoursesView: React.FC<BulkUploadCoursesViewProps> = ({ onBack }) => {
  const [viewState, setViewState] = useState<ViewState>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Progress
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  // Results
  const [allResults, setAllResults] = useState<ResultEntry[]>([]);
  const [summary, setSummary] = useState({ created: 0, updated: 0, failed: 0 });
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [resultsPage, setResultsPage] = useState(1);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFileChange = (selectedFile: File | undefined | null) => {
    if (!selectedFile) return;
    const valid =
      selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      selectedFile.type === 'application/vnd.ms-excel' ||
      selectedFile.name.endsWith('.xlsx') ||
      selectedFile.name.endsWith('.xls') ||
      selectedFile.type === 'text/csv' ||
      selectedFile.name.endsWith('.csv');
    if (valid) {
      setFile(selectedFile);
      setError(null);
    } else {
      setError('Invalid file type. Please upload an Excel (.xlsx, .xls) or CSV file.');
      setFile(null);
    }
  };

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(isOver);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFileChange(e.dataTransfer.files?.[0]);
  };

  // ── Parse ──────────────────────────────────────────────────────────────────

  const parseFile = (f: File): Promise<CourseRow[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target?.result, { type: 'array' });
          const rows: any[] = XLSX.utils.sheet_to_json(
            workbook.Sheets[workbook.SheetNames[0]],
            { defval: '' }
          );
          const courses: CourseRow[] = rows.map((row) => {
            const str = (keys: string[]) => {
              for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
              return undefined;
            };
            return ({
            course_code: String(row['Course Code'] || row['course_code'] || '').trim(),
            title: String(row['Course Title'] || row['Title'] || row['title'] || '').trim(),
            course_type: (() => {
              const raw = String(row['Type'] || row['Course Type'] || row['course_type'] || '').trim().toUpperCase();
              if (raw === 'WSQ') return 'WSQ';
              if (raw === 'CASL') return 'CASL';
              if (raw === 'IBF') return 'IBF';
              return 'Non-WSQ';
            })(),
            tsc_title: str(['TSC Title', 'tsc_title']),
            tsc_code: str(['TSC Code', 'tsc_code']),
            training_hours: row['Duration (hrs)'] || row['Training Hours'] || row['training_hours'] || 0,
            assessment_hours: row['Assessment Hours'] || row['assessment_hours'] || 0,
            domain: str(['Domain', 'domain']),
            schedule_id: str(['Schedule ID', 'schedule_id']),
            funding_validity: str(['Funding Validty', 'Funding Validity', 'funding_validity']),
            course_fees_exclude_gst: str(['Course Fee (exl GST)', 'course_fees_exclude_gst']),
            tax_percent: row['GST'] || row['tax_percent'],
            course_fees_include_gst: str(['Course Fee (inc GST)', 'course_fees_include_gst']),
            renewed_status: str(['Course Renewed Status', 'renewed_status']),
            after_normal_funding: row['After Normal Funding'] || row['after_normal_funding'],
            after_mces_funding: row['After MCES Funding'] || row['after_mces_funding'],
            num_of_days: row['Days'] || row['num_of_days'],
            num_of_trainers: row['Number of Trainers'] || row['# of Trainers'] || row['num_of_trainers'],
            course_link: str(['Course Link', 'course_link']),
            assessment_record_link: str(['Assessment Record Link', 'assessment_record_link']),
            courseware_link: str(['Courseware', 'Courseware Link', 'courseware_link']),
            brochure_link: str(['Brochure Link', 'brochure_link']),
            google_classroom: str(['Google Classrooms', 'Google Classroom', 'google_classroom']),
            google_classroom_code: str(['Google Classroom Code', 'google_classroom_code']),
            learner_guide_url: str(['Learner Guide Link', 'Learner Guide URL', 'learner_guide_url']),
            slides_url: str(['Learner Slides PDF Links', 'slides_url']),
            lesson_plan_url: str(['Lesson Plan Link', 'lesson_plan_url']),
            facilitator_guide_url: str(['Facilitator Guide Link', 'facilitator_guide_url']),
            trainer_slides_url: str(['Trainer Slides Link', 'trainer_slides_url']),
            activities_url: str(['Activities Link', 'Activities/Lab Link', 'activities_url']),
            assessment_plan_url: str(['Assessment Plan Link', 'assessment_plan_url']),
            practical_performance_assessment_link: str(['Practical Performance Assessment Link', 'practical_performance_assessment_link']),
            written_assessment_link: str(['Written Assessment Link', 'written_assessment_link']),
            skillsfuture_link: str(['SkillsFuture Link', 'skillsfuture_link']),
            sf_for_business_link: str(['SF for Business Link', 'sf_for_business_link']),
            skills_framework: str(['Skills Framework', 'skills_framework']),
            da: row['DA'] ?? row['da'],
            average_score: row['Average Score'] || row['average_score'],
            star_rating: row['Star Rating'] || row['star_rating'],
            num_responders: row['Num of Responders'] || row['num_responders'],
            description: str(['Description', 'description']),
            course_outline: str(['Course Outline', 'course_outline']),
            is_utap_eligible: row['UTAP'] ?? row['is_utap_eligible'],
          });});
          resolve(courses.filter(c => c.course_code));
        } catch {
          reject(new Error('Failed to parse file. Please ensure it matches the template format.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsArrayBuffer(f);
    });

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!file) return;
    setError(null);

    let courses: CourseRow[];
    try {
      courses = await parseFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file.');
      return;
    }

    if (courses.length === 0) {
      setError('No valid course rows found. Ensure the file has data and matches the template columns.');
      return;
    }

    setProgressCurrent(0);
    setProgressTotal(courses.length);
    setAllResults([]);
    setSummary({ created: 0, updated: 0, failed: 0 });
    setViewState('processing');

    const accumulated: ResultEntry[] = [];
    let created = 0, updated = 0, failed = 0;

    for (let i = 0; i < courses.length; i += BATCH_SIZE) {
      const batch = courses.slice(i, i + BATCH_SIZE);
      try {
        const response = await fetch('/api/admin/bulk-upload-courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courses: batch }),
        });
        const result = await response.json();
        if (response.ok && result.data) {
          accumulated.push(...result.data.results);
          created += result.data.created;
          updated += result.data.updated;
          failed += result.data.failed;
        } else {
          batch.forEach(c => {
            accumulated.push({ course_code: c.course_code, title: c.title, action: 'failed', message: result.message || 'Batch failed.' });
            failed++;
          });
        }
      } catch {
        batch.forEach(c => {
          accumulated.push({ course_code: c.course_code, title: c.title, action: 'failed', message: 'Network error.' });
          failed++;
        });
      }

      setProgressCurrent(Math.min(i + BATCH_SIZE, courses.length));
    }

    setAllResults(accumulated);
    setSummary({ created, updated, failed });
    setFilterCategory('all');
    setResultsPage(1);
    setViewState('results');
  };

  const downloadTemplate = () => {
    const link = document.createElement('a');
    link.href = '/company_templates/upload_course_template.xlsx';
    link.download = 'upload_course_template.xlsx';
    link.click();
  };

  // ── Filtered results ───────────────────────────────────────────────────────

  const filteredResults = filterCategory === 'all'
    ? allResults
    : allResults.filter(r => r.action === filterCategory);

  const totalResultPages = Math.ceil(filteredResults.length / RESULTS_PER_PAGE);
  const paginatedResults = filteredResults.slice(
    (resultsPage - 1) * RESULTS_PER_PAGE,
    resultsPage * RESULTS_PER_PAGE
  );

  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;

  // ── Category card helpers ──────────────────────────────────────────────────

  const categoryCards: { key: FilterCategory; label: string; count: number; color: string; activeColor: string }[] = [
    { key: 'all',     label: 'All',     count: allResults.length, color: 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600',       activeColor: 'bg-gray-200 dark:bg-gray-600 border-gray-400 dark:border-gray-400' },
    { key: 'created', label: 'Created', count: summary.created,   color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',   activeColor: 'bg-green-100 dark:bg-green-900/40 border-green-500 dark:border-green-500' },
    { key: 'updated', label: 'Updated', count: summary.updated,   color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',       activeColor: 'bg-blue-100 dark:bg-blue-900/40 border-blue-500 dark:border-blue-500' },
    { key: 'failed',  label: 'Failed',  count: summary.failed,    color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',           activeColor: 'bg-red-100 dark:bg-red-900/40 border-red-500 dark:border-red-500' },
  ];

  const textColors: Record<FilterCategory, string> = {
    all:     'text-gray-800 dark:text-gray-200',
    created: 'text-green-700 dark:text-green-400',
    updated: 'text-blue-700 dark:text-blue-400',
    failed:  'text-red-700 dark:text-red-400',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const headerRow = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack}>
          <Icon name={IconName.Back} className="w-4 h-4 mr-1" />
          Back to Courses
        </Button>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Bulk Upload Courses</h1>
      </div>
      {viewState === 'results' && (
        <Button variant="ghost" onClick={() => { setViewState('upload'); setFile(null); }} className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20">
          <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
          New Upload
        </Button>
      )}
    </div>
  );

  // ── Processing view ────────────────────────────────────────────────────────
  if (viewState === 'processing') {
    return (
      <div className="space-y-6">
        {headerRow}
        <Card className="p-10 dark:bg-gray-800 dark:border-gray-700 flex flex-col items-center justify-center min-h-[360px]">
          <div className="w-full max-w-md text-center space-y-6">
            <div className="animate-spin rounded-full h-14 w-14 border-4 border-blue-200 border-t-blue-600 mx-auto" />
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">Uploading courses...</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Please do not close this page.</p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>Progress</span>
                <span>{Math.min(progressCurrent, progressTotal)} / {progressTotal}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className="h-3 bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-right">{progressPct}%</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Results view ───────────────────────────────────────────────────────────
  if (viewState === 'results') {
    return (
      <div className="space-y-6">
        {headerRow}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {categoryCards.map(({ key, label, count, color, activeColor }) => (
            <button
              key={key}
              onClick={() => { setFilterCategory(key); setResultsPage(1); }}
              className={`rounded-lg p-4 text-center border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                filterCategory === key ? activeColor : `${color} hover:opacity-80`
              }`}
            >
              <p className={`text-3xl font-bold ${textColors[key]}`}>{count}</p>
              <p className={`text-sm font-medium mt-1 ${textColors[key]}`}>{label}</p>
              {filterCategory === key && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Showing this filter</p>
              )}
            </button>
          ))}
        </div>

        <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
          <div className="px-6 py-4 border-b dark:border-gray-700 flex justify-between items-center">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {filterCategory === 'all' ? 'All Results' : `${filterCategory.charAt(0).toUpperCase() + filterCategory.slice(1)} (${filteredResults.length})`}
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{filteredResults.length} record{filteredResults.length !== 1 ? 's' : ''}</span>
          </div>

          {filteredResults.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">No records in this category.</div>
          ) : (
            <>
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Course Code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Message</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedResults.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500">
                        {(resultsPage - 1) * RESULTS_PER_PAGE + i + 1}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-700 dark:text-gray-300">{r.course_code}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{r.title}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          r.action === 'created' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : r.action === 'updated' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {r.action.charAt(0).toUpperCase() + r.action.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        <span>{r.message}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totalResultPages > 1 && (
                <div className="p-4 flex justify-between items-center border-t dark:border-gray-700">
                  <Button variant="ghost" onClick={() => setResultsPage(p => Math.max(1, p - 1))} disabled={resultsPage === 1}>
                    Previous
                  </Button>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Page {resultsPage} of {totalResultPages}
                  </span>
                  <Button variant="ghost" onClick={() => setResultsPage(p => Math.min(totalResultPages, p + 1))} disabled={resultsPage === totalResultPages}>
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    );
  }

  // ── Upload view (default) ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {headerRow}

      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Instructions</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li>Download the template file and fill in course details.</li>
          <li>Template columns: <strong className="text-gray-800 dark:text-gray-200">Course Title, Course Code, Domain, Type, Courseware, Schedule ID, Funding Validty, Course Fee (exl GST), GST, After Normal Funding, After MCES Funding, Duration (hrs), Days, Course Link, Assessment Record Link, Brochure Link, Google Classrooms, Google Classroom Code, Learner Slides PDF Links, Lesson Plan Link, Learner Guide Link, Facilitator Guide Link, Trainer Slides Link, Assessment Plan Link, Practical Performance Assessment Link, Written Assessment Link, SkillsFuture Link, SF for Business Link, TSC Code, TSC Title, Skills Framework, DA, Average Score, Star Rating, Num of Responders, Description, Course Outline, UTAP, Course Renewed Status</strong>.</li>
          <li>Required columns: <strong className="text-gray-800 dark:text-gray-200">Course Code, Course Title</strong>.</li>
          <li><strong className="text-gray-800 dark:text-gray-200">Type</strong>: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">WSQ</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">IBF</code>, or <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Non-WSQ</code> (default).</li>
          <li>If the course code already exists, the course information will be updated.</li>
        </ol>
        <div className="mt-4">
          <Button variant="ghost" onClick={downloadTemplate}>
            <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
            Download Template
          </Button>
        </div>
      </Card>

      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Upload File</h2>

        <div
          onDragEnter={(e) => handleDragEvents(e, true)}
          onDragOver={(e) => handleDragEvents(e, true)}
          onDragLeave={(e) => handleDragEvents(e, false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('course-file-input')?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <Icon name={IconName.Upload} className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
          {file ? (
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{file.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drag & drop your file here, or click to browse</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Supports .xlsx, .xls, .csv</p>
            </div>
          )}
          <input
            id="course-file-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFileChange(e.target.files?.[0])}
          />
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={handleUpload} disabled={!file}>
            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
            Upload Courses
          </Button>
        </div>
      </Card>
    </div>
  );
};
