const { execSync } = require('child_process');
const COMMIT_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
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
