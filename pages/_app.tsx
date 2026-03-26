import '@styles/globals.css'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import { LmsProvider } from '@contexts/LmsContext'

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </Head>
      <LmsProvider>
        <Component {...pageProps} />
      </LmsProvider>
    </>
  )
}

export default MyApp
