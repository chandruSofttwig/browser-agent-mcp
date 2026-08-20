import { useState } from 'react'
import { Activity, Radio, Trash2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ActivityRow } from '@/components/activity-row'
import { useActivityStream } from '@/hooks/use-activity-stream'
import {
  clearServer,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from '@/lib/activity'

function TokenGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault()
          const token = value.trim()
          if (!token) {
            setErr('Paste your MCP token')
            return
          }
          setStoredToken(token)
          onUnlock(token)
        }}
      >
        <h1 className="text-lg font-semibold tracking-tight">Browser Agent</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Paste your MCP token to watch live tool calls.
        </p>
        <Input
          className="mt-4"
          type="password"
          autoComplete="current-password"
          placeholder="MCP token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {err ? <p className="mt-2 text-xs text-[var(--color-err)]">{err}</p> : null}
        <Button type="submit" className="mt-4 w-full">
          Unlock activity
        </Button>
      </form>
    </div>
  )
}

function Feed({
  token,
  onLogout,
}: {
  token: string
  onLogout: () => void
}) {
  const { events, live, error, clearLocal } = useActivityStream(token)

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--color-fg)]" />
          <h1 className="text-[15px] font-semibold tracking-tight">Browser Agent</h1>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Radio
            className={`h-3 w-3 ${live ? 'text-[var(--color-ok)]' : 'text-neutral-400'}`}
          />
          {live ? 'Live' : 'Reconnecting…'}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => {
              clearLocal()
              void clearServer(token)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5" />
            Lock
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-[var(--color-err-bg)] bg-[var(--color-err-bg)] px-4 py-2 text-xs text-[var(--color-err)]">
          {error}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 bg-[var(--color-panel)]">
        {events.length === 0 ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-[var(--color-fg)]">
              Waiting for tool calls…
            </p>
            <p className="max-w-sm text-xs text-[var(--color-muted)]">
              When ChatGPT or Claude invokes Read, Glob, Grep, Write, Edit, or Bash, rows
              appear here in real time. An empty feed means tools are not executing.
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

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken())

  if (!token) {
    return <TokenGate onUnlock={setToken} />
  }

  return (
    <Feed
      token={token}
      onLogout={() => {
        clearStoredToken()
        setToken(null)
      }}
    />
  )
}
