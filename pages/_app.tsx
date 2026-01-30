import '@styles/globals.css'
import type { AppProps } from 'next/app'
import { LmsProvider } from '@contexts/LmsContext'
import { useEffect } from 'react'
import { authService } from '@lib/services/authService'

function MyApp({ Component, pageProps }: AppProps) {
  // Handle OAuth callback on app initialization
  useEffect(() => {
    const handleOAuthCallback = async () => {
      // Only check for OAuth session if user is not already authenticated
      if (!authService.isAuthenticated()) {
        try {
          console.log('🔍 Checking for OAuth session...');
          const result = await authService.handleOAuthSession();

          if (result.success && result.data) {
            console.log('✅ OAuth session found and user logged in');
            // The authService has already stored the user data
            // Force a page reload to update the UI
            window.location.reload();
          }
        } catch (error) {
          console.error('❌ Error handling OAuth session:', error);
        }
      }
    };

    handleOAuthCallback();
  }, []);

  return (
    <LmsProvider>
      <Component {...pageProps} />
    </LmsProvider>
  )
}

export default MyApp
