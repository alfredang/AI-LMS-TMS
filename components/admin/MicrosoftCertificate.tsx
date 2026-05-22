/**
 * Microsoft Certificate — Microsoft MCT Title Plan course finder.
 *
 * Migrated from the standalone `microsoftredeemcode` Flask/Playwright app
 * into the LMS Admin > Certificate section. Lets an admin:
 *   - search the Microsoft MCT Title Plan,
 *   - open the Singapore-tracked course page.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { microsoftCourses, type MicrosoftCourse } from '@/lib/microsoft-redeem/courses';
import { singaporeUrl } from '@/lib/microsoft-redeem/constants';

const MAX_VISIBLE = 50;
const DEBOUNCE_MS = 120;

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Course card
// -----------------------------------------------------------------------------

const CourseCard: React.FC<{
  course: MicrosoftCourse;
}> = ({ course }) => {
  const sgUrl = singaporeUrl(course.baseUrl);

  return (
    <article className="p-5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-colors">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25">
          {course.courseNumber}
        </span>
        {course.solutionArea && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {course.solutionArea}
          </span>
        )}
      </div>

      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
        {course.title}
      </h3>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {course.duration && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
            {course.duration}
          </span>
        )}
        {course.credential && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
            {course.credential}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={sgUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Open Singapore course page
          <svg viewBox="0 0 24 24" className="w-4 h-4">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 17 17 7M9 7h8v8"
            />
          </svg>
        </a>
      </div>
    </article>
  );
};

// -----------------------------------------------------------------------------
// Main view
// -----------------------------------------------------------------------------

export const MicrosoftCertificateView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const matches = useMemo(() => {
    const tokens = tokenize(debouncedQuery);
    if (tokens.length === 0) return microsoftCourses;
    return microsoftCourses.filter((c) => {
      const haystack = `${c.courseNumber} ${c.title}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [debouncedQuery]);

  const visible = matches.slice(0, MAX_VISIBLE);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
          Microsoft Certificate
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Search the Microsoft MCT Title Plan and open the Singapore-tracked
          course page.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg
          viewBox="0 0 24 24"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M10 18a8 8 0 1 1 5.3-2l4.4 4.4"
          />
        </svg>
        <input
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by course number or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Status line */}
      <p className="mb-3 text-xs text-gray-400 dark:text-gray-500 min-h-[16px]">
        {!debouncedQuery.trim()
          ? `${microsoftCourses.length} Microsoft courses loaded`
          : matches.length === 0
            ? `No matches for “${debouncedQuery}”`
            : matches.length > MAX_VISIBLE
              ? `Showing ${visible.length} of ${matches.length} matches`
              : `Showing ${visible.length} of ${microsoftCourses.length}`}
      </p>

      {/* Results */}
      <div className="grid gap-3.5">
        {!debouncedQuery.trim() ? (
          <div className="py-12 px-6 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 text-gray-400 dark:text-gray-500">
            <strong className="block text-gray-700 dark:text-gray-300 text-base mb-1.5">
              Start typing to find a course
            </strong>
            Search by course number (AI-102) or any words in the title.
          </div>
        ) : matches.length === 0 ? (
          <div className="py-12 px-6 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 text-gray-400 dark:text-gray-500">
            <strong className="block text-gray-700 dark:text-gray-300 text-base mb-1.5">
              No matching course
            </strong>
            Try a shorter query or a course number like MS-900.
          </div>
        ) : (
          <>
            {visible.map((c) => (
              <CourseCard key={c.courseNumber} course={c} />
            ))}
            {matches.length > MAX_VISIBLE && (
              <div className="py-6 px-6 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 text-gray-400 dark:text-gray-500 text-sm">
                …and {matches.length - MAX_VISIBLE} more. Refine your search.
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
        Singapore partner campaign ocid=5238477
      </p>
    </div>
  );
};
