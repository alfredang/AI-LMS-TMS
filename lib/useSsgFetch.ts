import { useLms } from '@contexts/LmsContext';
import { useCallback } from 'react';

/**
 * Hook that wraps fetch() to automatically include the x-ssg-app header
 * based on the currently selected SSG app in the LMS context.
 */
export function useSsgFetch() {
  const { ssgApp } = useLms();

  const ssgFetch = useCallback(
    (url: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      if (ssgApp) {
        headers.set('x-ssg-app', ssgApp);
      }
      return fetch(url, { ...options, headers });
    },
    [ssgApp]
  );

  return ssgFetch;
}
