export function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = window.localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
