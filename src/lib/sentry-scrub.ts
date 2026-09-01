import type { ErrorEvent } from '@sentry/nextjs'

// Sentry's own default already keeps cookies/headers/IP out of events
// (sendDefaultPii: false). This is the second layer: whatever DOES make it
// into an event — an error message that quoted a request body, a breadcrumb,
// an `extra` — gets emails, tokens and long text redacted before it leaves
// the process. This app handles contract text and client PII; a stack trace
// is useful, the document that triggered it is not.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// JWTs (eyJ… . … . …), `ds_token=…`, `Bearer …`, and 32+ char hex blobs
// (service keys / IP-hash salts).
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const TOKEN_KV_RE = /(ds_token=|token=|authorization:\s*bearer\s+|bearer\s+)[A-Za-z0-9._-]+/gi
const HEX_BLOB_RE = /\b[a-f0-9]{32,}\b/gi

const MAX_STRING = 2000

export function scrubString(input: string): string {
  let s = input
    .replace(JWT_RE, '[redacted-token]')
    .replace(TOKEN_KV_RE, '$1[redacted-token]')
    .replace(HEX_BLOB_RE, '[redacted-hex]')
    .replace(EMAIL_RE, '[redacted-email]')
  if (s.length > MAX_STRING) s = s.slice(0, MAX_STRING) + `…[+${s.length - MAX_STRING} chars]`
  return s
}

/** Recursively scrub every string in a plain value; caps depth so a cyclic
 *  or pathologically deep object can't hang the send path. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]'
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubValue(v, depth + 1)
    return out
  }
  return value
}

/**
 * `beforeSend` hook. Drops the parts of an event that carry request
 * payloads outright, then string-scrubs everything that remains.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    // The body, cookies and auth header are never worth keeping.
    delete event.request.data
    delete event.request.cookies
    if (event.request.headers) {
      delete event.request.headers['cookie']
      delete event.request.headers['authorization']
      delete event.request.headers['x-internal-service-key']
    }
    // Keep the path, drop any query string (reset tokens, etc. ride there).
    if (typeof event.request.query_string === 'string') event.request.query_string = ''
    if (typeof event.request.url === 'string') event.request.url = event.request.url.split('?')[0]
  }
  delete event.user

  if (event.message) event.message = scrubString(event.message)
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value)
  }
  for (const bc of event.breadcrumbs ?? []) {
    if (bc.message) bc.message = scrubString(bc.message)
    if (bc.data) bc.data = scrubValue(bc.data) as Record<string, unknown>
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts

  return event
}
