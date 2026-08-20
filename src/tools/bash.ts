import { spawn } from 'node:child_process'
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { trackToolCall } from '../activity-bus.js'
import { config } from '../config.js'
import { assertCwdInWorkspace, getWorkspaceRoot, toWorkspaceRelative } from '../paths.js'

export function registerBashTool(server: McpServer): void {
  server.registerTool(
    'Bash',
    {
      description:
        'Run a shell command with cwd jailed under the workspace root. Hard timeout applies. Do not use for interactive programs.',
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
      },
      inputSchema: {
        command: z.string().describe('Shell command to run'),
        cwd: z
          .string()
          .optional()
          .describe('Working directory relative to workspace (default: workspace root)'),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(300_000)
          .optional()
          .describe('Timeout in ms (default from BASH_TIMEOUT_MS)'),
      },
    },
    async ({ command, cwd, timeout_ms }) =>
      trackToolCall(
        'Bash',
        {
          argsSummary: command.length > 80 ? `${command.slice(0, 80)}…` : command,
          paths: cwd ? [cwd] : [],
          args: { command, cwd, timeout_ms },
        },
        async () => {
          try {
            const workdir = assertCwdInWorkspace(cwd)
            const timeout = timeout_ms ?? config.bashTimeoutMs
            const result = await new Promise<{
              code: number | null
              stdout: string
              stderr: string
              timedOut: boolean
            }>((resolve) => {
              const child = spawn('/bin/bash', ['-lc', command], {
                cwd: workdir,
                env: {
                  PATH: process.env.PATH,
                  HOME: process.env.HOME,
                  USER: process.env.USER,
                  LANG: process.env.LANG ?? 'C.UTF-8',
                  TERM: 'dumb',
                  BROWSER_AGENT_MCP_WORKSPACE: getWorkspaceRoot(),
                },
                stdio: ['ignore', 'pipe', 'pipe'],
              })
              let stdout = ''
              let stderr = ''
              let timedOut = false
              const timer = setTimeout(() => {
                timedOut = true
                child.kill('SIGKILL')
              }, timeout)
              child.stdout.on('data', (chunk: Buffer) => {
                if (stdout.length < 200_000) stdout += chunk.toString('utf8')
              })
              child.stderr.on('data', (chunk: Buffer) => {
                if (stderr.length < 50_000) stderr += chunk.toString('utf8')
              })
              child.on('close', (code) => {
                clearTimeout(timer)
                resolve({ code, stdout, stderr, timedOut })
              })
              child.on('error', (err) => {
                clearTimeout(timer)
                resolve({ code: 1, stdout, stderr: err.message, timedOut })
              })
            })

            const parts = [
              `cwd: ${toWorkspaceRelative(workdir)}`,
              `exit: ${result.timedOut ? 'timeout' : result.code}`,
            ]
            if (result.stdout) parts.push(`stdout:\n${result.stdout}`)
            if (result.stderr) parts.push(`stderr:\n${result.stderr}`)
            if (result.timedOut) {
              parts.push(`Command killed after ${timeout}ms`)
            }

            return {
              isError: Boolean(result.timedOut || (result.code !== 0 && result.code !== null)),
              content: [{ type: 'text' as const, text: parts.join('\n\n') }],
            }
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Bash failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            }
          }
        },
      ),
  )
}
