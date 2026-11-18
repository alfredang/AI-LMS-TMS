import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import type { AdminTrainerRow as Trainer } from '@/lib/trainers/adminTrainerRow';
import SearchTrainersEditModal from './SearchTrainersEditModal';

const isActive = (t: Trainer) => t.status === 'Active';
const isOverseas = (t: Trainer) => { const c = (t.country || '').trim().toLowerCase(); return Boolean(c) && c !== 'singapore'; };

const statusBadge = (t: Trainer) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${isActive(t)
    ? 'bg-success-bg text-success'
    : 'bg-gray-200 text-on-surface-secondary dark:bg-gray-700'}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${isActive(t) ? 'bg-green-500' : 'bg-gray-400'}`} />
    {isActive(t) ? 'Active' : 'Inactive'}
  </span>
);

const capitalise = (s: string | null) => s ? s.charAt(0).toUpperCase() + s.slice(1) : null;

// dob arrives as 'YYYY-MM-DD'; parse the parts so no timezone shift can move the day.
const formatDob = (dob: string | null) => {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return dob;
  const label = new Date(y, m - 1, d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return `${label} (age ${age})`;
};

const toHref = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

const AVATAR_COLOURS = [
  'bg-info-bg text-primary',
  'bg-success-bg text-success',
  'bg-warning-bg text-warning',
  'bg-danger-bg text-rose-700 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
];

const Avatar: React.FC<{ name: string | null; size?: 'sm' | 'lg' }> = ({ name, size = 'sm' }) => {
  const words = (name || '?').trim().split(/\s+/);
  const initials = ((words[0]?.[0] || '?') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  const colour = AVATAR_COLOURS[[...(name || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLOURS.length];
  const dims = size === 'lg' ? 'w-14 h-14 text-lg' : 'w-9 h-9 text-xs';
  return <span className={`inline-flex items-center justify-center shrink-0 rounded-full font-semibold ${dims} ${colour}`}>{initials}</span>;
};

const TAG_STYLES = {
  domain: 'bg-info-bg text-primary ring-blue-200 dark:ring-blue-800',
  skill: 'bg-success-bg text-success ring-emerald-200 dark:ring-emerald-800',
  cert: 'bg-warning-bg text-warning ring-amber-200 dark:ring-amber-800',
  qual: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-800',
};

const TagList: React.FC<{ items: string[]; tone: keyof typeof TAG_STYLES; limit?: number; empty?: string }> = ({ items, tone, limit, empty = '—' }) => {
  if (items.length === 0) return <span className="text-sm text-muted">{empty}</span>;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(item => (
        <span key={item} className={`px-2 py-0.5 text-xs font-medium rounded-full ring-1 ring-inset ${TAG_STYLES[tone]}`}>{item}</span>
      ))}
      {limit && items.length > limit && (
        <span className="px-1 py-0.5 text-xs text-muted whitespace-nowrap" title={items.slice(limit).join(', ')}>+{items.length - limit}</span>
      )}
    </div>
  );
};

const ExternalLinkText: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={toHref(href)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
    {children} <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />
  </a>
);

const StatCard: React.FC<{ label: string; value: number; icon: IconName; tone: string; active: boolean; onClick: () => void }> = ({ label, value, icon, tone, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-4 p-4 text-left bg-surface border rounded-xl shadow-sm transition hover:shadow-md ${active ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-default'}`}
  >
    <span className={`inline-flex items-center justify-center w-11 h-11 rounded-lg ${tone}`}>
      <Icon name={icon} className="w-5 h-5" />
    </span>
    <span>
      <span className="block text-2xl font-bold text-on-surface">{value}</span>
      <span className="block text-sm text-muted">{label}</span>
    </span>
  </button>
);

const InfoItem: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
    <dd className="mt-0.5 text-sm text-on-surface break-words">{children || <span className="text-muted">—</span>}</dd>
  </div>
);

const selectClass = 'px-3 py-2 text-sm border border-strong rounded-lg dark:bg-gray-700 dark:text-white';
const iconButton = 'p-1.5 rounded-md text-muted transition hover:bg-surface-hover';

