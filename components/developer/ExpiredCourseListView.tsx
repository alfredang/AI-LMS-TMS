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

// renewed_status stores rich statuses ('Approved / Renewed', 'Waiting For
// Renewal', 'Rejected / Expired') or is blank when never processed. Classify
// for tiles/filtering; the table shows the stored text verbatim.
type RenewClass = 'Approved' | 'Waiting' | 'Rejected' | 'Not Set';

const classifyRenewStatus = (value?: string | null): RenewClass => {
  const v = (value || '').trim().toLowerCase();
  if (!v) return 'Not Set';
  if (v.includes('approved') || v.includes('renewed')) return 'Approved';
  if (v.includes('waiting') || v.includes('pending')) return 'Waiting';
  if (v.includes('rejected') || v.includes('expired')) return 'Rejected';
  return 'Waiting';
};

const RENEW_BADGE_CLASSES: Record<RenewClass, string> = {
  Approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Waiting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'Not Set': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

type RenewFilter = 'All' | RenewClass;

const ExpiredCourseListView: React.FC = () => {
  const { courses, loading, error } = useDeveloperCourses();
  const [search, setSearch] = useState('');
  const [renewFilter, setRenewFilter] = useState<RenewFilter>('All');

  const today = startOfDay(new Date());

  // Expired = any course whose funding validity end date is before today,
  // regardless of its current course type — courses re-typed to Non-WSQ when
  // their funding lapsed stay listed here. Courses with no validity date at
  // all are not expired (the course card renders those as "N/A").
  const expiredCourses = useMemo(() => {
    return (courses || [])
      .map(course => ({ course, expiry: parseValidityDate(course.fundingValidity) }))
      .filter((entry): entry is { course: (typeof entry)['course']; expiry: Date } => !!entry.expiry && entry.expiry < today)
      .sort((a, b) => a.expiry.getTime() - b.expiry.getTime());
  }, [courses, today]);

  const visibleCourses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return expiredCourses.filter(({ course }) => {
      if (renewFilter !== 'All' && classifyRenewStatus(course.renewedStatus) !== renewFilter) return false;
      if (term && ![course.title, course.currentCourseCode, course.newCourseCode, course.courseCode]
        .some(field => (field || '').toLowerCase().includes(term))) return false;
      return true;
    });
  }, [expiredCourses, search, renewFilter]);

  const renewedCount = useMemo(
    () => expiredCourses.filter(({ course }) => classifyRenewStatus(course.renewedStatus) === 'Approved').length,
    [expiredCourses]
  );

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
        <Card className="p-5 dark:bg-gray-800 dark:border-gray-700">
          <p className="text-4xl font-bold text-green-600 dark:text-green-400">{renewedCount}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Renewed</p>
        </Card>
        <Card className="p-5 dark:bg-gray-800 dark:border-gray-700">
          <p className="text-4xl font-bold text-gray-700 dark:text-gray-200">{expiredCourses.length - renewedCount}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Not Renewed</p>
        </Card>
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
            Courses whose funding validity end date has already passed, oldest first — including courses re-typed to Non-WSQ when their funding lapsed.
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
              value={renewFilter}
              onChange={e => setRenewFilter(e.target.value as RenewFilter)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="All">All Renew Statuses</option>
              <option value="Approved">Approved / Renewed</option>
              <option value="Waiting">Waiting For Renewal</option>
              <option value="Rejected">Rejected / Expired</option>
              <option value="Not Set">Not Set</option>
            </select>
          </div>
        </div>

        {visibleCourses.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
            {expiredCourses.length === 0
              ? 'No courses have expired funding validity. 🎉'
              : 'No expired courses match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr className="text-left text-gray-600 dark:text-gray-300">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Title</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Code</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Expiry Date</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Renew Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleCourses.map(({ course, expiry }) => {
                  const renewClass = classifyRenewStatus(course.renewedStatus);
                  return (
                    <tr key={course.id} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white max-w-[350px] truncate" title={course.title}>{course.title}</td>
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{course.currentCourseCode || course.newCourseCode || course.courseCode || '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="font-semibold text-red-600 dark:text-red-400">{formatValidityDate(expiry)}</span>
                        <span className="ml-2 text-gray-500 dark:text-gray-400">({daysAgo(expiry, today)}d ago)</span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${RENEW_BADGE_CLASSES[renewClass]}`}>
                          {(course.renewedStatus || '').trim() || 'Not Set'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ExpiredCourseListView;
