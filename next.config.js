/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // Image optimization
  images: {
    domains: ['i.pravatar.cc', 'avatars.githubusercontent.com'],
    unoptimized: process.env.NODE_ENV !== 'production',
  },

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

  // Only expose PUBLIC environment variables
  // NEVER expose database credentials or secrets here
  env: {
    // Public variables only (prefixed with NEXT_PUBLIC_)
  },
};

module.exports = nextConfig;
