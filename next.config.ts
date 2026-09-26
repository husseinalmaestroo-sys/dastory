import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs/config'
import { MAX_UPLOAD_REQUEST_BYTES } from './src/lib/upload-limits'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No `X-Powered-By: Next.js` fingerprint on responses.
  poweredByHeader: false,
  experimental: {
    // proxy.ts runs on /api/*, and Next buffers a proxied body only up to
    // this size (default 10 MB), silently truncating the rest. Must cover
    // the largest upload request — see src/lib/upload-limits.ts.
    proxyClientMaxBodySize: MAX_UPLOAD_REQUEST_BYTES,
  },
  // pdf-parse / mammoth / tesseract.js do runtime dynamic requires and read
  // their own bundled assets from disk — keep them external so Next emits a
  // plain require() instead of trying to trace/bundle their internals, which
  // breaks them under `output: 'standalone'`. Same list ailegal_hussein uses.
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pdf-parse', 'mammoth', 'tesseract.js', 'archiver'],
  // Emits .next/standalone with a self-contained server.js and only the
  // traced dependencies — the Docker runtime image copies that instead of
  // the whole node_modules. See Dockerfile / HOSTINGER_DEPLOY.md.
  output: 'standalone',
  // The document store and backup dirs are runtime data, found by output
  // tracing only because code builds paths under process.cwd(). Without this,
  // a standalone build on a machine that has uploaded documents copies every
  // client file into .next/standalone (and from there into any artifact made
  // from it). The Docker build never had it only because .dockerignore
  // excludes storage/.
  outputFileTracingExcludes: {
    '**': ['./storage/**/*', './storage-staging/**/*', './backups/**/*'],
  },
}

// Sentry build wrapper. Server-side only (see src/instrumentation.ts — no
// browser SDK). No org/project/authToken, so it never attempts a source-map
// upload; it just injects the release + wires onRequestError. Fully inert at
// runtime when SENTRY_DSN is unset.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  widenClientFileUpload: false,
})
