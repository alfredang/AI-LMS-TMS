/**
 * Global SSG App state — used to inject x-ssg-app header into API calls.
 * Set by the SsgAppSelector component, read by ssgFetch().
 */
let currentSsgApp = '';

export function getSsgApp(): string {
  return currentSsgApp;
}

export function setSsgAppGlobal(app: string): void {
  currentSsgApp = app;
}

/**
 * Fetch wrapper that automatically adds x-ssg-app header.
 * Drop-in replacement for fetch() in SSG-related API calls.
 */
export function ssgFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  if (currentSsgApp) {
    headers.set('x-ssg-app', currentSsgApp);
  }
  return fetch(url, { ...options, headers });
}
