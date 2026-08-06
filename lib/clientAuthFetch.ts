/**
 * Global fetch interceptor for the browser: every same-origin /api/ request
 * carries the session token, and a 401 (expired/revoked session) clears local
 * auth state and returns to the login screen.
 *
 * Installed once from _app.tsx. This is what lets the API lockdown
 * (withAuth on every route) work without touching the ~460 fetch call sites.
 */

const AUTH_TOKEN_KEY = 'auth_token';
const USER_DATA_KEY = 'user_data';

export function installAuthFetch(): void {
  if (typeof window === 'undefined') return;
  const w = window as any;
  if (w.__lmsAuthFetchInstalled) return;
  w.__lmsAuthFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;

    const isApiCall =
      url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);

    if (isApiCall) {
      let token: string | null = null;
      try {
        token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      } catch {
        // storage unavailable (private mode etc.) — proceed without a token
      }
      if (token) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        init = { ...init, headers };
      }
    }

    const response = await originalFetch(input as any, init);

    // Session expired or revoked: drop local auth state and show the login
    // screen. Auth endpoints are excluded so a failed login attempt doesn't
    // trigger a reload loop.
    if (
      isApiCall &&
      response.status === 401 &&
      !url.includes('/api/auth/')
    ) {
      let hadToken = false;
      try {
        hadToken = !!window.localStorage.getItem(AUTH_TOKEN_KEY);
        if (hadToken) {
          window.localStorage.removeItem(AUTH_TOKEN_KEY);
          window.localStorage.removeItem(USER_DATA_KEY);
        }
      } catch {
        // ignore storage errors
      }
      if (hadToken) {
        window.location.assign('/');
      }
    }

    return response;
  };
}
