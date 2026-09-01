import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentry-scrub'

// Inert unless SENTRY_DSN is set — the app boots and runs identically with
// it unset (same posture as SMTP / the AI service). No tracing, no profiling,
// no session data: errors only.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
})
