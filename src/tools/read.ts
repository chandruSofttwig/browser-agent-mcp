import { readFile } from 'node:fs/promises'
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { trackToolCall } from '../activity-bus.js'
import { resolveInWorkspace, toWorkspaceRelative } from '../paths.js'

export function registerReadTool(server: McpServer): void {
  server.registerTool(
    'Read',
    {
      description:
        'Read a file from the allowlisted workspace. Paths are relative to WORKSPACE_ROOT unless absolute under that root.',
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        path: z.string().describe('File path relative to workspace root'),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based start line (optional)'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Max number of lines to return (optional)'),
      },
    },
    async ({ path, offset, limit }) =>
      trackToolCall(
        'Read',
        {
          argsSummary: path,
          paths: [path],
          args: { path, offset, limit },
        },
        async () => {
          try {
            const abs = resolveInWorkspace(path, { mustExist: true })
            const raw = await readFile(abs, 'utf8')
            const lines = raw.split('\n')
            const start = offset ? Math.max(0, offset - 1) : 0
            const end = limit ? start + limit : lines.length
            const slice = lines.slice(start, end)
            const numbered = slice
              .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
              .join('\n')
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `File: ${toWorkspaceRelative(abs)}\n\n${numbered}`,
                },
              ],
            }
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Read failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            }
          }
        },
      ),
  )
}
