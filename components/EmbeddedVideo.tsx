import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './ui/Icon';
import { getYouTubeId, getYouTubeStart, youTubeEmbedUrl, youTubeThumbnailUrl } from '@lib/youtube';

/**
 * Embed Video subtopic asset: a YouTube link played inside the course page.
 *
 * The player is a thumbnail until clicked, so a course page with many videos
 * does not load a YouTube iframe per subtopic. The zoom button opens the video
 * in a full-screen overlay (same pattern as the feedback QR zoom) for showing
 * on the classroom screen. A link that is not a YouTube video falls back to a
 * plain link.
 */
const EmbeddedVideo: React.FC<{ url: string; title?: string }> = ({ url, title }) => {
  const id = getYouTubeId(url);
  const start = getYouTubeStart(url);
  const [playing, setPlaying] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const label = title || 'Video';

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomed]);

  if (!id) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <Icon name={IconName.Video} className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{title || url}</span>
      </a>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0 text-sm font-semibold text-on-surface">
          <Icon name={IconName.Video} className="w-3.5 h-3.5 flex-shrink-0 text-danger" />
          <span className="truncate">{label}</span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPlaying(false); setZoomed(true); }}
          className="p-1.5 rounded-md text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
          title="Show video full screen"
          aria-label={`Show ${label} full screen`}
        >
          <Icon name={IconName.ZoomIn} className="w-5 h-5" />
        </button>
      </div>
      <div className="relative w-full overflow-hidden rounded-lg border border-default bg-black" style={{ aspectRatio: '16 / 9' }}>{/* design-tokens-allow */}
        {playing && !zoomed ? (
          <iframe
            src={youTubeEmbedUrl(id, { autoplay: true, start })}
            title={label}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPlaying(true); }}
            className="group absolute inset-0 w-full h-full"
            aria-label={`Play ${label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={youTubeThumbnailUrl(id)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center justify-center w-16 h-11 rounded-xl bg-danger group-hover:scale-110 transition-transform shadow-lg">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-on-primary" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          </button>
        )}
      </div>
      {zoomed && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[1000] bg-black/95 flex flex-col items-center justify-center p-4" // design-tokens-allow
          role="dialog"
          aria-modal="true"
          aria-label={`${label} full screen`}
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 p-2 rounded-full text-white bg-white/10 hover:bg-white/25 transition-colors" // design-tokens-allow
            aria-label="Close full screen video"
          >
            <Icon name={IconName.Close} className="w-7 h-7" />
          </button>
          <div
            className="relative bg-black rounded-xl overflow-hidden" // design-tokens-allow
            style={{ width: 'min(94vw, calc(86vh * 16 / 9))', aspectRatio: '16 / 9' }}
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={youTubeEmbedUrl(id, { autoplay: true, start })}
              title={label}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EmbeddedVideo;
