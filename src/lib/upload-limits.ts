// One definition of the upload size limits, shared by the upload route,
// next.config.ts (proxy body buffer) and deploy/setup-nginx.sh (21M).
//
// proxy.ts runs on every /api request, and Next.js buffers a proxied request
// body only up to `proxyClientMaxBodySize` (default 10 MB) — anything beyond
// is silently cut off before the route handler sees it. With the default,
// every 10–20 MB upload arrived truncated even though the route accepts
// 20 MB. The buffer is therefore sized to the largest request the upload
// route accepts.

/** Largest accepted file. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
/** Largest accepted multipart request: the file plus 1 MiB for boundaries/headers/fields. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
