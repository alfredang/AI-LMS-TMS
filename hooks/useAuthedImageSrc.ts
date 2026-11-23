import { useEffect, useState } from 'react';

/** Same-origin API image routes need the session token, which an <img> tag cannot send. */
const needsAuth = (url: string): boolean => {
  if (typeof window === 'undefined') return false;
  return url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
};

/**
 * Returns a src an <img> can load. Images served by an authenticated API route
 * (e.g. the Google Drive image proxy) are fetched with the session token — the
 * global fetch interceptor adds it — and handed back as a blob URL. Other URLs
 * pass through unchanged. `failed` is true when the image cannot be loaded, so
 * the caller can show a fallback instead of a broken image.
 */
export function useAuthedImageSrc(url?: string | null): { src?: string; failed: boolean } {
  const [state, setState] = useState<{ src?: string; failed: boolean }>({ failed: false });

  useEffect(() => {
    if (!url) { setState({ failed: false }); return; }
    if (!needsAuth(url)) { setState({ src: url, failed: false }); return; }

    let cancelled = false;
    let objectUrl: string | undefined;
    setState({ failed: false });
    fetch(url)
      .then(res => {
        if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) throw new Error('not an image');
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, failed: false });
      })
      .catch(() => { if (!cancelled) setState({ failed: true }); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return state;
}
