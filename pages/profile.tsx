import type { NextPage } from 'next'
import Head from 'next/head'
import { ProfilePage } from '@components/ProfilePage'

const Profile: NextPage = () => {
  return (
    <>
      <Head>
        <title>Profile - Tertiary Infotech Academy LMS TMS</title>
        <meta name="description" content="User Profile Management" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <ProfilePage />
    </>
  )
}

export default Profile
