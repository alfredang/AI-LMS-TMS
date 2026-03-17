import '@styles/globals.css'
import type { AppProps } from 'next/app'
import { LmsProvider } from '@contexts/LmsContext'

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <LmsProvider>
      <Component {...pageProps} />
    </LmsProvider>
  )
}

export default MyApp
