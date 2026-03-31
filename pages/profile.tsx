import type { NextPage } from 'next'
import Head from 'next/head'
import { ProfilePage } from '@components/ProfilePage'
import { useLms } from '@contexts/LmsContext'

const Profile: NextPage = () => {
  const { trainingProviderProfile } = useLms();
  const appTitle = trainingProviderProfile?.companyShortname || 'LMS TMS';
  return (
    <>
      <Head>
        <title>Profile - {appTitle} LMS TMS</title>
        <meta name="description" content="User Profile Management" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <ProfilePage />
    </>
  )
}

export default Profile
