import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalQueue } from '../src/approvals.js'

/**
 * Approval gating tests.
 *
 * The security-critical property is that a request which is never answered is
 * DENIED, not allowed. If that inverts, an unattended server executes whatever
 * a remote model asks for.
 */

const gated = ['Bash', 'Write', 'Edit'] as const

function queue(options?: { enabled?: boolean; timeoutMs?: number }) {
  return new ApprovalQueue({
    enabled: options?.enabled ?? true,
    timeoutMs: options?.timeoutMs ?? 200,
    gatedTools: gated,
  })
}

describe('gating policy', () => {
  test('gates destructive tools and leaves read-only ones alone', () => {
    const q = queue()
    for (const tool of gated) {
      assert.equal(q.requiresApproval(tool), true, `${tool} should be gated`)
    }
    for (const tool of ['Read', 'Glob', 'Grep']) {
      assert.equal(q.requiresApproval(tool), false, `${tool} should not be gated`)
    }
  })

  test('gates nothing when disabled', () => {
    const q = queue({ enabled: false })
    assert.equal(q.isEnabled, false)
    assert.equal(q.requiresApproval('Bash'), false)
  })
})

describe('decision flow', () => {
  test('an approved request resolves as approved', async () => {
    const q = queue()
    const waiting = q.request({ tool: 'Bash', summary: 'echo hi' })
    // The approver only learns the token via the pending list.
    const [view] = q.list()
    assert.equal(view.status, 'pending')

    // Token is not exposed on the view.
    assert.equal((view as unknown as Record<string, unknown>).token, undefined)

    const pending = q['pending'].get(view.id)
    const status = q.decide(view.id, 'approve', pending.token, 'test')
    assert.equal(status, 'approved')
    assert.equal((await waiting).status, 'approved')
  })

  test('a denied request resolves as denied', async () => {
    const q = queue()
    const waiting = q.request({ tool: 'Write', summary: 'write file' })
    const [view] = q.list()
    const token = q['pending'].get(view.id).token

    assert.equal(q.decide(view.id, 'deny', token, 'test'), 'denied')
    assert.equal((await waiting).status, 'denied')
  })

  test('a wrong token cannot decide', async () => {
    const q = queue({ timeoutMs: 150 })
    const waiting = q.request({ tool: 'Bash', summary: 'rm -rf /' })
    const [view] = q.list()

    assert.equal(q.decide(view.id, 'approve', 'not-the-token', 'attacker'), null)
    // Still pending, so it must fall through to the timeout denial.
    assert.equal((await waiting).status, 'expired')
  })

  test('a decision cannot be replayed', async () => {
    const q = queue()
    const waiting = q.request({ tool: 'Edit', summary: 'edit' })
    const [view] = q.list()
    const token = q['pending'].get(view.id).token

    assert.equal(q.decide(view.id, 'deny', token, 'test'), 'denied')
    assert.equal(q.decide(view.id, 'approve', token, 'test'), null, 'second decide must be ignored')
    assert.equal((await waiting).status, 'denied')
  })

  test('an unanswerable request times out as denied, never approved', async () => {
    const q = queue({ timeoutMs: 120 })
    const { status } = await q.request({ tool: 'Bash', summary: 'unattended' })
    assert.equal(status, 'expired')
    assert.notEqual(status, 'approved')
  })

  test('cancel denies a pending request', async () => {
    const q = queue({ timeoutMs: 5000 })
    const waiting = q.request({ tool: 'Bash', summary: 'x' })
    const [view] = q.list()
    q.cancel(view.id, 'caller-gave-up')
    assert.equal((await waiting).status, 'denied')
  })
})

describe('pending list', () => {
  test('does not leak the decision token', async () => {
    const q = queue({ timeoutMs: 5000 })
    const waiting = q.request({ tool: 'Bash', summary: 'secret' })
    const [view] = q.list()
    assert.equal('token' in view, false)
    q.cancel(view.id)
    await waiting
  })

  test('drops expired entries from the list', async () => {
    const q = queue({ timeoutMs: 80 })
    await q.request({ tool: 'Bash', summary: 'expires' })
    assert.equal(q.list().length, 0, 'expired request should not still be pending')
  })
})
