import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // Deliberately above MAX_UPLOAD_BYTES (1 MB). If this equals the guard,
    // a file at the limit is rejected by the framework with an opaque error
    // before our own size message can be returned.
    serverActions: { bodySizeLimit: '2mb' },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      // Tailwind 4 is processed by this loader; without it no utility class is
      // ever generated and every page renders unstyled.
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig)
