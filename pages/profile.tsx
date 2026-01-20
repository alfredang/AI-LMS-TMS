import type { NextPage } from 'next'
import Head from 'next/head'
import { ProfilePage } from '../src/pages/ProfilePage'

const Profile: NextPage = () => {
  return (
    <>
      <Head>
        <title>Profile - Test Backend</title>
        <meta name="description" content="User Profile Management" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <ProfilePage />
    </>
  )
}

export default Profile
