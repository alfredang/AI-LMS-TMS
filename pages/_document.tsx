import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/png" sizes="32x32" href="/api/favicon.png?size=32" />
        <link rel="icon" type="image/png" sizes="16x16" href="/api/favicon.png?size=16" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
