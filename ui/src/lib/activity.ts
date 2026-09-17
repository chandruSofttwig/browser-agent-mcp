export type ActivityStatus =
  | 'started'
  | 'progress'
  | 'ok'
  | 'error'
  | 'awaiting-approval'

export type ActivityApproval = {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  summary: string
  expiresAt?: number
  by?: string
}

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
  output?: string
  outputType?: 'stdout' | 'stderr' | 'info'
  progress?: number
  approval?: ActivityApproval
  type?: string
}

/**
 * This UI is served by the agent itself, on loopback. It authenticates by
 * origin (the server enforces a local-Origin check on the `*-ui` routes)
 * rather than by a token in the URL.
 *
 * Tokens in query strings leak into access logs, browser history and Referer
 * headers, which is why the server no longer accepts `?token=` anywhere.
 * `apiBase()` returns a same-origin path, so no credential is needed here.
 */
export function apiBase(): string {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path.endsWith('/activity') || path.includes('/activity/')) {
    const idx = path.lastIndexOf('/activity')
    return path.slice(0, idx + '/activity'.length)
  }
  return '/activity'
}

function localOnlySuffix(): string {
  // The server rejects non-local Origins on these routes; the query flag is a
  // routing hint, not a credential.
  return '-ui'
}

export async function fetchSnapshot(): Promise<ActivityEvent[]> {
  const res = await fetch(`${apiBase()}/snapshot${localOnlySuffix()}`)
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? 'Activity is only available from a local browser'
        : `Snapshot failed (${res.status})`,
    )
  }
  const data = (await res.json()) as { events: ActivityEvent[] }
  return data.events ?? []
}

export async function clearServer(): Promise<void> {
  await fetch(`${apiBase()}/clear${localOnlySuffix()}`, { method: 'POST' })
}

export type PendingApproval = {
  id: string
  tool: string
  summary: string
  paths: string[]
  args: Record<string, unknown>
  expiresAt: number
}

/** Pending approval requests, newest last. Safe to call without a token. */
export async function fetchPendingApprovals(): Promise<{
  enabled: boolean
  pending: PendingApproval[]
}> {
  const res = await fetch(`${apiBase()}/../approvals-ui/pending`)
  if (!res.ok) {
    throw new Error(`Could not load approvals (${res.status})`)
  }
  const data = (await res.json()) as { enabled?: boolean; pending?: PendingApproval[] }
  return {
    enabled: data.enabled !== false,
    pending: Array.isArray(data.pending) ? data.pending : [],
  }
}

/**
 * Approve or deny a pending request.
 *
 * The decision token is supplied by the person clicking, having read it from
 * the waiting tool call. The server requires it in addition to the local
 * origin, so this UI cannot approve on the model's behalf.
 */
export async function decideApproval(
  id: string,
  decision: 'approve' | 'deny',
  token: string,
): Promise<'approved' | 'denied'> {
  const res = await fetch(`${apiBase()}/../approvals-ui/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, token }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Decision failed (${res.status})`)
  }
  const body = (await res.json()) as { status?: 'approved' | 'denied' }
  return body.status ?? (decision === 'approve' ? 'approved' : 'denied')
}
