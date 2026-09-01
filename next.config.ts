import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdf-parse / mammoth / tesseract.js do runtime dynamic requires and read
  // their own bundled assets from disk — keep them external so Next emits a
  // plain require() instead of trying to trace/bundle their internals, which
  // breaks them under `output: 'standalone'`. Same list ailegal_hussein uses.
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pdf-parse', 'mammoth', 'tesseract.js', 'archiver'],
  // Emits .next/standalone with a self-contained server.js and only the
  // traced dependencies — the Docker runtime image copies that instead of
  // the whole node_modules. See Dockerfile / HOSTINGER_DEPLOY.md.
  output: 'standalone',
}

export default nextConfig
