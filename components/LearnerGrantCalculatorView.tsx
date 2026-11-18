import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';

export default function LearnerGrantCalculatorView() {
  const { currentUser, currentUserProfile } = useLms();
  const [uen, setUen] = useState('');
  const [courseRef, setCourseRef] = useState('');
  const [nric, setNric] = useState('');
  const [nricType, setNricType] = useState('SC');
  const [sme, setSme] = useState('N');
  const [employerSponsored, setEmployerSponsored] = useState('N');
  const [startDate, setStartDate] = useState('');
  const [dob, setDob] = useState('');
  const [sponsorUen, setSponsorUen] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  // Auto-populate UEN from company settings
  useEffect(() => {
    fetch('/api/training-provider/uen')
      .then(r => r.json())
      .then(data => { if (data.uen) setUen(data.uen); })
      .catch(() => {});
  }, []);

  // Auto-populate learner NRIC and DOB from profile API
  useEffect(() => {
    if (!currentUser?.id) return;
    fetch(`/api/profile-new?userId=${currentUser.id}&role=learner`)
      .then(r => r.json())
      .then(json => {
        const profile = json.data?.profile;
        if (profile?.nric) setNric(profile.nric);
        if (profile?.dob) {
          const d = new Date(profile.dob);
          if (!isNaN(d.getTime())) setDob(d.toISOString().split('T')[0]);
        }
      })
      .catch(() => {});
  }, [currentUser?.id]);

  const formatCurrency = (amount: number | string | null | undefined) => {
    if (amount == null) return '—';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '—';
    return `SGD ${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const extractFeeSummary = (data: any) => {
    if (!data) return [];
    const rows: any[] = [];

    // Handle personalised format: data.data.funding
    const funding = data?.data?.funding;
    if (funding) {
      const approvedFee = funding.approvedCourseFee?.amount ?? null;
      const grants = funding.eligibleGrants || [];
      let totalGrant = 0;
      for (const g of grants) totalGrant += parseFloat(g.amount || '0');
      const nettFee = funding.nettFee?.amount ?? (approvedFee != null ? approvedFee - totalGrant : null);
      rows.push({
        courseName: courseRef || '—',
        courseRef: courseRef,
        tpName: uen || '—',
        tpUen: uen,
        approvedFee,
        totalGrant,
        feeAfterGrant: nettFee,
        components: grants,
      });
      return rows;
    }

    // Handle baseline format: data.courses or data.data.courses
    const courses = data?.data?.courses || data?.courses || [];
    for (const course of courses) {
      const courseName = course?.courseTitle || course?.courseName || course?.course?.title || course?.courseReferenceNumber || '—';
      const courseRefNum = course?.courseReferenceNumber || course?.course?.referenceNumber || '';
      const tpName = course?.trainingPartnerName || course?.trainingPartner?.name || course?.course?.trainingPartner?.name || '—';
      const tpUen = course?.trainingPartnerUen || course?.trainingPartner?.uen || course?.course?.trainingPartner?.uen || '';
      const fundingData = course?.funding || course;
      const approvedFee = fundingData?.approvedCourseFee?.amount ?? course?.approvedCourseFee ?? course?.courseFee ?? null;
      const components = fundingData?.eligibleGrants || fundingData?.eligibleGrantDetails || course?.fundingComponents || course?.grantComponents || [];
      let totalGrant = 0;
      for (const comp of components) totalGrant += parseFloat(comp?.grantAmount || comp?.amount || '0');
      const feeAfterGrant = fundingData?.nettFee?.amount ?? (approvedFee != null ? parseFloat(String(approvedFee)) - totalGrant : null);
      rows.push({ courseName, courseRef: courseRefNum, tpName, tpUen, approvedFee, totalGrant, feeAfterGrant, components });
    }
    return rows;
  };

  const handleSubmit = async () => {
    setError(''); setResult(null);
    if (!courseRef) { setError('Course Ref Code is required.'); return; }
    if (!uen) { setError('UEN is required.'); return; }

    const courses = [{ trainingPartnerUen: uen, courseReferenceNumber: courseRef }];
    setLoading(true);
    try {
      const resp = await fetch('/api/grants/calculate-personalised', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courses,
          app: 'app1',
          applicant: { sme, nric, nricType, employerSponsored },
          course: { referenceNumber: courseRef },
          trainee: { idType: 'NRIC', id: nric, dateOfBirth: dob || undefined, sponsoringEmployerUen: sponsorUen || undefined },
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-on-surface">Grant Calculator</h2>

      <p className="text-xs text-warning">Using App 1 (Skilleto) certificate for Personalised Grant Calculator.</p>

      {/* Main Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">UEN</label>
          <input value={uen} onChange={e => setUen(e.target.value)} placeholder="e.g. 201200696W"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Course Ref Code *</label>
          <input value={courseRef} onChange={e => setCourseRef(e.target.value)} placeholder="TGS-2024043419"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {/* Trainee Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">NRIC</label>
          <input value={nric} onChange={e => setNric(e.target.value)} placeholder="S1234567A"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">NRIC Type</label>
          <select value={nricType} onChange={e => setNricType(e.target.value)}
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary">
            <option value="SC">Singapore Citizen (SC)</option>
            <option value="PR">Permanent Resident (PR)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Date of Birth</label>
          <input type="date" value={dob} onChange={e => setDob(e.target.value)}
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">SME?</label>
          <select value={sme} onChange={e => setSme(e.target.value)}
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary">
            <option value="N">No</option>
            <option value="Y">Yes</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Employer Sponsored?</label>
          <select value={employerSponsored} onChange={e => setEmployerSponsored(e.target.value)}
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary">
            <option value="N">No</option>
            <option value="Y">Yes</option>
          </select>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={loading}
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading ? 'Calculating…' : 'Calculate Grant'}
      </button>

      {error && <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">{error}</div>}

      {result && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-on-surface">Grant Fee Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                  <th className="text-left px-6 py-3 font-semibold w-1/5">Course</th>
                  <th className="text-left px-6 py-3 font-semibold w-1/5">Training Partner</th>
                  <th className="text-right px-6 py-3 font-semibold w-1/5">Approved Fee</th>
                  <th className="text-right px-6 py-3 font-semibold w-1/5">Grant Amount</th>
                  <th className="text-right px-6 py-3 font-semibold w-1/5">Fee After Grant (w/o GST)</th>
                </tr>
              </thead>
              <tbody>
                {extractFeeSummary(result).length > 0 ? extractFeeSummary(result).map((row, i) => (
                  <tr key={i} className="border-b border-default hover:bg-surface-hover">
                    <td className="px-6 py-3">
                      <div className="font-medium text-on-surface">{row.courseName}</div>
                      <div className="text-xs text-muted">{row.courseRef}</div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="text-on-surface">{row.tpName}</div>
                      <div className="text-xs text-muted">{row.tpUen}</div>
                    </td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums">{formatCurrency(row.approvedFee)}</td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums text-success">− {formatCurrency(row.totalGrant)}</td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums font-bold text-primary">{formatCurrency(row.feeAfterGrant)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No course data returned. Check the JSON response.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border border-default rounded-lg overflow-hidden">
            <button onClick={() => setShowJson(!showJson)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-secondary hover:bg-surface-hover transition-colors">
              <span>▶ JSON Response</span>
              <span className="text-xs text-muted">{showJson ? 'collapse' : 'expand'}</span>
            </button>
            {showJson && (
              <pre className="px-4 py-3 bg-surface-elevated text-xs font-mono text-on-surface overflow-x-auto max-h-96 border-t border-default">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
