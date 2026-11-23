/**
 * YouTube link helpers for the Embed Video subtopic asset.
 *
 * Accepts the link shapes a developer is likely to paste: watch?v=, youtu.be/,
 * /embed/, /shorts/, /live/ and music.youtube.com. Returns null for anything
 * else, so the caller can fall back to a plain link.
 */
export function getYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] || null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

/** Start offset in seconds from ?t=90, ?t=1m30s or ?start=90 (0 when absent). */
export function getYouTubeStart(url: string | null | undefined): number {
  if (!url) return 0;
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    const raw = u.searchParams.get('start') || u.searchParams.get('t') || '';
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (m && raw) return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
  } catch {
    // not a URL
  }
  return 0;
}

export function youTubeEmbedUrl(id: string, opts: { autoplay?: boolean; start?: number } = {}): string {
  const p = new URLSearchParams({ rel: '0', modestbranding: '1' });
  if (opts.autoplay) p.set('autoplay', '1');
  if (opts.start && opts.start > 0) p.set('start', String(opts.start));
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}

export function youTubeThumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
