import { randomUUID } from 'node:crypto'

export type ActivityStatus = 'started' | 'progress' | 'ok' | 'error' | 'awaiting-approval'

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
  /** Present on approval lifecycle events, so a UI can render the prompt. */
  approval?: {
    status: 'pending' | 'approved' | 'denied' | 'expired'
    summary: string
    expiresAt?: number
    by?: string
  }
}

type Listener = (event: ActivityEvent) => void

const MAX_EVENTS = 200

class ActivityBus {
  private events: ActivityEvent[] = []
  private listeners = new Set<Listener>()

  snapshot(): ActivityEvent[] {
    return [...this.events]
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    this.events = []
  }

  private push(event: ActivityEvent): void {
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS)
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore listener errors
      }
    }
  }

  emitStarted(input: {
    tool: string
    argsSummary: string
    paths?: string[]
    args?: Record<string, unknown>
  }): string {
    const id = randomUUID()
    this.push({
      id,
      ts: Date.now(),
      tool: input.tool,
      status: 'started',
      argsSummary: input.argsSummary,
      paths: input.paths ?? [],
      args: input.args,
    })
    return id
  }

  emitProgress(input: {
    id: string
    tool: string
    argsSummary: string
    paths?: string[]
    args?: Record<string, unknown>
    output: string
    outputType?: 'stdout' | 'stderr' | 'info'
    progress?: number
  }): void {
    this.push({
      id: input.id,
      ts: Date.now(),
      tool: input.tool,
      status: 'progress',
      argsSummary: input.argsSummary,
      paths: input.paths ?? [],
      args: input.args,
      output: input.output,
      outputType: input.outputType,
      progress: input.progress,
    })
  }

  emitFinished(input: {
    id: string
    tool: string
    status: 'ok' | 'error'
    argsSummary: string
    paths?: string[]
    args?: Record<string, unknown>
    durationMs: number
    error?: string
    output?: string
    outputType?: 'stdout' | 'stderr' | 'info'
    progress?: number
  }): void {
    this.push({
      id: input.id,
      ts: Date.now(),
      tool: input.tool,
      status: input.status,
      argsSummary: input.argsSummary,
      paths: input.paths ?? [],
      args: input.args,
      durationMs: input.durationMs,
      error: input.error,
      output: input.output,
      outputType: input.outputType,
      progress: input.progress,
    })
  }

  /** A destructive call is waiting for a human decision. */
  emitApprovalRequested(input: {
    id: string
    tool: string
    summary: string
    paths?: string[]
    args?: Record<string, unknown>
    expiresAt: number
  }): void {
    this.push({
      id: input.id,
      ts: Date.now(),
      tool: input.tool,
      status: 'awaiting-approval',
      argsSummary: input.summary,
      paths: input.paths ?? [],
      args: input.args,
      approval: {
        status: 'pending',
        summary: input.summary,
        expiresAt: input.expiresAt,
      },
    })
  }

  /** The decision landed (approved, denied, or timed out). */
  emitApprovalDecided(input: {
    id: string
    tool: string
    status: 'approved' | 'denied' | 'expired'
    by: string
  }): void {
    this.push({
      id: input.id,
      ts: Date.now(),
      tool: input.tool,
      status: input.status === 'approved' ? 'started' : 'error',
      argsSummary: `approval ${input.status}`,
      paths: [],
      approval: { status: input.status, summary: '', by: input.by },
    })
  }
}

export const activityBus = new ActivityBus()

/** Run a tool handler while emitting started/ok/error activity events. */
export async function trackToolCall<T extends { isError?: boolean; content?: unknown }>(
  tool: string,
  meta: {
    argsSummary: string
    paths?: string[]
    args?: Record<string, unknown>
    onProgress?: (progress: { output: string; outputType?: 'stdout' | 'stderr' | 'info'; progress?: number }) => void
    /**
     * Consulted before the call starts. Returning a string aborts the call and
     * surfaces that text to the model as an error — used for approval gating so
     * the tool implementations stay unaware of the policy.
     */
    beforeRun?: () => Promise<string | null>
  },
  fn: (emitProgress: (progress: { output: string; outputType?: 'stdout' | 'stderr' | 'info'; progress?: number }) => void) => Promise<T>,
): Promise<T> {
  if (meta.beforeRun) {
    const blocked = await meta.beforeRun()
    if (blocked) {
      return {
        isError: true,
        content: [{ type: 'text', text: blocked }],
      } as unknown as T
    }
  }
  const started = Date.now()
  const id = activityBus.emitStarted({
    tool,
    argsSummary: meta.argsSummary,
    paths: meta.paths,
    args: meta.args,
  })
  const emitProgress = (progress: { output: string; outputType?: 'stdout' | 'stderr' | 'info'; progress?: number }) => {
    if (!progress.output) return
    activityBus.emitProgress({ id, tool, argsSummary: meta.argsSummary, paths: meta.paths, args: meta.args, ...progress })
    meta.onProgress?.(progress)
  }
  try {
    const result = await fn(emitProgress)
    const durationMs = Date.now() - started
    if (result.isError) {
      let errorText = 'Tool returned an error'
      const content = result.content
      if (Array.isArray(content) && content[0] && typeof content[0] === 'object') {
        const first = content[0] as { text?: string }
        if (typeof first.text === 'string') errorText = first.text.slice(0, 500)
      }
      activityBus.emitFinished({
        id,
        tool,
        status: 'error',
        argsSummary: meta.argsSummary,
        paths: meta.paths,
        args: meta.args,
        durationMs,
        error: errorText,
      })
    } else {
      activityBus.emitFinished({
        id,
        tool,
        status: 'ok',
        argsSummary: meta.argsSummary,
        paths: meta.paths,
        args: meta.args,
        durationMs,
      })
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    activityBus.emitFinished({
      id,
      tool,
      status: 'error',
      argsSummary: meta.argsSummary,
      paths: meta.paths,
      args: meta.args,
      durationMs: Date.now() - started,
      error: message,
    })
    throw error
  }
}

