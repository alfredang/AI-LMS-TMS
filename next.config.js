const { execSync } = require('child_process');
const COMMIT_HASH = (() => {
  const formatDate = (d) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
  };
  // If already set via Docker build arg or env, use it directly
  if (process.env.NEXT_PUBLIC_COMMIT_HASH && process.env.NEXT_PUBLIC_COMMIT_HASH !== 'dev') {
    return process.env.NEXT_PUBLIC_COMMIT_HASH;
  }
  // Get commit hash
  let hash = 'dev';
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    hash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
  } else {
    try { hash = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
  }
  // Get commit timestamp, fall back to build time
  let timestamp;
  try {
    const isoDate = execSync('git log -1 --format=%ci').toString().trim();
    timestamp = formatDate(new Date(isoDate));
  } catch {
    timestamp = formatDate(new Date());
  }
  return `${hash} ${timestamp}`;
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  // Turbopack configuration (Next.js 16 default bundler)
  turbopack: {
    resolveAlias: {
      '@components': './components',
      '@lib': './lib',
      '@hooks': './hooks',
      '@contexts': './contexts',
      '@app-types': './types',
      '@styles': './styles',
      '@utils': './utils',
    },
  },

  // Image optimization
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.pravatar.cc' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
    unoptimized: process.env.NODE_ENV !== 'production',
  },

  serverExternalPackages: ['node-cron'],

  // Webpack configuration
  webpack: (config, { isServer }) => {
    const path = require('path');

    config.resolve.alias = {
      ...config.resolve.alias,
      '@components': path.resolve(__dirname, 'components'),
      '@lib': path.resolve(__dirname, 'lib'),
      '@hooks': path.resolve(__dirname, 'hooks'),
      '@contexts': path.resolve(__dirname, 'contexts'),
      '@app-types': path.resolve(__dirname, 'types'),
      '@styles': path.resolve(__dirname, 'styles'),
      '@utils': path.resolve(__dirname, 'utils'),
    };

    return config;
  },

  // Rewrite /uploads/* to the API file-serving route so dynamically-uploaded
  // files in the Docker volume are served reliably in standalone mode.
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination: '/api/uploads/:path*',
      },
    ];
  },

  // Only expose PUBLIC environment variables
  // NEVER expose database credentials or secrets here
  env: {
    NEXT_PUBLIC_COMMIT_HASH: COMMIT_HASH,
  },
};

module.exports = nextConfig;
