import { useCallback, useEffect, useState } from 'react'
import { Activity, Check, Radio, ShieldAlert, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ActivityRow } from '@/components/activity-row'
import { useActivityStream } from '@/hooks/use-activity-stream'
import {
  clearServer,
  decideApproval,
  fetchPendingApprovals,
  type PendingApproval,
} from '@/lib/activity'

/**
 * Approval prompt.
 *
 * The decision token comes from the *waiting tool call*, which relays it to the
 * model, which shows it to the user. Requiring it here is what makes this an
 * explicit human decision rather than a click the model could trigger itself.
 */
function ApprovalCard({
  approval,
  onDone,
}: {
  approval: PendingApproval
  onDone: () => void
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const secondsLeft = Math.max(0, Math.round((approval.expiresAt - Date.now()) / 1000))

  const decide = async (decision: 'approve' | 'deny') => {
    if (!token.trim()) {
      setErr('Paste the approval token from the waiting tool call')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await decideApproval(approval.id, decision, token.trim())
      onDone()
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Decision failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          {approval.tool} needs approval
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">{secondsLeft}s left</span>
      </div>

      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/5 px-2 py-1.5 font-mono text-[11px]">
        {approval.summary}
      </pre>

      {approval.paths.length > 0 ? (
        <p className="mt-1 font-mono text-[11px] text-[var(--color-muted)]">
          {approval.paths.join(', ')}
        </p>
      ) : null}

      <Input
        className="mt-2"
        placeholder="Paste approval token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
      />
      {err ? <p className="mt-1 text-[11px] text-[var(--color-err)]">{err}</p> : null}

      <div className="mt-2 flex gap-2">
        <Button size="sm" type="button" disabled={busy} onClick={() => void decide('approve')}>
          <Check className="h-3.5 w-3.5" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={busy}
          onClick={() => void decide('deny')}
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-muted)]">
        Do nothing and this request is denied automatically when it times out.
      </p>
    </div>
  )
}

function Feed() {
  const { events, live, error, clearLocal } = useActivityStream()
  const [pending, setPending] = useState<PendingApproval[]>([])
  const [approvalsEnabled, setApprovalsEnabled] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await fetchPendingApprovals()
      setPending(result.pending)
      setApprovalsEnabled(result.enabled)
    } catch {
      // Server unreachable; the event stream surfaces the error itself.
    }
  }, [])

  // Poll: a request can appear at any moment, and disappears when it times out.
  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(id)
  }, [refresh])

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--color-fg)]" />
          <h1 className="text-[15px] font-semibold tracking-tight">Andro Agent</h1>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Radio className={`h-3 w-3 ${live ? 'text-[var(--color-ok)]' : 'text-neutral-400'}`} />
          {live ? 'Live' : 'Reconnecting…'}
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => {
              clearLocal()
              void clearServer()
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b bg-[var(--color-err-bg)] px-4 py-2 text-xs text-[var(--color-err)]">
          {error}
        </div>
      ) : null}

      {!approvalsEnabled ? (
        <div className="border-b bg-amber-500/10 px-4 py-2 text-xs">
          Approval gating is OFF. Write, Edit and Bash run without confirmation.
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="shrink-0 space-y-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] p-3">
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onDone={() => void refresh()} />
          ))}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 bg-[var(--color-panel)]">
        {events.length === 0 ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-[var(--color-fg)]">Waiting for tool calls…</p>
            <p className="max-w-sm text-xs text-[var(--color-muted)]">
              When your AI client invokes Read, Glob, Grep, Write, Edit, Bash, or any andro_*
              context tool, rows appear here in real time.
            </p>
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <ActivityRow key={`${event.id}-${event.status}-${event.ts}`} event={event} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

/**
 * No token gate: this page is served by the agent itself on loopback, and the
 * server authorises these routes by origin. Deciding an approval still requires
 * the per-request token, so nothing here can act on its own.
 */
export default function App() {
  return <Feed />
}
