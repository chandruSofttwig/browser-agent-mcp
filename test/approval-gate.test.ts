import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvalGate } from '../src/tool-approval.js'
import { approvalQueue } from '../src/approvals.js'
import { trackToolCall } from '../src/activity-bus.js'

/**
 * Verifies the gate is actually in the call path: a tool wrapped with
 * trackToolCall + approvalGate must not run its body until a human approves,
 * and must refuse when the decision is a denial.
 *
 * Uses the exported singletons, so it drives the same objects the tools use.
 */

let root: string

before(() => {
  root = mkdtempSync(join(tmpdir(), 'andro-gate-'))
})

after(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

function decidePending(decision: 'approve' | 'deny'): void {
  const pending = approvalQueue.list()
  assert.equal(pending.length, 1, 'expected exactly one pending approval')
  // The decision token lives on the internal record; reach it the same way an
  // approver would (via the CLI/HTTP path, which looks it up by id).
  const internal = (approvalQueue as unknown as {
    pending: Map<string, { token: string }>
  }).pending.get(pending[0].id)
  assert.ok(internal, 'pending record missing')
  const status = approvalQueue.decide(pending[0].id, decision, internal.token, 'test')
  assert.ok(status, 'decision should be accepted')
}

describe('approval gate integration', () => {
  test('blocks the body until approved, then runs it', async () => {
    const target = join(root, 'approved.txt')
    let ran = false

    const call = trackToolCall(
      'Write',
      {
        argsSummary: target,
        paths: [target],
        beforeRun: approvalGate({
          tool: 'Write',
          summary: `write ${target}`,
          paths: [target],
        }),
      },
      async () => {
        ran = true
        return { content: [{ type: 'text', text: 'ok' }] }
      },
    )

    // Body must not have run while the decision is outstanding.
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(ran, false, 'tool body ran before approval')

    decidePending('approve')
    const result = await call
    assert.equal(result.isError, undefined)
    assert.equal(ran, true, 'tool body did not run after approval')
  })

  test('refuses to run the body when denied', async () => {
    let ran = false

    const call = trackToolCall(
      'Bash',
      {
        argsSummary: 'rm -rf /',
        beforeRun: approvalGate({ tool: 'Bash', summary: 'rm -rf /' }),
      },
      async () => {
        ran = true
        return { content: [{ type: 'text', text: 'should not happen' }] }
      },
    )

    await new Promise((r) => setTimeout(r, 50))
    assert.equal(ran, false)

    decidePending('deny')
    const result = await call

    assert.equal(result.isError, true, 'denied call should report an error')
    assert.equal(ran, false, 'denied call must not execute')

    const text = (result.content as Array<{ text: string }>)[0].text
    assert.match(text, /denied/i)
    assert.match(text, /NOT performed/i)
  })

  test('a read-only tool is not gated', async () => {
    let ran = false
    const result = await trackToolCall(
      'Read',
      {
        argsSummary: 'some/file.txt',
        beforeRun: approvalGate({ tool: 'Read', summary: 'read' }),
      },
      async () => {
        ran = true
        return { content: [{ type: 'text', text: 'contents' }] }
      },
    )
    assert.equal(ran, true, 'Read should not require approval')
    assert.equal(result.isError, undefined)
  })
})

describe('every destructive tool is actually wired to the gate', () => {
  /**
   * Guards the failure mode where the gate exists but is not attached to a
   * tool: the suite passes, the policy looks implemented, and the tool runs
   * unapproved anyway. Source-level check because the wiring is a call-site
   * property that no unit test of the queue can observe.
   */
  const destructive = ['bash', 'write', 'edit'] as const

  for (const tool of destructive) {
    test(`${tool}.ts attaches approvalGate`, async () => {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const source = readFileSync(
        join(import.meta.dirname, '..', 'src', 'tools', `${tool}.ts`),
        'utf8',
      )
      assert.match(source, /approvalGate\(/, `${tool} does not call approvalGate`)
      assert.match(source, /beforeRun:/, `${tool} does not pass beforeRun to trackToolCall`)
    })
  }

  test('read-only tools are not gated', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const tool of ['read', 'glob', 'grep'] as const) {
      const source = readFileSync(
        join(import.meta.dirname, '..', 'src', 'tools', `${tool}.ts`),
        'utf8',
      )
      assert.doesNotMatch(source, /approvalGate\(/, `${tool} should not be gated`)
    }
  })
})
