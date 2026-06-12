import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import {
  AUDIT_COURSEWARE_DOC_TYPES,
  AUDIT_FIELD_OPTIONS,
  AuditCoursewareDocType,
  AuditDocComparison,
  AuditFieldComparison,
  useCw,
} from './CwContext';

// Auto-detect doc type from filename — checks the leading 2-3 chars or any
// `_AP_` / `LP_` style token. Falls back to 'AP' if nothing matches.
function detectDocType(name: string): AuditCoursewareDocType {
  const upper = name.toUpperCase();
  for (const t of AUDIT_COURSEWARE_DOC_TYPES) {
    if (upper.startsWith(t + '_') || upper.startsWith(t + '-') || upper.includes('_' + t + '_') || upper.includes('-' + t + '-')) {
      return t;
    }
  }
  return 'AP';
}

const STATUS_BADGE: Record<AuditFieldComparison['status'], { label: string; cls: string; icon: string }> = {
  match: {
    label: 'PASS',
    cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    icon: '✓',
  },
  mismatch: {
    label: 'FAIL',
    cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
    icon: '✕',
  },
  missing: {
    label: 'MISSING',
    cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    icon: '!',
  },
  na: {
    label: 'N/A',
    cls: 'bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    icon: '—',
  },
};

const fmtValue = (v: string | string[] | null): string => {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(' • ');
  return v;
};

