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
    case UserRole.Finance: return 'Finance';
    case UserRole.Payroll: return 'Payroll';
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
    case UserRole.Finance: return '💰';
    case UserRole.Payroll: return '🧾';
    case UserRole.TrainingProvider: return '🏢';
    default: return '👤';
  }
};

interface LoginScreenProps {
  onLoginSuccess?: (role: UserRole) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const { login, courses, trainingProviderProfile } = useLms();

  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'roleSelect' | 'changePassword' | 'forgotPassword' | 'profileSetup'>('email');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
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
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showAcceptableUsePolicy, setShowAcceptableUsePolicy] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({ name: '', email: '', tel: '', message: '' });
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);

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

        // Check if user needs to set up profile
        if (result.data.requiresProfileSetup) {
          console.log('New user requires profile setup');
          setPendingUser(result.data.user);
          setAvailableRoles(roles);
          setStep('profileSetup');
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

  const handleProfileSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/profile-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pendingUser?.id,
          profileData: { name: fullName }
        }),
      });
      const result = await response.json();

      if (result.success) {
        // Name updated, proceed with login
        if (availableRoles.length > 1) {
          setStep('roleSelect');
        } else {
          completeLogin({ ...pendingUser!, fullName }, availableRoles[0] || (pendingUser as any).role);
        }
      } else {
        setError(result.error || result.message || 'Failed to update profile.');
      }
    } catch (err) {
      console.error('Profile update error:', err);
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotPasswordEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });
      const result = await response.json();
      if (result.success) {
        setForgotPasswordSent(true);
      } else {
        setError(result.error || 'Failed to process request. Please try again.');
      }
    } catch (err) {
      console.error('Forgot password error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
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
        <p className="text-green-600 text-xs text-center">If you don&apos;t see the OTP email in your inbox, please check the spam/all emails.</p>
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

      <div className="text-center mt-4 space-y-2">
        <button
          type="button"
          onClick={() => {
            setStep('forgotPassword');
            setForgotPasswordEmail(email);
            setForgotPasswordSent(false);
            setError(null);
          }}
          className="text-sm text-gray-500 hover:text-gray-700 underline dark:text-gray-400 dark:hover:text-gray-300"
        >
          Forgot Password?
        </button>
        {securitySettings.enableOtpLogin && (
          <div>
            <button
              type="button"
              onClick={handleSwitchToOtp}
              className="text-sm text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              Login with OTP instead
            </button>
          </div>
        )}
      </div>

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
                <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {role === UserRole.Learner && 'Access courses and track your learning progress'}
                  {role === UserRole.Trainer && 'Manage classes and grade assessments'}
                  {role === UserRole.Developer && 'Create and edit course content'}
                  {role === UserRole.Admin && 'Manage users, classes, and system settings'}
                  {role === UserRole.Finance && 'Manage grants, claims, and financial records'}
                  {role === UserRole.Payroll && 'Manage trainer payouts and payment records'}
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

  const renderProfileSetupStep = () => (
    <form onSubmit={handleProfileSetup} className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Welcome!</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Please enter your full name as per your NRIC/Passport. This will be used for your certificates.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder="e.g. John Doe"
          required
        />
      </div>

      <Button type="submit" variant="primary" className="w-full py-3" disabled={isLoading}>
        {isLoading ? 'Saving...' : 'Continue'}
      </Button>
    </form>
  );

  const renderForgotPasswordStep = () => (
    <div className="space-y-6">
      {forgotPasswordSent ? (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Check Your Email</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            If an account exists for <span className="font-semibold text-gray-900 dark:text-white">{forgotPasswordEmail}</span>, a temporary password has been sent. Please check your inbox (and spam folder).
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Use the temporary password to log in. You will be prompted to set a new password.
          </p>
          <Button
            onClick={() => {
              setStep('password');
              setEmail(forgotPasswordEmail);
              setPassword('');
              setError(null);
            }}
            className="w-full !py-3"
            size="lg"
          >
            Back to Login
          </Button>
        </div>
      ) : (
        <form onSubmit={handleForgotPassword} className="space-y-6">
          <div className="text-center mb-2">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Forgot Password</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Enter your email address and we&apos;ll send you a temporary password.
            </p>
          </div>
          <div>
            <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">Email</label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={forgotPasswordEmail}
              onChange={(e) => setForgotPasswordEmail(e.target.value.toLowerCase())}
              className={inputClasses}
              placeholder="your@email.com"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <Button type="submit" className="w-full !py-3" size="lg" disabled={isLoading}>
            {isLoading ? 'Sending...' : 'Send Temporary Password'}
          </Button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setStep('password');
                setError(null);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline dark:text-gray-400 dark:hover:text-gray-300"
            >
              Back to Login
            </button>
          </div>
        </form>
      )}
    </div>
  );

  const renderCurrentStep = () => {
    if (step === 'forgotPassword') {
      return renderForgotPasswordStep();
    } else if (step === 'changePassword') {
      return renderChangePasswordStep();
    } else if (step === 'profileSetup') {
      return renderProfileSetupStep();
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
      <div className={`w-full px-4 ${step === 'roleSelect' ? 'max-w-lg' : 'max-w-md'}`}>
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
              {isLoadingProviderData ? '...' : (trainingProviderData?.companyShortname || trainingProviderData?.companyName)}
            </h1>
            <p className="text-gray-600 mt-2 dark:text-gray-400">LMS cum TMS for WSQ Courses</p>
          </div>

          {renderCurrentStep()}

          <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-center space-x-4">
              <button onClick={() => setShowPrivacyPolicy(true)} className="hover:underline cursor-pointer">Privacy Policy</button>
              <button onClick={() => setShowAcceptableUsePolicy(true)} className="hover:underline cursor-pointer">Acceptable Use Policy</button>
              <button onClick={() => { setShowFeedback(true); setFeedbackStatus(null); setFeedbackForm({ name: '', email: '', tel: '', message: '' }); }} className="hover:underline cursor-pointer">Feedback</button>
            </div>
            {trainingProviderProfile?.companyWebsite && (
              <p className="mt-3">
                Browse our WSQ courses at{' '}
                <a href={trainingProviderProfile.companyWebsite} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  {trainingProviderProfile.companyWebsite}
                </a>
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Privacy Policy Modal */}
      {showPrivacyPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPrivacyPolicy(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Privacy Policy</h2>
              <button onClick={() => setShowPrivacyPolicy(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 space-y-2">
              {(() => {
                const companyName = trainingProviderData?.companyName || 'The Company';
                const policyText = (trainingProviderData?.privacyPolicy || '')
                  .replace(/\{COMPANY_NAME\}/g, companyName);
                if (!policyText.trim()) {
                  return <p className="text-gray-400 italic">No privacy policy has been configured.</p>;
                }
                return policyText.split('\n').map((line: string, i: number) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <br key={i} />;
                  if (/^\d+\.\s+/.test(trimmed)) {
                    return <h3 key={i} className="font-semibold text-gray-900 dark:text-white mt-3">{trimmed}</h3>;
                  }
                  if (trimmed.startsWith('- ')) {
                    return <li key={i} className="ml-5 list-disc">{trimmed.substring(2)}</li>;
                  }
                  return <p key={i}>{trimmed}</p>;
                });
              })()}
            </div>
            <div className="p-4 border-t dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setShowPrivacyPolicy(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Acceptable Use Policy Modal */}
      {showAcceptableUsePolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAcceptableUsePolicy(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Acceptable Use Policy</h2>
              <button onClick={() => setShowAcceptableUsePolicy(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 space-y-2">
              {(() => {
                const companyName = trainingProviderData?.companyName || 'The Company';
                const policyText = (trainingProviderData?.acceptableUsePolicy || '')
                  .replace(/\{COMPANY_NAME\}/g, companyName);
                if (!policyText.trim()) {
                  return <p className="text-gray-400 italic">No acceptable use policy has been configured.</p>;
                }
                return policyText.split('\n').map((line: string, i: number) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <br key={i} />;
                  if (/^\d+\.\s+/.test(trimmed)) {
                    return <h3 key={i} className="font-semibold text-gray-900 dark:text-white mt-3">{trimmed}</h3>;
                  }
                  if (trimmed.startsWith('- ')) {
                    return <li key={i} className="ml-5 list-disc">{trimmed.substring(2)}</li>;
                  }
                  return <p key={i}>{trimmed}</p>;
                });
              })()}
            </div>
            <div className="p-4 border-t dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setShowAcceptableUsePolicy(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFeedback(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Feedback</h2>
              <button onClick={() => setShowFeedback(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              {feedbackStatus && (
                <div className={`p-3 rounded-md text-sm ${feedbackStatus.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                  {feedbackStatus.text}
                </div>
              )}
              {feedbackStatus?.type !== 'success' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={feedbackForm.name}
                      onChange={(e) => setFeedbackForm(prev => ({ ...prev, name: e.target.value }))}
                      className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      value={feedbackForm.email}
                      onChange={(e) => setFeedbackForm(prev => ({ ...prev, email: e.target.value }))}
                      className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tel</label>
                    <input
                      type="tel"
                      value={feedbackForm.tel}
                      onChange={(e) => setFeedbackForm(prev => ({ ...prev, tel: e.target.value }))}
                      className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Your phone number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message <span className="text-red-500">*</span></label>
                    <textarea
                      value={feedbackForm.message}
                      onChange={(e) => setFeedbackForm(prev => ({ ...prev, message: e.target.value }))}
                      rows={4}
                      className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                      placeholder="Your feedback or message..."
                    />
                  </div>
                </>
              )}
            </div>
            <div className="p-4 border-t dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowFeedback(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {feedbackStatus?.type === 'success' ? 'Close' : 'Cancel'}
              </button>
              {feedbackStatus?.type !== 'success' && (
                <button
                  onClick={async () => {
                    if (!feedbackForm.name.trim() || !feedbackForm.email.trim() || !feedbackForm.message.trim()) {
                      setFeedbackStatus({ type: 'error', text: 'Please fill in all required fields.' });
                      return;
                    }
                    setIsSendingFeedback(true);
                    setFeedbackStatus(null);
                    try {
                      const response = await fetch('/api/training-provider/send-feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(feedbackForm),
                      });
                      const data = await response.json();
                      if (data.success) {
                        setFeedbackStatus({ type: 'success', text: 'Thank you! Your feedback has been sent successfully.' });
                      } else {
                        setFeedbackStatus({ type: 'error', text: data.error || 'Failed to send feedback.' });
                      }
                    } catch (error) {
                      setFeedbackStatus({ type: 'error', text: 'Failed to send feedback. Please try again.' });
                    } finally {
                      setIsSendingFeedback(false);
                    }
                  }}
                  disabled={isSendingFeedback}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                >
                  {isSendingFeedback ? 'Sending...' : 'Send Feedback'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginScreen;
