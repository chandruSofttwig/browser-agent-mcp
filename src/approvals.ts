import { randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { activityBus } from './activity-bus.js'

/**
 * Approval gating for destructive tools.
 *
 * `Bash`, `Write` and `Edit` can change the user's files, and they are driven
 * by a remote model. Sandboxing limits the blast radius to the workspace, but
 * "the model can silently rewrite my repo" is still a different proposition
 * from "the model can read it". This module makes each destructive call wait
 * for an explicit human decision.
 *
 * Design:
 *  - A pending request is published on the activity bus, so the existing
 *    activity UI (and any other subscriber) can render it.
 *  - The decision can come from the UI over HTTP, or from the CLI on the same
 *    machine. Both go through {@link ApprovalQueue.decide}.
 *  - If nobody answers within APPROVAL_TIMEOUT_MS the request is DENIED. A
 *    timeout must never mean "allowed" for a destructive operation — an
 *    unattended server would otherwise execute anything.
 *  - The decision token is compared in constant time and is single-use.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface ApprovalRequest {
  id: string
  /** Opaque single-use token the approver must present. */
  token: string
  tool: string
  /** One-line description of what is about to happen. */
  summary: string
  /** Workspace-relative paths the call will touch, when known. */
  paths: string[]
  /** Full arguments, so the approver can see exactly what runs. */
  args: Record<string, unknown>
  createdAt: number
  expiresAt: number
  status: ApprovalStatus
  decidedAt?: number
  decidedBy?: string
  reason?: string
}

export interface ApprovalView {
  id: string
  tool: string
  summary: string
  paths: string[]
  args: Record<string, unknown>
  createdAt: number
  expiresAt: number
  status: ApprovalStatus
  reason?: string
}

export class ApprovalDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalDeniedError'
  }
}

/** Tools that must be approved before they run. */
const DEFAULT_GATED_TOOLS = new Set(['Bash', 'Write', 'Edit'])

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export class ApprovalQueue {
  private pending = new Map<string, ApprovalRequest>()
  private waiters = new Map<
    string,
    { resolve: (value: ApprovalStatus) => void; timer: NodeJS.Timeout }
  >()
  private readonly gated: Set<string>
  private readonly enabled: boolean
  private readonly timeoutMs: number

  constructor(options?: {
    enabled?: boolean
    timeoutMs?: number
    gatedTools?: Iterable<string>
  }) {
    this.enabled = options?.enabled ?? config.approvalsEnabled
    this.timeoutMs = options?.timeoutMs ?? config.approvalTimeoutMs
    this.gated = new Set(options?.gatedTools ?? DEFAULT_GATED_TOOLS)
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  requiresApproval(tool: string): boolean {
    return this.enabled && this.gated.has(tool)
  }

  /**
   * Requests still awaiting a decision, newest last.
   *
   * Decided requests are retained briefly (so a late poll can observe the
   * outcome) but are filtered out here — a caller listing "pending" work must
   * never be shown something that can no longer be acted on.
   */
  list(): ApprovalView[] {
    this.sweepExpired()
    return [...this.pending.values()]
      .filter((request) => request.status === 'pending')
      .map(toView)
  }

  get(id: string): ApprovalView | null {
    const request = this.pending.get(id)
    return request ? toView(request) : null
  }

  /**
   * Register a request and wait for a decision.
   *
   * Resolves with the final status; never throws for a denial, so callers can
   * shape their own error message.
   */
  async request(input: {
    tool: string
    summary: string
    paths?: string[]
    args?: Record<string, unknown>
  }): Promise<{ id: string; status: ApprovalStatus }> {
    const now = Date.now()
    const id = randomUUID()
    const request: ApprovalRequest = {
      id,
      token: randomUUID(),
      tool: input.tool,
      summary: input.summary,
      paths: input.paths ?? [],
      args: input.args ?? {},
      createdAt: now,
      expiresAt: now + this.timeoutMs,
      status: 'pending',
    }
    this.pending.set(id, request)

    // Surfaced so the activity UI can prompt, and so `andro-agent approvals`
    // shows it in a terminal.
    activityBus.emitApprovalRequested({
      id,
      tool: request.tool,
      summary: request.summary,
      paths: request.paths,
      args: request.args,
      expiresAt: request.expiresAt,
    })

    const status = await new Promise<ApprovalStatus>((resolve) => {
      const timer = setTimeout(() => {
        this.settle(id, 'expired', 'timeout')
        resolve('expired')
      }, this.timeoutMs)
      // Do not hold the event loop open purely for an approval.
      timer.unref?.()
      this.waiters.set(id, { resolve, timer })
    })

    return { id, status }
  }

  /**
   * Apply a decision. `token` must match the one issued for this request.
   *
   * @returns the resulting status, or null when the request is unknown,
   *          already decided, or the token is wrong.
   */
  decide(id: string, decision: 'approve' | 'deny', token: string, by?: string): ApprovalStatus | null {
    const request = this.pending.get(id)
    if (!request || request.status !== 'pending') {
      return null
    }
    if (!safeEqual(token, request.token)) {
      return null
    }
    const status: ApprovalStatus = decision === 'approve' ? 'approved' : 'denied'
    this.settle(id, status, by ?? 'unknown')
    return status
  }

  /** Drop a request without deciding it (e.g. the caller gave up). */
  cancel(id: string, reason = 'cancelled'): void {
    const request = this.pending.get(id)
    if (request && request.status === 'pending') {
      this.settle(id, 'denied', reason)
    }
  }

  private settle(id: string, status: ApprovalStatus, by: string): void {
    const request = this.pending.get(id)
    if (!request) return
    request.status = status
    request.decidedAt = Date.now()
    request.decidedBy = by

    const waiter = this.waiters.get(id)
    if (waiter) {
      clearTimeout(waiter.timer)
      this.waiters.delete(id)
      waiter.resolve(status)
    }
    if (status !== 'pending') {
      activityBus.emitApprovalDecided({ id, tool: request.tool, status, by })
    }
    // Keep the record briefly so a late UI poll can observe the outcome.
    const ttl = setTimeout(() => this.pending.delete(id), 60_000)
    ttl.unref?.()
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const request of [...this.pending.values()]) {
      if (request.status === 'pending' && request.expiresAt <= now) {
        this.settle(request.id, 'expired', 'timeout')
      }
    }
  }
}

function toView(request: ApprovalRequest): ApprovalView {
  return {
    id: request.id,
    tool: request.tool,
    summary: request.summary,
    paths: request.paths,
    args: request.args,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    status: request.status,
    reason: request.reason,
  }
}

export const approvalQueue = new ApprovalQueue()
