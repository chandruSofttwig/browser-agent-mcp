import { approvalQueue, ApprovalDeniedError, type ApprovalView } from './approvals.js'

/**
 * Bridge between the tool layer and {@link approvalQueue}.
 *
 * Kept separate from the tools so the policy ("which calls need a human") lives
 * in one place and the tool bodies stay purely about doing the work.
 */

/**
 * Build a `beforeRun` hook for a destructive tool.
 *
 * Returns null when the call may proceed, or a message to return to the model.
 * A denial is reported as a normal tool error rather than a crash: the model
 * should learn that the action did not run and why, and be able to propose
 * something else.
 */
export function approvalGate(input: {
  tool: string
  summary: string
  paths?: string[]
  args?: Record<string, unknown>
}): (() => Promise<string | null>) | undefined {
  if (!approvalQueue.requiresApproval(input.tool)) {
    return undefined
  }
  return async () => {
    const { id, status } = await approvalQueue.request(input)
    if (status === 'approved') {
      return null
    }
    if (status === 'expired') {
      return (
        `Approval required for ${input.tool} and no decision arrived in time ` +
        `(request ${id}). The action was NOT performed. Ask the user to approve ` +
        `and retry, or choose a non-destructive approach.`
      )
    }
    return (
      `Approval for ${input.tool} was denied by the user (request ${id}). ` +
      `The action was NOT performed. Do not retry the same call; explain what ` +
      `you wanted to do and ask how to proceed.`
    )
  }
}

export { ApprovalDeniedError, approvalQueue }
export type { ApprovalView }
