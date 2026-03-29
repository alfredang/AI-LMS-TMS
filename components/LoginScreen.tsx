import React, { useState, useEffect } from 'react';
import { UserRole } from '@app-types';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { authService, LoginCredentials, User } from '@lib/services/authService';
import { useLms } from '@contexts/LmsContext';
import { trainingProviderService, TrainingProviderData } from '@lib/services/trainingProviderService';

// Helper to get display name for a role
const getRoleDisplayName = (role: UserRole): string => {
  switch (role) {
    case UserRole.Learner: return 'Learner';
    case UserRole.Trainer: return 'Trainer';
    case UserRole.Developer: return 'Developer';
    case UserRole.Admin: return 'Admin';
    case UserRole.TrainingProvider: return 'Training Provider';
    default: return role;
  }
};

// Helper to get role icon
const getRoleIcon = (role: UserRole): string => {
  switch (role) {
    case UserRole.Learner: return '📚';
    case UserRole.Trainer: return '👨‍🏫';
    case UserRole.Developer: return '💻';
    case UserRole.Admin: return '⚙️';
    case UserRole.TrainingProvider: return '🏢';
    default: return '👤';
  }
};

interface LoginScreenProps {
  onLoginSuccess?: (role: UserRole) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const { login, courses } = useLms();

  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'roleSelect' | 'changePassword'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); // Pre-fill for testing
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loginType, setLoginType] = useState<'password' | 'otp'>('password');
  const [showPassword, setShowPassword] = useState(false);
  const [trainingProviderData, setTrainingProviderData] = useState<TrainingProviderData | null>(null);
  const [isLoadingProviderData, setIsLoadingProviderData] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Multi-role state
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [availableRoles, setAvailableRoles] = useState<UserRole[]>([]);

  // Load training provider data on component mount
  useEffect(() => {
    const loadTrainingProviderData = async () => {
      console.log('🔄 LoginScreen: Loading training provider data...');
      setIsLoadingProviderData(true);
      try {
        console.log('🔍 LoginScreen: Calling trainingProviderService.getTrainingProviderInfo()...');
        const result = await trainingProviderService.getTrainingProviderInfo();
        console.log('🔍 LoginScreen: Raw API result:', result);
        console.log('🔍 LoginScreen: result.success:', result.success);
        console.log('🔍 LoginScreen: result.data:', result.data);
        console.log('🔍 LoginScreen: result.error:', result.error);

        if (result.success && result.data) {
          console.log('✅ LoginScreen: Training provider data loaded:', result.data);
          console.log('🔍 LoginScreen: Company name from API:', result.data.companyName);
          console.log('🔍 LoginScreen: Company logo from API:', result.data.companyLogoUrl);
          setTrainingProviderData(result.data);
        } else {
          console.error('❌ LoginScreen: Failed to load training provider data:', result.error);
          console.error('❌ LoginScreen: Result structure:', result);
        }
      } catch (error) {
        console.error('❌ LoginScreen: Error loading training provider data:', error);
      } finally {
        setIsLoadingProviderData(false);
      }
    };
    loadTrainingProviderData();
  }, []);



  console.log('🎨 LoginScreen: Current trainingProviderData state:', trainingProviderData);
  console.log('🔍 LoginScreen: trainingProviderData?.companyName:', trainingProviderData?.companyName);
  console.log('🔍 LoginScreen: trainingProviderData?.companyLogoUrl:', trainingProviderData?.companyLogoUrl);
  console.log('🔍 LoginScreen: trainingProviderData?.defaultOtp:', trainingProviderData?.defaultOtp);

  // Training provider security settings from database (no fallbacks)
  const securitySettings = {
    enableOtpLogin: trainingProviderData?.enableOtpLogin ?? true,
    enableDefaultOtp: trainingProviderData?.enableDefaultOtp ?? false,
    defaultOtp: trainingProviderData?.defaultOtp
  };

  console.log('🔍 LoginScreen: securitySettings.defaultOtp:', securitySettings.defaultOtp);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
    setIsLoading(true);
    setLoginType('otp');

    try {
      console.log(`Sending OTP to ${email}`);
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const result = await response.json();

      if (result.success) {
        setStep('otp');
        setSuccessMessage(result.message || 'OTP sent to your email.');
      } else {
        setError(result.error || 'Failed to send OTP. Please try again.');
      }
    } catch (error) {
      console.error('Error sending OTP:', error);
      setError('Failed to send OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Complete login with selected role
  const completeLogin = (user: User, selectedRole: UserRole) => {
    // Update user's current role
    const updatedUser = { ...user, role: selectedRole };
    authService.setCurrentRole(selectedRole);
    login(selectedRole, updatedUser);
    onLoginSuccess?.(selectedRole);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@') || password.length < 6) {
      setError('Please enter a valid email and password.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const credentials: LoginCredentials = {
        email,
        password,
        loginType: 'password'
      };

      const result = await authService.login(credentials);

      if (result.success && result.data) {
        console.log('Login successful:', result.data.user);
        const roles = result.data.roles || [result.data.role];

        // Check if user needs to change default password
        if (result.data.forcePasswordChange) {
          console.log('User must change default password');
          setPendingUser(result.data.user);
          setAvailableRoles(roles);
          setStep('changePassword');
          return;
        }

        // If user has multiple roles, show role selector
        if (roles.length > 1) {
          console.log('User has multiple roles:', roles);
          setPendingUser(result.data.user);
          setAvailableRoles(roles);
          setStep('roleSelect');
        } else {
          // Single role - proceed directly
          completeLogin(result.data.user, result.data.role);
        }
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    setError(null);

    try {
      const credentials: LoginCredentials = {
        email,
        otp,
        loginType: 'otp'
      };

      const result = await authService.login(credentials);

      if (result.success && result.data) {
        console.log('OTP login successful:', result.data.user);
        const roles = result.data.roles || [result.data.role];

        // If user has multiple roles, show role selector
        if (roles.length > 1) {
          console.log('User has multiple roles:', roles);
          setPendingUser(result.data.user);
          setAvailableRoles(roles);
          setStep('roleSelect');
        } else {
          // Single role - proceed directly
          completeLogin(result.data.user, result.data.role);
        }
      } else {
        setError(result.error || 'Invalid OTP. Please try again.');
      }
    } catch (error) {
      console.error('OTP login error:', error);
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle role selection
  const handleRoleSelect = (selectedRole: UserRole) => {
    if (pendingUser) {
      completeLogin(pendingUser, selectedRole);
    }
  };

  const handleResendOtp = async () => {
    setIsResending(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const result = await response.json();

      if (result.success) {
        setSuccessMessage(result.message || 'A new OTP has been sent to your email.');
        setTimeout(() => setSuccessMessage(null), 10000);
      } else {
        setError(result.error || 'Failed to resend OTP. Please try again.');
      }
    } catch (error) {
      console.error('Error resending OTP:', error);
      setError('Failed to resend OTP. Please try again.');
    } finally {
      setTimeout(() => setIsResending(false), 5000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword === password) {
      setError('New password must be different from your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/update-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingUser?.id, newPassword }),
      });
      const result = await response.json();

      if (result.success) {
        // Password changed, now proceed with login
        if (availableRoles.length > 1) {
          setStep('roleSelect');
        } else {
          completeLogin(pendingUser!, availableRoles[0] || (pendingUser as any).role);
        }
      } else {
        setError(result.message || 'Failed to update password.');
      }
    } catch (err) {
      console.error('Password change error:', err);
      setError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchToPassword = () => {
    setStep('password');
    setLoginType('password');
    setError(null);
    setSuccessMessage(null);
  };

  const handleSwitchToOtp = () => {
    setStep('email');
    setLoginType('otp');
    setError(null);
    setSuccessMessage(null);
  };




  const inputClasses = "block w-full px-4 py-3 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

  const renderEmailStep = () => (
    <form onSubmit={handleSendOtp} className="space-y-6">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value.toLowerCase())}
          className={inputClasses}
        />
      </div>
      {error && <p className="text-red-500 text-sm text-center">{error}</p>}
      <div>
        <Button type="submit" className="w-full !py-3" size="lg" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send OTP'}
        </Button>
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={handleSwitchToPassword}
          className="text-sm text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300"
        >
          Login with password instead
        </button>
      </div>

    </form>
  );

  const renderOtpStep = () => (
    <div>
      <div className="text-center mb-6">
        <p className="font-semibold dark:text-white">Verify your identity</p>
        <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
          An OTP has been sent to <span className="font-bold text-gray-900 dark:text-white">{email}</span>.
        </p>
      </div>
      <form onSubmit={handleVerifyOtp} className="space-y-4">
        <div>
          <label htmlFor="otp" className="sr-only">Enter OTP</label>
          <input
            id="otp"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
            maxLength={6}
            className={`${inputClasses} text-center text-2xl tracking-[0.5em] font-mono`}
            placeholder="______"
          />
        </div>
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        {successMessage && <p className="text-green-600 text-sm text-center">{successMessage}</p>}
        <Button type="submit" className="w-full !py-3" size="lg" disabled={isLoading}>
          {isLoading ? 'Verifying...' : 'Verify & Log In'}
        </Button>
      </form>
      <div className="mt-4 text-center text-sm">
        <button
          onClick={handleResendOtp}
          disabled={isResending}
          className="font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400 disabled:cursor-not-allowed dark:text-blue-400 dark:hover:text-blue-300 dark:disabled:text-gray-600"
        >
          {isResending ? 'Resending...' : 'Resend OTP'}
        </button>
        <span className="mx-2 text-gray-500 dark:text-gray-400">|</span>
        <button
          onClick={handleSwitchToPassword}
          className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Use Password
        </button>
      </div>
    </div>
  );

  const renderPasswordStep = () => (
    <form onSubmit={handlePasswordLogin} className="space-y-6">
      <div>
        <label htmlFor="email-pw" className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">Email</label>
        <input
          id="email-pw"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value.toLowerCase())}
          className={inputClasses}
        />
      </div>
      <div>
        <label htmlFor="password-login" className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">Password</label>
        <div className="relative">
          <input
            id="password-login"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClasses}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? (
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && <p className="text-red-500 text-sm text-center">{error}</p>}
      <div>
        <Button type="submit" className="w-full !py-3" size="lg" disabled={isLoading}>
          {isLoading ? 'Signing In...' : 'Sign In'}
        </Button>
      </div>

      {securitySettings.enableOtpLogin && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={handleSwitchToOtp}
            className="text-sm text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            Login with OTP instead
          </button>
        </div>
      )}

    </form>
  );

  const renderRoleSelectStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <p className="font-semibold text-lg text-gray-900 dark:text-white">Welcome back, {pendingUser?.fullName}!</p>
        <p className="text-sm text-gray-600 mt-2 dark:text-gray-300">
          You have access to multiple roles. Please select one to continue:
        </p>
      </div>

      <div className="space-y-3">
        {availableRoles.map((role) => (
          <button
            key={role}
            onClick={() => handleRoleSelect(role)}
            className="w-full flex items-center justify-between p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 group dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-blue-400"
          >
            <div className="flex items-center space-x-3">
              <span className="text-2xl">{getRoleIcon(role)}</span>
              <div className="text-left">
                <p className="font-medium text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-400">
                  {getRoleDisplayName(role)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {role === UserRole.Learner && 'Access courses and track your learning progress'}
                  {role === UserRole.Trainer && 'Manage classes and grade assessments'}
                  {role === UserRole.Developer && 'Create and edit course content'}
                  {role === UserRole.Admin && 'Manage users, classes, and system settings'}
                  {role === UserRole.TrainingProvider && 'Manage organization and SSG integration'}
                </p>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-500 dark:text-gray-500 dark:group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>

      <div className="text-center mt-6">
        <button
          onClick={() => {
            setStep('password');
            setPendingUser(null);
            setAvailableRoles([]);
          }}
          className="text-sm text-gray-500 hover:text-gray-700 underline dark:text-gray-400 dark:hover:text-gray-200"
        >
          Sign in with a different account
        </button>
      </div>
    </div>
  );

  const renderChangePasswordStep = () => (
    <form onSubmit={handleChangePassword} className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Change Your Password</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          You are using the default password. Please set a new password to continue.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
        <div className="relative">
          <input
            type={showNewPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            placeholder="Enter new password"
            required
            minLength={6}
          />
          <button
            type="button"
            onClick={() => setShowNewPassword(!showNewPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            {showNewPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder="Confirm new password"
          required
          minLength={6}
        />
      </div>

      <Button type="submit" variant="primary" className="w-full py-3" disabled={isLoading}>
        {isLoading ? 'Updating...' : 'Set New Password'}
      </Button>
    </form>
  );

  const renderCurrentStep = () => {
    if (step === 'changePassword') {
      return renderChangePasswordStep();
    } else if (step === 'roleSelect') {
      return renderRoleSelectStep();
    } else if (securitySettings.enableOtpLogin && step === 'otp') {
      return renderOtpStep();
    } else if (step === 'password') {
      return renderPasswordStep();
    } else if (securitySettings.enableOtpLogin && step === 'email') {
      return renderEmailStep();
    } else {
      // If OTP is disabled, always show password step
      return renderPasswordStep();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#1a3a69] dark:bg-gray-900">
      <div className="w-full max-w-md px-4">
        <Card className="!p-8 sm:!p-10 !shadow-2xl dark:bg-gray-800 dark:border-gray-700">
          <div className="flex flex-col items-center text-center mb-8">
            {/* Only show logo and company name when data is loaded */}
            {isLoadingProviderData ? (
              <div className="w-20 h-20 bg-gray-200 rounded-md mb-4 animate-pulse dark:bg-gray-700"></div>
            ) : (
              <img
                src={trainingProviderData?.companyLogoUrl}
                alt="Company Logo"
                className="w-20 h-20 rounded-md mb-4"
                onError={(e) => {
                  console.error('❌ LoginScreen: Failed to load company logo:', trainingProviderData?.companyLogoUrl);
                }}
              />
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isLoadingProviderData ? '...' : trainingProviderData?.companyName}
            </h1>
            <p className="text-gray-600 mt-2 dark:text-gray-400">LMS cum TMS for WSQ Courses</p>
          </div>

          {renderCurrentStep()}

          <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-center space-x-4">
              <a href="#privacy" className="hover:underline">Privacy Policy</a>
              <a href="#acceptable-use" className="hover:underline">Acceptable Use Policy</a>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default LoginScreen;
