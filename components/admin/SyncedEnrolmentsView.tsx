import React, { useEffect, useMemo, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { maskNric } from './CompanyApplicationViews';
import { authHeader } from '../../lib/auth/authHeader';

// "All Synced Enrolments" — a list of every EMPLOYER-sponsored enrolment that
// exists in `enrollment` but was never registered as a Company Application.
// These mostly arrived through the SSG sync/import path, so they never got a
// company_application row and are invisible to the View Company Application tab.
//
// The list itself is read-only. The one action available is "Add to Company
// Application": it promotes selected enrolments into real Company Application
// rows (billed to an employer the admin picks from QuickBooks) so the existing
// Generate Invoice / Check Supporting Document pipeline can act on them. That
// promotion is inert — it copies the existing SSG enrolment reference and marks
// the row already-enrolled, so nothing is re-sent to SSG.

interface SyncedRow {
  id: string;
  enrolmentId: string;
  enrolmentStatus: string;
  enrolmentDate: string;
  nric: string;
  email: string;
  sponsorship: string;
  traineeName: string;
  employer: string;
  courseTitle: string;
  courseReference: string;
  courseStartDate: string;
  grantId: string;
  grantAmount: string;
}

interface EmployerOption {
  id: string;
  employerUen: string;
  employerOrgName: string;
  employerContactName: string;
  employerContactDesignation: string;
  employerContactEmail: string;
  employerContactPhone: string;
  source: 'qb' | 'history' | 'both';
}

const inputClasses =
  'block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500';

const dash = (value: string) => (value && value.trim() !== '' ? value.trim() : '—');

// Colour the enrolment-status pill: Confirmed → green, Cancelled/Withdrawn →
// red, Pending → amber, anything else → neutral grey.
const statusPillClass = (status: string): string => {
  const s = status.trim().toLowerCase();
  if (s === 'confirmed' || s === 'enrolled' || s === 'enroled' || s === 'completed') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  }
  if (s.includes('cancel') || s.includes('withdraw') || s === 'rejected') {
    return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  }
  if (s.includes('pending') || s.includes('await')) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
};

const ITEMS_PER_PAGE = 25;

// The company domain from a work email — a soft hint at the employer, since the
// employer field itself was never captured on these sync'd enrolments.
const emailDomain = (email: string): string => {
  const at = String(email || '').split('@');
  return at.length === 2 && at[1] ? at[1].trim().toLowerCase() : '';
};

