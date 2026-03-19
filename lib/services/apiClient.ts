// Base API configuration - Use relative URLs for Next.js proxy
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// API Routes
const ROUTES = {
  API: {
    PROFILE: '/api/profile-new',
    USERS: '/api/users',
    AUTH: '/api/auth',
    COURSES: {
      ENROLLED: '/api/courses/enrolled'
    }
  }
} as const;

// Generic API client with token-based authentication
class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    // Strip trailing slash to prevent double-slash when joining with /api/... paths
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  private getAuthToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('auth_token');
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authorization header if token exists
    const token = this.getAuthToken();
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Clear session and redirect to login on auth failure or missing resource
      if (response.status === 401 || response.status === 404) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user_data');
          window.location.href = '/';
        }
        return Promise.reject(new Error(
          response.status === 401 ? 'Authentication expired' : 'Resource not found'
        ));
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
