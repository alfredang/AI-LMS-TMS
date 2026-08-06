import '@styles/globals.css'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import { LmsProvider } from '@contexts/LmsContext'
import { installAuthFetch } from '@lib/clientAuthFetch'

installAuthFetch()

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" type="image/png" sizes="32x32" href="/api/favicon.png?size=32" />
        <link rel="icon" type="image/png" sizes="16x16" href="/api/favicon.png?size=16" />
        <link rel="shortcut icon" href="/api/favicon.png?size=32" />
      </Head>
      <LmsProvider>
        <Component {...pageProps} />
      </LmsProvider>
    </>
  )
}

export default MyApp
