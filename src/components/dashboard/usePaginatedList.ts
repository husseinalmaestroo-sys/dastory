'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, fetchPage } from '@/lib/dashboard/api-client'

/**
 * A cursor-paginated list for dashboard pages. Loads the first page whenever
 * `url` or `reloadKey` changes and appends further pages on loadMore(). It
 * replaces the old one-shot `fetch(url)` per page, which silently showed only
 * the first 200 rows (the API's default page size) and turned any failure
 * into an empty list via `.catch(() => {})`.
 */
export function usePaginatedList<T extends { id: string }>(url: string | null, reloadKey: unknown = 0, pageSize = 50) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Ignore responses from a request superseded by a newer url/reloadKey.
  const generation = useRef(0)

  useEffect(() => {
    if (!url) return
    const gen = ++generation.current
    let cancelled = false
    const run = async () => {
      await Promise.resolve() // state updates happen after the effect body
      if (cancelled) return
      setLoading(true)
      setError(null)
      try {
        const page = await fetchPage<T>(url, { limit: pageSize })
        if (cancelled || gen !== generation.current) return
        setItems(page.items)
        setTotal(page.total)
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
      } catch (err) {
        if (cancelled || gen !== generation.current) return
        setError(errorMessage(err))
      } finally {
        if (!cancelled && gen === generation.current) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [url, reloadKey, pageSize, attempt])

  const loadMore = useCallback(async () => {
    if (!url || !cursor || loadingMore) return
    const gen = generation.current
    setLoadingMore(true)
    setError(null)
    try {
      const page = await fetchPage<T>(url, { limit: pageSize, cursor })
      if (gen !== generation.current) return
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id))
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))]
      })
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (err) {
      if (gen === generation.current) setError(errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }, [url, cursor, loadingMore, pageSize])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { items, setItems, total, hasMore, loading, loadingMore, error, loadMore, retry }
}
