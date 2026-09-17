import type { Express, Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { approvalQueue } from './approvals.js'
import { extractBearerToken } from './auth.js'
import { config } from './config.js'
import { localOriginOnly } from './local-origin.js'

/**
 * Approval endpoints.
 *
 * Deliberately separate from the MCP surface: the model must not be able to
 * approve its own request. Only a caller holding the MCP token can decide, and
 * a decision additionally requires the single-use token issued with the
 * request, so a leaked activity feed alone cannot authorise anything.
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Express 5 types route params as `string | string[]`; only a single value is
 * meaningful for an id, so coerce and reject anything else.
 */
function paramId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req)
  if (!token || !safeEqual(token, config.authToken)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

export function mountApprovalRoutes(app: Express): void {
  const prefixes = ['/approvals', '/agent/approvals'] as const

  for (const prefix of prefixes) {
    /** Pending requests (never includes the decision token). */
    app.get(prefix, requireAuth, (_req, res) => {
      res.json({ enabled: approvalQueue.isEnabled, pending: approvalQueue.list() })
    })

    /**
     * Local-origin variants for the bundled activity UI.
     *
     * Listing pending work is safe without a bearer token: the response never
     * contains the decision token, and the route is loopback-only. Deciding
     * still requires that token, so a local page cannot approve by itself —
     * and the model, which does see the token, cannot approve either without
     * the user relaying it into the UI.
     */
    app.get(`${prefix}-ui/pending`, localOriginOnly, (_req, res) => {
      res.json({ enabled: approvalQueue.isEnabled, pending: approvalQueue.list() })
    })

    app.post(`${prefix}-ui/:id`, localOriginOnly, (req, res) => {
      const body = (req.body ?? {}) as { decision?: string; token?: string }
      if (body.decision !== 'approve' && body.decision !== 'deny') {
        res.status(400).json({ error: "decision must be 'approve' or 'deny'" })
        return
      }
      if (typeof body.token !== 'string' || !body.token.trim()) {
        res.status(400).json({ error: 'token is required' })
        return
      }
      const id = paramId(req.params.id)
      if (!id) {
        res.status(400).json({ error: 'id is required' })
        return
      }
      const status = approvalQueue.decide(id, body.decision, body.token.trim(), 'ui')
      if (!status) {
        res.status(409).json({ error: 'No pending request for that id and token' })
        return
      }
      res.json({ id, status })
    })

    app.get(`${prefix}/:id`, requireAuth, (req, res) => {
      const id = paramId(req.params.id)
      if (!id) {
        res.status(400).json({ error: 'id is required' })
        return
      }
      const view = approvalQueue.get(id)
      if (!view) {
        res.status(404).json({ error: 'Unknown approval request' })
        return
      }
      res.json(view)
    })

    /**
     * Decide a request.
     *
     * Body: { decision: 'approve' | 'deny', token: string }
     * The `token` is the one issued with the request; it is single-use and is
     * compared in constant time.
     */
    app.post(`${prefix}/:id`, requireAuth, (req, res) => {
      const body = (req.body ?? {}) as { decision?: string; token?: string }
      const decision = body.decision
      if (decision !== 'approve' && decision !== 'deny') {
        res.status(400).json({ error: "decision must be 'approve' or 'deny'" })
        return
      }
      if (typeof body.token !== 'string' || !body.token.trim()) {
        res.status(400).json({ error: 'token is required' })
        return
      }
      const id = paramId(req.params.id)
      if (!id) {
        res.status(400).json({ error: 'id is required' })
        return
      }
      const status = approvalQueue.decide(id, decision, body.token.trim(), 'http')
      if (!status) {
        // Unknown, already decided, wrong token, or expired.
        res.status(409).json({ error: 'No pending request for that id and token' })
        return
      }
      res.json({ id, status })
    })
  }
}
