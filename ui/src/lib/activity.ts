export type ActivityStatus = 'started' | 'ok' | 'error'

export type ActivityEvent = {
  id: string
  ts: number
  tool: string
  status: ActivityStatus
  argsSummary: string
  paths: string[]
  args?: Record<string, unknown>
  durationMs?: number
  error?: string
  type?: string
}

const TOKEN_KEY = 'bamcp_activity_token'

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

/** API base under current page path (/activity or /agent/activity). */
export function apiBase(): string {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path.endsWith('/activity') || path.includes('/activity/')) {
    const idx = path.lastIndexOf('/activity')
    return path.slice(0, idx + '/activity'.length)
  }
  return '/activity'
}

export async function fetchSnapshot(token: string): Promise<ActivityEvent[]> {
  const res = await fetch(`${apiBase()}/snapshot?token=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(res.status === 401 ? 'Invalid token' : `Snapshot failed (${res.status})`)
  const data = (await res.json()) as { events: ActivityEvent[] }
  return data.events ?? []
}

export async function clearServer(token: string): Promise<void> {
  await fetch(`${apiBase()}/clear?token=${encodeURIComponent(token)}`, { method: 'POST' })
}
