import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ActivityEvent,
  apiBase,
  fetchSnapshot,
  getStoredToken,
} from '@/lib/activity'

function isActivityEvent(data: unknown): data is ActivityEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    'tool' in data &&
    'status' in data
  )
}

export function useActivityStream(token: string | null) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const backoffRef = useRef(1000)

  const upsert = useCallback((incoming: ActivityEvent) => {
    setEvents((prev) => {
      // Same id: replace started with ok/error (keep both chronological as separate? Plan says started then finished with same id - replace/update row)
      const idx = prev.findIndex((e) => e.id === incoming.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = incoming
        return next
      }
      return [incoming, ...prev]
    })
  }, [])

  const connect = useCallback(() => {
    if (!token) return
    esRef.current?.close()
    setError(null)

    const url = `${apiBase()}/events?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      setLive(true)
      backoffRef.current = 1000
    }

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as unknown
        if (
          typeof data === 'object' &&
          data !== null &&
          'type' in data &&
          (data as { type: string }).type === 'ready'
        ) {
          setLive(true)
          return
        }
        if (isActivityEvent(data)) upsert(data)
      } catch {
        // ignore malformed
      }
    }

    es.onerror = () => {
      setLive(false)
      es.close()
      esRef.current = null
      const delay = backoffRef.current
      backoffRef.current = Math.min(delay * 2, 15000)
      window.setTimeout(() => {
        if (getStoredToken() === token) connect()
      }, delay)
    }
  }, [token, upsert])

  useEffect(() => {
    if (!token) {
      setEvents([])
      setLive(false)
      return
    }

    let cancelled = false
    void fetchSnapshot(token)
      .then((snap) => {
        if (cancelled) return
        // Newest first; keep latest status per id
        const map = new Map<string, ActivityEvent>()
        for (const e of snap) map.set(e.id, e)
        setEvents([...map.values()].sort((a, b) => b.ts - a.ts))
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) connect()
      })

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [token, connect])

  const clearLocal = useCallback(() => setEvents([]), [])

  return { events, live, error, clearLocal, setError }
}
