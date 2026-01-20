import type { NextPage } from 'next'
import Head from 'next/head'
import { useState, useEffect } from 'react'
import LearnerLayout from '@/layouts/LearnerLayout'
import TrainerLayout from '@/layouts/TrainerLayout'
import DeveloperLayout from '@/layouts/DeveloperLayout'
import AdminLayout from '@/layouts/AdminLayout'
import TrainingProviderLayout from '@/layouts/TrainingProviderLayout'
import { useLms } from '@contexts/LmsContext'
import { UserRole } from '@app-types'
import Header from '@components/Header'
import LoginScreen from '@components/LoginScreen'
import { Spinner } from '@components/ui'

interface HealthStatus {
  status: string
  timestamp: string
  version: string
  database?: string
}

const Home: NextPage = () => {
  const { role, isAuthenticated, isLoading, currentUser } = useLms();
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        setHealthStatus(data)
        setHealthLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch health status:', err)
        setHealthLoading(false)
      })
  }, [])

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        <Head>
          <title>TechEd Solutions - Login</title>
          <meta name="description" content="Login to your learning management system" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <LoginScreen 
          onLoginSuccess={(role) => {
            console.log('Login successful for role:', role);
            // The login function in LoginScreen already handles the login process
          }}
        />
      </>
    );
  }

  // Show appropriate layout based on user role
  if (role === UserRole.Learner) {
    return (
      <>
        <Head>
          <title>Learning Management System</title>
          <meta name="description" content="Your personal learning dashboard" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <LearnerLayout />
      </>
    );
  }

  if (role === UserRole.Trainer) {
    return (
      <>
        <Head>
          <title>TechEd Solutions - Trainer Dashboard</title>
          <meta name="description" content="Trainer management dashboard" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <TrainerLayout />
      </>
    );
  }

  if (role === UserRole.Developer) {
    return (
      <>
        <Head>
          <title>TechEd Solutions - Developer Dashboard</title>
          <meta name="description" content="Developer dashboard and profile" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <DeveloperLayout />
      </>
    );
  }

  if (role === UserRole.Admin) {
    return (
      <>
        <Head>
          <title>TechEd Solutions - Admin Dashboard</title>
          <meta name="description" content="Admin management dashboard" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <AdminLayout />
      </>
    );
  }

  if (role === UserRole.TrainingProvider) {
    return (
      <>
        <Head>
          <title>TechEd Solutions - Training Provider Dashboard</title>
          <meta name="description" content="Training provider management dashboard" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <TrainingProviderLayout />
      </>
    );
  }

  // Default view for other roles (for now, show a placeholder)
  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>TechEd Solutions - Dashboard</title>
        <meta name="description" content="Learning Management System Dashboard" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Header />

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Welcome, {currentUser?.fullName}!
              </h2>
              <p className="text-gray-600 mb-4">
                You are logged in as: <span className="font-semibold capitalize">{role}</span>
              </p>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-2">System Status</h3>
                {healthLoading ? (
                  <Spinner size="sm" />
                ) : healthStatus ? (
                  <div className="text-sm">
                    <p>Status: <span className="text-green-600 font-semibold">{healthStatus.status}</span></p>
                    <p>Database: <span className="text-green-600 font-semibold">{healthStatus.database || 'Connected'}</span></p>
                    <p>Version: {healthStatus.version}</p>
                    <p>Time: {new Date(healthStatus.timestamp).toLocaleString()}</p>
                  </div>
                ) : (
                  <p className="text-red-600">Failed to load system status</p>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-4">
                Role-specific dashboards for {role} users are coming soon.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home
