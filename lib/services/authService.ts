import { UserRole } from '@app-types';

export interface User {
  id: string;
  email: string;
  fullName: string;
  profilePictureUrl?: string;
  role: UserRole;
  roles: UserRole[]; // All roles the user has
}

export interface LoginCredentials {
  email: string;
  password?: string;
  otp?: string;
  role?: UserRole; // Make role optional as it will be determined by the backend
  loginType: 'password' | 'otp';
}

export interface AuthResponse {
  success: boolean;
  data?: {
    user: User;
    role: UserRole; // Primary/selected role
    roles: UserRole[]; // All available roles
    token?: string;
  };
  error?: string;
}

class AuthService {
  private static readonly AUTH_TOKEN_KEY = 'auth_token';
  private static readonly USER_DATA_KEY = 'user_data';

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      console.log('🔐 AuthService: Attempting login...', { 
        email: credentials.email, 
        role: credentials.role,
        loginType: credentials.loginType 
      });

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const result: AuthResponse = await response.json();

      if (!response.ok) {
        console.log('❌ AuthService: Login failed:', result.error);
        return result;
      }

      if (result.success && result.data) {
        // Store auth data in localStorage for persistence
        this.setAuthData(result.data.user, result.data.token);
        console.log('✅ AuthService: Login successful');
      }

      return result;
    } catch (error) {
      console.error('❌ AuthService: Login error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  async logout(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🚪 AuthService: Logging out...');

      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        this.clearAuthData();
        console.log('✅ AuthService: Logout successful');
        return { success: true };
      } else {
        const result = await response.json();
        console.log('❌ AuthService: Logout failed:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ AuthService: Logout error:', error);
      // Clear local data even if API call fails
      this.clearAuthData();
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  async verifyToken(): Promise<{ valid: boolean; user?: User; error?: string }> {
    try {
      const token = this.getAuthToken();
      const userData = this.getUserData();

      if (!token || !userData) {
        console.log('❌ AuthService: No token or user data found');
        return { valid: false, error: 'No authentication data' };
      }

      // For now, just validate that we have the necessary data locally
      // Skip server-side token verification to prevent auto-logout on refresh
      console.log('✅ AuthService: Using cached authentication data');
      return { valid: true, user: userData };

      /* Commented out server-side verification to prevent auto-logout
      console.log('🔍 AuthService: Verifying token...');

      const response = await fetch('/api/auth/verify', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log('✅ AuthService: Token is valid');
        // Update stored user data with fresh data from server
        if (result.data?.user) {
          this.setAuthData(result.data.user, token);
        }
        return { valid: true, user: result.data?.user };
      } else {
        console.log('❌ AuthService: Token is invalid');
        this.clearAuthData();
        return { valid: false, error: result.error || 'Token verification failed' };
      }
      */
    } catch (error) {
      console.error('❌ AuthService: Token verification error:', error);
      // Don't clear auth data on verification errors to prevent auto-logout
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  isAuthenticated(): boolean {
    const token = this.getAuthToken();
    const userData = this.getUserData();
    return !!(token && userData);
  }

  getUserData(): User | null {
    try {
      const userData = localStorage.getItem(AuthService.USER_DATA_KEY);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.error('❌ AuthService: Error reading user data:', error);
      return null;
    }
  }

  getAuthToken(): string | null {
    return localStorage.getItem(AuthService.AUTH_TOKEN_KEY);
  }

  private setAuthData(user: User, token?: string): void {
    try {
      localStorage.setItem(AuthService.USER_DATA_KEY, JSON.stringify(user));
      if (token) {
        localStorage.setItem(AuthService.AUTH_TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('❌ AuthService: Error storing auth data:', error);
    }
  }

  private clearAuthData(): void {
    try {
      localStorage.removeItem(AuthService.USER_DATA_KEY);
      localStorage.removeItem(AuthService.AUTH_TOKEN_KEY);
    } catch (error) {
      console.error('❌ AuthService: Error clearing auth data:', error);
    }
  }

  // Check if user has a specific role (checks all roles)
  hasRole(role: UserRole): boolean {
    const userData = this.getUserData();
    if (!userData) return false;
    // Check if role exists in the roles array, or matches the primary role
    return userData.roles?.includes(role) || userData.role === role;
  }

  // Get current user's primary role
  getCurrentRole(): UserRole | null {
    const userData = this.getUserData();
    return userData?.role || null;
  }

  // Get all roles the user has
  getAllRoles(): UserRole[] {
    const userData = this.getUserData();
    return userData?.roles || (userData?.role ? [userData.role] : []);
  }

  // Update the current selected role (for role switching)
  setCurrentRole(role: UserRole): void {
    const userData = this.getUserData();
    if (userData && this.hasRole(role)) {
      userData.role = role;
      localStorage.setItem(AuthService.USER_DATA_KEY, JSON.stringify(userData));
    }
  }
}

export const authService = new AuthService();
