const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const COMMIT_HASH = (() => {
  const formatDate = (d) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
  };
  // Try reading pre-generated .version file (used in Docker builds)
  try {
    const v = fs.readFileSync(path.join(__dirname, '.version'), 'utf8').trim();
    if (v) return v;
  } catch {}
  // Get commit timestamp, fall back to build time
  try {
    const isoDate = execSync('git log -1 --format=%ci').toString().trim();
    return formatDate(new Date(isoDate));
  } catch {
    return formatDate(new Date());
  }
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

  serverExternalPackages: ['node-cron', '@anthropic-ai/claude-agent-sdk'],

  // Force-include the Claude Agent SDK's runtime files in the standalone
  // bundle. The SDK loads `cli.js` and `vendor/` (ripgrep + audio-capture)
  // dynamically at runtime, which Next.js's static tracer cannot detect,
  // so without this they get stripped from the production image and the
  // SDK throws: "Native CLI binary for linux-x64 not found." Including
  // the whole package directory ensures every runtime asset travels into
  // the standalone output.
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@anthropic-ai/claude-agent-sdk/**',
    ],
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
    NEXT_PUBLIC_COMMIT_HASH: COMMIT_HASH,
  },
};

module.exports = nextConfig;