const StatTile: React.FC<{ label: string; value: string | number; icon: IconName; accent: string }> = ({ label, value, icon, accent }) => (
  <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm">
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${accent}`}>
      <Icon name={icon} className="w-5 h-5" />
    </div>
    <div className="min-w-0">
      <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none tabular-nums">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{label}</p>
    </div>
  </div>
);

// Windowed page list: always show first + last, the current page and its
// neighbours, with '…' gaps for the rest. e.g. 1 … 5 [6] 7 … 76.
const pageWindow = (current: number, total: number): Array<number | '…'> => {
  const wanted = new Set<number>([1, total, current, current - 1, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
};

export const SyncedEnrolmentsView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [rows, setRows] = useState<SyncedRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEmployerPicker, setShowEmployerPicker] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const reload = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/fetch-synced-enrolments');
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err) {
      console.error('Failed to load synced enrolments:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load synced enrolments.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.traineeName, r.nric, r.email, r.courseTitle, r.courseReference, r.enrolmentId, r.employer, r.grantId]
        .some((v) => String(v || '').toLowerCase().includes(q)),
    );
  }, [rows, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const pageStart = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageRows = filtered.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id));
  const togglePageAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);

  const stats = useMemo(() => {
    const withGrant = rows.filter((r) => r.grantId && r.grantId.trim() !== '').length;
    const courses = new Set(rows.map((r) => r.courseTitle).filter(Boolean)).size;
    const companies = new Set(rows.map((r) => emailDomain(r.email)).filter(Boolean)).size;
    return { total: rows.length, withGrant, courses, companies };
  }, [rows]);

  const handleAdded =(result: { created: number; skippedCount: number; convertedIds: string[] }) => {
    setShowEmployerPicker(false);
    // Drop the promoted rows from the list — they're now Company Applications.
    const promoted = new Set(selectedRows.map((r) => r.id));
    setRows((prev) => prev.filter((r) => !promoted.has(r.id)));
    setSelectedIds(new Set());
    const parts = [`${result.created} enrolment${result.created === 1 ? '' : 's'} added to Company Application`];
    if (result.skippedCount > 0) parts.push(`${result.skippedCount} skipped (already tracked)`);
    setResultMessage({ tone: result.created > 0 ? 'success' : 'error', text: parts.join(' · ') });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.Sync} className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white leading-tight">All Synced Enrolments</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Employer-sponsored enrolments already in the system that are not tracked as Company Applications.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={reload} disabled={isLoading}>
          <Icon name={IconName.Sync} className="w-4 h-4 mr-2" />
          {isLoading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Total enrolments" value={stats.total.toLocaleString()} icon={IconName.Users} accent="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300" />
        <StatTile label="With a grant" value={stats.withGrant.toLocaleString()} icon={IconName.CheckCircle} accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" />
        <StatTile label="Distinct courses" value={stats.courses.toLocaleString()} icon={IconName.BookOpen} accent="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300" />
        <StatTile label="Employers (by email)" value={stats.companies.toLocaleString()} icon={IconName.Building} accent="bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300" />
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 dark:border-blue-400 rounded-lg p-4 flex items-start gap-3">
        <Icon name={IconName.InfoCircle} className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 dark:text-blue-200">
          <p className="font-semibold mb-1">These learners are already enrolled</p>
          <p className="text-blue-700 dark:text-blue-300">
            They came in through the enrolment/sync path rather than a Company Application upload, so they never appeared
            under View Company Application. To invoice or verify supporting documents for any of them, tick the rows and
            click <strong>Add to Company Application</strong> — you&apos;ll pick the paying company, and they&apos;ll move into
            the normal Company Application tab. This does not re-enrol anyone or contact SSG.
          </p>
        </div>
      </div>

      {resultMessage && (
        <div
          className={`rounded-lg p-4 flex items-start justify-between gap-3 ${
            resultMessage.tone === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
              : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
          }`}
        >
          <div className="flex items-start gap-2">
            <Icon
              name={resultMessage.tone === 'success' ? IconName.CheckCircle : IconName.Warning}
              className={`w-5 h-5 flex-shrink-0 mt-0.5 ${resultMessage.tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
            />
            <div className="text-sm">
              <p className={resultMessage.tone === 'success' ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}>
                {resultMessage.text}
              </p>
              {resultMessage.tone === 'success' && (
                <button
                  type="button"
                  onClick={() => setAdminPage(AdminPage.ViewCompanyApplication)}
                  className="mt-1 text-sm font-medium text-emerald-700 dark:text-emerald-300 underline hover:no-underline"
                >
                  Go to View Company Application →
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={() => setResultMessage(null)} aria-label="Dismiss">
            <Icon name={IconName.Close} className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" />
          </button>
        </div>
      )}

      <Card className="p-6">
        <div className="flex flex-col md:flex-row gap-4 items-end mb-4">
          <div className="flex-1 w-full">
            <label htmlFor="search-synced-enrolments" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Search</label>
            <div className="relative">
              <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="search-synced-enrolments"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by learner, NRIC, email, course, enrolment ID…"
                className={`${inputClasses} pl-9`}
              />
            </div>
          </div>
          <Button onClick={() => { setResultMessage(null); setShowEmployerPicker(true); }} disabled={selectedIds.size === 0} className="w-full md:w-auto whitespace-nowrap">
            <Icon name={IconName.Plus} className="w-4 h-4 mr-2" />
            Add to Company Application{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </Button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {isLoading
            ? 'Loading…'
            : `${filtered.length.toLocaleString()} enrolment${filtered.length === 1 ? '' : 's'}${searchQuery.trim() ? ` matching “${searchQuery.trim()}”` : ''}`}
          {selectedIds.size > 0 && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">· {selectedIds.size} selected</span>}
        </p>

        {loadError && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <Icon name={IconName.Warning} className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-red-600 dark:text-red-400 text-sm">{loadError}</p>
          </div>
        )}

        <div className="overflow-auto max-h-[65vh] rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
          <table className="min-w-max w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10 shadow-sm">
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={pageAllSelected} onChange={togglePageAll} aria-label="Select all on page" className="w-3.5 h-3.5 rounded border-gray-300" />
                </th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Learner</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">NRIC</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Email</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Employer</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Course</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Ref</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Start Date</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Enrolment ID</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Status</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Grant ID</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Grant Amt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
              {pageRows.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-gray-400 dark:text-gray-500">
                    {rows.length === 0 ? 'No synced enrolments found.' : 'No rows match your search.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((r, idx) => {
                  const checked = selectedIds.has(r.id);
                  const zebra = idx % 2 === 1 ? 'bg-gray-50/60 dark:bg-gray-800/20' : 'bg-white dark:bg-gray-900';
                  return (
                    <tr
                      key={r.id}
                      className={`text-gray-800 dark:text-gray-200 transition-colors hover:bg-blue-50/40 dark:hover:bg-gray-800/50 ${checked ? 'bg-blue-50/70 dark:bg-blue-900/25' : zebra}`}
                    >
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.traineeName}`} className="w-3.5 h-3.5 rounded border-gray-300" />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{dash(r.traineeName)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{r.nric ? maskNric(r.nric) : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{dash(r.email)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{dash(r.employer)}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={r.courseTitle}>{dash(r.courseTitle)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{dash(r.courseReference)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{dash(r.courseStartDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{dash(r.enrolmentId)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusPillClass(r.enrolmentStatus)}`}>
                          {dash(r.enrolmentStatus)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{dash(r.grantId)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">{r.grantAmount ? Number(r.grantAmount).toLocaleString() : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Page <span className="font-semibold text-gray-700 dark:text-gray-200">{currentPage}</span> of {totalPages}
            </span>
            <nav className="flex items-center gap-1" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
                className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name={IconName.ChevronDown} className="w-4 h-4 rotate-90" />
              </button>

              {pageWindow(currentPage, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`gap-${i}`} className="w-8 h-8 flex items-center justify-center text-gray-400 dark:text-gray-500 select-none">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCurrentPage(p)}
                    aria-label={`Page ${p}`}
                    aria-current={p === currentPage ? 'page' : undefined}
                    className={`min-w-8 h-8 px-2 flex items-center justify-center rounded-md text-sm font-medium border transition-colors ${
                      p === currentPage
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
                className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name={IconName.ChevronDown} className="w-4 h-4 -rotate-90" />
              </button>
            </nav>
          </div>
        )}
      </Card>

      {showEmployerPicker && (
        <EmployerPickerModal
          selectedRows={selectedRows}
          onClose={() => setShowEmployerPicker(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
};

// ─── Employer picker + confirm dialog ────────────────────────────────────────
// Reuses GET /api/admin/list-employers (QuickBooks customers ∪ CA history) so
// the admin picks a real, billable company. The employer is what the invoice
// step matches on — so choosing from this list (rather than free typing) is
// what makes downstream invoicing actually resolve to a QuickBooks customer.
interface NewCompany {
  orgName: string;
  uen: string;
  contactName: string;
  contactDesignation: string;
  contactEmail: string;
  contactPhone: string;
}

const EMPTY_NEW_COMPANY: NewCompany = {
  orgName: '', uen: '', contactName: '', contactDesignation: '', contactEmail: '', contactPhone: '',
};

const EmployerPickerModal: React.FC<{
  selectedRows: SyncedRow[];
  onClose: () => void;
  onAdded: (result: { created: number; skippedCount: number; convertedIds: string[] }) => void;
}> = ({ selectedRows, onClose, onAdded }) => {
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [employers, setEmployers] = useState<EmployerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<EmployerOption | null>(null);
  const [newCompany, setNewCompany] = useState<NewCompany>(EMPTY_NEW_COMPANY);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    fetch('/api/admin/list-employers')
      .then((r) => r.json())
      .then((data) => {
        if (aborted) return;
        if (Array.isArray(data?.employers)) setEmployers(data.employers as EmployerOption[]);
        else setLoadError(data?.message || 'Failed to load companies.');
      })
      .catch(() => { if (!aborted) setLoadError('Failed to load companies.'); })
      .finally(() => { if (!aborted) setLoading(false); });
    return () => { aborted = true; };
  }, []);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? employers.filter((e) => `${e.employerOrgName} ${e.employerUen}`.toLowerCase().includes(q))
      : employers;
    return base.slice(0, 50);
  }, [employers, search]);

  // What we're billing to depends on the mode: a picked existing company, or
  // the typed-in new company (only its name is required).
  const billingName = mode === 'pick' ? chosen?.employerOrgName ?? '' : newCompany.orgName.trim();
  const canSubmit = mode === 'pick' ? !!chosen : newCompany.orgName.trim() !== '';

  const setNewField = (key: keyof NewCompany, value: string) =>
    setNewCompany((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!canSubmit) return;
    const employerPayload = mode === 'pick'
      ? {
          uen: chosen!.employerUen,
          orgName: chosen!.employerOrgName,
          contactName: chosen!.employerContactName,
          contactDesignation: chosen!.employerContactDesignation,
          contactPhone: chosen!.employerContactPhone,
          contactEmail: chosen!.employerContactEmail,
        }
      : {
          uen: newCompany.uen.trim(),
          orgName: newCompany.orgName.trim(),
          contactName: newCompany.contactName.trim(),
          contactDesignation: newCompany.contactDesignation.trim(),
          contactPhone: newCompany.contactPhone.trim(),
          contactEmail: newCompany.contactEmail.trim(),
        };

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/admin/synced-to-company-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ enrolmentIds: selectedRows.map((r) => r.id), employer: employerPayload }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);
      onAdded({ created: data.created ?? 0, skippedCount: data.skippedCount ?? 0, convertedIds: data.createdIds ?? [] });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to add to Company Application.');
    } finally {
      setSubmitting(false);
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
      active
        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-400'
        : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'
    }`;

  const newInput = (label: string, key: keyof NewCompany, opts?: { required?: boolean; placeholder?: string; type?: string }) => (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}{opts?.required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={opts?.type ?? 'text'}
        value={newCompany[key]}
        onChange={(e) => setNewField(key, e.target.value)}
        placeholder={opts?.placeholder}
        className={inputClasses}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add {selectedRows.length} enrolment{selectedRows.length === 1 ? '' : 's'} to Company Application</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Choose the company that is paying for these learners. This is who the invoice will be billed to.</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center flex-shrink-0" aria-label="Close">
            <Icon name={IconName.Close} className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            These are older enrolments. Before you generate an invoice afterwards, double-check the company wasn&apos;t already
            billed in QuickBooks — the system can&apos;t see invoices created directly there.
          </div>

          {/* Mode switch: pick an existing company, or add a brand-new one */}
          <div className="flex gap-2">
            <button type="button" className={tabClass(mode === 'pick')} onClick={() => setMode('pick')}>
              Pick existing company
            </button>
            <button type="button" className={tabClass(mode === 'new')} onClick={() => setMode('new')}>
              <Icon name={IconName.Plus} className="w-4 h-4 mr-1 inline-block align-text-bottom" />Add a new company
            </button>
          </div>

          {mode === 'pick' ? (
            <>
              <div className="relative">
                <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search company name or UEN…"
                  className={`${inputClasses} pl-9`}
                  autoFocus
                />
              </div>

              {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-gray-500 dark:text-gray-400">
                  <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-300 border-t-blue-600 dark:border-gray-600 dark:border-t-blue-400" />
                  <span>Loading companies…</span>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 max-h-72 overflow-y-auto">
                  {results.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                      No companies match. If it&apos;s a brand-new company, use <strong>Add a new company</strong> above.
                    </li>
                  ) : (
                    results.map((e) => {
                      const active = chosen?.id === e.id;
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => setChosen(e)}
                            className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{e.employerOrgName || '(no name)'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {e.employerUen ? `UEN ${e.employerUen}` : 'No UEN'}{e.employerContactEmail ? ` · ${e.employerContactEmail}` : ''}
                              </p>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${e.source === 'history' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                              {e.source === 'history' ? 'not in QuickBooks' : 'in QuickBooks'}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}

              {chosen && chosen.source === 'history' && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  <strong>{chosen.employerOrgName}</strong> isn&apos;t in QuickBooks yet. You can still add these to Company
                  Application, but the invoice won&apos;t generate until the company is added in QuickBooks first.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
                Only the company name is required. When you generate the invoice later, this company will be created in
                QuickBooks automatically — so double-check the name and UEN are correct to avoid a duplicate or typo&apos;d customer.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">{newInput('Company name', 'orgName', { required: true, placeholder: 'e.g. Acme Pte. Ltd.' })}</div>
                {newInput('UEN', 'uen', { placeholder: 'e.g. 201812345A' })}
                {newInput('Contact name', 'contactName')}
                {newInput('Contact designation', 'contactDesignation')}
                {newInput('Contact email', 'contactEmail', { type: 'email', placeholder: 'billing@company.com' })}
                <div className="sm:col-span-2">{newInput('Contact phone', 'contactPhone')}</div>
              </div>
            </>
          )}

          {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {billingName
              ? <>Billing to <strong className="text-gray-700 dark:text-gray-200">{billingName}</strong></>
              : mode === 'pick' ? 'Select a company to continue' : 'Enter a company name to continue'}
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={!canSubmit || submitting}>
              {submitting ? 'Adding…' : `Add ${selectedRows.length} to Company Application`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncedEnrolmentsView;