const SearchTrainers: React.FC = () => {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [filterCountry, setFilterCountry] = useState('All');
  const [filterDomain, setFilterDomain] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [detailTrainer, setDetailTrainer] = useState<Trainer | null>(null);
  const [editingTrainer, setEditingTrainer] = useState<Trainer | null>(null);
  const [statusTarget, setStatusTarget] = useState<Trainer | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Full NRICs are fetched one trainer at a time when the eye is clicked, and
  // dropped again when hidden.
  const [revealedNric, setRevealedNric] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  const itemsPerPage = 30;

  const fetchTrainers = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const response = await fetch(getApiUrl('/api/admin/search-trainers'));
      const data = await response.json();
      if (!data.success) throw new Error(data.message || 'Failed to load trainers');
      setTrainers(data.data.trainers);
    } catch (error) {
      console.error('Error fetching trainers:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load trainers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrainers();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!detailTrainer || editingTrainer || statusTarget) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailTrainer(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailTrainer, editingTrainer, statusTarget]);

  const replaceTrainer = (updated: Trainer) => {
    setTrainers(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    setDetailTrainer(prev => (prev && prev.id === updated.id ? updated : prev));
  };

  const toggleNric = async (trainerId: string) => {
    if (revealedNric[trainerId] !== undefined) {
      setRevealedNric(prev => {
        const next = { ...prev };
        delete next[trainerId];
        return next;
      });
      return;
    }

    setRevealingId(trainerId);
    try {
      const response = await fetch(getApiUrl('/api/admin/trainer-nric'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainerId }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || 'Could not load NRIC');
      setRevealedNric(prev => ({ ...prev, [trainerId]: data.data.nric || '—' }));
    } catch (error) {
      alert(`Failed: ${error instanceof Error ? error.message : 'Could not load NRIC'}`);
    } finally {
      setRevealingId(null);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    const newStatus = isActive(statusTarget) ? 'Inactive' : 'Active';
    setUpdatingStatus(true);
    try {
      const response = await fetch(getApiUrl('/api/admin/update-trainer-status'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: statusTarget.id, newStatus }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed to update status');
      replaceTrainer({ ...statusTarget, status: newStatus });
      setNotice(`${statusTarget.full_name} is now ${newStatus.toLowerCase()}.`);
      setStatusTarget(null);
    } catch (error) {
      alert(`Failed: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const renderNric = (trainer: Trainer) => {
    if (!trainer.nric_masked) return <span className="text-sm text-muted">—</span>;
    const isShown = revealedNric[trainer.id] !== undefined;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-sm text-on-surface-secondary">{revealedNric[trainer.id] ?? trainer.nric_masked}</span>
        <button
          onClick={() => toggleNric(trainer.id)}
          disabled={revealingId === trainer.id}
          className="text-muted hover:text-blue-500 disabled:opacity-50"
          title={isShown ? 'Hide NRIC' : 'Show NRIC'}
          aria-label={isShown ? 'Hide NRIC' : 'Show NRIC'}
        >
          <Icon name={isShown ? IconName.EyeOff : IconName.Eye} className="w-3.5 h-3.5" />
        </button>
      </span>
    );
  };

  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    trainers.forEach(t => { const c = (t.country || '').trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [trainers]);

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    trainers.forEach(t => t.domains.forEach(d => set.add(d)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [trainers]);

  const query = searchQuery.trim().toLowerCase();
  const filteredTrainers = trainers.filter(t => {
    const matchesSearch = !query ||
      (t.full_name || '').toLowerCase().includes(query) ||
      (t.common_name || '').toLowerCase().includes(query) ||
      (t.email || '').toLowerCase().includes(query) ||
      (t.secondary_email || '').toLowerCase().includes(query) ||
      (t.tel || '').includes(query);
    const matchesStatus = filterStatus === 'All' || (filterStatus === 'Active') === isActive(t);
    const matchesCountry = filterCountry === 'All' ||
      (filterCountry === 'Not set' ? !(t.country || '').trim()
        : filterCountry === 'Overseas' ? isOverseas(t)
        : (t.country || '').trim() === filterCountry);
    const matchesDomain = filterDomain === 'All' || t.domains.includes(filterDomain);
    return matchesSearch && matchesStatus && matchesCountry && matchesDomain;
  });

  const hasFilters = Boolean(searchQuery) || filterStatus !== 'All' || filterCountry !== 'All' || filterDomain !== 'All';
  const clearFilters = () => { setSearchQuery(''); setFilterStatus('All'); setFilterCountry('All'); setFilterDomain('All'); setCurrentPage(1); };

  const totalPages = Math.ceil(filteredTrainers.length / itemsPerPage);
  const paginatedTrainers = filteredTrainers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const activeCount = trainers.filter(isActive).length;
  const overseasCount = trainers.filter(isOverseas).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
          <p className="mt-4 text-on-surface-secondary">Loading trainers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">Search Trainers</h1>
          <p className="mt-1 text-on-surface-secondary">Find a trainer, view their full profile, and keep their details up to date.</p>
        </div>
        <Button variant="ghost" onClick={fetchTrainers}>Refresh</Button>
      </div>

      {loadError && (
        <Card className="p-4 border-red-300 dark:border-red-700 bg-danger-bg">
          <p className="text-danger">{loadError}</p>
        </Card>
      )}

      {notice && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-success border border-green-200 rounded-lg bg-success-bg dark:border-green-800">
          <Icon name={IconName.Check} className="w-4 h-4" /> {notice}
        </div>
      )}

      {/* Stats — click to filter */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total trainers" value={trainers.length} icon={IconName.Users} tone="bg-info-bg text-primary"
          active={!hasFilters} onClick={clearFilters} />
        <StatCard label="Active" value={activeCount} icon={IconName.Check} tone="bg-success-bg text-success"
          active={filterStatus === 'Active'} onClick={() => { setFilterStatus(filterStatus === 'Active' ? 'All' : 'Active'); setCurrentPage(1); }} />
        <StatCard label="Inactive" value={trainers.length - activeCount} icon={IconName.Close} tone="bg-surface-elevated text-on-surface-secondary"
          active={filterStatus === 'Inactive'} onClick={() => { setFilterStatus(filterStatus === 'Inactive' ? 'All' : 'Inactive'); setCurrentPage(1); }} />
        <StatCard label="Based overseas" value={overseasCount} icon={IconName.Globe} tone="bg-warning-bg text-warning"
          active={filterCountry === 'Overseas'} onClick={() => { setFilterCountry(filterCountry === 'Overseas' ? 'All' : 'Overseas'); setCurrentPage(1); }} />
      </div>

      {/* Search + Filters */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Icon name={IconName.Search} className="absolute w-5 h-5 text-muted -translate-y-1/2 left-3 top-1/2" />
            <input
              type="text"
              placeholder="Search name, email, phone..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full py-2 pl-10 pr-3 text-sm border border-strong rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as typeof filterStatus); setCurrentPage(1); }} className={selectClass} aria-label="Filter by status">
            <option value="All">All status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <select value={filterCountry} onChange={e => { setFilterCountry(e.target.value); setCurrentPage(1); }} className={selectClass} aria-label="Filter by country">
            <option value="All">All countries</option>
            {countryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="Overseas">Overseas (not Singapore)</option>
            <option value="Not set">Not set</option>
          </select>
          <select value={filterDomain} onChange={e => { setFilterDomain(e.target.value); setCurrentPage(1); }} className={selectClass} aria-label="Filter by domain">
            <option value="All">All domains</option>
            {domainOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="px-3 py-2 text-sm border border-strong rounded-lg hover:bg-surface-hover dark:text-gray-300">
              Clear
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">
          Showing <span className="font-semibold text-on-surface-secondary">{filteredTrainers.length}</span> of {trainers.length} trainers
        </p>
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {paginatedTrainers.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-default">
                <thead className="bg-surface-elevated">
                  <tr>
                    {['Trainer', 'Contact', 'Country', 'NRIC', 'Domains', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-xs font-medium tracking-wider text-left text-muted uppercase">{h}</th>
                    ))}
                    <th className="px-4 py-3 text-xs font-medium tracking-wider text-right text-muted uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-default">
                  {paginatedTrainers.map(trainer => (
                    <tr key={trainer.id} className={`hover:bg-blue-50/40 dark:hover:bg-gray-700/50 ${isActive(trainer) ? '' : 'opacity-70'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={trainer.full_name} />
                          <div className="min-w-0">
                            <button onClick={() => setDetailTrainer(trainer)} className="text-sm font-medium text-left text-on-surface hover:text-blue-600 hover:underline dark:hover:text-blue-400">
                              {trainer.full_name || '—'}
                            </button>
                            {trainer.trainer_type && <div className="text-xs text-muted">{trainer.trainer_type}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-on-surface-secondary">{trainer.email || '—'}</div>
                        <div className="text-xs text-muted">{trainer.tel || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-on-surface-secondary whitespace-nowrap">
                        {trainer.country || <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{renderNric(trainer)}</td>
                      <td className="px-4 py-3 min-w-[11rem]"><TagList items={trainer.domains} tone="domain" limit={2} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">{statusBadge(trainer)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setDetailTrainer(trainer)} className={`${iconButton} hover:text-blue-600`} title="View profile" aria-label="View profile">
                            <Icon name={IconName.Eye} className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingTrainer(trainer)} className={`${iconButton} hover:text-blue-600`} title="Edit" aria-label="Edit">
                            <Icon name={IconName.Edit} className="w-4 h-4" />
                          </button>
                          {isActive(trainer) ? (
                            <button onClick={() => setStatusTarget(trainer)} className={`${iconButton} hover:text-red-600`} title="Make inactive" aria-label="Make inactive">
                              <Icon name={IconName.Close} className="w-4 h-4" />
                            </button>
                          ) : (
                            <button onClick={() => setStatusTarget(trainer)} className={`${iconButton} hover:text-green-600`} title="Make active" aria-label="Make active">
                              <Icon name={IconName.Check} className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t dark:border-gray-700">
                <p className="text-sm text-muted">
                  {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredTrainers.length)} of {filteredTrainers.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2.5 py-1 text-xs font-medium rounded border border-strong bg-surface text-on-surface-secondary disabled:opacity-40 hover:bg-surface-hover">First</button>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2.5 py-1 text-xs font-medium rounded border border-strong bg-surface text-on-surface-secondary disabled:opacity-40 hover:bg-surface-hover">Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(i => i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1)
                    .reduce<(number | 'e')[]>((acc, i, idx, arr) => {
                      if (idx > 0 && i - (arr[idx - 1] as number) > 1) acc.push('e');
                      acc.push(i);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === 'e' ? <span key={`e${idx}`} className="px-1 text-muted">...</span> : (
                        <button key={item} onClick={() => setCurrentPage(item as number)} className={`px-2.5 py-1 text-xs font-medium rounded border ${currentPage === item ? 'bg-blue-600 text-white border-blue-600' : 'border-strong bg-surface text-on-surface-secondary hover:bg-surface-hover'}`}>{item}</button>
                      )
                    )}
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-2.5 py-1 text-xs font-medium rounded border border-strong bg-surface text-on-surface-secondary disabled:opacity-40 hover:bg-surface-hover">Next</button>
                  <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="px-2.5 py-1 text-xs font-medium rounded border border-strong bg-surface text-on-surface-secondary disabled:opacity-40 hover:bg-surface-hover">Last</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-12 text-center">
            <Icon name={IconName.Users} className="w-12 h-12 mx-auto mb-3 text-muted" />
            <p className="text-muted">{hasFilters ? 'No trainers match your filters.' : 'No trainers in the system yet.'}</p>
          </div>
        )}
      </Card>

      {/* Trainer profile modal */}
      {detailTrainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDetailTrainer(null)}>
          <div className="flex flex-col w-full max-w-3xl max-h-[92vh] overflow-hidden bg-surface shadow-2xl rounded-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-default bg-gradient-to-r from-blue-50 to-white dark:from-gray-700/60 dark:to-gray-800">
              <div className="flex items-start gap-4">
                <Avatar name={detailTrainer.full_name} size="lg" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold text-on-surface">{detailTrainer.full_name || '—'}</h3>
                  {detailTrainer.common_name && detailTrainer.common_name !== detailTrainer.full_name && (
                    <p className="text-sm text-muted">Also known as {detailTrainer.common_name}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {statusBadge(detailTrainer)}
                    {detailTrainer.trainer_type && (
                      <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">{detailTrainer.trainer_type}</span>
                    )}
                    {detailTrainer.country && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-surface-elevated text-on-surface-secondary">
                        <Icon name={IconName.Globe} className="w-3 h-3" /> {detailTrainer.country}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setDetailTrainer(null)} className="text-muted hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
                  <Icon name={IconName.Close} className="w-5 h-5" />
                </button>
              </div>
              <div className="flex gap-2 mt-4">
                <Button onClick={() => setEditingTrainer(detailTrainer)} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <span className="inline-flex items-center gap-1.5"><Icon name={IconName.Edit} className="w-4 h-4" /> Edit</span>
                </Button>
                <Button variant="ghost" onClick={() => setStatusTarget(detailTrainer)}>
                  {isActive(detailTrainer) ? 'Make inactive' : 'Make active'}
                </Button>
              </div>
            </div>

            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              <section>
                <h4 className="flex items-center gap-2 mb-3 text-sm font-semibold text-on-surface-secondary"><Icon name={IconName.Mail} className="w-4 h-4 text-muted" /> Contact</h4>
                <dl className="grid grid-cols-1 gap-4 p-4 rounded-lg sm:grid-cols-2 bg-surface-elevated">
                  <InfoItem label="Email">{detailTrainer.email && <a href={`mailto:${detailTrainer.email}`} className="text-primary hover:underline">{detailTrainer.email}</a>}</InfoItem>
                  <InfoItem label="Phone">{detailTrainer.tel && <a href={`tel:${detailTrainer.tel}`} className="text-primary hover:underline">{detailTrainer.tel}</a>}</InfoItem>
                  <InfoItem label="Secondary email">{detailTrainer.secondary_email}</InfoItem>
                  <InfoItem label="CN Plus email">{detailTrainer.cn_plus_email}</InfoItem>
                  <InfoItem label="LinkedIn">{detailTrainer.linkedin_url && <ExternalLinkText href={detailTrainer.linkedin_url}>View profile</ExternalLinkText>}</InfoItem>
                  <InfoItem label="CV">
                    {(detailTrainer.cv_folder_url || detailTrainer.cv_url) && (
                      <span className="flex flex-wrap gap-3">
                        {detailTrainer.cv_folder_url && <ExternalLinkText href={detailTrainer.cv_folder_url}>CV folder</ExternalLinkText>}
                        {detailTrainer.cv_url && <ExternalLinkText href={detailTrainer.cv_url}>CV file</ExternalLinkText>}
                      </span>
                    )}
                  </InfoItem>
                </dl>
              </section>

              <section>
                <h4 className="flex items-center gap-2 mb-3 text-sm font-semibold text-on-surface-secondary"><Icon name={IconName.User} className="w-4 h-4 text-muted" /> Personal</h4>
                <dl className="grid grid-cols-1 gap-4 p-4 rounded-lg sm:grid-cols-3 bg-surface-elevated">
                  <InfoItem label="NRIC">{renderNric(detailTrainer)}</InfoItem>
                  <InfoItem label="Date of birth">{formatDob(detailTrainer.dob)}</InfoItem>
                  <InfoItem label="Gender">{capitalise(detailTrainer.gender)}</InfoItem>
                  <InfoItem label="Country">{detailTrainer.country}</InfoItem>
                  <InfoItem label="Nationality">{detailTrainer.nationality}</InfoItem>
                  <InfoItem label="Ethnicity">{detailTrainer.ethnicity}</InfoItem>
                </dl>
              </section>

              <section>
                <h4 className="flex items-center gap-2 mb-3 text-sm font-semibold text-on-surface-secondary"><Icon name={IconName.Briefcase} className="w-4 h-4 text-muted" /> Expertise</h4>
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Domains</p>
                    <TagList items={detailTrainer.domains} tone="domain" empty="No domains recorded" />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Skill sets</p>
                    <TagList items={detailTrainer.skills} tone="skill" empty="No skill sets recorded" />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Certifications</p>
                    <TagList items={detailTrainer.certifications} tone="cert" empty="No certifications recorded" />
                  </div>
                </div>
              </section>

              <section>
                <h4 className="flex items-center gap-2 mb-3 text-sm font-semibold text-on-surface-secondary"><Icon name={IconName.Award} className="w-4 h-4 text-muted" /> Qualifications &amp; Education</h4>
                <TagList items={detailTrainer.qualifications} tone="qual" empty="No qualifications recorded" />
                {detailTrainer.education && (
                  <p className="mt-3 text-sm text-on-surface-secondary whitespace-pre-line">{detailTrainer.education}</p>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Edit */}
      {editingTrainer && (
        <SearchTrainersEditModal
          trainer={editingTrainer}
          domainSuggestions={domainOptions}
          countrySuggestions={countryOptions.length ? countryOptions : ['Singapore', 'Malaysia']}
          onClose={() => setEditingTrainer(null)}
          onSaved={updated => {
            replaceTrainer(updated);
            setEditingTrainer(null);
            setRevealedNric(prev => { const next = { ...prev }; delete next[updated.id]; return next; });
            setNotice(`Saved changes to ${updated.full_name}.`);
          }}
        />
      )}

      {/* Status confirmation */}
      {statusTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md p-6 bg-surface rounded-lg shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-on-surface">
              {isActive(statusTarget) ? 'Make trainer inactive' : 'Make trainer active'}
            </h3>
            <p className="mb-6 text-on-surface-secondary">
              {isActive(statusTarget)
                ? <>Mark <strong>{statusTarget.full_name}</strong> as inactive? They will show as Inactive in trainer lists.</>
                : <>Mark <strong>{statusTarget.full_name}</strong> as active again?</>}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setStatusTarget(null)} disabled={updatingStatus}>Cancel</Button>
              <Button onClick={confirmStatusChange} disabled={updatingStatus}
                className={isActive(statusTarget) ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-700 hover:bg-green-800 text-white'}>
                {updatingStatus ? 'Updating...' : (isActive(statusTarget) ? 'Make inactive' : 'Make active')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchTrainers;
