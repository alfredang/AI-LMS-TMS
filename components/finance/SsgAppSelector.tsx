import React, { useEffect } from 'react';

declare global {
  interface Window {
    __originalFetch?: typeof fetch;
  }
}
import { useLms } from '@contexts/LmsContext';
import { setSsgAppGlobal } from '@lib/ssgAppState';

const SSG_APP_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'app1', label: 'App 1' },
  { value: 'app2', label: 'App 2' },
  { value: 'app3', label: 'App 3' },
  { value: 'app4', label: 'App 4' },
];

export default function SsgAppSelector() {
  const { ssgApp, setSsgApp } = useLms();

  // Intercept fetch to automatically add x-ssg-app header
  useEffect(() => {
    setSsgAppGlobal(ssgApp);
    if (typeof window === 'undefined') return;

    const originalFetch = window.__originalFetch || window.fetch;
    if (!window.__originalFetch) {
      window.__originalFetch = window.fetch;
    }

    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      // Only intercept API calls to our own backend
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.startsWith('/api/') || url.includes('/api/')) {
        const headers = new Headers(init?.headers);
        if (ssgApp && !headers.has('x-ssg-app')) {
          headers.set('x-ssg-app', ssgApp);
        }
        return originalFetch.call(window, input, { ...init, headers });
      }
      return originalFetch.call(window, input, init);
    } as typeof fetch;

    return () => {
      window.fetch = originalFetch;
    };
  }, [ssgApp]);

  return (
    <div className="flex items-center gap-3 mb-4">
      <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">SSG App</label>
      <div className="flex gap-1">
        {SSG_APP_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSsgApp(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              ssgApp === opt.value
                ? 'bg-green-100 text-green-800 border-2 border-green-500 dark:bg-green-900/30 dark:text-green-400 dark:border-green-500'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 border-2 border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
