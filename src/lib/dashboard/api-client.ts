// Client-side fetch helpers for the dashboard. The point is that a failed
// request is never mistaken for "no data": every helper throws an ApiError
// carrying the server's own (already user-safe) message, and callers render
// an error state with a retry instead of an empty list.

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const NETWORK_ERROR = 'تعذّر الاتصال بالخادم — تحقق من الاتصال وحاول مجدداً'

/** fetch + JSON, throwing ApiError on any non-2xx or network failure. */
export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<{ data: T; res: Response }> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError(NETWORK_ERROR, 0)
  }
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!res.ok) {
    const b = body as { error?: unknown; code?: unknown } | null
    const message = typeof b?.error === 'string' ? b.error : `تعذّر تنفيذ الطلب (HTTP ${res.status})`
    throw new ApiError(message, res.status, typeof b?.code === 'string' ? b.code : undefined)
  }
  return { data: body as T, res }
}

/** Human-readable message for anything thrown by the helpers above. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return NETWORK_ERROR
}

function withParams(url: string, params: Record<string, string | undefined>): string {
  const [path, query = ''] = url.split('?')
  const sp = new URLSearchParams(query)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, v)
  const qs = sp.toString()
  return qs ? `${path}?${qs}` : path
}

export type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null; total: number | null }

/** One page of a cursor-paginated list endpoint (see src/lib/pagination.ts). */
export async function fetchPage<T>(url: string, opts: { limit: number; cursor?: string | null }): Promise<Page<T>> {
  const { data, res } = await apiFetch<T[]>(withParams(url, { limit: String(opts.limit), cursor: opts.cursor ?? undefined }))
  const totalHeader = res.headers.get('X-Total-Count')
  return {
    items: Array.isArray(data) ? data : [],
    hasMore: res.headers.get('X-Has-More') === 'true',
    nextCursor: res.headers.get('X-Next-Cursor'),
    total: totalHeader !== null ? Number(totalHeader) : null,
  }
}

/**
 * Every row of a list endpoint, following the cursor — for pickers (e.g.
 * "choose a client") that must offer ALL of the office's records, not just
 * the first page. `max` bounds the walk; `truncated` says if it was hit.
 */
export async function fetchAllPages<T>(url: string, max = 5000): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  let cursor: string | null = null
  for (;;) {
    const page: Page<T> = await fetchPage<T>(url, { limit: 200, cursor })
    items.push(...page.items)
    if (!page.hasMore || !page.nextCursor) return { items, truncated: false }
    if (items.length >= max) return { items: items.slice(0, max), truncated: true }
    cursor = page.nextCursor
  }
}
