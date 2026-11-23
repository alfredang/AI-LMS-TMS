import React from 'react';

/**
 * "Download on the App Store" / "Get it on Google Play" badges for this tenant's
 * mobile app. The links come from the tenant config (lib/mobileAppLinks.ts) and
 * each badge shows only when its store is configured; with neither it renders
 * nothing. Badges keep the stores' own black-and-white look in both themes.
 */

const BADGE_STYLE = { backgroundColor: '#000' } as const;

// Store badges are always black with white text, by the stores' brand rules.
const BADGE_BASE = 'inline-flex items-center rounded-xl text-white ring-1 ring-white/25 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'; // design-tokens-allow
const CAPTION = 'whitespace-nowrap font-medium uppercase tracking-wider text-white/75'; // design-tokens-allow

const SIZES = {
  md: { badge: 'min-h-[48px] gap-2.5 px-3.5 py-2', icon: 'h-6 w-6', caption: 'text-[10px]', name: 'text-[17px]' },
} as const;

// Compact outlined pill for the header: theme tokens, one-line label.
const OUTLINE = 'inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-xl border border-strong bg-surface px-3 py-1.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

interface AppStoreBadgesProps {
  iosUrl?: string | null;
  androidUrl?: string | null;
  /** md: the stores' black badge (login screen); outline: compact outlined pill (header). */
  size?: keyof typeof SIZES | 'outline';
  className?: string;
}

const AppleLogo: React.FC<{ className: string }> = ({ className }) => (
  <svg viewBox="0 0 384 512" className={`${className} shrink-0`} fill="currentColor" aria-hidden="true">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C71.5 141.1 0 184.6 0 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM255.6 88.3c30.4-36.1 27.6-68.9 26.7-80.7-26.8 1.6-57.8 18.3-75.5 38.9-19.5 22.1-31 49.4-28.5 79.9 28.9 2.2 55.3-12.7 77.3-38.1z" />
  </svg>
);

const PlayLogo: React.FC<{ className: string }> = ({ className }) => (
  <svg viewBox="0 0 512 512" className={`${className} shrink-0`} aria-hidden="true">
    <path fill="#00D9FF" d="M47.6 24.6C41.2 31.3 37.5 41.7 37.5 55.2v401.6c0 13.5 3.7 23.9 10.1 30.6l1.3 1.3 225-225v-5.3l-225-225-1.3 1.2z" />
    <path fill="#FFD400" d="M348.2 336.9l-75-75v-5.3l75.1-75.1 1.7 1 88.9 50.5c25.4 14.4 25.4 38 0 52.5l-88.9 50.5-1.8.9z" />
    <path fill="#FF3A44" d="M349.9 335.9l-76.7-76.7L47.6 484.8c8.4 8.9 22.2 10 37.8 1.1l264.5-150z" />
    <path fill="#00C244" d="M349.9 176.1L85.4 26.1C69.8 17.2 56 18.3 47.6 27.2l225.6 225.6 76.7-76.7z" />
  </svg>
);

const AppStoreBadges: React.FC<AppStoreBadgesProps> = ({ iosUrl, androidUrl, size = 'md', className = '' }) => {
  if (!iosUrl && !androidUrl) return null;
  if (size === 'outline') {
    const pill = (href: string, label: string, name: string, logo: React.ReactNode) => (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={OUTLINE}>
        {logo}
        <span>{name}</span>
      </a>
    );
    return (
      <div className={`flex flex-wrap items-center gap-2.5 ${className}`}>
        {iosUrl && pill(iosUrl, 'Download on the App Store', 'App Store', <AppleLogo className="h-4 w-4" />)}
        {androidUrl && pill(androidUrl, 'Get it on Google Play', 'Google Play', <PlayLogo className="h-4 w-4" />)}
      </div>
    );
  }

  const s = SIZES[size];

  const badge = (href: string, label: string, caption: string, name: string, logo: React.ReactNode) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={`${BADGE_BASE} ${s.badge}`}
      style={BADGE_STYLE}
    >
      {logo}
      <span className="flex flex-col text-left leading-tight">
        <span className={`${CAPTION} ${s.caption}`}>{caption}</span>
        <span className={`whitespace-nowrap font-semibold tracking-tight ${s.name}`}>{name}</span>
      </span>
    </a>
  );

  return (
    <div className={`flex flex-wrap items-center gap-2.5 ${className}`}>
      {iosUrl && badge(iosUrl, 'Download on the App Store', 'Download on the', 'App Store', <AppleLogo className={s.icon} />)}
      {androidUrl && badge(androidUrl, 'Get it on Google Play', 'Get it on', 'Google Play', <PlayLogo className={s.icon} />)}
    </div>
  );
};

export default AppStoreBadges;
