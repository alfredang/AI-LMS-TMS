import { Html, Head, Main, NextScript } from 'next/document'

// Applies the saved Light / Dark / System preference before first paint, so no
// user sees a wrong-theme flash. Mirrors getThemePreference() /
// resolveThemePreference() in utils/colorUtils.ts (same key, System by default).
const THEME_INIT = `(function(){try{localStorage.removeItem('trainingProviderTheme');var p=localStorage.getItem('lmsThemePreference');if(p!=='light'&&p!=='dark'&&p!=='system')p='system';var t=p==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;var d=document.documentElement;d.setAttribute('data-theme',t);if(t==='dark')d.classList.add('dark');else d.classList.remove('dark');}catch(e){}})();`

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/png" sizes="32x32" href="/api/favicon.png?size=32" />
        <link rel="icon" type="image/png" sizes="16x16" href="/api/favicon.png?size=16" />
      </Head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
