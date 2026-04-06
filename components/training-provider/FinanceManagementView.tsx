import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { maskNric } from '../../utils';

type TabView = 'grants' | 'claims';

interface GrantRow {
  grant_id: string;
  enrollment_id: string;
  status: string;
  funding_scheme_description: string;
  component_description: string;
  estimated_grant_amount: number | null;
  approved_grant_amount: number | null;
  trainee_name: string | null;
  trainee_nric: string | null;
}

interface ClaimRow {
  claim_id: string;
  grant_id: string;
  enrollment_id: string;
  trainee_name: string | null;
  individual_nric: string | null;
  course_reference: string;
  claim_status: string;
  claim_amount: number | null;
  submission_date: string | null;
  approval_date: string | null;
  payment_date: string | null;
}

interface StatusCount {
  status: string;
  count: number;
}

interface GrantStats {
  totalGrants: number;
  totalEstimated: number;
  totalApproved: number;
  byStatus: StatusCount[];
}

interface ClaimStats {
  totalClaims: number;
  totalAmount: number;
  totalDisbursed: number;
  byStatus: StatusCount[];
}

const formatCurrency = (amount: number | null): string => {
  if (amount === null || amount === undefined) return '-';
  return `$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const statusColor = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes('completed') || s.includes('disbursed'))
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (s.includes('cancelled'))
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  if (s.includes('rejected') || s.includes('refunded'))
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (s.includes('pending') || s.includes('ready'))
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  if (s.includes('processing') || s.includes('approved'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
};

const PAGE_SIZE = 20;

const FinanceManagementView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>('grants');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(0);
  const [visibleNrics, setVisibleNrics] = useState<Set<string>>(new Set());

  const toggleNricVisibility = (id: string) => {
    setVisibleNrics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Grants state
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantsTotal, setGrantsTotal] = useState(0);
  const [grantStats, setGrantStats] = useState<GrantStats | null>(null);
  const [grantsLoading, setGrantsLoading] = useState(false);

  // Claims state
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimsTotal, setClaimsTotal] = useState(0);
  const [claimStats, setClaimStats] = useState<ClaimStats | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Reset filters on tab switch
  useEffect(() => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setSortOrder('newest');
    setPage(0);
  }, [activeTab]);

  // Fetch grants
  const fetchGrants = useCallback(async () => {
    setGrantsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort: sortOrder });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/training-provider/finance-grants?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch grants');
      setGrants(json.data.grants);
      setGrantsTotal(json.data.total);
      setGrantStats(json.data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch grants');
    } finally {
      setGrantsLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, sortOrder]);

  // Fetch claims
  const fetchClaims = useCallback(async () => {
    setClaimsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort: sortOrder });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/training-provider/finance-claims?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch claims');
      setClaims(json.data.claims);
      setClaimsTotal(json.data.total);
      setClaimStats(json.data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch claims');
    } finally {
      setClaimsLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, sortOrder]);

  useEffect(() => {
    if (activeTab === 'grants') fetchGrants();
    else fetchClaims();
  }, [activeTab, fetchGrants, fetchClaims]);

  const isLoading = activeTab === 'grants' ? grantsLoading : claimsLoading;
  const total = activeTab === 'grants' ? grantsTotal : claimsTotal;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const grantStatuses = grantStats?.byStatus.map(s => s.status) ?? [];
  const claimStatuses = claimStats?.byStatus.map(s => s.status) ?? [];
  const statusOptions = activeTab === 'grants' ? grantStatuses : claimStatuses;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-on-surface">Financial Dashboard</h2>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('grants')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'grants'
              ? 'bg-primary text-white'
              : 'bg-surface-elevated text-on-surface-secondary hover:bg-surface-hover border border-default'
          }`}
        >
          Grants
        </button>
        <button
          onClick={() => setActiveTab('claims')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'claims'
              ? 'bg-primary text-white'
              : 'bg-surface-elevated text-on-surface-secondary hover:bg-surface-hover border border-default'
          }`}
        >
          Claims
        </button>
      </div>

      {/* KPI Cards */}
      {activeTab === 'grants' && grantStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 text-center">
            <p className="text-4xl font-bold text-blue-600">{grantStats.totalGrants.toLocaleString()}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Total Grants</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-4xl font-bold text-green-600">{formatCurrency(grantStats.totalEstimated)}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Total Estimated</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-4xl font-bold text-purple-600">{formatCurrency(grantStats.totalApproved)}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Total Approved</p>
          </Card>
        </div>
      )}
      {activeTab === 'claims' && claimStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 text-center">
            <p className="text-4xl font-bold text-blue-600">{claimStats.totalClaims.toLocaleString()}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Total Claims</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-4xl font-bold text-green-600">{formatCurrency(claimStats.totalAmount)}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Total Amount</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-4xl font-bold text-purple-600">{formatCurrency(claimStats.totalDisbursed)}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Total Disbursed</p>
          </Card>
        </div>
      )}

      {/* Search + Filter */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary" />
            <input
              type="text"
              placeholder={activeTab === 'grants' ? 'Search by name, grant ID, enrollment ID, funding scheme...' : 'Search by name, claim ID, grant ID, enrollment ID...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface placeholder-gray-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface"
          >
            <option value="">All Statuses</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={sortOrder}
            onChange={e => { setSortOrder(e.target.value as 'newest' | 'oldest'); setPage(0); }}
            className="px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'grants' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default bg-surface-elevated">
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Trainee Name</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">NRIC</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Enrollment ID</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Grant ID</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Funding Scheme</th>
                  <th className="text-right px-4 py-3 font-medium text-on-surface-secondary">Estimated</th>
                  <th className="text-right px-4 py-3 font-medium text-on-surface-secondary">Approved</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-on-surface-secondary">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                      Loading grants...
                    </div>
                  </td></tr>
                ) : grants.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-on-surface-secondary">No grants found.</td></tr>
                ) : grants.map((g, i) => (
                  <tr key={`${g.grant_id}-${i}`} className="border-b border-default hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3 text-on-surface">{g.trainee_name || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-on-surface">
                          {g.trainee_nric ? (visibleNrics.has(g.grant_id) ? g.trainee_nric : maskNric(g.trainee_nric)) : '-'}
                        </span>
                        {g.trainee_nric && (
                          <button onClick={() => toggleNricVisibility(g.grant_id)} className="text-gray-400 hover:text-blue-500 transition-colors" title={visibleNrics.has(g.grant_id) ? 'Hide NRIC' : 'Show NRIC'}>
                            <Icon name={visibleNrics.has(g.grant_id) ? IconName.EyeOff : IconName.Eye} className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-on-surface-secondary font-mono text-xs">{g.enrollment_id || '-'}</td>
                    <td className="px-4 py-3 text-on-surface-secondary font-mono text-xs">{g.grant_id}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(g.status)}`}>
                        {g.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-secondary text-xs max-w-[200px] truncate" title={g.funding_scheme_description}>
                      {g.funding_scheme_description || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-on-surface tabular-nums">{formatCurrency(g.estimated_grant_amount)}</td>
                    <td className="px-4 py-3 text-right text-on-surface tabular-nums">{formatCurrency(g.approved_grant_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default bg-surface-elevated">
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Trainee Name</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">NRIC</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Claim ID</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Enrollment ID</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Course Ref</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-on-surface-secondary">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Submitted</th>
                  <th className="text-left px-4 py-3 font-medium text-on-surface-secondary">Payment</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-on-surface-secondary">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                      Loading claims...
                    </div>
                  </td></tr>
                ) : claims.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-on-surface-secondary">No claims found.</td></tr>
                ) : claims.map((c, i) => (
                  <tr key={`${c.claim_id}-${i}`} className="border-b border-default hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3 text-on-surface">{c.trainee_name || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-on-surface">
                          {c.individual_nric ? (visibleNrics.has(c.claim_id) ? c.individual_nric : maskNric(c.individual_nric)) : '-'}
                        </span>
                        {c.individual_nric && (
                          <button onClick={() => toggleNricVisibility(c.claim_id)} className="text-gray-400 hover:text-blue-500 transition-colors" title={visibleNrics.has(c.claim_id) ? 'Hide NRIC' : 'Show NRIC'}>
                            <Icon name={visibleNrics.has(c.claim_id) ? IconName.EyeOff : IconName.Eye} className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-on-surface-secondary font-mono text-xs">{c.claim_id}</td>
                    <td className="px-4 py-3 text-on-surface-secondary font-mono text-xs">{c.enrollment_id || '-'}</td>
                    <td className="px-4 py-3 text-on-surface-secondary text-xs">{c.course_reference || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(c.claim_status)}`}>
                        {c.claim_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-on-surface tabular-nums">{formatCurrency(c.claim_amount)}</td>
                    <td className="px-4 py-3 text-on-surface-secondary text-xs">{formatDate(c.submission_date)}</td>
                    <td className="px-4 py-3 text-on-surface-secondary text-xs">{formatDate(c.payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-default bg-surface-elevated">
          <div className="text-sm text-on-surface-secondary">
            Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-on-surface-secondary">
              Page {page + 1} of {totalPages || 1}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default FinanceManagementView;
