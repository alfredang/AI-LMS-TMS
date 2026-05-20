/**
 * Microsoft Certificate — achievement code finder & generator.
 *
 * Migrated from the standalone `microsoftredeemcode` Flask/Playwright app
 * into the LMS Admin > Certificate section. Lets an admin:
 *   - search the Microsoft MCT Title Plan,
 *   - open the Singapore-tracked course page,
 *   - generate Microsoft Learn achievement codes (Playwright automation
 *     runs server-side; codes are recorded in microsoft_redeem_code).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { microsoftCourses, type MicrosoftCourse } from '@/lib/microsoft-redeem/courses';
import { singaporeUrl } from '@/lib/microsoft-redeem/constants';

const MAX_VISIBLE = 50;
const DEBOUNCE_MS = 120;

interface GeneratedCode {
  code: string;
  url: string;
}

type StatusLevel = 'info' | 'ok' | 'err';

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    window.prompt('Copy:', value);
    return false;
  }
}

function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Copy button
// -----------------------------------------------------------------------------

const CopyButton: React.FC<{ value: string; label: string; className?: string }> = ({
  value,
  label,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyToClipboard(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        copied
          ? 'border-green-400 text-green-600 dark:text-green-400'
          : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-slate-500'
      } ${className}`}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
};

// -----------------------------------------------------------------------------
// Course card
// -----------------------------------------------------------------------------

const CourseCard: React.FC<{
  course: MicrosoftCourse;
  onCheckSignedIn: () => Promise<boolean>;
}> = ({ course, onCheckSignedIn }) => {
  const { currentUser } = useLms();
  const [students, setStudents] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<{ text: string; level: StatusLevel } | null>(null);
  const [codes, setCodes] = useState<GeneratedCode[]>([]);

  const sgUrl = singaporeUrl(course.baseUrl);

  const clampStudents = (n: number) => Math.max(1, Math.min(1000, Math.floor(n) || 1));

  const handleGenerate = async () => {
    setGenerating(true);
    setCodes([]);
    setStatus({ text: 'Checking Microsoft Learn sign-in…', level: 'info' });

    const ready = await onCheckSignedIn();
    if (!ready) {
      setStatus({
        text: 'Not signed in to Microsoft Learn. Use the "Sign in to Microsoft" button at the top first.',
        level: 'err',
      });
      setGenerating(false);
      return;
    }

    setStatus({
      text: `Requesting an achievement code for ${students} student${
        students === 1 ? '' : 's'
      }… this can take up to a minute.`,
      level: 'info',
    });

    try {
      const res = await fetch('/api/admin/microsoft-redeem/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseNumber: course.courseNumber,
          count: 1,
          students,
          userId: currentUser?.id,
        }),
      });
      const data = await res.json();

      if (data.results?.length) {
        setCodes(data.results);
      } else if (data.codes?.length) {
        setCodes(data.codes.map((c: string) => ({ code: c, url: '' })));
      }

      if (data.ok) {
        setStatus({
          text: `Code generated for ${students} student${
            students === 1 ? '' : 's'
          }. Saved to history.`,
          level: 'ok',
        });
      } else {
        const msg =
          (data.errors && data.errors.join(' · ')) || data.error || 'Unknown error';
        setStatus({ text: msg, level: 'err' });
      }
    } catch (err: any) {
      setStatus({ text: `Request failed: ${err?.message || err}`, level: 'err' });
    } finally {
      setGenerating(false);
    }
  };

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
        <CopyButton value={sgUrl} label="Copy link" className="px-4 py-2 text-sm" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-slate-700">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10.5px] font-medium tracking-widest uppercase text-gray-400 dark:text-gray-500 mb-1.5">
            Students redeeming this code
          </label>
          <div className="inline-flex items-center rounded-md border border-gray-300 dark:border-slate-600 overflow-hidden">
            <button
              type="button"
              aria-label="Decrease"
              disabled={students <= 1}
              onClick={() => setStudents((s) => clampStudents(s - 1))}
              className="w-9 h-9 text-lg font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              –
            </button>
            <input
              type="number"
              min={1}
              max={1000}
              value={students}
              onChange={(e) => setStudents(clampStudents(Number(e.target.value)))}
              className="w-16 h-9 text-center font-mono font-semibold bg-transparent border-x border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="Increase"
              disabled={students >= 1000}
              onClick={() => setStudents((s) => clampStudents(s + 1))}
              className="w-9 h-9 text-lg font-semibold text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-purple-600 hover:bg-purple-700 disabled:opacity-55 disabled:cursor-not-allowed text-white transition-colors"
        >
          {generating ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Generating…
            </>
          ) : (
            'Generate achievement code'
          )}
        </button>
      </div>

      {status && (
        <p
          className={`mt-3 text-sm ${
            status.level === 'err'
              ? 'text-red-600 dark:text-red-400'
              : status.level === 'ok'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {status.text}
        </p>
      )}

      {codes.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {codes.map((c, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-2.5 px-3 py-2.5 rounded-md bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/25"
            >
              <span className="font-mono font-semibold tracking-wide px-2 py-0.5 rounded bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-200">
                {c.code}
              </span>
              <CopyButton value={c.code} label="Copy code" />
              {c.url && (
                <>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-0 truncate text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {c.url}
                  </a>
                  <CopyButton value={c.url} label="Copy URL" />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};

// -----------------------------------------------------------------------------
// Main view
// -----------------------------------------------------------------------------

export const MicrosoftCertificateView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Inline credential form — only revealed when the server tells us
  // there's no display and we need to drive the sign-in form headlessly.
  const [needsCreds, setNeedsCreds] = useState(false);
  const [credEmail, setCredEmail] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial sign-in status check.
  useEffect(() => {
    fetch('/api/admin/microsoft-redeem/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setSignedIn(!!d.signedIn);
          setSignedInEmail(d.email ?? null);
        }
      })
      .catch(() => {});
  }, []);

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

  // Check (without signing in) whether a Microsoft Learn session is stored.
  const checkSignedIn = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/microsoft-redeem/status');
      const data = await res.json();
      const ok = !!(data.ok && data.signedIn);
      setSignedIn(ok);
      setSignedInEmail(ok ? (data.email ?? null) : null);
      return ok;
    } catch {
      return false;
    }
  };

  // Open the interactive Microsoft sign-in window OR — on a headless host
  // — submit caller-provided credentials so the server can drive the
  // login form itself. The two paths share the same endpoint; the body
  // is empty for headed sign-in, populated for headless.
  const handleSignIn = async (creds?: { email: string; password: string }) => {
    setLoggingIn(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/microsoft-redeem/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds ?? {}),
      });
      const data = await res.json();
      if (data.ok) {
        setSignedIn(true);
        setSignedInEmail(data.email ?? null);
        setAuthError(null);
        setNeedsCreds(false);
        setCredPassword('');
      } else if (data.needsCredentials) {
        // Headless server has no display — reveal the inline form so the
        // admin can hand the backend an email + password to use.
        setNeedsCreds(true);
        setAuthError(data.error || null);
      } else {
        setAuthError(data.error || 'Sign-in failed');
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Sign-in failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleCredSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!credEmail.trim() || !credPassword) return;
    void handleSignIn({ email: credEmail.trim(), password: credPassword });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
          Microsoft Certificate
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Search the Microsoft MCT Title Plan, open the Singapore-tracked course
          page, and generate Microsoft Learn achievement codes.
        </p>
      </div>

      {/* Auth bar */}
      <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <span
          className={`w-2.5 h-2.5 rounded-full flex-none ${
            signedIn ? 'bg-green-500' : 'bg-amber-500'
          }`}
        />
        <span className="text-sm text-gray-600 dark:text-gray-300">
          {signedIn
            ? `Signed in to Microsoft Learn${signedInEmail ? ` as ${signedInEmail}` : ''}`
            : 'Not signed in to Microsoft Learn'}
        </span>
        <button
          type="button"
          onClick={() => handleSignIn()}
          disabled={loggingIn}
          className="ml-auto px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-55 disabled:cursor-not-allowed"
        >
          {loggingIn
            ? 'Waiting for sign-in…'
            : signedIn
              ? 'Re-sign in'
              : 'Sign in to Microsoft'}
        </button>
      </div>

      {/* Inline credential form — appears only when the server reports it
          has no display and needs the admin to supply credentials so the
          backend can drive Microsoft's login form headlessly. */}
      {needsCreds && !signedIn && (
        <form
          onSubmit={handleCredSubmit}
          className="mb-4 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 space-y-3"
        >
          <p className="text-sm text-blue-800 dark:text-blue-200">
            This server can't open a sign-in window. Enter your Microsoft
            email and password and the server will sign in for you. Your
            password isn't stored — only the resulting session cookies.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="email"
              required
              autoComplete="username"
              placeholder="Microsoft email"
              value={credEmail}
              onChange={(e) => setCredEmail(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Microsoft password"
              value={credPassword}
              onChange={(e) => setCredPassword(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={loggingIn || !credEmail.trim() || !credPassword}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-55 disabled:cursor-not-allowed text-white"
            >
              {loggingIn ? 'Signing in…' : 'Sign in headlessly'}
            </button>
            <button
              type="button"
              onClick={() => {
                setNeedsCreds(false);
                setCredPassword('');
                setAuthError(null);
              }}
              className="px-3 py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-slate-500"
            >
              Cancel
            </button>
            <span className="text-xs text-blue-700 dark:text-blue-300">
              MFA / passkey accounts won't work — automated sign-in only.
            </span>
          </div>
        </form>
      )}

      {loggingIn && !needsCreds && (
        <div className="mb-4 p-3 rounded-md text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          A Microsoft sign-in window has opened on the server desktop. Complete
          the sign-in there (email, passkey/password, MFA) — this page will
          update automatically once it finishes.
        </div>
      )}

      {authError && (
        <div className="mb-4 p-3 rounded-md text-sm bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {authError}
        </div>
      )}

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
              <CourseCard
                key={c.courseNumber}
                course={c}
                onCheckSignedIn={checkSignedIn}
              />
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
        Generated codes are recorded for record-keeping · Singapore partner
        campaign ocid=5238477
      </p>
    </div>
  );
};
