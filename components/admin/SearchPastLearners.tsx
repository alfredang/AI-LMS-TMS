import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

interface EnrolmentResult {
  enrolment_id: string | null;
  trainee_name: string | null;
  trainee_nric: string | null;
  course_title: string | null;
  course_reference: string | null;
  course_run_id: string | null;
  enrolment_status: string | null;
  sponsorship_type: string | null;
  enrolment_date: string | null;
  completion_date: string | null;
  grant_id: string | null;
  grant_status: string | null;
  funding_scheme_description: string | null;
  component_description: string | null;
  estimated_grant_amount: number | null;
  approved_grant_amount: number | null;
}

const getStatusColor = (status: string | null) => {
  const s = (status || '').toLowerCase();
  if (s === 'confirmed' || s === 'approved' || s === 'completed')
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (s === 'cancelled' || s === 'rejected')
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  if (s === 'pending' || s === 'processing')
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const formatCurrency = (amount: number | null) => {
  if (amount === null || amount === undefined) return '-';
  return `$${Number(amount).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const SearchPastLearners: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<EnrolmentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchedTerm, setSearchedTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const itemsPerPage = 10;
  const inputClasses = "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

  const handleSearch = async () => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setCurrentPage(1);
    setSearchedTerm(trimmed);

    try {
      const response = await fetch(getApiUrl('/api/admin/search-past-learners'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerm: trimmed }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Search failed');
      }

      setResults(data.data.results);
      setSearched(true);
    } catch (err) {
      console.error('Search error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const uniqueEnrolments = new Set(results.map(r => r.enrolment_id)).size;
  const totalPages = Math.ceil(results.length / itemsPerPage);
  const paginatedResults = results.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Search Past Learners</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Search a trainee by NRIC to view their SSG enrolment history and linked grant details. Use this to investigate grant cancellation reasons.
        </p>
      </div>

      {/* Search */}
      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label htmlFor="search-past-learners" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              NRIC
            </label>
            <div className="relative mt-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icon name={IconName.User} className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="text"
                id="search-past-learners"
                placeholder="Enter NRIC (e.g. S1234567A)"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                className={`${inputClasses} pl-10`}
              />
            </div>
          </div>
          <Button variant="primary" onClick={handleSearch} disabled={loading || !searchTerm.trim()}>
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <Card className="p-4 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </Card>
      )}

      {/* Results */}
      {searched && !error && (
        <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
          {paginatedResults.length > 0 ? (
            <>
              <div className="p-4 border-b dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Found <span className="font-semibold text-gray-900 dark:text-white">{uniqueEnrolments}</span> enrolment{uniqueEnrolments !== 1 ? 's' : ''} ({results.length} row{results.length !== 1 ? 's' : ''} incl. grants) for <span className="font-mono font-semibold text-gray-900 dark:text-white">{searchedTerm}</span>
                </p>
              </div>
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainee</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Run</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Enrolment ID</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Enrolment Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Sponsorship</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Enrolment Date</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Completion Date</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Grant ID</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Grant Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Funding Scheme</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Component</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Est. Grant</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Approved Grant</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  {paginatedResults.map((row, index) => (
                    <tr key={`${row.enrolment_id}-${row.grant_id}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{row.trainee_name || '-'}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{row.trainee_nric || '-'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 dark:text-white max-w-xs truncate" title={row.course_title || ''}>{row.course_title || '-'}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{row.course_reference || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{row.course_run_id || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">{row.enrolment_id || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(row.enrolment_status)}`}>
                          {row.enrolment_status || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{row.sponsorship_type || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDate(row.enrolment_date)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDate(row.completion_date)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">{row.grant_id || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {row.grant_status ? (
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(row.grant_status)}`}>
                            {row.grant_status}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate" title={row.funding_scheme_description || ''}>{row.funding_scheme_description || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate" title={row.component_description || ''}>{row.component_description || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">{formatCurrency(row.estimated_grant_amount)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">{formatCurrency(row.approved_grant_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="p-4 flex justify-between items-center border-t dark:border-gray-700">
                  <Button variant="ghost" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                    Previous
                  </Button>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button variant="ghost" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                    Next
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <Icon name={IconName.User} className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No results found</h3>
              <p className="text-gray-500 dark:text-gray-400">
                No enrolment records found for <span className="font-mono font-semibold">{searchedTerm}</span>.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default SearchPastLearners;