// One per-doc collapsible card with a status row per audit field.
const DocResultCard: React.FC<{ comparison: AuditDocComparison }> = ({ comparison }) => {
  const [open, setOpen] = useState(comparison.failCount > 0);
  const total = comparison.fields.filter((f) => f.status !== 'na').length;
  const allPassed = comparison.passCount === total && total > 0;
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-base">{allPassed ? '✅' : comparison.failCount > 0 ? '❌' : '✅'}</span>
        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
          {comparison.docType}
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{comparison.fileName}</span>
        <span className="ml-auto text-xs text-gray-500">
          {comparison.passCount} pass · {comparison.failCount} fail
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {comparison.fields.map((f) => {
            const badge = STATUS_BADGE[f.status];
            return (
              <div key={f.field} className="px-4 py-3 border-b last:border-b-0 border-gray-100 dark:border-gray-700/50">
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold border ${badge.cls}`}>
                    {badge.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{f.label}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                    </div>
                    {f.status !== 'na' && (
                      <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-gray-400 uppercase tracking-wider text-[10px]">Got</p>
                          <p className="text-gray-800 dark:text-gray-200 break-words">{fmtValue(f.got)}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 uppercase tracking-wider text-[10px]">Expected (CP)</p>
                          <p className="text-gray-800 dark:text-gray-200 break-words">{fmtValue(f.expected)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

const CwCoursewareAudit: React.FC = () => {
  const cw = useCw();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCpUpload = (file: File | null) => {
    cw.setAuditCpFile(file);
  };

  const handleAddDocs = (files: FileList | null) => {
    if (!files) return;
    const newEntries = Array.from(files).map((f) => ({
      file: f,
      docType: detectDocType(f.name),
    }));
    cw.setAuditDocs([...cw.auditDocs, ...newEntries]);
  };

  const handleRemoveDoc = (idx: number) => {
    cw.setAuditDocs(cw.auditDocs.filter((_, i) => i !== idx));
  };

  const handleDocTypeChange = (idx: number, type: AuditCoursewareDocType) => {
    cw.setAuditDocs(cw.auditDocs.map((d, i) => (i === idx ? { ...d, docType: type } : d)));
  };

  const handleChecklistToggle = (key: string) => {
    if (cw.auditChecklist.includes(key)) {
      cw.setAuditChecklist(cw.auditChecklist.filter((k) => k !== key));
    } else {
      cw.setAuditChecklist([...cw.auditChecklist, key]);
    }
  };

  const handleSelectAll = () => cw.setAuditChecklist(AUDIT_FIELD_OPTIONS.map((f) => f.key));
  const handleSelectNone = () => cw.setAuditChecklist([]);

  const handleClearAll = () => {
    cw.setAuditCpFile(null);
    cw.setAuditTgsCode('');
    cw.setAuditDocs([]);
    cw.setAuditResultData(null);
    cw.setAuditChecklist(AUDIT_FIELD_OPTIONS.map((f) => f.key));
    setError('');
  };

  const handleAudit = async () => {
    if (!cw.auditCpFile) {
      setError('Please upload the CP document first.');
      return;
    }
    if (cw.auditDocs.length === 0) {
      setError('Please upload at least one courseware document (AP / ASR / FG / LG / LP).');
      return;
    }
    if (cw.auditChecklist.length === 0) {
      setError('Please select at least one field to audit.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('cp', cw.auditCpFile);
      fd.append('tgsCode', cw.auditTgsCode);
      fd.append('checklist', cw.auditChecklist.join(','));
      const docTypes: string[] = [];
      for (const entry of cw.auditDocs) {
        fd.append('docs', entry.file);
        docTypes.push(entry.docType);
      }
      // Send docTypes in the SAME order as docs were appended.
      docTypes.forEach((t) => fd.append('docTypes', t));

      const res = await fetch('/api/developer/cw-audit', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Audit failed');
      cw.setAuditResultData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const result = cw.auditResultData;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold dark:text-white">Courseware Audit</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload the Course Proposal and one or more courseware documents (AP / ASR / FG / LG / LP).
          Each doc is checked against the CP and you'll see per-field pass / fail / missing status.
        </p>
      </div>

      {/* Step 1 — Upload CP */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          1. Course Proposal (CP)
        </h3>
        <input
          type="file"
          accept=".docx,.doc,.xlsx,.xls"
          onChange={(e) => handleCpUpload(e.target.files?.[0] || null)}
          className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/60"
        />
        {cw.auditCpFile && (
          <p className="text-xs text-gray-500">
            Selected: <span className="font-mono">{cw.auditCpFile.name}</span> ({Math.round(cw.auditCpFile.size / 1024)} KB)
          </p>
        )}
      </Card>

      {/* Step 2 — TGS code */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          2. TGS Reference Code
        </h3>
        <input
          type="text"
          value={cw.auditTgsCode}
          onChange={(e) => cw.setAuditTgsCode(e.target.value)}
          placeholder="e.g. TGS-2024001234"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-400">Leave blank to use whatever the audit extracts from the CP.</p>
      </Card>

      {/* Step 3 — Upload courseware docs */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
          3. Courseware Documents
        </h3>
        <input
          type="file"
          accept=".docx,.doc"
          multiple
          onChange={(e) => {
            handleAddDocs(e.target.files);
            e.target.value = ''; // reset so re-selecting same file fires onChange
          }}
          className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/40 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/60"
        />
        {cw.auditDocs.length > 0 && (
          <div className="space-y-2">
            {cw.auditDocs.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <span className="text-xs font-mono text-gray-500 w-6">#{idx + 1}</span>
                <select
                  value={entry.docType}
                  onChange={(e) => handleDocTypeChange(idx, e.target.value as AuditCoursewareDocType)}
                  className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-mono text-gray-700 dark:text-gray-200"
                >
                  {AUDIT_COURSEWARE_DOC_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{entry.file.name}</span>
                <span className="text-xs text-gray-400">{Math.round(entry.file.size / 1024)} KB</span>
                <button
                  type="button"
                  onClick={() => handleRemoveDoc(idx)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Step 4 — Field checklist */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            4. Fields to Audit
          </h3>
          <div className="flex gap-2 text-xs">
            <button onClick={handleSelectAll} className="text-blue-600 dark:text-blue-400 hover:underline">All</button>
            <span className="text-gray-300">|</span>
            <button onClick={handleSelectNone} className="text-blue-600 dark:text-blue-400 hover:underline">None</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AUDIT_FIELD_OPTIONS.map((opt) => {
            const on = cw.auditChecklist.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleChecklistToggle(opt.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all text-left ${
                  on
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <span className="mr-1.5">{on ? '✓' : '○'}</span> {opt.label}
              </button>
            );
          })}
        </div>
      </Card>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleAudit} disabled={loading} className="flex-1">
          {loading ? 'Running Audit...' : 'Run Courseware Audit'}
        </Button>
        <button
          type="button"
          onClick={handleClearAll}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
        >
          Clear All & Start New Audit
        </button>
      </div>

      {loading && (
        <Card className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Extracting fields and comparing... this may take 30-60s per document.
          </p>
        </Card>
      )}

      {!loading && result && (
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3">
              Audit Summary
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Documents</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{result.summary.totalDocs}</p>
              </div>
              <div className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-900/20">
                <p className="text-xs text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Pass</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-200">{result.summary.totalPass}</p>
              </div>
              <div className="rounded-lg p-3 bg-red-50 dark:bg-red-900/20">
                <p className="text-xs text-red-700 dark:text-red-300 uppercase tracking-wider">Fail</p>
                <p className="text-2xl font-bold text-red-700 dark:text-red-200">{result.summary.totalFail}</p>
              </div>
            </div>
          </Card>

          <div className="space-y-3">
            {result.comparisons.map((cmp, idx) => (
              <DocResultCard key={`${cmp.fileName}-${idx}`} comparison={cmp} />
            ))}
          </div>
        </div>
      )}

      {!loading && !result && (
        <Card className="p-8 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Courseware Audit</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Upload your CP and at least one courseware doc above, then click <span className="font-semibold">Run Courseware Audit</span>.
          </p>
        </Card>
      )}
    </div>
  );
};

export default CwCoursewareAudit;
