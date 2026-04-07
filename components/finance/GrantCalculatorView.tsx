import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';

type CalcTab = 'baseline' | 'personalised';

interface CourseEntry {
  trainingPartnerUen: string;
  courseReferenceNumber: string;
}

const APP_OPTIONS = [
  { value: 'app1', label: 'App 1 (Skilleto)' },
  { value: 'app2', label: 'App 2' },
  { value: 'app3', label: 'App 3' },
  { value: 'app4', label: 'App 4 (OAuth)' },
];

export default function GrantCalculatorView() {
  const { trainingProviderProfile } = useLms();
  const [tab, setTab] = useState<CalcTab>('personalised');
  const [selectedApp, setSelectedApp] = useState('app1');
  const [uen, setUen] = useState('');

  // Auto-populate UEN from company settings or API
  useEffect(() => {
    if (trainingProviderProfile?.uen) {
      setUen(trainingProviderProfile.uen);
    } else {
      fetch('/api/training-provider/uen')
        .then(r => r.json())
        .then(data => { if (data.uen) setUen(data.uen); })
        .catch(() => {});
    }
  }, [trainingProviderProfile]);

  // --- Baseline state ---
  const [coursesText, setCoursesText] = useState('');
  const [baselineResult, setBaselineResult] = useState<any>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [baselineError, setBaselineError] = useState('');
  const [showBaselineJson, setShowBaselineJson] = useState(false);

  // --- Personalised state ---
  const [pCoursesText, setPCoursesText] = useState('');
  const [pNric, setPNric] = useState('');
  const [pNricType, setPNricType] = useState('SC');
  const [pSme, setPSme] = useState('N');
  const [pEmployerSponsored, setPEmployerSponsored] = useState('N');
  const [pCourseRef, setPCourseRef] = useState('');
  const [pStartDate, setPStartDate] = useState('');
  const [pDob, setPDob] = useState('');
  const [pSponsorUen, setPSponsorUen] = useState('');
  const [personalisedResult, setPersonalisedResult] = useState<any>(null);
  const [personalisedLoading, setPersonalisedLoading] = useState(false);
  const [personalisedError, setPersonalisedError] = useState('');
  const [showPersonalisedJson, setShowPersonalisedJson] = useState(false);

  const parseCourses = (text: string): CourseEntry[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(',').map((s) => s.trim());
        return {
          trainingPartnerUen: parts[0] || '',
          courseReferenceNumber: parts[1] || '',
        };
      })
      .filter((c) => c.trainingPartnerUen && c.courseReferenceNumber);
  };

  const handleBaseline = async () => {
    setBaselineError('');
    setBaselineResult(null);

    const courses = parseCourses(coursesText);
    if (courses.length === 0) {
      setBaselineError('Please enter at least one course (UEN, CourseRefNo).');
      return;
    }

    setBaselineLoading(true);
    try {
      const resp = await fetch('/api/grants/calculate-baseline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courses, app: selectedApp }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setBaselineError(json.error || `Error ${resp.status}`);
      } else {
        setBaselineResult(json.data);
      }
    } catch (err) {
      setBaselineError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBaselineLoading(false);
    }
  };

  const handlePersonalised = async () => {
    setPersonalisedError('');
    setPersonalisedResult(null);

    if (!pCourseRef) {
      setPersonalisedError('Course Reference Code is required.');
      return;
    }
    if (!uen) {
      setPersonalisedError('UEN is required.');
      return;
    }

    // Auto-build courses from UEN + Course Ref
    const courses = [{ trainingPartnerUen: uen, courseReferenceNumber: pCourseRef }];

    setPersonalisedLoading(true);
    try {
      const resp = await fetch('/api/grants/calculate-personalised', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courses,
          app: selectedApp,
          applicant: {
            sme: pSme,
            nric: pNric,
            nricType: pNricType,
            employerSponsored: pEmployerSponsored,
          },
          course: {
            referenceNumber: pCourseRef,
            startDate: pStartDate,
          },
          trainee: {
            idType: 'NRIC',
            id: pNric,
            dateOfBirth: pDob,
            sponsoringEmployerUen: pSponsorUen,
          },
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setPersonalisedError(json.error || `Error ${resp.status}`);
      } else {
        setPersonalisedResult(json.data);
      }
    } catch (err) {
      setPersonalisedError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPersonalisedLoading(false);
    }
  };

  const formatCurrency = (amount: number | string | null | undefined) => {
    if (amount == null) return '—';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '—';
    return `SGD ${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Extract fee summary rows from SSG response
  const extractFeeSummary = (data: any) => {
    if (!data) return [];
    // SSG response may have data.data.courses or data.courses
    const courses = data?.data?.courses || data?.courses || [];
    const rows: any[] = [];
    for (const course of courses) {
      const courseName = course?.courseTitle || course?.courseName || course?.courseReferenceNumber || '—';
      const courseRef = course?.courseReferenceNumber || '';
      const tpName = course?.trainingPartnerName || course?.trainingPartner?.name || '—';
      const tpUen = course?.trainingPartnerUen || course?.trainingPartner?.uen || '';
      const approvedFee = course?.approvedCourseFee ?? course?.courseFee ?? null;
      const components = course?.fundingComponents || course?.grantComponents || [];
      let totalGrant = 0;
      for (const comp of components) {
        totalGrant += parseFloat(comp?.grantAmount || comp?.amount || '0');
      }
      const feeAfterGrant = approvedFee != null ? parseFloat(approvedFee) - totalGrant : null;
      rows.push({
        courseName,
        courseRef,
        tpName,
        tpUen,
        approvedFee,
        totalGrant,
        feeAfterGrant,
        components,
      });
    }
    return rows;
  };

  const tabClass = (t: CalcTab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      tab === t
        ? 'bg-white dark:bg-slate-800 text-primary border-b-2 border-primary'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Grant Calculator</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          POST /grantCalculators/individual (v3.0).{' '}
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            Certificate + OAuth
          </span>
        </p>
      </div>

      {/* SSG App Selector */}
      <div>
        <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider mb-2">
          Certificate / OAuth
        </label>
        <select
          value={selectedApp}
          onChange={(e) => setSelectedApp(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary"
        >
          {APP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <button onClick={() => setTab('personalised')} className={tabClass('personalised')}>
          Personalised
        </button>
        <button onClick={() => setTab('baseline')} className={tabClass('baseline')}>
          Baseline Scheme
        </button>
      </div>

      {/* Baseline Tab */}
      {tab === 'baseline' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Courses (one per line: UEN, CourseRefNo)
            </label>
            <textarea
              value={coursesText}
              onChange={(e) => setCoursesText(e.target.value)}
              rows={4}
              placeholder="201200696W, TGS-2024043419"
              className="w-full max-w-xl rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>

          <button
            onClick={handleBaseline}
            disabled={baselineLoading}
            className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {baselineLoading ? 'Calculating…' : 'Calculate Baseline Grant'}
          </button>

          {baselineError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {baselineError}
            </div>
          )}

          {baselineResult && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Grant Fee Summary</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                      <th className="text-left px-4 py-3 font-semibold">Course</th>
                      <th className="text-left px-4 py-3 font-semibold">Training Partner</th>
                      <th className="text-right px-4 py-3 font-semibold">Approved Fee</th>
                      <th className="text-right px-4 py-3 font-semibold">Grant Amount</th>
                      <th className="text-right px-4 py-3 font-semibold">Fee After Grant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractFeeSummary(baselineResult).length > 0 ? (
                      extractFeeSummary(baselineResult).map((row, i) => (
                        <tr key={i} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{row.courseName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{row.courseRef}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900 dark:text-white">{row.tpName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{row.tpUen}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-900 dark:text-white">
                            {formatCurrency(row.approvedFee)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-green-600 dark:text-green-400">
                            − {formatCurrency(row.totalGrant)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-primary">
                            {formatCurrency(row.feeAfterGrant)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                          No course data returned. Check the JSON response for details.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* JSON Response collapsible */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowBaselineJson(!showBaselineJson)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <span>▶ JSON Response</span>
                  <span className="text-xs text-gray-400">{showBaselineJson ? 'collapse' : 'expand'}</span>
                </button>
                {showBaselineJson && (
                  <pre className="px-4 py-3 bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 border-t border-gray-200 dark:border-gray-700">
                    {JSON.stringify(baselineResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Personalised Tab */}
      {tab === 'personalised' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UEN</label>
              <input
                value={uen}
                onChange={(e) => setUen(e.target.value)}
                placeholder="e.g. 201200696W"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Ref Code *</label>
              <input
                value={pCourseRef}
                onChange={(e) => setPCourseRef(e.target.value)}
                placeholder="TGS-2024043419"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NRIC</label>
              <input
                value={pNric}
                onChange={(e) => setPNric(e.target.value)}
                placeholder="S1234567A"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NRIC Type</label>
              <select
                value={pNricType}
                onChange={(e) => setPNricType(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                <option value="SC">Singapore Citizen (SC)</option>
                <option value="PR">Permanent Resident (PR)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SME?</label>
              <select
                value={pSme}
                onChange={(e) => setPSme(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                <option value="N">No</option>
                <option value="Y">Yes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Employer Sponsored?</label>
              <select
                value={pEmployerSponsored}
                onChange={(e) => setPEmployerSponsored(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                <option value="N">No</option>
                <option value="Y">Yes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Start Date</label>
              <input
                type="date"
                value={pStartDate}
                onChange={(e) => setPStartDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date of Birth</label>
              <input
                type="date"
                value={pDob}
                onChange={(e) => setPDob(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sponsoring Employer UEN</label>
              <input
                value={pSponsorUen}
                onChange={(e) => setPSponsorUen(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          <button
            onClick={handlePersonalised}
            disabled={personalisedLoading}
            className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {personalisedLoading ? 'Calculating…' : 'Calculate Personalised Grant'}
          </button>

          {personalisedError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {personalisedError}
            </div>
          )}

          {personalisedResult && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Grant Fee Summary</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                      <th className="text-left px-4 py-3 font-semibold">Course</th>
                      <th className="text-left px-4 py-3 font-semibold">Training Partner</th>
                      <th className="text-right px-4 py-3 font-semibold">Approved Fee</th>
                      <th className="text-right px-4 py-3 font-semibold">Grant Amount</th>
                      <th className="text-right px-4 py-3 font-semibold">Fee After Grant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractFeeSummary(personalisedResult).length > 0 ? (
                      extractFeeSummary(personalisedResult).map((row, i) => (
                        <tr key={i} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{row.courseName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{row.courseRef}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900 dark:text-white">{row.tpName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{row.tpUen}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-900 dark:text-white">
                            {formatCurrency(row.approvedFee)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-green-600 dark:text-green-400">
                            − {formatCurrency(row.totalGrant)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-primary">
                            {formatCurrency(row.feeAfterGrant)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                          No course data returned. Check the JSON response for details.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* JSON Response collapsible */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowPersonalisedJson(!showPersonalisedJson)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <span>▶ JSON Response</span>
                  <span className="text-xs text-gray-400">{showPersonalisedJson ? 'collapse' : 'expand'}</span>
                </button>
                {showPersonalisedJson && (
                  <pre className="px-4 py-3 bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 border-t border-gray-200 dark:border-gray-700">
                    {JSON.stringify(personalisedResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
