import React, { useMemo, useState } from 'react';
import { useDeveloperCourses } from '@hooks/useDeveloperCourses';
import { Card } from '../ui/Card';

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

// Same parser the Course Funding Validity page uses: funding_validity is free
// text, so it is stored either as 'YYYY-MM-DD…' or as 'Sep 27, 2026'.
const parseValidityDate = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const formatValidityDate = (date: Date) => date.toLocaleDateString('en-GB');

// Whole days between expiry and today, for the "expired N days ago" column hint.
const daysAgo = (date: Date, today: Date) =>
  Math.round((today.getTime() - date.getTime()) / 86400000);

// Only the funded types carry a funding validity that can lapse.
type FundingType = 'WSQ' | 'CASL';
const FUNDING_TYPES: FundingType[] = ['WSQ', 'CASL'];

const isFundedType = (value?: string | null): value is FundingType =>
  value === 'WSQ' || value === 'CASL';

const ExpiredCourseListView: React.FC = () => {
  const { courses, loading, error } = useDeveloperCourses();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | FundingType>('All');

  const today = startOfDay(new Date());

  // Expired = a WSQ/CASL course whose funding validity end date is before today.
  // Non-WSQ and IBF are excluded by request; courses with no validity date at
  // all are not expired (the course card renders those as "N/A").
  const expiredCourses = useMemo(() => {
    return (courses || [])
      .map(course => ({ course, expiry: parseValidityDate(course.fundingValidity) }))
      .filter(({ course, expiry }) => isFundedType(course.courseType) && !!expiry && expiry < today)
      .sort((a, b) => a.expiry!.getTime() - b.expiry!.getTime());
  }, [courses, today]);

  const visibleCourses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return expiredCourses.filter(({ course }) => {
      if (typeFilter !== 'All' && course.courseType !== typeFilter) return false;
      if (term && ![course.title, course.currentCourseCode, course.newCourseCode, course.courseCode]
        .some(field => (field || '').toLowerCase().includes(term))) return false;
      return true;
    });
  }, [expiredCourses, search, typeFilter]);

  const typeTotals = useMemo(() => {
    const totals: Record<FundingType, number> = { WSQ: 0, CASL: 0 };
    for (const { course } of expiredCourses) totals[course.courseType as FundingType] += 1;
    return totals;
  }, [expiredCourses]);

  if (loading) {
    return <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">Loading courses…</div>;
  }

  if (error) {
    return (
      <div className="px-6 py-8 text-center text-red-600 dark:text-red-400">
        Could not load courses: {String(error)}
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-3xl font-bold dark:text-white mb-6">Expired Course List</h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-5 dark:bg-gray-800 dark:border-gray-700">
          <p className="text-4xl font-bold text-red-600 dark:text-red-400">{expiredCourses.length}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Expired Courses</p>
        </Card>
        {FUNDING_TYPES.map(type => (
          <Card key={type} className="p-5 dark:bg-gray-800 dark:border-gray-700">
            <p className="text-4xl font-bold text-gray-700 dark:text-gray-200">{typeTotals[type]}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Expired {type}</p>
          </Card>
        ))}
      </div>

      <Card className="mb-8 dark:bg-gray-800 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
            Expired Funding Validity
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {visibleCourses.length}
            </span>
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            WSQ and CASL courses whose funding validity end date has already passed, oldest first.
          </p>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title or course code…"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as 'All' | FundingType)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="All">All Funding Types</option>
              {FUNDING_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
        </div>

        {visibleCourses.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
            {expiredCourses.length === 0
              ? 'No WSQ or CASL courses have expired funding validity. 🎉'
              : 'No expired courses match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr className="text-left text-gray-600 dark:text-gray-300">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Title</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Code</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Expired Date</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Funding Type</th>
                </tr>
              </thead>
              <tbody>
                {visibleCourses.map(({ course, expiry }) => (
                  <tr key={course.id} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white max-w-[350px] truncate" title={course.title}>{course.title}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{course.currentCourseCode || course.newCourseCode || course.courseCode || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="font-semibold text-red-600 dark:text-red-400">{formatValidityDate(expiry!)}</span>
                      <span className="ml-2 text-gray-500 dark:text-gray-400">({daysAgo(expiry!, today)}d ago)</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        {course.courseType}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ExpiredCourseListView;
