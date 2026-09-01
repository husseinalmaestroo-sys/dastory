// Next.js runs this once per server/edge process at startup. It wires up
// Sentry (server-side only — no browser SDK, to keep the client bundle
// untouched). Everything is a no-op when SENTRY_DSN is unset.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Captures errors thrown in nested React Server Components / route handlers
// that Next surfaces through this hook. Harmless when Sentry is inert.
export { captureRequestError as onRequestError } from '@sentry/nextjs'
