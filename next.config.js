/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  instrumentationHook: true,

  // Silence conflict warning between Turbopack and Webpack
  // by explicitly acknowledging we have no specific Turbopack config yet
  turbopack: {},

  // Image optimization
  images: {
    domains: ['i.pravatar.cc', 'avatars.githubusercontent.com'],
    unoptimized: process.env.NODE_ENV !== 'production',
  },

  serverExternalPackages: ['node-cron'],

  // TypeScript & ESLint
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

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
    // Public variables only (prefixed with NEXT_PUBLIC_)
  },
};

module.exports = nextConfig;
